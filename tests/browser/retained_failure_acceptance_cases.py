"""Exact retained failures from the ce5e9110 full-web qualification.

This bounded affected-scope selection runs unchanged original test methods and
fixtures. Full qualification already runs their source suites and must not run
this additional subset. It is not a replacement for full web or Android parity.

The filesystem, completion and migration fixtures retain their original
Chromium-only launch paths. Rhea, Whispersync and browser-backed Library cases
run in Chromium and WebKit. No unsupported case is selected and then skipped.

--list --json and --validate inspect source only, without importing Playwright.
The caller provides the existing built export; this runner never builds it.
"""
import argparse
import ast
import json
import os
from pathlib import Path
import sys
import unittest

BROWSERS = ('chromium', 'webkit')
CASES = (
    'test_books_library.BooksLibraryFilesystem.test_recursive_series_covers_filters_and_readonly_scanning',
    'test_books_library.BooksLibraryFilesystem.test_relocated_book_read_cannot_navigate_after_browser_back',
    'test_rhea_ui.RheaReader.test_dialog_traps_focus_and_escape_preserves_custom_theme',
    'test_rhea_ui.RheaReader.test_library_sort_and_export_preserve_all_export_parts',
    'test_rhea_ui.RheaReader.test_touch_reading_appearance_fits_and_outside_dismissal_restores_controls',
    'test_rhea_ui.RheaReader.test_video_release_gate_keeps_default_build_dormant',
    'test_whispersync.WhispersyncBrowser.test_whispersync_conflict_warning_is_visible_without_an_audio_file',
    'test_whispersync.WhispersyncBrowser.test_whispersync_reset_in_second_tab_cannot_be_undone_by_stale_autosave',
    'test_ttu_migration.MigrationBrowser.test_migration_entrypoint_and_google_drive_labels_use_official_names',
    'test_completed_reading.CompletedReadingBrowser.test_completion_dialog_reflows_and_reduced_motion_skips_confetti',
    'test_local_library_features.LocalFeatureBrowser.test_yatsu_edit_download_conflict_and_restore',
    'test_local_library_features.LocalFeatureBrowser.test_direct_webdav_import_is_read_only_and_offline_searchable',
    'test_local_library_review.LocalLibraryReview.test_yatsu_concurrent_note_edits_and_deletes_require_reload',
    'test_local_library_lifecycle.LocalLibraryLifecycle.test_webdav_unlinked_passage_remains_visible_and_sync_converges',
    'test_library_open_commit.LibraryOpenCommitStatic.test_queued_open_cannot_change_resume_or_navigate_after_back',
)
CHROMIUM_ONLY = frozenset((
    CASES[0], CASES[1], CASES[8], CASES[9],
))
SOURCE_DIRECTORY = Path(__file__).parent


def selected_cases(browser):
    if browser not in BROWSERS:
        raise ValueError('Unsupported retained-failure browser: ' + browser)
    return tuple(case for case in CASES if browser == 'chromium' or case not in CHROMIUM_ONLY)


def resolve_method(module, class_name, method, visited=None):
    """Resolve original/inherited definitions through local ASTs, without imports.

    Rhea deliberately owns the inherited dormant-video case so it keeps its real
    persistent WebKit setup. Inspecting the base definition must not substitute
    ReaderBrowser's Chromium-only class in the selected suite.
    """
    visited = set() if visited is None else visited
    identity = (module, class_name)
    if identity in visited:
        return None
    visited.add(identity)
    path = SOURCE_DIRECTORY / (module + '.py')
    tree = ast.parse(path.read_text(), filename=str(path))
    classes = {node.name: node for node in tree.body if isinstance(node, ast.ClassDef)}
    cls = classes.get(class_name)
    if cls is None:
        raise ValueError('Missing retained class: ' + module + '.' + class_name)
    if any(isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == method
           for node in cls.body):
        return module + '.' + class_name + '.' + method
    imports = {}
    for node in tree.body:
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports[alias.asname or alias.name] = (alias.name, None)
        elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
            for alias in node.names:
                imports[alias.asname or alias.name] = (node.module, alias.name)
    for base in cls.bases:
        parent = None
        if isinstance(base, ast.Name):
            parent = (module, base.id) if base.id in classes else imports.get(base.id)
        elif isinstance(base, ast.Attribute) and isinstance(base.value, ast.Name):
            imported = imports.get(base.value.id)
            if imported and imported[1] is None:
                parent = (imported[0], base.attr)
        if not parent or not parent[1] or not (SOURCE_DIRECTORY / (parent[0] + '.py')).is_file():
            continue
        resolved = resolve_method(*parent, method, visited)
        if resolved:
            return resolved
    return None


