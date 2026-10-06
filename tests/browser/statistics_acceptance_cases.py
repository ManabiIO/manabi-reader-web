"""Exact shared-Statistics affected cases for either production Expo web export.

This is an intermediate affected-route selection, never the final parity gate.
The caller must build/qualify the requested export first. --export-mode records
which existing build is being tested; it does not change flags, rebuild, inject
application state, or replace the real StaticHandler/data/browser harnesses.

Run the identical selection for default and gated exports, each in Chromium and
WebKit. Import exact methods instead of unittest discovery: Connect and Rhea
inherit unrelated whole-reader suites that must not be replayed by this subset.
The full retained workflow inventories and original suite entrypoints remain the
final gate, including legacy reader-embedded Statistics/tracker/modal behavior.

Examples (after the corresponding export):
  python tests/browser/statistics_acceptance_cases.py --list
  python tests/browser/statistics_acceptance_cases.py --validate
  LIBRARY_BROWSER=chromium APPEARANCE_BROWSER=chromium python tests/browser/statistics_acceptance_cases.py
"""
import argparse
import json
import os
from pathlib import Path
import sys
import unittest


# Existing acceptance keeps its original assertions, fixtures and diagnostics.
# Only the mixed short-workspace test is exposed as an additional focused method;
# the original all-workspace test still invokes exactly the same assertion helper.
CASES = (
    'test_panel_usability.PanelUsabilityBrowser.test_heatmap_popup_close_has_its_own_space_and_restores_day_focus',
    'test_panel_usability.PanelUsabilityBrowser.test_heatmap_outside_pointer_dismissal_keeps_the_new_focus',
    'test_panel_usability.PanelUsabilityBrowser.test_heatmap_arrow_navigation_has_one_tab_stop_and_native_activation',
    'test_panel_usability.PanelUsabilityBrowser.test_repeated_heatmap_activation_stays_open_and_period_change_dismisses',
    'test_panel_usability.PanelUsabilityBrowser.test_heatmap_cells_shrink_and_month_columns_follow_the_new_calendar',
    'test_panel_usability.PanelUsabilityBrowser.test_enlarged_heatmap_toolbar_does_not_crush_the_year_between_buttons',
    'test_panel_usability.PanelUsabilityBrowser.test_filter_page_focus_is_not_under_sticky_header_or_footer',
    'test_panel_usability.PanelUsabilityBrowser.test_short_enlarged_filter_uses_flow_and_keeps_controls_clickable',
    'test_connect_ui.ConnectControlsBrowser.test_statistics_workspace_remains_operable_in_short_enlarged_viewport',
    'test_connect_ui.ConnectControlsBrowser.test_statistics_toolbar_and_options_reflow_and_keep_unique_form_labels',
    'test_connect_ui.ConnectControlsBrowser.test_heatmap_days_are_real_keyboard_actions',
    'test_connect_ui.ConnectControlsBrowser.test_title_filter_pages_survive_empty_queries_resize_and_private_drafts',
    'test_rhea_ui.RheaReader.test_statistics_filter_is_one_focus_managed_sheet',
    'test_rhea_ui.RheaReader.test_statistics_navigation_and_options_sheet',
    'test_rhea_ui.RheaReader.test_statistics_raw_recovery_download_preserves_ambiguous_days',
    # Rhea provides the retained real, persistent WebKit fixture. Calling this
    # on AppearanceBrowser directly would silently keep its Chromium-only base.
    'test_rhea_ui.RheaReader.test_all_presets_theme_forms_headers_and_statistics',
    'test_product_journeys.ProductJourneys.test_statistics_heading_keeps_words_whole_at_large_text',
    'test_books_library.BooksLibraryBrowser.test_selected_statistics_view_keeps_same_title_book_identities_distinct',
    'test_statistics_shared_route.SharedStatisticsBrowser.test_shared_composition_preserves_measurements_editor_and_real_exports',
    'test_statistics_shared_route.SharedStatisticsBrowser.test_shared_route_filter_calendar_and_zoom_keep_original_semantics',
)

EXPORT_MODES = ('default', 'gated')
BROWSERS = ('chromium', 'webkit')

