"""Appearance regressions against the real static Reader and real browser storage."""
import base64
import os
from tempfile import TemporaryDirectory
from pathlib import Path
import unittest
from playwright.sync_api import expect
import test_appearance as previous


# Real raster bytes; browsers need only decode, not implement every encoder.
JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCABQAHgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwChRRRQfWhRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAH/2Q=='
WEBP = 'UklGRlYAAABXRUJQVlA4IEoAAADwBACdASp4AFAAPm02mUmkIyKhIMgAgA2JaQAABje6m/LqHOMoB7qb6NqHOMoBoAAA/uLev//ln/+y3/Zb0bzR0EdEwAAAAAAAAA=='

class RefinedAppearance(previous.AppearanceBrowser):
    def setUp(self):
        if os.environ.get('APPEARANCE_BROWSER', 'chromium') == 'chromium':
            super().setUp()
            return
        # Ordinary Safari uses a persistent store. WebKit's private/ephemeral
        # sessions cannot store IDB Blobs (WebKit #156347 / Playwright #42795).
        # Real, isolated disk-backed profiles; no API replacements or interception.
        profile = TemporaryDirectory(prefix='reader-appearance-webkit-')
        self.addCleanup(profile.cleanup)
        self.context = self.playwright.webkit.launch_persistent_context(profile.name)
        self.page = self.context.pages[0]
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        previous.baseline.StaticHandler.probes.clear()

    def test_live_tabs_share_palette_custom_edits_and_fade_without_reloading_book(self):
        self.open_book()
        reader = self.context.new_page()
        reader.on('pageerror', lambda error: self.errors.append(str(error)))
        reader.goto(self.page.url)
        expect(reader.locator('.book-content')).to_be_visible()
        reader.locator('.book-content').evaluate('e => e.dataset.retained = "yes"')
        self.settings()
        self.page.locator('button[title="ecru-theme"]').click()
        expect(reader.locator('html')).to_have_attribute('data-theme', 'ecru-theme')
        self.mode('Dark')
        expect(reader.locator('html')).to_have_attribute('data-appearance', 'dark')
        self.page.get_by_text('Background images', exact=True).click()
        self.upload('reader', [100, 40, 150])
        expect(reader.locator('[data-background="reader"]')).to_have_count(1)
        self.page.locator('#fade-reader').focus()
        self.page.keyboard.press('End')
        reader.wait_for_function('getComputedStyle(document.querySelector(".page-background"), "::after").backgroundColor === "rgb(0, 0, 0)"')
        self.page.locator('fieldset:has(#background-reader)').get_by_role('checkbox', name='Fade background').uncheck()
        reader.wait_for_function('getComputedStyle(document.querySelector(".page-background"), "::after").backgroundColor === "rgba(0, 0, 0, 0)"')
        self.page.get_by_role('button', name='Add custom theme', exact=True).click()
        self.page.get_by_placeholder('Theme Name', exact=True).fill('Midnight notes')
        self.page.get_by_role('button', name='Save', exact=True).click()
        expect(reader.locator('html')).to_have_attribute('data-theme', 'custom')
        self.page.get_by_role('button', name='Edit Midnight notes theme', exact=True).click()
        self.page.get_by_label('Font color', exact=True).evaluate('e => {e.value = "#ffeecc"; e.dispatchEvent(new Event("change", {bubbles: true}));}')
        self.page.get_by_label('Font opacity', exact=True).fill('1')
        self.page.get_by_role('button', name='Save', exact=True).click()
        expect(reader.locator('.book-content')).to_have_css('color', 'rgb(255, 238, 204)')
        expect(reader.locator('.book-content')).to_have_attribute('data-retained', 'yes')
        reader.close()

    def test_damaged_optional_palette_does_not_break_startup_or_override(self):
        self.page.goto(self.origin + '/Reader-Web/manage')
        for raw in ['{invalid', 'null', '[]', '42']:
            self.page.evaluate('(raw) => {localStorage.setItem("customThemes", raw); localStorage.setItem("appearance", "dark");}', raw)
            self.settings()
            self.assertEqual('dark', self.scheme())
            self.assertEqual(raw, self.page.evaluate('localStorage.getItem("customThemes")'))
            self.mode('Light')
            self.page.reload()
            expect(self.page.get_by_role('heading', name='Appearance', exact=True)).to_be_visible()
            self.assertEqual('light', self.scheme())

    def test_rapid_tab_edits_converge_without_writing_back_stale_events(self):
        self.settings()
        other = self.context.new_page()
        other.goto(self.origin + '/Reader-Web/settings')
        expect(other.get_by_role('heading', name='Appearance', exact=True)).to_be_visible()
        for label in ['Light', 'Dark', 'System', 'Dark', 'Light']:
            self.page.get_by_role('group', name='Appearance mode').get_by_role('button', name=label, exact=True).click()
        expect(other.locator('html')).to_have_attribute('data-appearance', 'light')
        other.get_by_role('group', name='Appearance mode').get_by_role('button', name='Dark', exact=True).click()
        expect(self.page.locator('html')).to_have_attribute('data-appearance', 'dark')
        # Removal is a real storage event, including its null-key clear variant.
        other.evaluate('localStorage.clear()')
        expect(self.page.locator('html')).to_have_attribute('data-appearance', 'system')
        expect(self.page.locator('html')).to_have_attribute('data-theme', 'manabi-theme')
        self.assertIsNone(other.evaluate('localStorage.getItem("appearance")'))
        other.close()

    def test_corrupt_persisted_image_is_recoverable_and_never_published(self):
        self.settings()
        self.page.get_by_text('Background images', exact=True).click()
        self.upload('library', [40, 100, 160])
        # Defensive damaged-record case, not a mocked decoder or IndexedDB.
        self.page.evaluate('''async () => {
          const db = await new Promise((resolve, reject) => {
            const r = indexedDB.open('manabi-reader-appearance', 1);
            r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
          });
          const bytes = new Uint8Array(24);
          bytes.set([137,80,78,71,13,10,26,10]);
          bytes.set([73,72,68,82], 12); bytes[19] = 1; bytes[23] = 1;
          await new Promise((resolve, reject) => {
            const tx = db.transaction('backgrounds', 'readwrite');
            tx.objectStore('backgrounds').put({name:'broken.png', blob:new Blob([bytes], {type:'image/png'})}, 'library');
            tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
          });
          db.close();
        }''')
        self.page.reload()
        self.page.get_by_text('Background images', exact=True).click()
        expect(self.page.get_by_role('alert')).to_contain_text('decode')
        preview = self.page.locator('fieldset:has(#background-library) .background-preview')
        self.assertEqual('none', preview.evaluate('e => getComputedStyle(e).backgroundImage'))
        self.page.get_by_role('button', name='Remove book browser background', exact=True).click()
        expect(self.page.get_by_role('alert')).to_have_count(0)
        self.upload('library', [170, 60, 90])
        self.page.goto(self.origin + '/Reader-Web/manage')
        expect(self.page.locator('[data-background="library"]')).to_have_count(1)

    def test_selected_theme_has_a_distinct_border_and_forced_colors_marker(self):
        self.settings()
        self.mode('Light')
        selected = self.page.locator('button[title="manabi-theme"]')
        other = self.page.locator('button[title="ecru-theme"]')
        self.assertNotEqual(selected.evaluate('e => getComputedStyle(e).borderTopColor'), other.evaluate('e => getComputedStyle(e).borderTopColor'))
        self.page.emulate_media(forced_colors='active')
        selected_mode = self.page.get_by_role('group', name='Appearance mode').get_by_role('button', name='Light', exact=True)
        self.assertEqual('2px', selected_mode.evaluate('e => getComputedStyle(e).outlineWidth'))
        self.page.screenshot(path='test-results/appearance-forced-colors.png', full_page=True)

    def test_png_jpeg_webp_reencoding_and_cross_tab_removal(self):
        self.settings()
        self.page.get_by_text('Background images', exact=True).click()
        fixtures = [
            ('image/png', previous.png([184, 77, 113], 120, 80)),
            ('image/jpeg', base64.b64decode(JPEG)),
            ('image/webp', base64.b64decode(WEBP))
        ]
        for mime, data in fixtures:
            name = 'real-image.' + mime.split('/')[1]
            self.page.locator('#background-library').set_input_files({'name':name, 'mimeType':mime, 'buffer':data})
            expect(self.page.get_by_text(name, exact=True)).to_be_visible()
            expect(self.page.get_by_text('Preparing image…', exact=True)).to_have_count(0)
            expect(self.page.get_by_role('alert')).to_have_count(0)
        other = self.context.new_page()
        other.goto(self.origin + '/Reader-Web/manage')
        expect(other.locator('[data-background="library"]')).to_have_count(1)
        self.page.get_by_role('button', name='Remove book browser background', exact=True).click()
        expect(other.locator('[data-background="library"]')).to_have_count(0)
        other.close()

    def test_custom_editor_copies_current_palette_and_keeps_hex_and_transparent_values(self):
        self.settings()
        self.mode('Light')
        self.page.locator('button[title="water-theme"]').click()
        self.page.get_by_role('button', name='Add custom theme', exact=True).click()
        expect(self.page.get_by_label('Background color', exact=True)).to_have_value('#dfecf4')
        expect(self.page.get_by_label('Selected text color', exact=True)).to_have_value('#ffffff')
        expect(self.page.get_by_label('Selection background color', exact=True)).to_have_value('#24506c')
        self.page.get_by_placeholder('Theme Name', exact=True).fill('Personal hex')
        self.page.get_by_role('button', name='Save', exact=True).click()
        self.page.evaluate("""() => {
          const themes = JSON.parse(localStorage.getItem('customThemes'));
          themes['Personal hex'].fontColor = '#112233';
          themes['Personal hex'].backgroundColor = 'rgba(240, 245, 255, 0)';
          localStorage.setItem('customThemes', JSON.stringify(themes));
        }""")
        self.page.reload()
        self.page.get_by_role('button', name='Edit Personal hex theme', exact=True).click()
        expect(self.page.get_by_label('Font color', exact=True)).to_have_value('#112233')
        expect(self.page.get_by_label('Background opacity', exact=True)).to_have_value('0')
        self.page.get_by_role('button', name='Save', exact=True).click()
        self.assertEqual('#112233', self.page.evaluate("JSON.parse(localStorage.getItem('customThemes'))['Personal hex'].fontColor"))

    def test_print_and_forced_colors_hide_wallpaper_without_deleting_it(self):
        self.settings()
        self.page.get_by_text('Background images', exact=True).click()
        self.upload('library', [90, 30, 160])
        self.page.goto(self.origin + '/Reader-Web/manage')
        background = self.page.locator('[data-background="library"]')
        expect(background).to_be_visible()
        self.page.emulate_media(media='print')
        expect(background).to_be_hidden()
        self.page.emulate_media(media='screen', forced_colors='active')
        expect(background).to_be_hidden()
        self.page.emulate_media(forced_colors='none')
        expect(background).to_be_visible()


if __name__ == '__main__':
    Path('test-results').mkdir(exist_ok=True)
    unittest.main(verbosity=2)
