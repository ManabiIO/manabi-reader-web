"""Browser acceptance against the built static app, without request interception."""
import base64
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import threading
import unittest
from urllib.parse import unquote, urlsplit
import zipfile
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2] / 'apps/web/build'
TITLE = 'Reader browser acceptance'


def epub():
    output = io.BytesIO()
    png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/ZkAAAAASUVORK5CYII=')
    body = '<h1>Reader browser acceptance</h1><p><ruby>本<rt>ほん</rt></ruby>を読む。</p>'
    body += '<img id="safe-image" src="絵.png" alt="Archive illustration"/>'
    body += '<img src="/attack-probe" onerror="window.bookAttack=true"/>'
    body += '<img src="missing/../../attack-probe"/><img src="#attack-probe"/>'
    body += '<iframe src="/attack-probe"></iframe><script>window.bookAttack=true</script>'
    body += '<p style="background-image:url(/attack-probe);color:rgb(20,30,40)">安全な文章</p>'
    body += ''.join('<p>日本語の本を読みます。文章を丁寧に読んで、次のページに進みます。</p>' for _ in range(150))
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('mimetype', 'application/epub+zip')
        archive.writestr('META-INF/container.xml', '<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>')
        archive.writestr('content.opf', '<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">' + TITLE + '</dc:title></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="image" href="絵.png" media-type="image/png"/></manifest><spine><itemref idref="chapter"/></spine></package>')
        archive.writestr('chapter.xhtml', '<html><body>' + body + '</body></html>')
        archive.writestr('絵.png', png)
    return output.getvalue()


class StaticHandler(SimpleHTTPRequestHandler):
    probes = []

    def translate_path(self, path):
        path = unquote(urlsplit(path).path)
        if 'attack-probe' in path:
            self.probes.append(path)
        if not path.startswith('/Reader-Web/'):
            return str(ROOT / '__not_an_application_route__')
        relative = path[len('/Reader-Web/'):]
        if '..' in Path(relative).parts:
            return str(ROOT / '__not_an_application_route__')
        target = ROOT / relative
        for candidate in (target, target / 'index.html', ROOT / (relative.rstrip('/') + '.html')):
            if candidate.is_file():
                return str(candidate)
        return str(ROOT / '404.html')

    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except (BrokenPipeError, ConnectionResetError):
            pass  # Normal cancellation when a test closes its browser context.

    def log_message(self, *args):
        pass


