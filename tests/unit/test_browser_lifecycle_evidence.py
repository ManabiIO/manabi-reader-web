"""Exercise real diagnostic/teardown code without launching a browser."""
from contextlib import contextmanager, redirect_stdout
import importlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tests/browser'))
from lifecycle_evidence import LifecycleEvidence, case_failed, close_context_with_evidence


class Emitter:
    def __init__(self):
        self.listeners = {}

    def on(self, event, callback):
        self.listeners.setdefault(event, []).append(callback)

    def emit(self, event, *args):
        for callback in self.listeners.get(event, []):
            callback(*args)


class Page(Emitter):
    url = 'http://127.0.0.1:39967/reader-web/videos'

    def content(self):
        return '<html></html>'

    def screenshot(self, **_):
        pass


class Context(Emitter):
    def __init__(self, page):
        super().__init__()
        self.pages = [page]
        self.scripts = []
        self.on_close = lambda: None
        self.closed = False

    def add_init_script(self, script):
        self.scripts.append(script)

    def close(self):
        self.on_close()
        for page in self.pages:
            page.emit('close')
        self.closed = True


def error(name='TypeError', message='synthetic application failure', stack='at app.js:1'):
    return SimpleNamespace(name=name, message=message, stack=stack)


@contextmanager
def temporary_working_directory():
    original = Path.cwd()
    with tempfile.TemporaryDirectory() as directory:
        try:
            os.chdir(directory)
            yield Path(directory)
        finally:
            os.chdir(original)


