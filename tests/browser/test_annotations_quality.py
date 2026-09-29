"""Bookmarks & Notes quality regressions for enlarged text and keyboard focus."""
import json
from pathlib import Path
import unittest

from playwright.sync_api import expect
from reader_controls import reveal_reader_controls
from test_books_library import LibraryBase


class AnnotationQuality(LibraryBase):
    def setUp(self):
        super().setUp()
        self.output = Path('test-results') / 'annotations-quality' / self.engine / self._testMethodName
        self.output.mkdir(parents=True, exist_ok=True)
        self.context.tracing.start(screenshots=True, snapshots=True, sources=True)

    def tearDown(self):
        try:
            self.page.screenshot(path=str(self.output / 'final.png'))
            (self.output / 'final.html').write_text(self.page.content())
            (self.output / 'page-errors.json').write_text(json.dumps(self.errors, indent=2))
            self.context.tracing.stop(path=str(self.output / 'trace.zip'))
        finally:
            super().tearDown()

    def open_reader(self):
        self.import_book('Annotation quality')
        self.page.get_by_role('button', name='Read Annotation quality', exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute(
            'aria-busy', 'false', timeout=35000)

    def open_annotations(self):
        reveal_reader_controls(self.page)
        self.page.get_by_role('button', name='Bookmarks and Notes', exact=True).click()
        panel = self.page.get_by_role('dialog', name='Bookmarks & Notes', exact=True)
        expect(panel).to_be_visible()
        return panel

    def add_bookmarks(self, panel, count):
        add = panel.get_by_role('button', name='Add Bookmark', exact=True)
        removes = panel.get_by_role('button', name='Remove bookmark', exact=True)
        for index in range(count):
            add.click()
            expect(removes).to_have_count(index + 1)

    def assert_pointer_target(self, control):
        handle = control.element_handle()
        try:
            result = self.page.evaluate('''element => {
              const r = element.getBoundingClientRect();
              const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              return {
                width: r.width, height: r.height, left: r.left, top: r.top,
                right: r.right, bottom: r.bottom, viewport: [innerWidth, innerHeight],
                hit: !!hit && element.contains(hit)
              };
            }''', handle)
        finally:
            handle.dispose()
        self.assertGreaterEqual(result['width'], 44, result)
        self.assertGreaterEqual(result['height'], 44, result)
        self.assertGreaterEqual(result['left'], 0, result)
        self.assertGreaterEqual(result['top'], 0, result)
        self.assertLessEqual(result['right'], result['viewport'][0], result)
        self.assertLessEqual(result['bottom'], result['viewport'][1], result)
        self.assertTrue(result['hit'], result)

    def test_enlarged_long_notes_keep_dismissal_reachable_after_scroll(self):
        self.open_reader()
        panel = self.open_annotations()
        self.add_bookmarks(panel, 12)
        self.page.set_viewport_size({'width': 320, 'height': 320})
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        self.page.evaluate('''panel => { panel.scrollTop = panel.scrollHeight; }''',
                           panel.element_handle())
        self.page.wait_for_function('(panel) => panel.scrollTop > 0', arg=panel.element_handle())

        close = panel.locator('[data-modal-dismiss]')
        self.assert_pointer_target(close)
        title = panel.get_by_text('Bookmarks & Notes', exact=True)
        geometry = self.page.evaluate('''([title, close]) => {
          const a = title.getBoundingClientRect(), b = close.getBoundingClientRect();
          return {
            overlapX: Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)),
            overlapY: Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
          };
        }''', [title.element_handle(), close.element_handle()])
        self.assertFalse(geometry['overlapX'] > 1 and geometry['overlapY'] > 1, geometry)
        self.assertLessEqual(panel.evaluate('e => e.scrollWidth - e.clientWidth'), 1)

        self.page.screenshot(path=str(self.output / 'enlarged-scrolled.png'))
        close.click()
        expect(panel).to_have_count(0)
        expect(self.page.locator('button[data-reader-controls]')).to_be_focused()

    def test_removing_focused_annotation_moves_focus_to_next_remove_action(self):
        self.open_reader()
        panel = self.open_annotations()
        self.add_bookmarks(panel, 3)
        removes = panel.get_by_role('button', name='Remove bookmark', exact=True)
        removes.nth(1).focus()
        expect(removes.nth(1)).to_be_focused()
        removes.nth(1).click()
        expect(removes).to_have_count(2)
        expect(removes.nth(1)).to_be_focused()

        removes.nth(1).click()
        expect(removes).to_have_count(1)
        expect(removes.first).to_be_focused()
        removes.first.click()
        expect(removes).to_have_count(0)
        expect(panel.get_by_role('button', name='Add Bookmark', exact=True)).to_be_focused()



    def test_export_delete_import_conflict_can_restore_the_archived_bookmark(self):
        self.open_reader()
        panel = self.open_annotations()
        self.add_bookmarks(panel, 1)
        saved = panel.get_by_label('Saved annotations')
        expect(saved.get_by_text('Bookmark · Section 1', exact=True)).to_have_count(1)

        with self.page.expect_download() as download_info:
            panel.get_by_role('button', name='Export Notes', exact=True).click()
        download = download_info.value
        archive = Path(download.path()).read_bytes()
        self.assertGreater(len(archive), 100)
        expect(panel.get_by_role('status')).to_have_text('Notes archive downloaded.')

        panel.get_by_role('button', name='Remove bookmark', exact=True).click()
        expect(panel.get_by_role('button', name='Remove bookmark', exact=True)).to_have_count(0)
        expect(panel.get_by_role('button', name='Add Bookmark', exact=True)).to_be_focused()

        panel.locator('input[type=file][accept*=".json"]').set_input_files({
            'name': 'annotations.json',
            'mimeType': 'application/json',
            'buffer': archive
        })
        expect(panel.get_by_role('region', name='Archive conflicts')).to_be_visible()
        expect(panel.get_by_role('status')).to_contain_text('1 kept for conflict review')
        expect(panel.get_by_role('button', name='Use Archive', exact=True)).to_be_visible()

        panel.get_by_role('button', name='Use Archive', exact=True).click()
        expect(panel.get_by_role('region', name='Archive conflicts')).to_have_count(0)
        expect(panel.get_by_role('status')).to_have_text('Archived passage restored.')
        expect(panel.get_by_role('button', name='Remove bookmark', exact=True)).to_have_count(1)
        self.page.screenshot(path=str(self.output / 'archive-restored.png'))

        saved.get_by_role('button').filter(has_text='Go to saved passage').click()
        expect(panel).to_have_count(0)
        expect(self.page.get_by_role('button', name='Return to where I was', exact=True)).to_be_visible()


    def test_selected_passage_can_be_saved_as_note_and_previewed(self):
        self.open_reader()
        paragraph = self.page.locator('.book-content p').first
        paragraph.select_text()
        self.page.wait_for_function(
            "() => getSelection()?.toString().includes('日本語の本を読みます')")

        panel = self.open_annotations()
        highlight = panel.get_by_role('button', name='Highlight Selection', exact=True)
        snippet = panel.get_by_role('button', name='Add to Snippet…', exact=True)
        expect(highlight).to_be_enabled()
        expect(snippet).to_be_enabled()

        note = panel.get_by_label('Note on selected passage', exact=True)
        expect(note).to_be_visible()
        note.fill('Selected-passage QA note')
        panel.get_by_role('button', name='Save Note', exact=True).click()
        expect(note).to_have_value('')
        saved = panel.get_by_label('Saved annotations')
        expect(saved.get_by_text('Note · Section 1', exact=True)).to_have_count(1)
        expect(saved.get_by_text('Selected-passage QA note', exact=True)).to_be_visible()

        panel.locator('[data-modal-dismiss]').click()
        expect(panel).to_have_count(0)
        self.page.wait_for_function(
            "() => [...document.querySelectorAll('.reader-highlight')].some(e => {"
            " const r=e.getBoundingClientRect(); return r.width > 0 && r.height > 0;"
            "})")
        self.page.screenshot(path=str(self.output / 'saved-note-highlight.png'))

        panel = self.open_annotations()
        saved = panel.get_by_label('Saved annotations')
        saved.get_by_role('button').filter(has_text='Go to saved passage').click()
        expect(panel).to_have_count(0)
        expect(self.page.get_by_role('button', name='Return to where I was', exact=True)).to_be_visible()
        self.page.screenshot(path=str(self.output / 'selected-note-preview.png'))
        self.page.get_by_role('button', name='Return to where I was', exact=True).click()
        expect(self.page.get_by_role('button', name='Return to where I was', exact=True)).to_have_count(0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
