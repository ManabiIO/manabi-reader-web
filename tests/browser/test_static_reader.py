"""Browser acceptance against the built static app, without request interception."""
import base64
from functools import partial
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
        if not path.startswith('/Reader-Web/'):
            if 'attack-probe' in path:
                self.probes.append(path)
            return str(ROOT / '__not_an_application_route__')
        relative = path[len('/Reader-Web/'):]
        if '..' in Path(relative).parts:
            return str(ROOT / '__not_an_application_route__')
        target = ROOT / relative
        for candidate in (target, target / 'index.html', ROOT / (relative.rstrip('/') + '.html')):
            if candidate.is_file():
                return str(candidate)
        return str(ROOT / '404.html')

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
        if self.errors:
            print('Browser errors:', self.errors)
        self.context.close()
        self.assertEqual([], self.errors)

    def open_book(self, view='paginated', writing='vertical-rl', font=None):
        settings = {'viewMode': view, 'writingMode': writing, 'hideFurigana': 'false', 'hideSpoilerImage': 'false'}
        if font:
            settings['fontFamilyGroupOne'] = font
        self.context.add_init_script('for (const [key,value] of Object.entries(' + json.dumps(settings) + ')) localStorage.setItem(key,value);')
        self.page.goto(self.origin + '/Reader-Web/manage')
        self.page.locator('input[type=file]').set_input_files({'name': 'acceptance.epub', 'mimeType': 'application/epub+zip', 'buffer': epub()})
        self.page.get_by_text(TITLE, exact=True).click(timeout=30000)
        expect(self.page.locator('.book-content')).to_be_visible(timeout=30000)
        self.page.wait_for_function('document.querySelector(".book-content ruby rt")?.textContent === "ほん"')

    def test_anonymous_navigation_without_backend(self):
        self.page.goto(self.origin + '/Reader-Web/manage')
        self.page.get_by_role('button', name='Accounts and libraries', exact=True).click()
        expect(self.page.get_by_role('heading', name='Accounts and libraries', exact=True)).to_be_visible()
        expect(self.page.get_by_text('Manabi account services are not available on this deployment. Local libraries still work.')).to_be_visible()
        self.assertTrue(self.page.get_by_role('link', name='Sign in to Manabi').get_attribute('href').startswith('/accounts/login/'))

    def test_paginated_ruby_images_and_untrusted_resources(self):
        self.open_book()
        self.assertEqual('ほん', self.page.locator('.book-content ruby rt').first.text_content())
        self.page.wait_for_function('document.querySelector("#safe-image")?.naturalWidth > 0')
        self.assertEqual(0, self.page.locator('.book-content script, .book-content iframe, .book-content [onerror]').count())
        self.assertFalse(self.page.evaluate('Boolean(window.bookAttack)'))
        self.assertEqual([], StaticHandler.probes)
        family = self.page.locator('.book-content').evaluate('e => getComputedStyle(e).fontFamily')
        self.assertTrue(family.startswith('YuKyokasho,'), family)
        self.page.keyboard.press('ArrowLeft')
        expect(self.page.locator('.book-content')).to_be_visible()

    def test_continuous_horizontal_system_font_and_saved_explicit_font(self):
        self.open_book('continuous', 'horizontal-tb')
        family = self.page.locator('.book-content').evaluate('e => getComputedStyle(e).fontFamily')
        self.assertTrue(family.startswith('"YuKyokasho Yoko",'), family)
        self.page.evaluate('localStorage.setItem("fontFamilyGroupOne", "Noto Serif JP")')
        self.context.clear_cookies()
        self.page.reload()
        expect(self.page.locator('.book-content')).to_be_visible(timeout=30000)
        family = self.page.locator('.book-content').evaluate('e => getComputedStyle(e).fontFamily')
        self.assertIn('Noto Serif JP', family)
        self.assertNotIn('YuKyokasho', family)

    def test_offline_reload_preserves_book_and_never_caches_account_requests(self):
        self.page.goto(self.origin + '/Reader-Web/manage')
        self.page.evaluate('caches.open("other-manabi-app").then(c => c.put("/other-app",new Response("keep")))')
        self.open_book()
        self.page.evaluate('navigator.serviceWorker.ready')
        self.page.wait_for_function('navigator.serviceWorker.controller !== null')
        keys = self.page.evaluate('async () => (await Promise.all((await caches.keys()).map(async n => (await (await caches.open(n)).keys()).map(r => r.url)))).flat()')
        self.assertFalse(any('/api/' in key or '/accounts/' in key for key in keys))
        fonts = [key for key in keys if key.endswith(('.woff', '.woff2'))]
        self.assertLessEqual(len(fonts), 3, fonts)
        self.assertTrue(any('KleeOne-Regular' in key and key.endswith('.woff2') for key in fonts))
        self.assertIn('other-manabi-app', self.page.evaluate('caches.keys()'))
        self.context.set_offline(True)
        self.page.reload()
        expect(self.page.locator('.book-content')).to_be_visible(timeout=30000)
        self.assertEqual('ほん', self.page.locator('.book-content ruby rt').first.text_content())
        self.assertIn(TITLE, self.page.title())


if __name__ == '__main__':
    unittest.main(verbosity=2)
