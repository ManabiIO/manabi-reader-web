"""Shared release/PR entry point; reuse the already built app and browsers.

The native-storage suites also start their existing Vite module harness. They
are not substitutes for the separately retained production-app browser cases.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
LOCAL_MODULES = (
    'test_local_library_features', 'test_local_library_review',
    'test_local_library_refinement', 'test_local_library_lifecycle',
    'test_library_deletion', 'test_book_save_cancellation', 'test_book_last_read',
)
OPEN_CASES = (
    'test_books_library.BooksLibraryFilesystem.test_external_relocation_rebinds_content_identity_and_presentation',
    'test_books_library.BooksLibraryFilesystem.test_relocated_book_read_cannot_navigate_after_browser_back',
)


def groups(suite):
    if suite not in ('all', 'shared', 'local'):
        raise ValueError('Unknown library qualification suite')
    selected = []
    if suite in ('all', 'shared'):
        # These files deliberately select their own cases in __main__. Running
        # unittest discovery instead would also collect inherited harness tests.
        for name in ('test_shared_ttu', 'test_shared_safety'):
            selected.append((name, 'chromium', [f'tests/browser/{name}.py']))
        selected.append(('shared-ui', 'chromium', ['-m', 'unittest', 'test_reader_integration', '-v']))
    if suite in ('all', 'local'):
        for engine in ('chromium', 'webkit'):
            selected.append(('local-' + engine, engine, ['-m', 'unittest', *LOCAL_MODULES, '-v']))
        selected.append(('open-lifetime', 'chromium', ['-m', 'unittest', *OPEN_CASES, '-v']))
    return selected


def qualify(suite):
    reports = []
    output = ROOT / 'test-results'
    output.mkdir(exist_ok=True)
    report = output / ('library-data-safety-' + suite + '.json')
    for name, engine, arguments in groups(suite):
        command = [sys.executable, *arguments]
        environment = dict(os.environ, PYTHONPATH=str(ROOT / 'tests/browser'),
                           LIBRARY_BROWSER=engine, PICKS_BROWSER=engine,
                           APPEARANCE_BROWSER=engine)
        print(f'::group::{name} ({engine})', flush=True)
        # No retry or waived exit status. Continue to collect the remaining
        # engine diagnostics, but any failed group fails the required job.
        result = subprocess.run(command, cwd=ROOT, env=environment, check=False)
        reports.append({'name': name, 'engine': engine, 'command': command,
                        'returncode': result.returncode})
        report.write_text(json.dumps(reports, indent=2) + '\n')
        print('::endgroup::', flush=True)
    return int(any(result['returncode'] != 0 for result in reports))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--suite', choices=('all', 'shared', 'local'), default='all')
    sys.exit(qualify(parser.parse_args().suite))
