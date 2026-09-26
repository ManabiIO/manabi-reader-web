"""Exercise the launcher with real child processes, not invented exit statuses."""
import importlib.util
import io
import json
import os
from contextlib import redirect_stdout
from pathlib import Path
import signal
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('gate', ROOT / 'tests/browser/qualify_library_data_safety.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class LibraryReleaseDiagnostics(unittest.TestCase):
    def run_groups(self, directory, selected):
        with patch.object(gate, 'ROOT', Path(directory)), patch.object(gate, 'groups', return_value=selected), redirect_stdout(io.StringIO()) as console:
            status = gate.qualify('all')
        output = Path(directory) / 'test-results'
        return status, json.loads((output / 'library-data-safety-all.json').read_text()), console.getvalue()

    def test_real_failure_retains_both_streams_and_runs_later_group(self):
        with tempfile.TemporaryDirectory() as directory:
            script = "import os,sys;os.write(1,b'first-out\\n');os.write(2,b'first-err\\n');sys.exit(7)"
            status, report, console = self.run_groups(directory, [
                ('first', 'chromium', ['-c', script]),
                ('later', 'webkit', ['-c', "print('later-result')"]),
            ])
            self.assertEqual(1, status)
            self.assertEqual([7, 0], [row['returncode'] for row in report])
            self.assertEqual(['completed', 'completed'], [row['status'] for row in report])
            logs = [(Path(directory) / row['log']).read_text() for row in report]
            for text in ('first-out', 'first-err'):
                self.assertIn(text, logs[0]); self.assertIn(text, console)
            self.assertIn('later-result', logs[1])

    @unittest.skipUnless(os.name == 'posix', 'POSIX signal exit semantics')
    def test_real_signal_is_not_turned_into_a_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            status, report, _ = self.run_groups(directory, [
                ('terminated', 'webkit', ['-c', "import os,signal;print('before-signal',flush=True);os.kill(os.getpid(),signal.SIGTERM)"]),
                ('after-signal', 'chromium', ['-c', 'pass']),
            ])
            self.assertEqual(1, status)
            self.assertEqual([-signal.SIGTERM, 0], [row['returncode'] for row in report])
            self.assertIn('before-signal', (Path(directory) / report[0]['log']).read_text())

    def test_large_no_newline_unicode_output_is_preserved_without_pipe_deadlock(self):
        with tempfile.TemporaryDirectory() as directory:
            payload = ('猫' * 70000 + '\n').encode()
            status, report, console = self.run_groups(directory, [
                ('large', 'chromium', ['-c', "import os;os.write(1,('猫'*70000+'\\n').encode())"]),
            ])
            self.assertEqual(0, status)
            self.assertEqual(payload, (Path(directory) / report[0]['log']).read_bytes())
            self.assertIn('猫' * 70000, console)

    def test_partial_report_cannot_reuse_an_earlier_success(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'test-results'; output.mkdir()
            report_path = output / 'library-data-safety-all.json'
            report_path.write_text('[{"status":"completed","returncode":0}]')
            selected = [('first', 'chromium', ['-c', 'pass']), ('next', 'webkit', ['-c', 'pass'])]
            def interrupted(*args, **kwargs):
                current = json.loads(report_path.read_text())
                self.assertEqual(['running', 'pending'], [row['status'] for row in current])
                self.assertEqual([None, None], [row['returncode'] for row in current])
                raise KeyboardInterrupt()
            with patch.object(gate, 'ROOT', Path(directory)), patch.object(gate, 'groups', return_value=selected), patch.object(gate, 'run_group', side_effect=interrupted), redirect_stdout(io.StringIO()):
                with self.assertRaises(KeyboardInterrupt): gate.qualify('all')
            current = json.loads(report_path.read_text())
            self.assertEqual(['interrupted', 'pending'], [row['status'] for row in current])
            self.assertEqual([None, None], [row['returncode'] for row in current])

    def test_launch_failure_is_recorded_and_later_groups_are_not_lost(self):
        original = subprocess.Popen
        calls = 0
        def launch(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 1: raise FileNotFoundError('test executable unavailable')
            return original(*args, **kwargs)
        with tempfile.TemporaryDirectory() as directory, patch.object(gate.subprocess, 'Popen', side_effect=launch):
            status, report, _ = self.run_groups(directory, [
                ('missing', 'chromium', ['-c', 'pass']),
                ('later', 'webkit', ['-c', "print('still-qualified')"]),
            ])
            self.assertEqual(1, status)
            self.assertEqual(['launch-failed', 'completed'], [row['status'] for row in report])
            self.assertIn('test executable unavailable', report[0]['error'])
            self.assertIn('test executable unavailable', (Path(directory) / report[0]['log']).read_text())
            self.assertEqual(0, report[1]['returncode'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
