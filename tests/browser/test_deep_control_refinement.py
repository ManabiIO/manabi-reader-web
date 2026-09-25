"""Additional regressions against the actual app; retain all prior control cases."""
import unittest
from playwright.sync_api import expect
import test_control_refinement as control_refinement


class DeepControlRefinementBrowser(control_refinement.ControlRefinementBrowser):
    def open_notes(self):
        controls = self.page.get_by_role('button', name='Show reading controls', exact=True)
        if controls.is_visible():
            controls.click()
        self.page.get_by_role('button', name='Bookmarks and Notes', exact=True).click()
        panel = self.page.get_by_role('dialog', name='Bookmarks & Notes', exact=True)
        expect(panel).to_be_visible()
        self.frames()
        return panel

    def test_notes_autofocus_skips_the_visually_hidden_import_picker(self):
        self.open_reader()
        panel = self.open_notes()
        expect(panel).to_be_focused()
        self.assertLessEqual(panel.evaluate('e => e.scrollTop'), 1)
        self.check_modal(panel)
        self.capture('notes-visible-initial-focus')
        # The import input must remain keyboard-accessible, just not autofocused.
        picker = panel.locator('input[type=file]')
        self.assertEqual(0, picker.evaluate('e => e.tabIndex'))
        panel.get_by_role('button', name='Close', exact=True).click()
        expect(panel).to_have_count(0)

    def test_annotation_write_blocks_dismissal_and_saved_passage_navigation(self):
        self.open_reader()
        panel = self.open_notes()
        panel.get_by_role('button', name='Add Bookmark', exact=True).click()
        passages = panel.get_by_role('button').filter(has_text='Go to saved passage')
        expect(passages).to_have_count(1)
        expect(panel).to_have_attribute('aria-busy', 'false')
        # Queue a real IndexedDB write, rather than replacing annotation logic.
        self.page.evaluate('''async () => {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('books');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const tx = db.transaction('readerAnnotation', 'readwrite');
          let hold = true;
          window.__releaseAnnotationWrite = () => { hold = false; };
          tx.oncomplete = tx.onabort = () => db.close();
          const pump = () => {
            if (hold) tx.objectStore('readerAnnotation').get('__hold__').onsuccess = pump;
          };
          pump();
        }''')
        try:
            panel.get_by_role('button', name='Add Bookmark', exact=True).click()
            expect(panel).to_have_attribute('aria-busy', 'true')
            expect(panel.get_by_role('button', name='Close', exact=True)).to_be_disabled()
            expect(passages.first).to_be_disabled()
            expect(panel.locator('input[type=file]')).to_be_disabled()
            self.assertEqual('0.5', panel.locator('label[aria-label="Import notes"]').evaluate('e => getComputedStyle(e).opacity'))
            self.page.keyboard.press('Escape')
            expect(panel).to_be_visible()
            self.page.mouse.click(self.page.viewport_size['width'] - 2, 2)
            expect(panel).to_be_visible()
            self.capture('notes-pending-write')
        finally:
            self.page.evaluate('window.__releaseAnnotationWrite()')
        expect(panel).to_have_attribute('aria-busy', 'false')
        expect(passages).to_have_count(2)
        expect(panel.locator('input[type=file]')).to_be_enabled()
        self.assertEqual('1', panel.locator('label[aria-label="Import notes"]').evaluate('e => getComputedStyle(e).opacity'))
        passages.first.click()
        expect(panel).to_have_count(0)
        expect(self.page.get_by_role('button', name='Return to where I was', exact=True)).to_be_visible()

    def test_collection_management_reflows_at_double_text_size(self):
        self.page.set_viewport_size({'width': 320, 'height': 640})
        self.page.get_by_role('button', name='Collections', exact=True).click()
        self.page.get_by_role('button', name='New Collection…', exact=True).click()
        panel = self.dialog()
        name = 'ReadingCollection' * 10
        panel.get_by_label('Name', exact=True).fill(name)
        panel.get_by_role('button', name='Save', exact=True).click()
        expect(panel).to_have_count(0)
        sheet = self.page.locator('#library-collections-sheet')
        expect(sheet).to_be_visible()
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        sheet.get_by_role('button', name='Edit', exact=True).click()
        sheet.evaluate('e => e.scrollTop = 0')
        close = self.check_modal(sheet)
        self.assertAlmostEqual(close.bounding_box()['width'], 44, delta=0.5)
        heading = sheet.locator('[data-slot="sheet-title"]')
        self.assertLessEqual(heading.bounding_box()['height'], heading.evaluate('e => parseFloat(getComputedStyle(e).lineHeight)') + 1)
        # Rounded groups must not flex-shrink and clip their actual controls.
        groups = sheet.locator(':scope > div.overflow-hidden')
        expect(groups).to_have_count(2)
        for group in groups.all():
            self.assertLessEqual(group.evaluate('e => e.scrollHeight - e.clientHeight'), 1)
        self.capture('collections-double-text')
        rename = sheet.get_by_role('button', name='Rename collection ' + name, exact=True)
        rename.scroll_into_view_if_needed()
        self.assertLessEqual(sheet.evaluate('e => e.scrollWidth - e.clientWidth'), 1)
        self.capture('collections-double-text-actions')
        rename.click()
        panel = self.dialog()
        close = self.check_modal(panel)
        self.assertAlmostEqual(close.bounding_box()['width'], 44, delta=0.5)
        heading = panel.locator('[data-slot="dialog-title"]')
        self.assertGreaterEqual(heading.bounding_box()['width'], 180)
        self.assertLessEqual(heading.bounding_box()['height'], 2 * heading.evaluate('e => parseFloat(getComputedStyle(e).lineHeight)') + 1)
        field = panel.get_by_label('Name', exact=True)
        expect(field).to_have_value(name)
        field.fill('Renamed at large text')
        self.capture('collection-form-double-text')
        panel.get_by_role('button', name='Save', exact=True).click()
        expect(panel).to_have_count(0)
        expect(sheet.get_by_role('button', name='Renamed at large text 0', exact=True)).to_be_visible()

    def test_search_preview_preserves_case_and_decomposed_text(self):
        original = 'Original É e\u0301 𠮷 👩‍💻 End'
        self.import_book('Original text search', body='<h1>Original text search</h1><p>' + original + '</p>')
        self.page.get_by_role('button', name='Read Original text search', exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')
        panel = self.open_tool('Search Book')
        panel.get_by_role('searchbox').fill('é')
        expect(panel.get_by_text('2 results', exact=True)).to_be_visible()
        results = panel.get_by_role('button').filter(has_text='Section 1')
        expect(results).to_have_count(2)
        for index in range(2):
            # Compare textContent, not normalized Playwright whitespace matching.
            self.assertIn(original, results.nth(index).text_content())
        self.capture('search-original-excerpts')
        results.first.click()
        expect(panel).to_have_count(0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
