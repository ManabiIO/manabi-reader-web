"""Real static-browser acceptance: native CSS modes, actual uploads and IndexedDB. No request interception."""
import json
from pathlib import Path
import struct
import threading
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
        expect(self.page.get_by_label('Search settings', exact=True)).to_be_visible()

    def mode(self, name):
        self.page.get_by_role('group', name='Appearance mode').get_by_role('button', name=name, exact=True).click()
        expect(self.page.locator('html')).to_have_attribute('data-appearance', name.lower())

    def scheme(self):
        return self.page.locator('html').evaluate('e => getComputedStyle(e).colorScheme')

    def upload(self, target, color, mode='light', name=None):
        filename = name or f'{target}-{mode}.png'
        slot = self.page.locator(f'#background-{target}-{mode}')
        slot.set_input_files({
            'name': filename,
            'mimeType': 'image/png',
            'buffer': png(color)
        })
        section = self.page.locator(f'.mode-image:has(#background-{target}-{mode})')
        expect(section.get_by_text(filename, exact=True)).to_be_visible()
        expect(section.get_by_text('Preparing image…', exact=True)).to_have_count(0)

    def test_focus_does_not_duplicate_a_recent_account_probe(self):
        probes = []
        self.context.on(
            'request',
            lambda request: probes.append(request.url)
            if request.url == self.origin + '/api/reader-web/session/' else None
        )
        self.settings()
        self.assertEqual(1, len(probes))
        self.page.evaluate(
            '() => new Promise(resolve => {'
            'window.dispatchEvent(new Event("focus")); requestAnimationFrame(resolve);})'
        )
        self.assertEqual(1, len(probes))

    def test_session_probe_can_outlive_page_navigation_and_close(self):
        page = self.context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(error.stack or str(error)))

        # First exercise consecutive real documents. Each document may probe the
        # optional account endpoint, and neither probe may leak a browser error.
        with page.expect_request_finished(
            predicate=lambda r: r.url == self.origin + '/api/reader-web/session/'
        ):
            page.goto(self.origin + '/Reader-Web/manage')
        with page.expect_request_finished(
            predicate=lambda r: r.url == self.origin + '/api/reader-web/session/'
        ):
            page.goto(self.origin + '/Reader-Web/settings')

        # Hold a forced refresh in the real HTTP handler, then destroy its page.
        # This deterministically covers the WebKit teardown path without request
        # interception or a timing sleep.
        gate = threading.Event()
        started = threading.Event()
        baseline.StaticHandler.session_gate = gate
        baseline.StaticHandler.session_started = started
        try:
            page.evaluate('window.dispatchEvent(new Event("online"))')
            self.assertTrue(started.wait(timeout=5), 'session probe did not reach the server')
            page.close()
        finally:
            gate.set()
            baseline.StaticHandler.session_gate = None
            baseline.StaticHandler.session_started = None
        self.assertEqual([], errors)

    def test_library_connection_probe_can_outlive_page_close(self):
        baseline.StaticHandler.account_fixture = {
            'user': {'id': '42', 'username': 'reader'},
            'csrf_token': 'c' * 64,
            'providers': []
        }
        gate = threading.Event()
        started = threading.Event()
        baseline.StaticHandler.connections_gate = gate
        baseline.StaticHandler.connections_started = started
        page = self.context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(error.stack or str(error)))
        try:
            page.goto(self.origin + '/Reader-Web/manage')
            self.assertTrue(started.wait(timeout=5), 'connection request did not reach the server')
            page.close()
        finally:
            gate.set()
            baseline.StaticHandler.connections_gate = None
            baseline.StaticHandler.connections_started = None
        self.assertEqual([], errors)

    def test_optional_account_auth_syncs_with_csrf_and_one_bootstrap_probe(self):
        gate = threading.Event()
        started = threading.Event()
        baseline.StaticHandler.session_gate = gate
        baseline.StaticHandler.session_started = started
        baseline.StaticHandler.account_fixture = {
            'user': {'id': '42', 'username': 'reader'},
            'csrf_token': 'c' * 64,
            'providers': []
        }
        self.page.goto(self.origin + '/Reader-Web/connections')
        try:
            self.assertTrue(started.wait(timeout=5), 'account bootstrap did not reach the server')
        finally:
            gate.set()

        expect(self.page.get_by_text('Signed in as', exact=False)).to_contain_text('reader')
        session_requests = [
            request for request in baseline.StaticHandler.account_requests
            if request['path'].endswith('/session/')
        ]
        self.assertEqual(1, len(session_requests))

        sync = self.page.get_by_label('Sync reader settings with this Manabi account', exact=True)
        sync.check()
        expect(self.page.get_by_role('status', name='Settings sync status')).to_contain_text(
            'synced'
        )
        preferences = [
            request for request in baseline.StaticHandler.account_requests
            if request['path'].endswith('/preferences/')
        ]
        self.assertEqual(['GET', 'PUT'], [request['method'] for request in preferences])
        self.assertEqual('42', preferences[0]['user'])
        self.assertIsNone(preferences[0]['csrf'])
        self.assertEqual('42', preferences[1]['user'])
        self.assertEqual('c' * 64, preferences[1]['csrf'])
        self.assertEqual('"0"', preferences[1]['if_match'])
        self.assertEqual({'settings'}, set(preferences[1]['body']))

        self.page.get_by_role('button', name='Sign out', exact=True).click()
        sign_in = self.page.get_by_role('link', name='Sign in to Manabi', exact=True)
        expect(sign_in).to_be_visible()
        self.assertEqual(
            '/accounts/login/?next=%2FReader-Web%2Fconnections',
            sign_in.get_attribute('href')
        )
        logout = next(
            request for request in baseline.StaticHandler.account_requests
            if request['path'].endswith('/logout/')
        )
        self.assertEqual('42', logout['user'])
        self.assertEqual('c' * 64, logout['csrf'])
        self.assertEqual(2, len([
            request for request in baseline.StaticHandler.account_requests
            if request['path'].endswith('/session/')
        ]))

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
        self.page.get_by_role('button', name='All settings', exact=True).click()
        for theme in ['manabi-theme', 'light-theme', 'ecru-theme', 'water-theme', 'gray-theme', 'dark-theme', 'black-theme']:
            self.page.locator('button[title="' + theme + '"]').click()
            for mode in ['Light', 'Dark']:
                with self.subTest(theme=theme, mode=mode):
                    self.mode(mode)
                    self.assertEqual(mode.lower(), self.scheme())
                    palette = self.page.locator('html').evaluate('''e => {
                      const style = getComputedStyle(e);
                      return Object.fromEntries(['background', 'card', 'foreground'].map(key => [
                        key, style.getPropertyValue('--' + key).trim().replace('rgba(', 'rgb(').replace(', 1)', ')')
                      ]));
                    }''')
                    # Inputs intentionally animate color changes. Require final
                    # rendered values, not whichever frame a single read hits.
                    expect(self.page.locator('.app-header').first).to_have_css('background-color', palette['card'])
                    field = self.page.get_by_role('spinbutton', name='Font size', exact=True)
                    expect(field).to_have_css('background-color', palette['background'])
                    expect(field).to_have_css('color', palette['foreground'])
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
        self.upload('library', [180, 40, 30], 'light')
        self.upload('library', [30, 150, 70], 'dark')
        self.upload('reader', [190, 140, 30], 'light')
        self.upload('reader', [30, 70, 180], 'dark')
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
        expect(background).to_have_attribute('data-background-mode', 'dark')
        style = background.evaluate(
            'e => ({size:getComputedStyle(e).backgroundSize, '
            'fade:getComputedStyle(e,"::after").backgroundColor, '
            'pointer:getComputedStyle(e).pointerEvents})'
        )
        self.assertEqual(
            {'size':'cover','fade':'rgba(0, 0, 0, 0.65)','pointer':'none'},
            style
        )
        self.page.screenshot(path='test-results/appearance-library-background.png', full_page=True)

        self.open_book()
        reader_background = self.page.locator('[data-background="reader"]')
        expect(reader_background).to_have_attribute('data-background-mode', 'dark')
        self.assertEqual(
            'rgba(0, 0, 0, 0.25)',
            reader_background.evaluate('e => getComputedStyle(e,"::after").backgroundColor')
        )
        self.page.reload()
        expect(self.page.locator('.book-content')).to_be_visible(timeout=30000)
        expect(self.page.locator('[data-background="reader"]')).to_have_attribute(
            'data-background-mode', 'dark'
        )

        self.settings()
        expect(self.page.locator('.page-background')).to_have_count(0)
        self.page.get_by_text('Background images', exact=True).click()
        self.mode('Light')
        light_preview = self.page.locator(
            '.mode-image:has(#background-reader-light) .background-preview'
        )
        dark_preview = self.page.locator(
            '.mode-image:has(#background-reader-dark) .background-preview'
        )
        self.assertEqual(
            'rgba(255, 255, 255, 0.25)',
            light_preview.evaluate('e => getComputedStyle(e,"::after").backgroundColor')
        )
        self.assertEqual(
            'rgba(0, 0, 0, 0.25)',
            dark_preview.evaluate('e => getComputedStyle(e,"::after").backgroundColor')
        )

        # Removing one mode must leave the other mode intact.
        self.page.get_by_role(
            'button', name='Remove dark book browser background', exact=True
        ).click()
        expect(
            self.page.locator('.mode-image:has(#background-library-dark)').get_by_text(
                'library-dark.png', exact=True
            )
        ).to_have_count(0)
        expect(
            self.page.locator('.mode-image:has(#background-library-light)').get_by_text(
                'library-light.png', exact=True
            )
        ).to_be_visible()

        self.mode('Dark')
        self.page.goto(self.origin + '/Reader-Web/manage')
        expect(self.page.locator('[data-background="library"]')).to_have_count(0)
        self.settings()
        self.mode('Light')
        self.page.goto(self.origin + '/Reader-Web/manage')
        expect(self.page.locator('[data-background="library"]')).to_have_attribute(
            'data-background-mode', 'light'
        )

        # "Remove both" clears both mode slots for one surface at once.
        self.settings()
        self.page.get_by_text('Background images', exact=True).click()
        self.page.get_by_role(
            'button', name='Remove both book reader background images', exact=True
        ).click()
        expect(
            self.page.locator('.mode-image:has(#background-reader-light)').get_by_text(
                'reader-light.png', exact=True
            )
        ).to_have_count(0)
        expect(
            self.page.locator('.mode-image:has(#background-reader-dark)').get_by_text(
                'reader-dark.png', exact=True
            )
        ).to_have_count(0)
    def test_invalid_upload_keeps_previous_image_and_fade_can_be_disabled(self):
        self.settings()
        self.page.get_by_text('Background images', exact=True).click()
        self.upload('library', [40, 150, 80], 'light')
        self.page.locator('#background-library-light').set_input_files({
            'name':'bad.svg',
            'mimeType':'image/svg+xml',
            'buffer': b'<svg/>'
        })
        light = self.page.locator('.mode-image:has(#background-library-light)')
        expect(light.get_by_role('alert')).to_contain_text('PNG, JPEG, or WebP')
        expect(light.get_by_text('library-light.png', exact=True)).to_be_visible()
        self.page.locator(
            'fieldset:has(#background-library-light)'
        ).get_by_role('switch').uncheck()
        self.mode('Light')
        self.page.goto(self.origin + '/Reader-Web/manage')
        self.assertEqual(
            'rgba(255, 255, 255, 0)',
            self.page.locator('.page-background').evaluate(
                'e => getComputedStyle(e,"::after").backgroundColor'
            )
        )
        self.assertFalse(
            self.page.evaluate('Object.values(localStorage).some(v => v.startsWith("data:image"))')
        )
    def test_system_changes_do_not_remount_or_repaginate_the_book(self):
        self.page.emulate_media(color_scheme='light')
        self.settings()
        self.page.get_by_text('Background images', exact=True).click()
        self.upload('reader', [230, 210, 180], 'light')
        self.upload('reader', [20, 30, 60], 'dark')
        self.mode('System')
        self.open_book()
        background = self.page.locator('[data-background="reader"]')
        expect(background).to_have_attribute('data-background-mode', 'light')
        light_image = background.evaluate('e => getComputedStyle(e).backgroundImage')

        self.page.locator('.book-content').evaluate(
            'e => {e.dataset.appearanceSentinel = "same"}'
        )
        size = self.page.locator('.book-content').evaluate('e => [e.scrollWidth, e.scrollHeight]')
        self.page.emulate_media(color_scheme='dark')
        self.page.wait_for_function(
            '() => getComputedStyle(document.documentElement).colorScheme === "dark"'
        )
        expect(background).to_have_attribute('data-background-mode', 'dark')
        dark_image = background.evaluate('e => getComputedStyle(e).backgroundImage')
        self.assertNotEqual(light_image, dark_image)
        expect(self.page.locator('.book-content')).to_have_attribute(
            'data-appearance-sentinel','same'
        )
        self.assertEqual(
            size,
            self.page.locator('.book-content').evaluate('e => [e.scrollWidth, e.scrollHeight]')
        )
        self.assertEqual(
            'rgb(0, 0, 0)',
            self.page.locator('body').evaluate('e => getComputedStyle(e).backgroundColor')
        )
    def test_offline_background_reload_and_mobile_layout(self):
        self.page.set_viewport_size({'width':390, 'height':844})
        self.settings()
        self.page.get_by_text('Background images', exact=True).click()
        self.upload('library', [100, 60, 150], 'light')
        self.mode('Light')
        self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), 390)
        self.page.goto(self.origin + '/Reader-Web/manage')
        self.page.evaluate('navigator.serviceWorker.ready')
        self.page.wait_for_function('() => navigator.serviceWorker.controller !== null')
        self.go_offline()
        self.page.reload()
        expect(self.page.locator('[data-background="library"]')).to_have_attribute(
            'data-background-mode', 'light'
        )
        self.assertEqual(
            'cover',
            self.page.locator('.page-background').evaluate(
                'e => getComputedStyle(e).backgroundSize'
            )
        )

if __name__ == '__main__':
    Path('test-results').mkdir(exist_ok=True)
    unittest.main(verbosity=2)
