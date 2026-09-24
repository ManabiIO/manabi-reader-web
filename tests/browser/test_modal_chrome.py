"""Modal geometry and dismissal against the actual built app and IndexedDB.

Uses ordinary browser input; no substituted components or intercepted requests.
Run with LIBRARY_BROWSER=chromium or webkit after the /Reader-Web static build.
"""
from pathlib import Path
import unittest
from playwright.sync_api import expect
from test_books_library import LibraryBase


class ModalChromeBrowser(LibraryBase):
    def screenshot(self, name):
        Path('test-results').mkdir(exist_ok=True)
        self.page.screenshot(path=f'test-results/{self.engine}-modal-{name}.png', full_page=True)

    def assert_close_chrome(self, panel, header=None):
        expect(panel).to_be_visible()
        close = panel.get_by_role('button', name='Close', exact=True)
        close.scroll_into_view_if_needed()
        expect(close).to_be_in_viewport()
        geometry = close.evaluate('''button => {
          const rect = button.getBoundingClientRect();
          const style = getComputedStyle(button);
          const icon = button.querySelector('svg');
          return {width: rect.width, height: rect.height,
            radius: parseFloat(style.borderTopLeftRadius),
            background: style.backgroundColor, foreground: style.color,
            hasIcon: Boolean(icon), hiddenIcon: icon?.getAttribute('aria-hidden')};
        }''')
        self.assertGreaterEqual(geometry['width'], 43.99)
        self.assertGreaterEqual(geometry['height'], 43.99)
        self.assertAlmostEqual(geometry['width'], geometry['height'], delta=0.1)
        self.assertGreaterEqual(geometry['radius'], geometry['height'] / 2)
        self.assertNotEqual('rgba(0, 0, 0, 0)', geometry['background'])
        self.assertNotEqual(geometry['background'], geometry['foreground'])
        self.assertTrue(geometry['hasIcon'])
        self.assertEqual('true', geometry['hiddenIcon'])
        self.assertLessEqual(panel.evaluate('e => e.scrollWidth - e.clientWidth'), 1)
        bounds = panel.bounding_box()
        viewport = self.page.viewport_size
        self.assertGreaterEqual(bounds['x'], -1)
        self.assertGreaterEqual(bounds['y'], -1)
        self.assertLessEqual(bounds['x'] + bounds['width'], viewport['width'] + 1)
        self.assertLessEqual(bounds['y'] + bounds['height'], viewport['height'] + 1)
        if header is not None:
            box, button = header.bounding_box(), close.bounding_box()
            self.assertTrue(
                box['x'] + box['width'] <= button['x'] + 1 or
                button['x'] + button['width'] <= box['x'] + 1 or
                box['y'] + box['height'] <= button['y'] + 1 or
                button['y'] + button['height'] <= box['y'] + 1,
                f'Close overlaps modal content: header={box}, close={button}')
        return close

    def test_library_headers_and_capsules_at_phone_tablet_desktop_in_both_modes(self):
        title = 'A long book title 日本語の長い本の題名と読書の記録 ' + 'UnbrokenTitle' * 12
        self.import_book(title)
        for mode in ('light', 'dark'):
            self.page.evaluate('mode => localStorage.setItem("appearance", mode)', mode)
            self.go_library()
            expect(self.page.locator('html')).to_have_attribute('data-appearance', mode)
            for width in (320, 390, 768, 1440):
                with self.subTest(mode=mode, width=width):
                    self.page.set_viewport_size({'width': width, 'height': 740})
                    self.menu(title, 'Add to Collection…')
                    panel = self.dialog()
                    close = self.assert_close_chrome(panel, panel.locator('[data-slot="dialog-header"]'))
                    done = panel.get_by_role('button', name='Done', exact=True)
                    capsule = done.evaluate('''e => ({height:e.getBoundingClientRect().height,
                      radius:parseFloat(getComputedStyle(e).borderTopLeftRadius)})''')
                    self.assertGreaterEqual(capsule['radius'], capsule['height'] / 2)
                    self.screenshot(f'collection-{mode}-{width}')
                    close.click()
                    expect(panel).to_have_count(0)
                    self.menu(title, 'Book Details')
                    panel = self.dialog()
                    close = self.assert_close_chrome(panel, panel.locator('[data-slot="dialog-header"]'))
                    self.screenshot(f'details-{mode}-{width}')
                    close.click()
                    expect(panel).to_have_count(0)

    def test_large_text_and_short_viewport_keep_actions_reachable(self):
        title = 'Large text 日本語の本'
        self.import_book(title)
        self.page.set_viewport_size({'width': 390, 'height': 420})
        self.menu(title, 'Add to Collection…')
        panel = self.dialog()
        # Browser text scaling, not replacement UI or test-only layout markup.
        self.page.evaluate('document.documentElement.style.fontSize = "24px"')
        close = self.assert_close_chrome(panel, panel.locator('[data-slot="dialog-header"]'))
        done = panel.get_by_role('button', name='Done', exact=True)
        done.scroll_into_view_if_needed()
        expect(done).to_be_in_viewport()
        self.screenshot('large-text-short-viewport')
        done.click()
        expect(panel).to_have_count(0)
        self.page.evaluate('document.documentElement.style.fontSize = ""')

    def test_reader_sheets_reserve_header_space_and_body_gutters(self):
        title = ('Reading a long book title 日本語の本の題名 ' * 3).strip()
        self.import_book(title)
        self.page.get_by_role('button', name='Read ' + title, exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')
        for width in (320, 768):
            self.page.set_viewport_size({'width': width, 'height': 740})
            for name in ('Search Book', 'Browse Book', 'Bookmarks & Notes'):
                with self.subTest(width=width, name=name):
                    reveal = self.page.get_by_role('button', name='Show reading controls', exact=True)
                    if reveal.is_visible():
                        reveal.click()
                    if name == 'Bookmarks & Notes':
                        self.page.get_by_role('button', name='Bookmarks and Notes', exact=True).click()
                    else:
                        self.page.get_by_role('button', name='Reading tools', exact=True).click()
                        self.page.get_by_role('menuitem', name=name, exact=True).click()
                    panel = self.page.get_by_role('dialog', name=name, exact=True)
                    close = self.assert_close_chrome(panel, panel.locator('[data-slot="sheet-header"]'))
                    self.assertEqual('horizontal-tb', panel.evaluate('e => getComputedStyle(e).writingMode'))
                    self.assertGreaterEqual(panel.evaluate('e => parseFloat(getComputedStyle(e).paddingLeft)'), 20)
                    self.screenshot(f'{name.replace(" ", "-")}-{width}')
                    close.click()
                    expect(panel).to_have_count(0)

    def test_legacy_dialog_close_does_not_cover_fields_or_save_unsaved_changes(self):
        self.page.set_viewport_size({'width': 390, 'height': 480})
        self.page.goto(self.origin + '/Reader-Web/settings')
        trigger = self.page.get_by_role('button', name='Add custom theme', exact=True)
        trigger.click()
        panel = self.dialog()
        self.assert_close_chrome(panel, panel.locator('section.ui-panel'))
        name = panel.get_by_label('Theme name', exact=True)
        name.fill('Unsaved chrome regression')
        save = panel.get_by_role('button', name='Save', exact=True)
        save.scroll_into_view_if_needed()
        expect(save).to_be_in_viewport()
        for _ in range(12):
            self.page.keyboard.press('Tab')
            expect(panel.locator(':focus')).to_have_count(1)
        self.screenshot('legacy-keyboard')
        self.page.keyboard.press('Escape')
        expect(panel).to_have_count(0)
        expect(trigger).to_be_focused()
        self.assertNotIn('Unsaved chrome regression', self.page.evaluate('localStorage.getItem("customThemes") || ""'))

    def test_navigation_close_is_in_flow_and_returns_focus(self):
        self.page.set_viewport_size({'width': 320, 'height': 568})
        self.page.goto(self.origin + '/Reader-Web/settings')
        trigger = self.page.get_by_role('button', name='Navigate', exact=True)
        trigger.click()
        panel = self.page.get_by_role('dialog', name='Manabi Reader', exact=True)
        close = self.assert_close_chrome(panel, panel.locator('[data-slot="sheet-header"]'))
        self.screenshot('navigation-320')
        close.click()
        expect(panel).to_have_count(0)
        expect(trigger).to_be_focused()

    def test_headerless_dialog_also_reserves_dismissal_space(self):
        self.page.set_viewport_size({'width': 320, 'height': 568})
        self.page.get_by_role('button', name='Library actions', exact=True).click()
        self.page.get_by_role('menuitem', name="Editor's Picks", exact=True).click()
        panel = self.page.get_by_role('dialog', name="Editor's Picks", exact=True)
        close = self.assert_close_chrome(panel, panel.locator('#editors-picks-dialog-heading'))
        self.screenshot('headerless-picks-320')
        close.click()
        expect(panel).to_have_count(0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