class BrowserLifecycleEvidence(unittest.TestCase):
    def fixture(self):
        page = Page()
        context = Context(page)
        evidence = LifecycleEvidence(context, page, 'webkit')
        return page, context, evidence

    def test_raw_error_identity_and_disposal_order_preserve_existing_observers(self):
        page, context, evidence = self.fixture()
        original = []
        page.on('pageerror', original.append)
        body_error = error()
        disposal_error = error('Fetch API cannot load http:',
                               '//127.0.0.1:39967/reader-web/service-worker.js due to access control checks.',
                               None)
        page.emit('pageerror', body_error)
        context.on_close = lambda: page.emit('pageerror', disposal_error)
        close_context_with_evidence(context, evidence)
        self.assertEqual([body_error, disposal_error], original)
        events = list(evidence.events)
        before, during = evidence.page_errors
        start = next(event for event in events if event['event'] == 'context-close-start')
        end = next(event for event in events if event['event'] == 'context-close-end')
        self.assertLess(before['sequence'], start['sequence'])
        self.assertLess(start['sequence'], during['sequence'])
        self.assertLess(during['sequence'], end['sequence'])
        self.assertLessEqual(start['seconds'], during['seconds'])
        self.assertLessEqual(during['seconds'], end['seconds'])
        self.assertEqual(disposal_error.name, during['name'])
        self.assertEqual(disposal_error.message, during['message'])
        self.assertIsNone(during['stack'])
        self.assertEqual(page.url, during['document'])
        self.assertTrue(end['completed'])

    def test_secondary_pages_are_identified_without_duplicate_observers(self):
        page, context, evidence = self.fixture()
        secondary = Page()
        secondary.url = 'http://127.0.0.1:40000/reader-web/manage'
        context.pages.append(secondary)
        context.emit('page', secondary)
        context.emit('page', secondary)
        secondary.emit('pageerror', error())
        page.emit('pageerror', error())
        self.assertEqual([2, 1], [event['page'] for event in evidence.page_errors])
        self.assertEqual(secondary.url, evidence.page_errors[0]['document'])

    def test_retention_is_bounded_and_does_not_lose_early_error_identity_silently(self):
        page, _, evidence = self.fixture()
        for index in range(40):
            page.emit('pageerror', error(message=str(index)))
        for index in range(600):
            evidence.record('request', url=f'/fixture-{index}')
        with temporary_working_directory(), redirect_stdout(io.StringIO()) as output:
            evidence.write('retention', failed=True)
            payload = json.loads(output.getvalue().split('BROWSER LIFECYCLE FAILURE: ', 1)[1])
        self.assertEqual(512, len(payload['events']))
        self.assertGreater(payload['events_omitted'], 0)
        self.assertEqual(40, payload['page_errors_seen'])
        self.assertEqual(8, payload['page_errors_omitted'])
        self.assertEqual([str(index) for index in range(8, 40)],
                         [event['message'] for event in payload['page_errors']])

    def test_success_is_quiet_and_failure_is_printed_even_when_disk_write_fails(self):
        _, _, evidence = self.fixture()
        with temporary_working_directory(), redirect_stdout(io.StringIO()) as output:
            evidence.write('success')
            self.assertEqual('', output.getvalue())
            with patch.object(Path, 'write_text', side_effect=OSError('synthetic disk failure')):
                with self.assertRaisesRegex(OSError, 'synthetic disk failure'):
                    evidence.write('failed', failed=True)
            self.assertIn('BROWSER LIFECYCLE FAILURE:', output.getvalue())

    def test_close_exception_is_rethrown_and_the_boundary_is_still_recorded(self):
        _, context, evidence = self.fixture()
        def fail_close():
            raise RuntimeError('synthetic close failure')
        context.on_close = fail_close
        with self.assertRaisesRegex(RuntimeError, 'synthetic close failure'):
            close_context_with_evidence(context, evidence)
        self.assertEqual('context-close-end', evidence.events[-1]['event'])
        self.assertFalse(evidence.events[-1]['completed'])

    def test_init_script_only_observes_native_errors(self):
        _, context, _ = self.fixture()
        script, = context.scripts
        for event in ('error', 'unhandledrejection', 'pagehide', 'pageshow'):
            self.assertIn(f"addEventListener('{event}'", script)
        self.assertNotIn('preventDefault', script)
        self.assertNotIn('stopPropagation', script)
        self.assertNotIn('.catch(', script)

    def test_body_and_subtest_failures_are_detected_without_pageerrors(self):
        for kind in ('body', 'subtest', 'success'):
            with self.subTest(kind=kind):
                observed = []
                class ActualCase(unittest.TestCase):
                    def runTest(self):
                        if kind == 'body':
                            self.fail('synthetic body failure')
                        if kind == 'subtest':
                            with self.subTest(mode='synthetic'):
                                self.fail('synthetic subtest failure')

                    def tearDown(self):
                        observed.append(case_failed(self))

                case = ActualCase()
                self.assertFalse(case_failed(case))
                case.run(unittest.TestResult())
                self.assertEqual([kind != 'success'], observed)

    def test_real_teardown_still_fails_on_disposal_pageerror_and_logs_boundaries(self):
        # Only satisfy import-time Playwright symbols. Real fixture tearDown,
        # unittest assertions and diagnostic emission execute unchanged.
        api = ModuleType('playwright.sync_api')
        def unavailable(*_, **__):
            raise AssertionError('A diagnostic unit test must not launch Playwright')
        api.expect = api.sync_playwright = unavailable
        with patch.dict(sys.modules, {'playwright.sync_api': api}):
            appearance = importlib.import_module('test_appearance_refinement')
        case = appearance.RefinedAppearance('test_video_release_gate_keeps_default_build_dormant')
        page, context, evidence = self.fixture()
        case.page, case.context, case.lifecycle = page, context, evidence
        case.errors, case.network = [], []
        case.origin = 'http://127.0.0.1:39967'
        case.thread = SimpleNamespace(is_alive=lambda: True)
        page.on('pageerror', lambda exception: case.errors.append(exception.stack or exception.message))
        context.on_close = lambda: page.emit('pageerror', error())
        with temporary_working_directory(), redirect_stdout(io.StringIO()) as output:
            with self.assertRaises(AssertionError):
                case.tearDown()
        self.assertTrue(context.closed)
        self.assertEqual(['at app.js:1'], case.errors)
        payload = json.loads(output.getvalue().split('BROWSER LIFECYCLE FAILURE: ', 1)[1])
        events = payload['events']
        self.assertEqual(['teardown-start', 'context-close-start', 'pageerror', 'close', 'context-close-end'],
                         [event['event'] for event in events if event['event'] not in ('start', 'page-attached')])
        self.assertEqual(case.origin, next(event for event in events if event['event'] == 'teardown-start')['origin'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
