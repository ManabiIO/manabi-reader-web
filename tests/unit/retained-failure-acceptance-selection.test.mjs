/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const runner = fileURLToPath(
  new URL('../browser/retained_failure_acceptance_cases.py', import.meta.url)
);
const expected = {
  'test_books_library.BooksLibraryFilesystem': [
    'test_recursive_series_covers_filters_and_readonly_scanning',
    'test_relocated_book_read_cannot_navigate_after_browser_back'
  ],
  'test_rhea_ui.RheaReader': [
    'test_dialog_traps_focus_and_escape_preserves_custom_theme',
    'test_library_sort_and_export_preserve_all_export_parts',
    'test_touch_reading_appearance_fits_and_outside_dismissal_restores_controls',
    'test_video_release_gate_keeps_default_build_dormant'
  ],
  'test_whispersync.WhispersyncBrowser': [
    'test_whispersync_conflict_warning_is_visible_without_an_audio_file',
    'test_whispersync_reset_in_second_tab_cannot_be_undone_by_stale_autosave'
  ],
  'test_ttu_migration.MigrationBrowser': [
    'test_migration_entrypoint_and_google_drive_labels_use_official_names'
  ],
  'test_completed_reading.CompletedReadingBrowser': [
    'test_completion_dialog_reflows_and_reduced_motion_skips_confetti'
  ],
  'test_local_library_features.LocalFeatureBrowser': [
    'test_yatsu_edit_download_conflict_and_restore',
    'test_direct_webdav_import_is_read_only_and_offline_searchable'
  ],
  'test_local_library_review.LocalLibraryReview': [
    'test_yatsu_concurrent_note_edits_and_deletes_require_reload'
  ],
  'test_local_library_lifecycle.LocalLibraryLifecycle': [
    'test_webdav_unlinked_passage_remains_visible_and_sync_converges'
  ],
  'test_library_open_commit.LibraryOpenCommitStatic': [
    'test_queued_open_cannot_change_resume_or_navigate_after_back'
  ]
};
const cases = Object.entries(expected).flatMap(([owner, methods]) =>
  methods.map((method) => `${owner}.${method}`)
);
const chromiumOnly = cases.filter((selector) =>
  /^(test_books_library|test_ttu_migration|test_completed_reading)\./.test(selector)
);
function python(args) {
  // -S excludes installed site packages, so listing/AST validation cannot depend
  // on Playwright or accidentally import and start a browser harness.
  const result = spawnSync('python', ['-S', ...args], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
}
const load = `
import importlib.util, sys
spec = importlib.util.spec_from_file_location('retained_runner', ${JSON.stringify(runner)})
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
`;

test('retained-failure inventory selects all 15 exact failures only in their original engines', () => {
  const manifest = JSON.parse(python([runner, '--list', '--json']));
  assert.equal(manifest.distinct_count, 15);
  assert.deepEqual(manifest.browsers.chromium, { count: 15, selectors: cases });
  assert.deepEqual(manifest.browsers.webkit, {
    count: 11,
    selectors: cases.filter((selector) => !chromiumOnly.includes(selector))
  });
  assert.deepEqual(manifest.chromium_only, chromiumOnly);
  assert.equal(new Set(manifest.browsers.chromium.selectors).size, 15);
  assert.deepEqual(python([runner, '--list']).trim().split('\n'), cases);
  assert.deepEqual(
    python([runner, '--list', '--browser', 'webkit']).trim().split('\n'),
    manifest.browsers.webkit.selectors
  );
});

test('retained-failure validation resolves inherited Rhea methods without browser imports', () => {
  assert.match(python([runner, '--validate']), /chromium=15, webkit=11; no browser imports/);
  python([
    '-c',
    load +
      `
r.validate()
assert r.resolve_method('test_rhea_ui', 'RheaReader', 'test_video_release_gate_keeps_default_build_dormant') == 'test_static_reader.ReaderBrowser.test_video_release_gate_keeps_default_build_dormant'
assert r.resolve_method('test_rhea_ui', 'RheaReader', 'test_missing_retained_method') is None
assert not any(name.startswith('playwright') or name.startswith('test_') for name in sys.modules)
`
  ]);
});

test('exact collection never expands inherited suites and routes the Whispersync browser parser', () => {
  python([
    '-c',
    load +
      `
import io, types, unittest
seen = []
class UnselectedBase(unittest.TestCase):
    def test_inherited_but_unselected(self):
        raise AssertionError('Whole inherited suites must not run')
# Lightweight harness doubles qualify collection only; the production runner
# continues to import unchanged original classes when it actually qualifies UI.
for selector in r.CASES:
    module, class_name, method = selector.split('.')
    owner = sys.modules.setdefault(module, types.ModuleType(module))
    if not hasattr(owner, class_name):
        setattr(owner, class_name, type(class_name, (UnselectedBase,), {'__module__': module}))
    def original_method(self):
        seen.append(self.id())
    setattr(getattr(owner, class_name), method, original_method)
for browser in r.BROWSERS:
    original_argv = sys.argv
    class TrackingLoader(unittest.TestLoader):
        def loadTestsFromNames(self, selectors, module=None):
            assert sys.argv == [original_argv[0], '--browser', browser]
            return super().loadTestsFromNames(selectors, module)
    suite = r.load_exact_cases(browser, TrackingLoader())
    assert sys.argv is original_argv
    expected = r.selected_cases(browser)
    assert suite.countTestCases() == len(expected)
    seen.clear()
    result = unittest.TextTestRunner(stream=io.StringIO()).run(suite)
    assert r.passed(result, len(expected))
    assert seen == list(expected), seen
`
  ]);
});

test('retained-failure runner rejects skipped, missing, partial and misconfigured collections', () => {
  python([
    '-c',
    load +
      `
import contextlib, io, os, unittest
class Cases(unittest.TestCase):
    def test_pass(self): pass
    def test_skip(self): self.skipTest('Capability unavailable')
    def test_failure(self): self.fail('Retained assertion failed')
def run(method):
    return unittest.TextTestRunner(stream=io.StringIO()).run(unittest.TestSuite([Cases(method)]))
assert r.passed(run('test_pass'), 1)
assert not r.passed(run('test_pass'), 2)
assert not r.passed(run('test_skip'), 1)
assert not r.passed(run('test_failure'), 1)
class EmptyLoader:
    errors = []
    def loadTestsFromNames(self, selectors): return unittest.TestSuite()
class BrokenLoader(EmptyLoader): errors = ['Original method no longer exists']
for loader in (EmptyLoader(), BrokenLoader()):
    original_argv = sys.argv
    try:
        r.load_exact_cases('chromium', loader)
    except RuntimeError:
        pass
    else:
        raise AssertionError('Incomplete collection was admitted')
    assert sys.argv is original_argv
os.environ.update(LIBRARY_BROWSER='chromium', APPEARANCE_BROWSER='webkit')
with contextlib.redirect_stderr(io.StringIO()):
    try:
        r.main([])
    except SystemExit as error:
        assert error.code == 2
    else:
        raise AssertionError('Mixed engines were silently admitted')
`
  ]);
});
