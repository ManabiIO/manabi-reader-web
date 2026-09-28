"""Enlarged-text gallery behavior using the actual EPUB importer and controls."""
import io
import unittest
import zipfile
from pathlib import Path
from playwright.sync_api import expect
from test_books_library import LibraryBase, book, raster


class GalleryUsabilityBrowser(LibraryBase):
    def open_gallery(self, mode, hidden=False):
        self.context.add_init_script(
            'localStorage.setItem("hideSpoilerImage", "' + ('1' if hidden else '0') + '");'
            'localStorage.setItem("appearance", "' + mode + '");')
        self.go_library()
        title = 'Illustrated gallery ' + mode
        source = book(title, body='<h1>Illustrated book</h1>'
                      '<img src="../Images/cover.png" alt="First illustration"/>'
                      '<p>次の挿絵です。</p><img src="../Images/second.png" alt="Second illustration"/>')
        output = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(source)) as original, zipfile.ZipFile(output, 'w') as target:
            for item in original.infolist():
                value = original.read(item)
                if item.filename == 'OEBPS/book.opf':
                    value = value.replace(b'</manifest>', b'<item id="second" href="Images/second.png" media-type="image/png"/></manifest>')
                target.writestr(item.filename, value)
            target.writestr('OEBPS/Images/second.png', raster(180, 280))
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files({
            'name': title + '.epub', 'mimeType': 'application/epub+zip', 'buffer': output.getvalue()
        })
        self.page.get_by_role('button', name='Read ' + title, exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')
        reveal = self.page.get_by_role('button', name='Show reading controls', exact=True)
        expect(reveal).to_be_visible()
        reveal.click()
        self.page.get_by_role('button', name='Reading tools', exact=True).click()
        self.page.get_by_role('menuitem', name='Image Gallery', exact=True).click()
        panel = self.page.get_by_role('dialog', name='Image gallery', exact=True)
        expect(panel).to_be_visible()
        return panel

    def hit_test(self, control):
        self.page.wait_for_function('''e => {
          const r = e.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
          return hit && (hit === e || e.contains(hit));
        }''', arg=control.element_handle())

    def test_enlarged_gallery_reflows_close_and_navigation_in_a_short_viewport(self):
        self.page.set_viewport_size({'width': 320, 'height': 568})
        for mode in ('light', 'dark'):
            panel = self.open_gallery(mode)
            self.page.evaluate('document.documentElement.style.fontSize = "200%"')
            close = panel.get_by_role('button', name='Close Image Gallery', exact=True)
            expect(close).to_have_attribute('data-modal-dismiss', '')
            expect(close).to_have_attribute('data-shape', 'circle')
            h, c = panel.locator('[data-slot="dialog-title"]').bounding_box(), close.bounding_box()
            self.assertLessEqual(h['x'] + h['width'], c['x'])
            self.assertGreaterEqual(c['width'], 44)
            self.hit_test(close)
            panel.get_by_role('button', name='View image 1', exact=True).click()
            self.page.set_viewport_size({'width': 320, 'height': 320})
            self.assertLessEqual(panel.evaluate('e => e.scrollWidth - e.clientWidth'), 1)
            for name in ('Next', 'Previous'):
                control = panel.get_by_role('button', name=name, exact=True)
                expect(control).to_have_attribute('data-variant', 'secondary')
                control.focus()
                self.hit_test(control)
                control.click()
                expect(panel.locator('.gallery-viewer img')).to_have_attribute(
                    'alt', 'Book illustration ' + ('2' if name == 'Next' else '1'))
            art = panel.locator('.gallery-art')
            art.scroll_into_view_if_needed()
            self.assertGreaterEqual(art.bounding_box()['height'], 128)
            Path('test-results').mkdir(exist_ok=True)
            self.page.screenshot(path=f'test-results/{self.engine}-gallery-short-{mode}.png')
            panel.get_by_role('button', name='All images', exact=True).click()
            expect(panel.get_by_role('button', name='View image 1', exact=True)).to_be_focused()
            close.click()
            expect(panel).to_have_count(0)
            expect(self.page.get_by_role('button', name='Show reading controls', exact=True)).to_be_focused()
            self.page.set_viewport_size({'width': 320, 'height': 568})

    def test_enlarged_gallery_spoiler_label_stays_within_its_image(self):
        self.page.set_viewport_size({'width': 320, 'height': 568})
        panel = self.open_gallery('dark', hidden=True)
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        hidden = panel.get_by_role('button', name='Show hidden image 1', exact=True)
        expect(hidden).to_be_visible()
        label = hidden.locator('.spoiler-label')
        bounds, text = hidden.bounding_box(), label.bounding_box()
        self.assertGreaterEqual(text['x'], bounds['x'])
        self.assertLessEqual(text['x'] + text['width'], bounds['x'] + bounds['width'])
        hidden.focus()
        hidden.press('Enter')
        visible = panel.get_by_role('button', name='View image 1', exact=True)
        expect(visible).to_be_visible()
        visible.click()
        expect(panel.locator('.gallery-viewer img')).to_have_attribute('alt', 'Book illustration 1')
        self.assertLessEqual(panel.evaluate('e => e.scrollWidth - e.clientWidth'), 1)
        self.page.keyboard.press('Escape')
        expect(panel).to_have_count(0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
