"""Canonical shared Library shelf/editor cases for either production Expo export.

This bounded selection supplements the affected CI gate. Original full suites and
assertions remain unchanged; this does not establish whole Library/native parity.
"""
import argparse
import ast
import json
from pathlib import Path
import sys
import unittest

CASES = (
    'test_library_grid_labels.LibraryGridLabels.test_same_cover_books_keep_visible_titles_authors_and_selection_identity',
    'test_library_grid_labels.LibraryGridLabels.test_enlarged_grid_identity_stays_readable_without_horizontal_overflow',
    'test_library_grid_labels.LibraryGridLabels.test_selection_toolbar_stays_compact_and_reachable_at_200_percent_text',
    'test_library_grid_labels.LibraryGridLabels.test_grid_title_and_author_contrast_across_real_theme_presets',
    'test_library_parity.LibraryParityBrowser.test_metadata_edit_keeps_source_identity_history_and_plain_text',
    'test_library_parity.LibraryParityBrowser.test_metadata_cancel_and_concurrent_tab_edits_do_not_overwrite_each_other',
    'test_library_parity.LibraryParityBrowser.test_modifiers_ranges_and_keyboard_in_grid_and_list',
    'test_books_library.BooksLibraryBrowser.test_responsive_shelf_grows_then_adds_columns_without_clipping_covers',
    'test_library_grid_labels.LibraryGridLabels.test_enlarged_list_keeps_titles_readable_and_actions_separate',
)

def validate():
    assert len(CASES) == len(set(CASES)) == 9
    for case in CASES:
        module, class_name, method = case.split('.')
        tree = ast.parse((Path(__file__).parent / (module + '.py')).read_text())
        cls = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == class_name)
        assert any(isinstance(node, ast.FunctionDef) and node.name == method for node in cls.body), case

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--list', action='store_true')
    parser.add_argument('--validate', action='store_true')
    args = parser.parse_args()
    validate()
    if args.list:
        print(json.dumps(CASES))
    elif args.validate:
        print('Eight retained Library shelf/editor cases and enlarged-list regression validated')
    else:
        suite = unittest.defaultTestLoader.loadTestsFromNames(CASES)
        assert suite.countTestCases() == len(CASES)
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        sys.exit(0 if result.wasSuccessful() and not result.skipped else 1)