# This is documentation of the boundary, not a skip list. These original cases
# still qualify the legacy reader surfaces at their ordinary full-suite entries.
LEGACY_READER_CASES = (
    'test_panel_usability.PanelUsabilityBrowser.test_tracker_reflows_and_privacy_toggle_is_accessible_at_200_percent_text',
    'test_panel_usability.PanelUsabilityBrowser.test_tracker_history_paginates_without_stranding_keyboard_focus',
    'test_rhea_ui.RheaReader.test_tracking_panel_owns_focus_and_preserves_controls',
    'test_modal_controls.ModalControlsBrowser.test_reader_sheets_have_gutters_and_unobscured_close_controls',
    'test_reader_navigation_panels.ReaderNavigationPanels.test_tracker_can_open_for_plain_text_without_a_chapter_catalog',
)

FULL_PARITY_GATE = (
    'The unchanged complete retained regression and browser inventories remain required on the final source.',
    'Both default and gated production exports must pass the shared-route cases in Chromium and WebKit.',
    'The two new shared-route cases supplement the existing behavior, geometry, keyboard, appearance and export assertions.',
    'All original reader-embedded/tracker/dialog cases remain required separately; this selection is not their replacement.',
    'Source review, collection validation, older-head results, skipped or unfinished runs do not qualify current browser geometry.',
    'Android packaged-host qualification and native parity remain separate from these web-browser results.',
)


def selected_cases(export_mode):
    if export_mode not in EXPORT_MODES:
        raise ValueError('Unknown export mode: ' + export_mode)
    # Both route entries select the same shared screen. Never use a smaller
    # default-route selection, or reinterpret a gated pass as a default pass.
    return CASES


def load_exact_cases():
    if len(CASES) != len(set(CASES)):
        raise RuntimeError('Duplicate affected Statistics selector')
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromNames(CASES)
    if loader.errors:
        raise RuntimeError('\n'.join(loader.errors))
    if suite.countTestCases() != len(CASES):
        raise RuntimeError('Affected Statistics collection changed unexpectedly')
    return suite


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument('--list', action='store_true', help='Print exact selectors without importing browser suites')
    action.add_argument('--validate', action='store_true', help='Resolve exact selectors without starting any browser')
    action.add_argument('--run', action='store_true', help='Run the exact affected cases against the existing export')
    parser.add_argument('--json', action='store_true', help='Print selection metadata with --list')
    parser.add_argument('--export-mode', choices=EXPORT_MODES)
    parser.add_argument('--browser', choices=BROWSERS)
    args = parser.parse_args()
    if args.json and (args.run or args.validate):
        parser.error('--json is available only with --list')
    if args.run or not (args.list or args.validate or args.json):
        browser = args.browser or os.environ.get('LIBRARY_BROWSER') or os.environ.get('APPEARANCE_BROWSER') or 'chromium'
        if browser not in BROWSERS:
            parser.error('Statistics acceptance requires chromium or webkit')
        for variable in ('LIBRARY_BROWSER', 'APPEARANCE_BROWSER', 'PICKS_BROWSER'):
            if not args.browser and os.environ.get(variable, browser) != browser:
                parser.error('Browser environment variables must identify the same engine')
            os.environ[variable] = browser
        Path('test-results').mkdir(exist_ok=True)
        print(json.dumps({
            'qualification': 'affected-shared-statistics-only',
            'export_mode': args.export_mode,
            'browser': browser,
            'selectors': selected_cases(args.export_mode) if args.export_mode else CASES,
            'full_parity_gate': FULL_PARITY_GATE,
        }), flush=True)
        result = unittest.TextTestRunner(verbosity=2, failfast=False).run(load_exact_cases())
        return 0 if result.wasSuccessful() else 1
    if args.validate:
        suite = load_exact_cases()
        print(f'Validated {suite.countTestCases()} exact shared Statistics cases; no browser started')
    elif args.json:
        print(json.dumps({
            'exports': {mode: selected_cases(mode) for mode in EXPORT_MODES},
            'browsers': BROWSERS,
            'separate_legacy_reader_cases': LEGACY_READER_CASES,
            'full_parity_gate': FULL_PARITY_GATE,
        }, indent=2))
    else:
        print('\n'.join(CASES))
    return 0


if __name__ == '__main__':
    sys.exit(main())
