"""Real static-browser acceptance: native CSS modes, actual uploads and IndexedDB. No request interception."""
import json
from pathlib import Path
import struct
import unittest
import zlib
from playwright.sync_api import expect
import test_static_reader as baseline


def png(rgb, width=80, height=60):
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data) & 0xffffffff)
    body = (b'\0' + bytes(rgb) * width) * height
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(body)) + chunk(b'IEND', b'')


class AppearanceBrowser(baseline.ReaderBrowser):
    # The inherited baseline suite also exercises actual EPUB/ruby/illustration,
    # writing modes and offline restoration under the new default theme.
    def settings(self, *, reload=False):
        # Observe the actual optional session probe, including its completed 404
        # body, before a subsequent deliberate navigation. Do not intercept or
        # replace it, and do not wait for unrelated global network idleness.
        with self.page.expect_request_finished(
            predicate=lambda r: r.url == self.origin + '/api/reader-web/session/'
        ) as probe:
            if reload:
                self.page.reload()
            else:
                self.page.goto(self.origin + '/Reader-Web/settings')
        response = probe.value.response()
        self.assertIsNotNone(response)
        self.assertEqual(404, response.status)
        expect(self.page.get_by_role('heading', name='Appearance', exact=True)).to_be_visible()

    def mode(self, name):
        self.page.get_by_role('group', name='Appearance mode').get_by_role('button', name=name, exact=True).click()
        expect(self.page.locator('html')).to_have_attribute('data-appearance', name.lower())

    def scheme(self):
        return self.page.locator('html').evaluate('e => getComputedStyle(e).colorScheme')

    def upload(self, target, color):
        self.page.locator('#background-' + target).set_input_files({'name': target + '.png', 'mimeType': 'image/png', 'buffer': png(color)})
        expect(self.page.get_by_text(target + '.png', exact=True)).to_be_visible()
        expect(self.page.get_by_text('Preparing image…', exact=True)).to_have_count(0)

    def test_default_modes_and_persistence(self):
        self.page.emulate_media(color_scheme='dark')
        self.settings()
        expect(self.page.locator('html')).to_have_attribute('data-theme', 'manabi-theme')
        self.assertEqual('dark', self.scheme())
        self.assertEqual('rgb(0, 0, 0)', self.page.locator('body').evaluate('e => getComputedStyle(e).backgroundColor'))
        self.mode('Light')
        self.assertEqual('light', self.scheme())
        self.settings(reload=True)
        self.assertEqual('light', self.scheme())
        self.page.emulate_media(color_scheme='light')
        self.mode('Dark')
        self.assertEqual('dark', self.scheme())
        self.mode('System')
        self.assertEqual('light', self.scheme())
        self.page.emulate_media(color_scheme='dark')
        self.page.wait_for_function('() => getComputedStyle(document.documentElement).colorScheme === "dark"')

    def test_all_presets_theme_forms_headers_and_statistics(self):
        self.settings()
        for theme in ['manabi-theme', 'light-theme', 'ecru-theme', 'water-theme', 'gray-theme', 'dark-theme', 'black-theme']:
            self.page.locator('button[title="' + theme + '"]').click()
            for mode in ['Light', 'Dark']:
                with self.subTest(theme=theme, mode=mode):
                    self.mode(mode)
                    self.assertEqual(mode.lower(), self.scheme())
                    palette = self.page.locator('html').evaluate('''e => {
                      const style = getComputedStyle(e);
                      return Object.fromEntries(['canvas', 'surface-raised', 'ink'].map(key => [
                        key, style.getPropertyValue('--' + key).trim().replace('rgba(', 'rgb(').replace(', 1)', ')')
                      ]));
                    }''')
                    # Inputs intentionally animate color changes. Require final
                    # rendered values, not whichever frame a single read hits.
                    expect(self.page.locator('.app-header').first).to_have_css('background-color', palette['surface-raised'])
                    field = self.page.locator('input[type="number"]').first
                    expect(field).to_have_css('background-color', palette['canvas'])
                    expect(field).to_have_css('color', palette['ink'])
            self.page.screenshot(path='test-results/palette-' + theme + '.png', full_page=True)
        self.page.goto(self.origin + '/Reader-Web/statistics')
        self.assertEqual('dark', self.scheme())
        self.page.screenshot(path='test-results/appearance-statistics-dark.png', full_page=True)

    def seed_released_preferences(self, values):
        # Seed before bootstrap/hydration instead of navigating away from a newly
        # mounted app while its optional session request is still in flight.
        self.context.add_init_script(
            'if (location.origin === ' + json.dumps(self.origin) +
            ' && localStorage.getItem("theme") === null) {' +
            'for (const [key, value] of Object.entries(' + json.dumps(values) +
            ')) localStorage.setItem(key, value); }'
        )

    def test_legacy_night_theme_is_not_reset(self):
        self.seed_released_preferences({'theme': 'gray-theme'})
        self.settings()
        self.assertEqual('dark', self.scheme())
        expect(self.page.locator('button[title="gray-theme"]')).to_have_attribute('aria-pressed', 'true')
        self.assertEqual('gray-theme', self.page.evaluate('localStorage.getItem("theme")'))
        self.mode('Light')
        self.assertEqual('gray-theme', self.page.evaluate('localStorage.getItem("theme")'))

    def test_legacy_custom_theme_is_not_reset(self):
        custom = {key: 'rgba(240, 240, 240, 1)' for key in ['fontColor','selectionFontColor','selectionBackgroundColor','hintFuriganaShadowColor','hintFuriganaFontColor','tooltipTextFontColor']}
        custom['backgroundColor'] = 'rgba(24, 20, 32, 1)'
        self.seed_released_preferences({'theme': 'Personal', 'customThemes': json.dumps({'Personal': custom})})
        self.settings()
        self.assertEqual('dark', self.scheme())
        expect(self.page.get_by_role('button', name='Edit Personal theme', exact=True)).to_be_visible()
        self.mode('Light')
        self.assertEqual(custom, self.page.evaluate('JSON.parse(localStorage.getItem("customThemes")).Personal'))
        self.assertEqual('Personal', self.page.evaluate('localStorage.getItem("theme")'))

    def test_backgrounds_are_independent_persistent_cover_and_mode_aware(self):
        self.settings()
        self.page.get_by_text('Background images', exact=True).click()
        self.upload('library', [180, 40, 30])
        self.upload('reader', [30, 70, 180])
        self.mode('Dark')
        self.page.locator('#fade-library').focus()
        self.page.keyboard.press('Home')
        for _ in range(65):
            self.page.keyboard.press('ArrowRight')
        self.page.locator('#fade-reader').focus()
        self.page.keyboard.press('Home')
        for _ in range(25):
            self.page.keyboard.press('ArrowRight')
        self.page.goto(self.origin + '/Reader-Web/manage')
        background = self.page.locator('[data-background="library"]')
        expect(background).to_have_count(1)
        style = background.evaluate('e => ({size:getComputedStyle(e).backgroundSize, fade:getComputedStyle(e,"::after").backgroundColor, pointer:getComputedStyle(e).pointerEvents})')
        self.assertEqual({'size':'cover','fade':'rgba(0, 0, 0, 0.65)','pointer':'none'}, style)
        self.page.screenshot(path='test-results/appearance-library-background.png', full_page=True)
        self.open_book()
        expect(self.page.locator('[data-background="reader"]')).to_have_count(1)
        self.assertEqual('rgba(0, 0, 0, 0.25)', self.page.locator('.page-background').evaluate('e => getComputedStyle(e,"::after").backgroundColor'))
        self.page.screenshot(path='test-results/appearance-reader-background.png', full_page=True)
        self.page.reload()
        expect(self.page.locator('.book-content')).to_be_visible(timeout=30000)
        expect(self.page.locator('[data-background="reader"]')).to_have_count(1)
        self.settings()
        expect(self.page.locator('.page-background')).to_have_count(0)
        self.page.get_by_text('Background images', exact=True).click()
        self.mode('Light')
        self.assertEqual('rgba(255, 255, 255, 0.25)', self.page.locator('fieldset:has(#background-reader) .background-preview').evaluate('e => getComputedStyle(e,"::after").backgroundColor'))
        self.page.get_by_role('button', name='Remove book browser background', exact=True).click()
        expect(self.page.get_by_text('library.png', exact=True)).to_have_count(0)
        expect(self.page.get_by_text('reader.png', exact=True)).to_be_visible()
        self.page.goto(self.origin + '/Reader-Web/manage')
        expect(self.page.locator('.page-background')).to_have_count(0)

    def test_invalid_upload_keeps_previous_image_and_fade_can_be_disabled(self):
        self.settings()
        self.page.get_by_text('Background images', exact=True).click()
        self.upload('library', [40, 150, 80])
        self.page.locator('#background-library').set_input_files({'name':'bad.svg','mimeType':'image/svg+xml','buffer': b'<svg/>'})
        expect(self.page.get_by_role('alert')).to_contain_text('PNG, JPEG, or WebP')
        expect(self.page.get_by_text('library.png', exact=True)).to_be_visible()
        self.page.locator('fieldset:has(#background-library)').get_by_role('checkbox', name='Fade background').uncheck()
        self.page.goto(self.origin + '/Reader-Web/manage')
        self.assertEqual('rgba(255, 255, 255, 0)', self.page.locator('.page-background').evaluate('e => getComputedStyle(e,"::after").backgroundColor'))
        self.assertFalse(self.page.evaluate('Object.values(localStorage).some(v => v.startsWith("data:image"))'))

    def test_system_changes_do_not_remount_or_repaginate_the_book(self):
        self.page.emulate_media(color_scheme='light')
        self.open_book()
        self.page.locator('.book-content').evaluate('e => {e.dataset.appearanceSentinel = "same"}')
        size = self.page.locator('.book-content').evaluate('e => [e.scrollWidth, e.scrollHeight]')
        self.page.emulate_media(color_scheme='dark')
        self.page.wait_for_function('() => getComputedStyle(document.documentElement).colorScheme === "dark"')
        expect(self.page.locator('.book-content')).to_have_attribute('data-appearance-sentinel','same')
        self.assertEqual(size, self.page.locator('.book-content').evaluate('e => [e.scrollWidth, e.scrollHeight]'))
        self.assertEqual('rgb(0, 0, 0)', self.page.locator('body').evaluate('e => getComputedStyle(e).backgroundColor'))

    def test_offline_background_reload_and_mobile_layout(self):
        self.page.set_viewport_size({'width':390, 'height':844})
        self.settings()
        self.page.get_by_text('Background images', exact=True).click()
        self.upload('library', [100, 60, 150])
        self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), 390)
        self.page.goto(self.origin + '/Reader-Web/manage')
        self.page.evaluate('navigator.serviceWorker.ready')
        self.page.wait_for_function('() => navigator.serviceWorker.controller !== null')
        self.go_offline()
        self.page.reload()
        expect(self.page.locator('[data-background="library"]')).to_have_count(1)
        self.assertEqual('cover', self.page.locator('.page-background').evaluate('e => getComputedStyle(e).backgroundSize'))


if __name__ == '__main__':
    Path('test-results').mkdir(exist_ok=True)
    unittest.main(verbosity=2)
