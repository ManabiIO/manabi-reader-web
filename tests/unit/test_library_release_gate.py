"""Run without application dependencies; exercise the actual suite dispatcher."""
import importlib.util
import io
from contextlib import redirect_stdout
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('gate', ROOT / 'tests/browser/qualify_library_data_safety.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class LibraryReleaseGate(unittest.TestCase):
    def test_required_books_workflow_runs_all_suites_without_a_condition(self):
        workflow = (ROOT / '.github/workflows/books-library.yml').read_text()
        push = workflow.split('  push:\n', 1)[1].split('permissions:', 1)[0]
        self.assertIn('branches: [main]', push)
        self.assertNotRegex(push, r'paths(?:-ignore)?:')
        step = workflow.split('      - name: Required shared and local data safety\n', 1)[1].split('      - ', 1)[0]
        self.assertIn('run: python tests/browser/qualify_library_data_safety.py', step)
        self.assertNotIn('--suite', step)
        self.assertNotRegex(step, r'if:|continue-on-error:|\|\|')
        self.assertIn('python tests/unit/test_library_release_gate.py', workflow)

    def test_standalone_pr_workflows_use_the_same_entry_point(self):
        for file, suite in (('local-library-features.yml', 'local'),
                            ('ttu-shared-qualification.yml', 'shared')):
            with self.subTest(file=file):
                workflow = (ROOT / '.github/workflows' / file).read_text()
                self.assertIn('run: python tests/browser/qualify_library_data_safety.py --suite ' + suite, workflow)
                self.assertNotIn('  push:', workflow)

    def test_both_real_engines_and_all_retained_suites_are_selected(self):
        all_groups = gate.groups('all')
        self.assertEqual(gate.groups('shared') + gate.groups('local'), all_groups)
        self.assertEqual(6, len(all_groups))
        for engine in ('chromium', 'webkit'):
            matches = [args for name, browser, args in all_groups if name == 'local-' + engine and browser == engine]
            self.assertEqual([['-m', 'unittest', *gate.LOCAL_MODULES, '-v']], matches)
        for name in ('test_library_deletion', 'test_book_save_cancellation', 'test_book_last_read',
                     'test_local_library_features', 'test_local_library_review',
                     'test_local_library_refinement', 'test_local_library_lifecycle',
                     'test_library_open_commit'):
            self.assertIn(name, gate.LOCAL_MODULES)
        for _, _, args in all_groups:
            if args[0].endswith('.py'):
                self.assertTrue((ROOT / args[0]).is_file())
            else:
                for selector in args[2:-1]:
                    self.assertTrue((ROOT / 'tests/browser' / (selector.split('.')[0] + '.py')).is_file(), selector)

    def test_each_failure_and_signal_blocks_qualification_without_hiding_other_results(self):
        expected = gate.groups('all')
        for failure in (None, *range(len(expected))):
            for status in (1, -15):
                with self.subTest(failure=failure, status=status), tempfile.TemporaryDirectory() as directory:
                    outcomes = [subprocess.CompletedProcess([], status if i == failure else 0)
                                for i in range(len(expected))]
                    with patch.object(gate, 'ROOT', Path(directory)), patch.object(gate.subprocess, 'run', side_effect=outcomes) as run, redirect_stdout(io.StringIO()):
                        self.assertEqual(int(failure is not None), gate.qualify('all'))
                    self.assertEqual(len(expected), run.call_count)
                    for call, (_, engine, args) in zip(run.call_args_list, expected):
                        self.assertEqual([gate.sys.executable, *args], call.args[0])
                        self.assertEqual(engine, call.kwargs['env']['LIBRARY_BROWSER'])
                        self.assertEqual(engine, call.kwargs['env']['PICKS_BROWSER'])
                    self.assertTrue((Path(directory) / 'test-results/library-data-safety-all.json').is_file())

    def test_unknown_suite_cannot_silently_run_nothing(self):
        with self.assertRaises(ValueError):
            gate.groups('typo')


if __name__ == '__main__':
    unittest.main(verbosity=2)
