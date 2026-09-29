"""Enlarged-text gallery behavior using the actual EPUB importer and controls."""
import io
import unittest
import zipfile
from pathlib import Path
from playwright.sync_api import expect
from test_books_library import LibraryBase, book, raster
from reader_controls import reveal_reader_controls


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
        reveal_reader_controls(self.page)
        self.page.get_by_role('button', name='Reading tools', exact=True).click()
        self.page.get_by_role('menuitem', name='Image Gallery', exact=True).click()
        panel = self.page.get_by_role('dialog', name='Image gallery', exact=True)
        expect(panel).to_be_visible()
        panel.evaluate('''async e => {
          await Promise.all(e.getAnimations({subtree:true})
            .filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
            .map(a => a.finished.catch(() => {})));
        }''')
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
            viewer = panel.locator('.gallery-viewer')
            viewer.focus()
            viewer.hover()
            self.page.mouse.wheel(0, 600)
            self.page.wait_for_function('e => e.scrollTop > 0', arg=viewer.element_handle())
            expect(viewer.locator('img')).to_have_attribute('alt', 'Book illustration 1')
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
            expect(self.page.locator('button[data-reader-controls]')).to_be_focused()
            self.page.set_viewport_size({'width': 320, 'height': 568})

    def test_enlarged_gallery_close_remains_reachable_after_short_viewer_scroll(self):
        self.page.set_viewport_size({'width': 320, 'height': 568})
        panel = self.open_gallery('dark')
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        panel.get_by_role('button', name='View image 1', exact=True).click()
        self.page.set_viewport_size({'width': 320, 'height': 320})
        viewer = panel.locator('.gallery-viewer')
        viewer.focus()
        viewer.hover()
        self.page.mouse.wheel(0, 900)
        self.page.wait_for_function('e => e.scrollTop > 0', arg=viewer.element_handle())

        close = panel.get_by_role('button', name='Close Image Gallery', exact=True)
        geometry = close.bounding_box()
        viewport = self.page.evaluate('''() => {
          const v = visualViewport;
          return {
            left: v?.offsetLeft ?? 0,
            top: v?.offsetTop ?? 0,
            width: v?.width ?? innerWidth,
            height: v?.height ?? innerHeight
          };
        }''')
        self.assertGreaterEqual(geometry['width'], 44)
        self.assertGreaterEqual(geometry['height'], 44)
        self.assertGreaterEqual(geometry['x'], viewport['left'])
        self.assertGreaterEqual(geometry['y'], viewport['top'])
        self.assertLessEqual(
            geometry['x'] + geometry['width'],
            viewport['left'] + viewport['width']
        )
        self.assertLessEqual(
            geometry['y'] + geometry['height'],
            viewport['top'] + viewport['height']
        )
        self.hit_test(close)
        close.focus()
        expect(close).to_be_focused()

        Path('test-results').mkdir(exist_ok=True)
        self.page.screenshot(
            path=f'test-results/{self.engine}-gallery-post-scroll-enlarged-close.png'
        )
        close.press('Enter')
        expect(panel).to_have_count(0)
        expect(self.page.locator('button[data-reader-controls]')).to_be_focused()

    def test_gallery_keeps_zoom_and_other_panes_out_of_wheel_paging(self):
        self.page.set_viewport_size({'width': 1440, 'height': 1000})
        panel = self.open_gallery('light')
        viewer = panel.locator('.gallery-viewer')
        viewer.focus()
        self.assertLessEqual(viewer.evaluate('e => e.scrollHeight - e.clientHeight'), 1)
        # Synthetic wheel events test routing/cancellation through the actual
        # gallery. They do not claim to emulate physical pinch zoom.
        for selector, options in (
            ('.gallery-viewer', {'ctrlKey': True}),
            ('.gallery-viewer', {'deltaX': 150}),
            ('.gallery-header', {}),
            ('.gallery-list', {})
        ):
            prevented = panel.locator(selector).evaluate("""(e, options) => {
              const event = new WheelEvent('wheel', {
                deltaY:100, bubbles:true, cancelable:true, ...options
              });
              e.dispatchEvent(event);
              return event.defaultPrevented;
            }""", options)
            self.assertFalse(prevented)
            expect(viewer.locator('img')).to_have_attribute('alt', 'Book illustration 1')
        viewer.press('Control+ArrowRight')
        expect(viewer.locator('img')).to_have_attribute('alt', 'Book illustration 1')
        viewer.press('ArrowRight')
        expect(viewer.locator('img')).to_have_attribute('alt', 'Book illustration 2')
        prevented = viewer.evaluate("""e => {
          const event = new WheelEvent('wheel', {deltaY:-100, bubbles:true, cancelable:true});
          e.dispatchEvent(event);
          return event.defaultPrevented;
        }""")
        self.assertTrue(prevented)
        expect(viewer.locator('img')).to_have_attribute('alt', 'Book illustration 1')
        next_button = panel.get_by_role('button', name='Next', exact=True)
        next_button.focus()
        next_button.press('Enter')
        expect(viewer.locator('img')).to_have_attribute('alt', 'Book illustration 2')
        self.page.keyboard.press('Escape')
        expect(panel).to_have_count(0)

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
