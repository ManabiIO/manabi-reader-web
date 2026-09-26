"""Shared release/PR entry point; reuse the already built app and browsers.

The native-storage suites also start their existing Vite module harness. They
are not substitutes for the separately retained production-app browser cases.
"""
import argparse
import codecs
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
    'test_library_open_commit', 'test_library_search_readiness',
    'test_offline_account_profile',
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


def run_group(command, environment, log_path):
    """Tee one merged pipe in bounded chunks; never buffer an entire suite log."""
    decoder = codecs.getincrementaldecoder('utf-8')(errors='replace')
    with log_path.open('wb') as log:
        try:
            with subprocess.Popen(command, cwd=ROOT, env=environment,
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT) as process:
                try:
                    while chunk := process.stdout.read1(65536):
                        log.write(chunk)
                        log.flush()
                        sys.stdout.write(decoder.decode(chunk))
                        sys.stdout.flush()
                    sys.stdout.write(decoder.decode(b'', final=True))
                    sys.stdout.flush()
                    return process.wait()
                except BaseException:
                    # An interrupted launcher must not leave its direct child
                    # running or turn incomplete evidence into a successful run.
                    process.kill()
                    process.wait()
                    raise
        except OSError as error:
            log.write((str(error) + '\n').encode('utf-8', errors='replace'))
            raise


def qualify(suite):
    selected = groups(suite)
    output = ROOT / 'test-results'
    output.mkdir(exist_ok=True)
    report = output / ('library-data-safety-' + suite + '.json')
    reports = [dict(name=name, engine=engine, command=[sys.executable, *arguments],
                    status='pending', returncode=None,
                    log=f'test-results/library-data-safety-{suite}-{name}.log')
               for name, engine, arguments in selected]

    def save_report():
        temporary = report.with_suffix('.json.tmp')
        temporary.write_text(json.dumps(reports, indent=2) + '\n')
        temporary.replace(report)

    # Invalidate any older success before starting a child. An interrupted
    # report identifies the unfinished group and all groups not yet attempted.
    save_report()
    for row in reports:
        environment = dict(os.environ, PYTHONPATH=str(ROOT / 'tests/browser'),
                           LIBRARY_BROWSER=row['engine'], PICKS_BROWSER=row['engine'],
                           APPEARANCE_BROWSER=row['engine'])
        print(f"::group::{row['name']} ({row['engine']})", flush=True)
        row['status'] = 'running'
        save_report()
        try:
            row['returncode'] = run_group(row['command'], environment, ROOT / row['log'])
            row['status'] = 'completed'
        except OSError as error:
            row.update(status='launch-failed', error=str(error))
        except BaseException:
            row['status'] = 'interrupted'
            raise
        finally:
            save_report()
            print('::endgroup::', flush=True)
    return int(any(row['status'] != 'completed' or row['returncode'] != 0 for row in reports))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--suite', choices=('all', 'shared', 'local'), default='all')
    sys.exit(qualify(parser.parse_args().suite))
