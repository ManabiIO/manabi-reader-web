"""Gallery round trips through real layout, focus, viewport and reading state."""
import io
import json
import unittest
import zipfile

from playwright.sync_api import expect
from test_gallery_reveal_lifetime import GalleryRevealBase, illustrated_book


class GalleryContinuity(GalleryRevealBase):
    def assert_pointer_target(self, control):
        expect(control).to_be_visible()
        handle = control.element_handle()
        try:
            self.page.wait_for_function('''e => {
              const r = e.getBoundingClientRect();
              const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
              return r.width >= 44 && r.height >= 44 && r.left >= 0 && r.top >= 0 &&
                r.right <= innerWidth && r.bottom <= innerHeight && hit && e.contains(hit);
            }''', arg=handle)
        finally:
            handle.dispose()

    def test_layout_switches_preserve_reveal_and_book_identity(self):
        self.open_book('Gallery layout continuity')
        url = self.page.url
        identity = [(r['id'], r['contentHash']) for r in self.stores('books', ['data'])['data']]
        panel = self.open_gallery()
        self.reveal_second(panel)
        self.close_gallery(panel)
        for layout, saved in [('Pages', 'paginated'), ('Scroll', 'continuous'), ('Pages', 'paginated')]:
            with self.subTest(layout=layout):
                self.page.get_by_role('button', name='Show reading controls', exact=True).click()
                self.page.get_by_role('button', name='Themes & Settings', exact=True).click()
                appearance = self.page.get_by_role('dialog', name='Themes & Settings', exact=True)
                button = appearance.get_by_role('button', name=layout, exact=True)
                button.click()
                expect(button).to_have_attribute('aria-pressed', 'true')
                self.page.wait_for_function('(v) => localStorage.getItem("viewMode") === v', arg=saved)
                appearance.get_by_role('button', name='Close reading appearance', exact=True).click()
                expect(appearance).to_have_count(0)
                expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')
                self.page.get_by_role('button', name='Hide reading controls', exact=True).click()
                panel = self.open_gallery()
                expect(panel.get_by_role('button', name='View image 2', exact=True)).to_be_visible()
                expect(panel.get_by_role('button', name='Show hidden image 1', exact=True)).to_be_visible()
                self.capture('layout-' + saved)
                self.close_gallery(panel)
                self.assertEqual(url, self.page.url)
                self.assertEqual(identity, [(r['id'], r['contentHash']) for r in self.stores('books', ['data'])['data']])

    def test_gallery_round_trip_restores_nonzero_continuous_scroll(self):
        # This journey measures vertical document scrolling. Configure horizontal
        # reading explicitly instead of inheriting the default vertical-rl mode.
        self.context.add_init_script("localStorage.setItem('writingMode', 'horizontal-tb')")
        self.go_library()
        title = 'Continuous reading continuity'
        source = illustrated_book(title)
        output = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(source)) as original, zipfile.ZipFile(output, 'w') as target:
            for item in original.infolist():
                value = original.read(item)
                if item.filename.endswith('chapter.xhtml'):
                    paragraphs = ''.join('<p>READING_ANCHOR_%03d 日本語の文章を丁寧に読み進めます。</p>' % i for i in range(100))
                    value = value.replace(b'<body>', b'<body>' + paragraphs.encode())
                target.writestr(item.filename, value)
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files({
            'name': title + '.epub', 'mimeType': 'application/epub+zip', 'buffer': output.getvalue()
        })
        self.page.get_by_role('button', name='Read ' + title, exact=True).click()
        content = self.page.locator('.book-content')
        expect(content).to_have_attribute('aria-busy', 'false')
        expect(content).to_have_css('writing-mode', 'horizontal-tb')
        self.page.wait_for_function("() => document.fonts.check('20px \"Klee One\"', '日本語')")
        anchor = content.get_by_text('READING_ANCHOR_060', exact=False)
        anchor.scroll_into_view_if_needed()
        self.page.wait_for_function('() => window.scrollY > 500')
        before = self.page.evaluate('({x:scrollX, y:scrollY})')
        anchor_before = anchor.bounding_box()
        url = self.page.url
        positions = {'before': before, 'anchorBefore': anchor_before}
        panel = self.open_gallery()
        positions['galleryOpen'] = self.page.evaluate('({x:scrollX, y:scrollY})')
        self.reveal_second(panel)
        self.close_gallery(panel)
        positions['immediateReturn'] = self.page.evaluate('({x:scrollX, y:scrollY})')
        (self.output / 'scroll-transition.json').write_text(json.dumps(positions, indent=2))
        self.page.wait_for_function('''({x,y}) => Math.abs(scrollX-x) <= 2 && Math.abs(scrollY-y) <= 2''', arg=before)
        after = self.page.evaluate('({x:scrollX, y:scrollY})')
        anchor_after = anchor.bounding_box()
        self.assertAlmostEqual(anchor_before['y'], anchor_after['y'], delta=2)
        self.assertEqual(url, self.page.url)
        (self.output / 'scroll-restoration.json').write_text(json.dumps({
            'before': before, 'after': after, 'anchorBefore': anchor_before, 'anchorAfter': anchor_after
        }, indent=2))
        self.capture('nonzero-reading-position-restored')

    def test_keyboard_navigation_survives_disabled_end_controls(self):
        self.open_book()
        panel = self.open_gallery()
        viewer = panel.locator('.gallery-viewer')
        next_button = viewer.get_by_role('button', name='Next', exact=True)
        next_button.focus()
        self.page.keyboard.press('Enter')
        expect(next_button).to_be_disabled()
        expect(viewer.get_by_text('2 / 2', exact=True)).to_be_visible()
        self.assertTrue(panel.evaluate('e => e.contains(document.activeElement)'),
                        'Reaching the last image must not lose dialog keyboard ownership')
        self.page.keyboard.press('ArrowLeft')
        expect(viewer.get_by_text('1 / 2', exact=True)).to_be_visible()
        previous = viewer.get_by_role('button', name='Previous', exact=True)
        expect(previous).to_be_disabled()
        self.page.keyboard.press('ArrowRight')
        expect(viewer.get_by_text('2 / 2', exact=True)).to_be_visible()
        expect(viewer.get_by_role('button', name='Show image · ネタバレ', exact=True)).to_be_visible()
        self.capture('keyboard-at-boundary')
        self.close_gallery(panel)

    def test_resizing_preserves_selected_image_and_mobile_return_focus(self):
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.open_book()
        panel = self.open_gallery()
        self.reveal_second(panel)
        panel.get_by_role('button', name='View image 2', exact=True).click()
        viewer = panel.locator('.gallery-viewer')
        for width, height in [(1200, 900), (667, 390), (320, 568)]:
            with self.subTest(width=width):
                self.page.set_viewport_size({'width': width, 'height': height})
                expect(viewer.locator('img')).to_have_attribute('alt', 'Book illustration 2')
                expect(viewer.locator('.spoiler-label')).to_have_count(0)
                expect(viewer.get_by_text('2 / 2', exact=True)).to_be_visible()
                self.assert_pointer_target(panel.get_by_role('button', name='Close Image Gallery', exact=True))
                self.assertLessEqual(panel.evaluate('e => e.scrollWidth - e.clientWidth'), 1)
                self.capture('resized-' + str(width))
        panel.get_by_role('button', name='All images', exact=True).click()
        chosen = panel.get_by_role('button', name='View image 2', exact=True)
        expect(chosen).to_be_focused()
        expect(panel.get_by_role('button', name='Show hidden image 1', exact=True)).to_be_visible()
        self.close_gallery(panel)


if __name__ == '__main__':
    unittest.main(verbosity=2)