class ReaderBrowser(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), StaticHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = 'http://127.0.0.1:' + str(cls.server.server_port)
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.context = self.browser.new_context()
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        StaticHandler.probes.clear()

    def tearDown(self):
        # Keep diagnostics for this generated fixture only, never real account data.
        diagnostics = Path('test-results')
        diagnostics.mkdir(exist_ok=True)
        name = self._testMethodName
        try:
            (diagnostics / (name + '.html')).write_text(self.page.content())
            self.page.screenshot(path=str(diagnostics / (name + '.png')), full_page=True)
        finally:
            # A diagnostic failure must not leak a profile into the next test.
            self.context.close()
            if self.errors:
                print('Browser errors:', self.errors)
            self.assertEqual([], self.errors)

    def go_offline(self):
        self.context.set_offline(True)

    def open_book(self, view='paginated', writing='vertical-rl', font=None):
        settings = {'viewMode': view, 'writingMode': writing, 'hideFurigana': 'false', 'hideSpoilerImage': 'false'}
        if font:
            settings['fontFamilyGroupOne'] = font
        self.context.add_init_script('if (location.origin === ' + json.dumps(self.origin) + ') { for (const [key,value] of Object.entries(' + json.dumps(settings) + ')) localStorage.setItem(key,value); }')
        self.page.goto(self.origin + '/Reader-Web/manage')
        # This attribute is installed by a Svelte action, not prerendered HTML.
        # Wait for real input handlers before assigning files to hidden SSR inputs.
        expect(self.page.locator('input[type=file][webkitdirectory]')).to_be_attached()
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files(
            {'name': 'acceptance.epub', 'mimeType': 'application/epub+zip', 'buffer': epub()})
        self.page.get_by_text(TITLE, exact=True).click(timeout=30000)
        expect(self.page.locator('.book-content')).to_be_visible(timeout=30000)
        self.page.wait_for_function(
            '() => document.querySelector(".book-content ruby rt")?.textContent === "ほん"'
        )

    def wait_for_fonts(self):
        # Bounded assertion, not a sleep, screenshot bypass or synthetic face.
        self.page.locator('.book-content').evaluate('e => e.getBoundingClientRect()')
        self.page.wait_for_function("() => document.fonts.status === 'loaded'", timeout=15000)

    def first_font(self):
        return self.page.locator('.book-content').evaluate('e => getComputedStyle(e).fontFamily.split(",")[0].trim().replace(/^"|"$/g, "")')

    def test_anonymous_navigation_without_backend(self):
        self.page.goto(self.origin + '/Reader-Web/manage')
        self.page.get_by_role('button', name='Accounts and libraries', exact=True).click()
        expect(self.page.get_by_role('heading', name='Accounts and libraries', exact=True)).to_be_visible()
        expect(self.page.get_by_text('Manabi account services are not available on this deployment. Local libraries still work.')).to_be_visible()
        self.assertTrue(self.page.get_by_role('link', name='Sign in to Manabi').get_attribute('href').startswith('/accounts/login/'))

    def test_paginated_ruby_images_and_untrusted_resources(self):
        self.open_book(font='Klee One')
        self.assertEqual('ほん', self.page.locator('.book-content ruby rt').first.text_content())
        self.page.wait_for_function(
            '() => document.querySelector("#safe-image")?.naturalWidth > 0'
        )
        self.assertEqual(0, self.page.locator('.book-content script, .book-content iframe, .book-content [onerror]').count())
        self.assertFalse(self.page.evaluate('Boolean(window.bookAttack)'))
        self.assertEqual([], StaticHandler.probes)
        self.assertEqual('Klee One', self.first_font())
        self.page.keyboard.press('ArrowLeft')
        expect(self.page.locator('.book-content')).to_be_visible()

    def test_continuous_horizontal_system_font_and_saved_explicit_font(self):
        self.open_book('continuous', 'horizontal-tb', font='Klee One')
        self.assertEqual('Klee One', self.first_font())
        # Finish the currently used face before deliberately replacing it. WebKit
        # can leave FontFaceSet.ready pending after a reload cancels the old face,
        # even though the new face subsequently loads. This test checks saved font
        # preference/decoding, not cancellation during an unfinished font download.
        self.wait_for_fonts()
        self.page.evaluate('localStorage.setItem("fontFamilyGroupOne", "Noto Serif JP")')
        self.page.reload()
        expect(self.page.locator('.book-content')).to_be_visible(timeout=30000)
        self.assertEqual('Noto Serif JP', self.first_font())
        self.assertGreater(self.page.evaluate('''async () => {
          let timer;
          try {
            return await Promise.race([
              document.fonts.load('20px "Noto Serif JP"', '日本語').then(faces => faces.length),
              new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('Selected font did not load')), 15000);
              })
            ]);
          } finally { clearTimeout(timer); }
        }'''), 0)
        self.wait_for_fonts()

    def test_offline_reload_preserves_book_and_never_caches_account_requests(self):
        self.page.goto(self.origin + '/Reader-Web/manage')
        self.page.evaluate('navigator.serviceWorker.ready')
        # The worker intentionally does not claim a tab that loaded under the
        # previous shell. A normal online navigation hands the next document to
        # the activated worker without mixing application generations.
        if not self.page.evaluate('Boolean(navigator.serviceWorker.controller)'):
            self.page.reload()
        self.page.wait_for_function('() => navigator.serviceWorker.controller !== null')
        self.page.evaluate('caches.open("other-manabi-app").then(c => c.put("/other-app",new Response("keep")))')
        # Select a packaged face explicitly so this remains a cache-on-use test
        # even on macOS hosts that already provide the preferred Japanese face.
        self.open_book(font='Klee One')
        self.assertGreater(self.page.evaluate('''async () => {
          let timer;
          try {
            return await Promise.race([
              (async () => {
                const faces = await document.fonts.load('20px "Klee One"', '日本語');
                await document.fonts.ready;
                return faces.length;
              })(),
              new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('Packaged font did not settle within 15 seconds')), 15000);
              })
            ]);
          } finally { clearTimeout(timer); }
        }'''), 0)
        keys = self.page.evaluate('async () => (await Promise.all((await caches.keys()).map(async n => (await (await caches.open(n)).keys()).map(r => r.url)))).flat()')
        self.assertFalse(any('/api/' in key or '/accounts/' in key for key in keys))
        fonts = [key for key in keys if key.endswith(('.woff', '.woff2'))]
        self.assertLessEqual(len(fonts), 3, fonts)
        self.assertTrue(any('KleeOne-Regular' in key and key.endswith('.woff2') for key in fonts))
        self.assertIn('other-manabi-app', self.page.evaluate('caches.keys()'))
        self.go_offline()
        self.page.reload()
        expect(self.page.locator('.book-content')).to_be_visible(timeout=30000)
        self.assertEqual('ほん', self.page.locator('.book-content ruby rt').first.text_content())
        self.assertIn(TITLE, self.page.title())


if __name__ == '__main__':
    unittest.main(verbosity=2)
