"""Probe scheduling/evidence contracts only; these tests do not use native storage."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch, MagicMock

SPEC = importlib.util.spec_from_file_location(
    'native_handle_profile', Path(__file__).with_name('native-handle-profile.py'))
PROBE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROBE)


class ProfileDriverTests(unittest.TestCase):
    def run_driver(self, selected, outcomes):
        calls = []
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            server = MagicMock(server_port=8000)

            def run(_pw, _url, mode, report):
                calls.append(mode)
                partial = {'profileMode': mode, 'passed': False,
                           'events': [{'event': 'console', 'text': 'read-admitted'}]}
                report(partial)
                # Evidence must be present before a browser call can stall/crash.
                recorded = json.loads((output / 'results.json').read_text())
                self.assertEqual(recorded[-1], partial)
                return {**partial, 'passed': outcomes[mode]}

            arguments = ['probe', '--output', directory]
            if selected:
                arguments += ['--profile-mode', selected]
            with (patch.object(sys, 'argv', arguments),
                  patch.object(PROBE, 'sync_playwright'),
                  patch.object(PROBE.http.server, 'ThreadingHTTPServer', return_value=server),
                  patch.object(PROBE.threading, 'Thread'),
                  patch.object(PROBE, 'probe', side_effect=run)):
                status = 0
                try:
                    PROBE.main()
                except SystemExit as error:
                    status = error.code
            server.shutdown.assert_called_once()
            server.server_close.assert_called_once()
            return status, calls, json.loads((output / 'results.json').read_text())

    def test_default_runs_both_and_preserves_private_failure(self):
        status, calls, rows = self.run_driver(None, {'persistent': True, 'incognito': False})
        self.assertEqual((status, calls), (1, ['persistent', 'incognito']))
        self.assertEqual([row['passed'] for row in rows], [True, False])

    def test_persistent_failure_does_not_skip_private_profile(self):
        status, calls, rows = self.run_driver('both', {'persistent': False, 'incognito': True})
        self.assertEqual((status, calls), (1, ['persistent', 'incognito']))
        self.assertEqual([row['passed'] for row in rows], [False, True])

    def test_matrix_persistent_entry_runs_only_persistent(self):
        status, calls, _ = self.run_driver('persistent', {'persistent': True})
        self.assertEqual((status, calls), (0, ['persistent']))

    def test_matrix_private_entry_remains_a_hard_gate(self):
        status, calls, _ = self.run_driver('incognito', {'incognito': False})
        self.assertEqual((status, calls), (1, ['incognito']))

    def test_both_successes_required_for_default_success(self):
        status, calls, _ = self.run_driver(None, {'persistent': True, 'incognito': True})
        self.assertEqual((status, calls), (0, ['persistent', 'incognito']))


if __name__ == '__main__':
    unittest.main()
