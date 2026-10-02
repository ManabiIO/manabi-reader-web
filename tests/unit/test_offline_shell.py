"""Browser-free regressions for the actual offline handoff helper and its JS."""
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('offline_shell', ROOT / 'tests/browser/offline_shell.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
SCOPE = 'http://127.0.0.1:12345/reader-web/'


class FakePage:
    def __init__(self, controlled=False, ready_error=None, control_error=None, reload_error=None):
        self.controlled = controlled
        self.ready_error = ready_error
        self.control_error = control_error
        self.reload_error = reload_error
        self.calls = []

    def evaluate(self, expression, argument):
        self.calls.append(('ready', expression, argument))
        if self.ready_error:
            raise self.ready_error
        return self.controlled

    def reload(self, **options):
        self.calls.append(('reload', options))
        if self.reload_error:
            raise self.reload_error

    def wait_for_function(self, expression, **options):
        self.calls.append(('control', expression, options))
        if self.control_error:
            raise self.control_error


class OfflineShellHandoff(unittest.TestCase):
    def test_activation_without_claim_navigates_once_then_requires_control(self):
        page = FakePage(controlled=False)
        helper.enter_offline_shell(page, SCOPE, timeout=321)
        self.assertEqual(['ready', 'reload', 'control'], [call[0] for call in page.calls])
        self.assertEqual((helper.READY, {'scope': SCOPE, 'timeout': 321}), page.calls[0][1:])
        self.assertEqual({'timeout': 321}, page.calls[1][1])
        self.assertEqual((helper.CONTROLLED, {'arg': SCOPE, 'timeout': 321}), page.calls[2][1:])

    def test_already_controlled_document_is_not_reloaded(self):
        page = FakePage(controlled=True)
        helper.enter_offline_shell(page, SCOPE)
        self.assertEqual(['ready', 'control'], [call[0] for call in page.calls])
        self.assertEqual(20000, page.calls[-1][2]['timeout'])

    def test_reload_timeout_propagates_without_a_second_navigation(self):
        failure = TimeoutError('normal document handoff timed out')
        page = FakePage(reload_error=failure)
        with self.assertRaises(TimeoutError) as caught:
            helper.enter_offline_shell(page, SCOPE)
        self.assertIs(failure, caught.exception)
        self.assertEqual(['ready', 'reload'], [call[0] for call in page.calls])
        self.assertEqual({'timeout': 20000}, page.calls[1][1])

    def test_readiness_failure_propagates_without_navigation(self):
        failure = RuntimeError('offline shell installation failed')
        page = FakePage(ready_error=failure)
        with self.assertRaises(RuntimeError) as caught:
            helper.enter_offline_shell(page, SCOPE)
        self.assertIs(failure, caught.exception)
        self.assertEqual(['ready'], [call[0] for call in page.calls])

    def test_control_failure_propagates_without_a_reload_loop(self):
        failure = TimeoutError('worker never controls the replacement document')
        page = FakePage(control_error=failure)
        with self.assertRaises(TimeoutError) as caught:
            helper.enter_offline_shell(page, SCOPE)
        self.assertIs(failure, caught.exception)
        self.assertEqual(['ready', 'reload', 'control'], [call[0] for call in page.calls])

    def javascript(self, fixture, *, expression=None):
        # Execute the exact browser expression; no Playwright/browser dependency.
        # The timer is real and bounded, including the never-ready failure case.
        source = r'''
          const fs = require('node:fs');
          const {expression, fixture, scope} = JSON.parse(fs.readFileSync(0, 'utf8'));
          let cleared = 0;
          const nativeClearTimeout = globalThis.clearTimeout;
          globalThis.clearTimeout = timer => { cleared++; nativeClearTimeout(timer); };
          const worker = {ready: fixture.never ? new Promise(() => {}) :
            new Promise(resolve => setTimeout(() => resolve({scope: fixture.scope ?? scope}), 0)),
            controller: fixture.controller ?? null,
            addEventListener() { throw Error('An uncontrolled document never receives a claim'); }};
          Object.defineProperty(globalThis, 'navigator', {value: {serviceWorker: worker}});
          (async () => {
            try {
              const run = eval('(' + expression + ')');
              const value = await run(fixture.predicate ? scope : {scope, timeout: 20});
              process.stdout.write(JSON.stringify({value, cleared}));
            } catch (error) {
              process.stdout.write(JSON.stringify({error: error.message, cleared}));
            }
          })();
        '''
        result = subprocess.run(['node', '-e', source], input=json.dumps({
            'expression': expression or helper.READY, 'fixture': fixture, 'scope': SCOPE
        }), capture_output=True, text=True, timeout=5, check=True)
        return json.loads(result.stdout)

    def test_actual_readiness_js_returns_for_delayed_activation_without_claim(self):
        self.assertEqual({'value': False, 'cleared': 1}, self.javascript({}))
        self.assertEqual({'value': True, 'cleared': 1}, self.javascript({'controller': {}}))

    def test_actual_readiness_js_rejects_never_ready_and_releases_timer(self):
        result = self.javascript({'never': True})
        self.assertEqual('Offline shell did not activate within 20ms for ' + SCOPE, result['error'])
        self.assertEqual(1, result['cleared'])

    def test_actual_readiness_js_rejects_other_deployment_scope(self):
        self.assertEqual({'error': 'Unexpected offline shell scope: http://127.0.0.1/other/',
                          'cleared': 1}, self.javascript({'scope': 'http://127.0.0.1/other/'}))

    def test_actual_control_predicate_requires_expected_active_worker(self):
        worker = {'state': 'activated', 'scriptURL': SCOPE + 'service-worker.js'}
        for controller, expected in ((None, False), (worker, True),
                                     ({**worker, 'state': 'activating'}, False),
                                     ({**worker, 'scriptURL': SCOPE + 'other-worker.js'}, False)):
            with self.subTest(controller=controller):
                result = self.javascript({'predicate': True, 'controller': controller},
                                         expression=helper.CONTROLLED)
                self.assertEqual(expected, result['value'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