def validate():
    if len(CASES) != 15 or len(set(CASES)) != 15:
        raise ValueError('Expected exactly 15 distinct retained-failure selectors')
    if not CHROMIUM_ONLY <= set(CASES) or len(CHROMIUM_ONLY) != 4:
        raise ValueError('The original Chromium-only fixture boundary changed')
    for case in CASES:
        if not resolve_method(*case.split('.')):
            raise ValueError('Missing retained test method: ' + case)
    if tuple(len(selected_cases(browser)) for browser in BROWSERS) != (15, 11):
        raise ValueError('Retained-failure engine coverage changed')


def load_exact_cases(browser, loader=None):
    selectors = selected_cases(browser)
    loader = unittest.TestLoader() if loader is None else loader
    # Whispersync reads --browser at module import, whereas Library and Rhea
    # read environment variables. Give its original parser the same engine.
    original_argv = sys.argv
    try:
        sys.argv = [original_argv[0], '--browser', browser]
        suite = loader.loadTestsFromNames(selectors)
    finally:
        sys.argv = original_argv
    if loader.errors:
        raise RuntimeError('\n'.join(loader.errors))
    if suite.countTestCases() != len(selectors):
        raise RuntimeError('Exact retained-failure collection changed unexpectedly')
    return suite


def passed(result, count):
    return result.wasSuccessful() and result.testsRun == count and not result.skipped


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument('--list', action='store_true')
    action.add_argument('--validate', action='store_true')
    parser.add_argument('--json', action='store_true', help='Include engine counts and selectors with --list')
    parser.add_argument('--browser', choices=BROWSERS)
    args = parser.parse_args(argv)
    if args.json and not args.list:
        parser.error('--json requires --list')
    validate()
    if args.validate:
        print('Validated 15 distinct retained failures: chromium=15, webkit=11; no browser imports')
        return 0
    if args.list:
        if args.json:
            print(json.dumps({
                'qualification': 'retained-failure-regressions-only',
                'distinct_count': len(CASES),
                'browsers': {
                    browser: {'count': len(selected_cases(browser)), 'selectors': selected_cases(browser)}
                    for browser in ((args.browser,) if args.browser else BROWSERS)
                },
                'chromium_only': [case for case in CASES if case in CHROMIUM_ONLY],
            }, indent=2))
        else:
            print('\n'.join(selected_cases(args.browser) if args.browser else CASES))
        return 0
    browser = args.browser or os.environ.get('LIBRARY_BROWSER') or os.environ.get('APPEARANCE_BROWSER') or 'chromium'
    if browser not in BROWSERS:
        parser.error('Retained failures require chromium or webkit')
    for variable in ('LIBRARY_BROWSER', 'APPEARANCE_BROWSER', 'PICKS_BROWSER'):
        if not args.browser and os.environ.get(variable, browser) != browser:
            parser.error('Browser environment variables must identify the same engine')
        os.environ[variable] = browser
    selectors = selected_cases(browser)
    print(json.dumps({
        'qualification': 'retained-failure-regressions-only',
        'browser': browser,
        'count': len(selectors),
        'selectors': selectors,
    }), flush=True)
    Path('test-results').mkdir(exist_ok=True)
    result = unittest.TextTestRunner(verbosity=2).run(load_exact_cases(browser))
    return 0 if passed(result, len(selectors)) else 1


if __name__ == '__main__':
    sys.exit(main())
