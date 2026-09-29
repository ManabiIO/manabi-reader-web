"""Real static UI: modal geometry, keyboard dismissal and async reader selection.

Only the resource digest is held/rejected in the lifetime fault tests. The UI,
EPUB importer, search worker, locator calculation and IndexedDB are production.
"""
from reader_controls import reveal_reader_controls
from pathlib import Path
import unittest
from playwright.sync_api import expect
from test_books_library import LibraryBase


class ModalControlsBrowser(LibraryBase):
    def frames(self):
        self.page.evaluate('''() => new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)))''')

    def capture(self, name):
        output = Path('test-results')
        output.mkdir(exist_ok=True)
        self.page.screenshot(path=str(output / (self.engine + '-' + name + '.png')))

    def check_modal(self, panel):
        expect(panel).to_be_visible()
        close = panel.locator('[data-modal-dismiss]')
        expect(close).to_be_visible()
        self.frames()
        result = panel.evaluate('''panel => {
          const close = panel.querySelector('[data-modal-dismiss]');
          const box = close.getBoundingClientRect();
          const bounds = panel.getBoundingClientRect();
          const style = getComputedStyle(close);
          const overlaps = [];
          for (const element of panel.querySelectorAll(
            '[data-slot="dialog-title"], [data-slot="dialog-description"], ' +
            '[data-slot="sheet-title"], [data-slot="sheet-description"]')) {
            if (element.classList.contains('sr-only')) continue;
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              const range = document.createRange();
              range.selectNodeContents(walker.currentNode);
              for (const r of range.getClientRects()) {
                if (Math.min(r.right, box.right) - Math.max(r.left, box.left) > 1 &&
                    Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top) > 1)
                  overlaps.push(walker.currentNode.textContent);
              }
            }
          }
          return { width: box.width, height: box.height,
            radius: parseFloat(style.borderTopLeftRadius),
            fill: style.backgroundColor, tint: style.color, overlaps,
            panel: { x: bounds.x, y: bounds.y, right: bounds.right, bottom: bounds.bottom },
            close: { x: box.x, y: box.y, right: box.right, bottom: box.bottom },
            viewport: { width: innerWidth, height: innerHeight },
            overflow: panel.scrollWidth - panel.clientWidth,
            hit: (() => {
              const x = box.left + box.width / 2, y = box.top + box.height / 2;
              const hit = document.elementFromPoint(x, y);
              return !!hit && (hit === close || close.contains(hit));
            })() };
        }''')
        self.assertEqual([], result['overlaps'], result)
        self.assertGreaterEqual(result['width'], 43.99, result)
        self.assertAlmostEqual(result['width'], result['height'], delta=0.5)
        self.assertGreaterEqual(result['radius'], result['height'] / 2, result)
        self.assertNotEqual(result['fill'], result['tint'], result)
        self.assertGreaterEqual(result['panel']['x'], -1, result)
        self.assertGreaterEqual(result['panel']['y'], -1, result)
        self.assertLessEqual(result['panel']['right'], result['viewport']['width'] + 1, result)
        self.assertLessEqual(result['panel']['bottom'], result['viewport']['height'] + 1, result)
        self.assertLessEqual(result['overflow'], 1, result)
        self.assertGreaterEqual(result['close']['y'], result['panel']['y'], result)
        self.assertLessEqual(result['close']['right'], result['panel']['right'], result)
        self.assertLessEqual(result['close']['bottom'], result['panel']['bottom'], result)
        self.assertTrue(result['hit'], result)
        return close

    def open_reader(self):
        self.import_book('Panel lifecycle')
        self.page.get_by_role('button', name='Read Panel lifecycle', exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute(
            'aria-busy', 'false', timeout=35000)

    def open_tool(self, name):
        reveal_reader_controls(self.page)
        self.page.get_by_role('button', name='Reading tools', exact=True).click()
        self.page.get_by_role('menuitem', name=name, exact=True).click()
        panel = self.page.get_by_role('dialog').last
        expect(panel).to_be_visible()
        self.frames()
        return panel

    def search(self):
        panel = self.open_tool('Search Book')
        panel.get_by_role('searchbox', name='Search within book').fill('日')
        expect(panel.get_by_text('180 results', exact=True)).to_be_visible(timeout=15000)
        return panel

    def hold_digest(self):
        self.page.evaluate('''() => {
          const digest = crypto.subtle.digest.bind(crypto.subtle);
          window.__releasePanelDigest = null;
          crypto.subtle.digest = (...args) => {
            crypto.subtle.digest = digest;
            return new Promise((resolve, reject) => {
              window.__releasePanelDigest = async () => {
                try { resolve(await digest(...args)); } catch (error) { reject(error); }
              };
            });
          };
        }''')

    def release_digest(self):
        self.page.evaluate('window.__releasePanelDigest()')
        self.frames()

    def test_long_library_dialogs_clear_the_close_target_in_light_and_dark(self):
        title = 'A long book title with a subtitle — ' + '日本語の読書と学習' * 12
        self.import_book(title)
        saved = self.stores('books', ['bookmark'])
        for mode in ('light', 'dark'):
            self.page.emulate_media(color_scheme=mode)
            for width, height in ((320, 640), (568, 320), (1200, 900)):
                with self.subTest(mode=mode, width=width):
                    self.page.set_viewport_size({'width': width, 'height': height})
                    self.menu(title, 'Book Details')
                    panel = self.dialog()
                    close = self.check_modal(panel)
                    done = panel.get_by_role('button', name='Done', exact=True)
                    shape = done.evaluate('e => ({height:e.getBoundingClientRect().height, radius:parseFloat(getComputedStyle(e).borderRadius)})')
                    self.assertGreaterEqual(shape['radius'], shape['height'] / 2)
                    for key in ['Tab', 'Shift+Tab'] * 3:
                        self.page.keyboard.press(key)
                        expect(panel.locator(':focus')).to_have_count(1)
                    self.capture(f'modal-book-info-{mode}-{width}')
                    close.click()
                    expect(panel).to_have_count(0)
        self.assertEqual(saved, self.stores('books', ['bookmark']))

    def test_long_dialog_keeps_dismissal_reachable_after_own_scroll(self):
        title = 'Scrollable Book Details — ' + '長い日本語の題名と副題' * 20
        self.import_book(title)
        self.page.set_viewport_size({'width': 320, 'height': 320})
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        self.menu(title, 'Book Details')
        panel = self.dialog()
        close = self.check_modal(panel)
        self.assertTrue(
            panel.evaluate('e => e.scrollHeight > e.clientHeight'),
            'The regression fixture must genuinely overflow the dialog.'
        )
        panel.evaluate('e => { e.scrollTop = e.scrollHeight; }')
        self.page.wait_for_function('e => e.scrollTop > 0', arg=panel.element_handle())

        # The entire dialog is the scroll owner. Dismissal must track that
        # scroll rather than moving off the visual viewport with its content.
        close = self.check_modal(panel)
        self.capture('modal-book-info-post-scroll-200')
        close.focus()
        expect(close).to_be_focused()
        close.press('Enter')
        expect(panel).to_have_count(0)
        self.page.evaluate('document.documentElement.style.fontSize = ""')

    def test_onboarding_dialog_fits_short_viewports_and_larger_text(self):
        self.open_reader()
        for width, height, font_size in (
            (320, 480, '125%'),
            (568, 320, '100%'),
            (320, 320, '200%'),
        ):
            with self.subTest(width=width, height=height, font_size=font_size):
                self.page.set_viewport_size({'width': width, 'height': height})
                self.page.evaluate('(size) => document.documentElement.style.fontSize = size', font_size)
                panel = self.open_tool('Dictionary Setup')
                self.check_modal(panel)

                if font_size == '200%':
                    controls = (
                        panel.get_by_role('link', name='Get Manabitan', exact=True),
                        panel.get_by_role('button', name='Use another extension', exact=True),
                        panel.get_by_role('button', name='Not now', exact=True),
                    )
                    self.assertTrue(
                        panel.evaluate('e => e.scrollHeight > e.clientHeight'),
                        'The 200% onboarding fixture must genuinely overflow.'
                    )
                    for control in controls:
                        control.scroll_into_view_if_needed()
                        expect(control).to_be_visible()
                        box = control.bounding_box()
                        self.assertGreaterEqual(box['height'], 43.99, box)
                        self.assertGreaterEqual(box['x'], -1, box)
                        self.assertGreaterEqual(box['y'], -1, box)
                        self.assertLessEqual(box['x'] + box['width'], width + 1, box)
                        self.assertLessEqual(box['y'] + box['height'], height + 1, box)
                        self.assertTrue(control.evaluate('''e => {
                          const r=e.getBoundingClientRect();
                          const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
                          return !!hit && (hit===e || e.contains(hit));
                        }'''))
                    # Dismissal must remain independently reachable after the
                    # body has scrolled all the way to the final choice.
                    close = self.check_modal(panel)
                    close.focus()
                    expect(close).to_be_focused()

                self.capture(f'modal-dictionary-{width}-{height}-{font_size}')
                panel.get_by_role('button', name='Not now', exact=True).click()
                expect(panel).to_have_count(0)
        self.page.evaluate('document.documentElement.style.fontSize = ""')

    def test_legacy_theme_dialog_uses_same_close_control_and_cancels(self):
        self.page.set_viewport_size({'width': 320, 'height': 520})
        self.page.goto(self.origin + '/reader-web/settings')
        trigger = self.page.get_by_role('button', name='Add custom theme', exact=True)
        trigger.click()
        panel = self.dialog()
        close = self.check_modal(panel)
        panel.get_by_label('Theme name', exact=True).fill('Do not save this theme')
        self.capture('modal-legacy-theme-phone')
        close.click()
        expect(panel).to_have_count(0)
        expect(trigger).to_be_focused()
        self.assertNotIn('Do not save this theme', self.page.evaluate('localStorage.getItem("customThemes") || ""'))

    def test_reader_sheets_have_gutters_and_unobscured_close_controls(self):
        self.open_reader()
        self.page.set_viewport_size({'width': 320, 'height': 568})
        panel = self.search()
        close = self.check_modal(panel)
        bounds, field = panel.bounding_box(), panel.get_by_role('searchbox').bounding_box()
        self.assertGreaterEqual(field['x'] - bounds['x'], 19)
        self.assertLessEqual(field['x'] + field['width'], bounds['x'] + bounds['width'] - 19)
        self.capture('modal-search-phone')
        close.click()
        expect(panel).to_have_count(0)
        panel = self.open_tool('Browse Book')
        close = self.check_modal(panel)
        bounds, slider = panel.bounding_box(), panel.get_by_role('slider').bounding_box()
        self.assertGreaterEqual(slider['x'] - bounds['x'], 19)
        self.assertLessEqual(slider['x'] + slider['width'], bounds['x'] + bounds['width'] - 19)
        self.capture('modal-browse-phone')
        close.click()
        expect(panel).to_have_count(0)

    def test_scrubber_preview_uses_the_current_input_before_release(self):
        self.open_reader()
        panel = self.open_tool('Browse Book')
        slider = panel.get_by_role('slider', name='Book position')
        slider.evaluate('e => { e.value = "750"; e.dispatchEvent(new Event("input", {bubbles:true})); }')
        expect(slider).to_have_attribute('aria-valuetext', 'Section 1 of 1 · approximately 75%')
        expect(panel.get_by_text('Section 1 of 1 · approximately 75%', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Return to where I was', exact=True)).to_have_count(0)

    def test_dismissed_search_cannot_navigate_a_reopened_panel(self):
        self.open_reader()
        panel = self.search()
        saved = self.stores('books', ['bookmark'])
        self.hold_digest()
        panel.get_by_role('button').filter(has_text='Section 1').first.click()
        self.page.wait_for_function('typeof window.__releasePanelDigest === "function"')
        self.page.keyboard.press('Escape')
        expect(panel).to_have_count(0)
        panel = self.search()
        self.release_digest()
        expect(panel).to_be_visible()
        expect(self.page.get_by_role('button', name='Return to where I was', exact=True)).to_have_count(0)
        self.assertEqual(saved, self.stores('books', ['bookmark']))
        panel.get_by_role('button').filter(has_text='Section 1').first.click()
        expect(panel).to_have_count(0)
        expect(self.page.get_by_role('button', name='Return to where I was', exact=True)).to_be_visible()

    def test_dismissed_scrubber_cannot_navigate_a_reopened_panel(self):
        self.open_reader()
        panel = self.open_tool('Browse Book')
        self.hold_digest()
        panel.get_by_role('slider').evaluate('e => { e.value = "750"; e.dispatchEvent(new Event("input", {bubbles:true})); e.dispatchEvent(new Event("change", {bubbles:true})); }')
        self.page.wait_for_function('typeof window.__releasePanelDigest === "function"')
        self.page.keyboard.press('Escape')
        expect(panel).to_have_count(0)
        panel = self.open_tool('Browse Book')
        self.release_digest()
        expect(panel).to_be_visible()
        expect(self.page.get_by_role('button', name='Return to where I was', exact=True)).to_have_count(0)
        panel.get_by_role('slider').evaluate('e => { e.value = "750"; e.dispatchEvent(new Event("input", {bubbles:true})); e.dispatchEvent(new Event("change", {bubbles:true})); }')
        expect(panel).to_have_count(0)
        expect(self.page.get_by_role('button', name='Return to where I was', exact=True)).to_be_visible()

    def test_failed_search_digest_is_reported_and_retry_still_navigates(self):
        self.open_reader()
        panel = self.search()
        self.page.evaluate('''() => {
          const digest = crypto.subtle.digest.bind(crypto.subtle);
          crypto.subtle.digest = () => {
            crypto.subtle.digest = digest;
            return Promise.reject(new Error('Test resource digest failure'));
          };
        }''')
        panel.get_by_role('button').filter(has_text='Section 1').first.click()
        expect(panel.get_by_role('alert')).to_have_text('Could not open this result. Please try again.')
        expect(panel).to_be_visible()
        panel.get_by_role('button').filter(has_text='Section 1').first.click()
        expect(panel).to_have_count(0)
        expect(self.page.get_by_role('button', name='Return to where I was', exact=True)).to_be_visible()


    def test_export_dialog_uses_native_targets_and_reflows_at_200_percent_text(self):
        title = 'Export dialog accessibility'
        self.import_book(title)
        header = self.page.locator('header[aria-label="Library toolbar"]')
        header.get_by_role('button', name='Library actions', exact=True).click()
        self.page.get_by_role('menuitem', name='Select Books', exact=True).click()
        header.get_by_role('button', name='Select All Visible', exact=True).click()
        export = header.get_by_role('button', name='Export', exact=True)
        expect(export).to_be_visible()
        self.page.set_viewport_size({'width': 320, 'height': 568})
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        export.click()
        panel = self.dialog()
        expect(
            panel.get_by_role('heading', name='Export books and reading data', exact=True)
        ).to_be_visible()
        self.frames()
        self.assertLessEqual(panel.evaluate('e => e.scrollWidth - e.clientWidth'), 1)

        target = panel.get_by_role('button', name='Zip File', exact=True)
        self.assertEqual('BUTTON', target.evaluate('e => e.tagName'))
        expect(target).to_have_attribute('aria-pressed', 'true')
        target.focus()
        expect(target).to_be_focused()
        self.assertGreaterEqual(target.bounding_box()['height'], 43.99)

        checkboxes = panel.get_by_role('checkbox')
        self.assertEqual(5, checkboxes.count())
        for checkbox in checkboxes.all():
            label = checkbox.locator('xpath=ancestor::label')
            self.assertGreaterEqual(label.bounding_box()['height'], 43.99)
            checkbox.uncheck()
        start = panel.get_by_role('button', name='Start export', exact=True)
        expect(start).to_be_disabled()
        checkboxes.first.check()
        expect(start).to_be_enabled()
        self.capture('modal-export-phone-200')

        panel.get_by_role('button', name='Cancel', exact=True).click()
        expect(panel).to_have_count(0)
        expect(export).to_be_focused()
        self.page.evaluate('document.documentElement.style.fontSize = ""')


if __name__ == '__main__':
    unittest.main()
