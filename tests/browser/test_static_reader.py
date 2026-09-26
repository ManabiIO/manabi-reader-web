"""Browser acceptance against the built static app, without request interception."""
import base64
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer as BaseThreadingHTTPServer
import io
import json
from pathlib import Path
import threading
import unittest
from urllib.parse import parse_qs, unquote, urlsplit
import zipfile
from playwright.sync_api import sync_playwright, expect

class ThreadingHTTPServer(BaseThreadingHTTPServer):
    # Browser pages request many hashed modules concurrently. The default
    # backlog of five can reset asset connections before workers accept them
    # on macOS. Scope the larger queue to this test server, not the stdlib.
    request_queue_size = 128


ROOT = Path(__file__).resolve().parents[2] / 'apps/web/build'
TITLE = 'Reader browser acceptance'


def epub():
    output = io.BytesIO()
    png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/ZkAAAAASUVORK5CYII=')
    body = '<h1>Reader browser acceptance</h1><p><ruby>本<rt>ほん</rt></ruby>を読む。</p>'
    body += '<p><a id="cross-note" href="chapter2.xhtml#note">脚注へ</a></p>'
    body += '<img id="safe-image" src="絵.png" alt="Archive illustration"/>'
    body += '<img src="/attack-probe" onerror="window.bookAttack=true"/>'
    body += '<img src="missing/../../attack-probe"/><img src="#attack-probe"/>'
    body += '<iframe src="/attack-probe"></iframe><script>window.bookAttack=true</script>'
    body += '<p style="background-image:url(/attack-probe);color:rgb(20,30,40)">安全な文章</p>'
    body += '<p><span id="legacy-tcy" class="tcy">!?</span></p>'
    body += ''.join('<p>日本語の本を読みます。文章を丁寧に読んで、次のページに進みます。</p>' for _ in range(150))
    container = '''<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>'''
    package = '''<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:reader-browser-acceptance</dc:identifier>
    <dc:title>''' + TITLE + '''</dc:title>
    <dc:language>ja</dc:language>
  </metadata>
  <manifest>
    <item id="chapter1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="style" href="style.css" media-type="text/css"/>
    <item id="image" href="絵.png" media-type="image/png"/>
  </manifest>
  <spine page-progression-direction="rtl">
    <itemref idref="chapter1"/>
    <itemref idref="chapter2"/>
  </spine>
</package>'''
    nav = '''<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ja">
<head><title>Navigation</title></head><body>
<nav epub:type="toc"><ol><li><a href="chapter.xhtml">本文</a></li><li><a href="chapter2.xhtml">脚注</a></li></ol></nav>
<nav epub:type="page-list"><ol><li><a href="chapter.xhtml#page-1">1</a></li></ol></nav>
<nav epub:type="landmarks"><ol><li><a epub:type="bodymatter" href="chapter.xhtml">本文</a></li></ol></nav>
</body></html>'''
    chapter1 = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ja"><head><link rel="stylesheet" href="style.css"/></head><body><span id="page-1"></span>' + body + '</body></html>'
    chapter2 = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ja"><head><title>Notes</title></head><body><aside id="note" epub:type="footnote"><p>脚注の内容</p></aside></body></html>'
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('mimetype', 'application/epub+zip')
        archive.writestr('META-INF/container.xml', container)
        archive.writestr('content.opf', package)
        archive.writestr('chapter.xhtml', chapter1)
        archive.writestr('chapter2.xhtml', chapter2)
        archive.writestr('nav.xhtml', nav)
        archive.writestr('style.css', '.tcy{-webkit-text-combine:horizontal;-epub-text-combine:horizontal}')
        archive.writestr('絵.png', png)
    return output.getvalue()

class StaticHandler(SimpleHTTPRequestHandler):
    probes = []
    session_gate = None
    session_started = None
    connections_gate = None
    connections_started = None
    account_fixture = None
    account_requests = []
    preference_revision = 0
    preference_settings = {}
    personal_enabled = False
    personal_mutations = []

    def api_request(self):
        length = int(self.headers.get('Content-Length') or '0')
        raw = self.rfile.read(length) if length else b''
        type(self).account_requests.append({
            'method': self.command,
            'path': urlsplit(self.path).path,
            'user': self.headers.get('X-Manabi-User'),
            'csrf': self.headers.get('X-CSRFToken'),
            'if_match': self.headers.get('If-Match'),
            'body': json.loads(raw) if raw else None
        })

    def api_response(self, value, *, user=''):
        body = json.dumps(value).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Manabi-User', user)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        # A focused lifecycle test can hold one real session response open while
        # the document navigates or closes. Consume the gate once so a new
        # document's own account probe is never held accidentally.
        if urlsplit(self.path).path == '/api/reader-web/session/':
            gate = type(self).session_gate
            started = type(self).session_started
            if gate is not None:
                type(self).session_gate = None
                type(self).session_started = None
                if started is not None:
                    started.set()
                gate.wait(timeout=10)
        fixture = type(self).account_fixture
        path = urlsplit(self.path).path
        if fixture is not None and path.startswith('/api/reader-web/'):
            self.api_request()
            user = fixture['user']
            identity = user['id'] if user else ''
            if path.endswith('/session/'):
                self.api_response(fixture, user=identity)
            elif path.endswith('/preferences/'):
                self.api_response({
                    'user_id': identity,
                    'schema_version': 1,
                    'revision': type(self).preference_revision,
                    'settings': type(self).preference_settings
                }, user=identity)
            elif path.endswith('/connections/'):
                gate = type(self).connections_gate
                started = type(self).connections_started
                if gate is not None:
                    type(self).connections_gate = None
                    type(self).connections_started = None
                    if started is not None:
                        started.set()
                    gate.wait(timeout=10)
                self.api_response({'items': []}, user=identity)
            elif path.endswith('/personal/changes/') and type(self).personal_enabled:
                cursor = int(parse_qs(urlsplit(self.path).query).get('cursor', ['0'])[0])
                self.api_response({'items': [], 'next_cursor': cursor, 'has_more': False},
                                  user=identity)
            else:
                self.send_error(404)
            return
        super().do_GET()

    def do_PUT(self):
        fixture = type(self).account_fixture
        path = urlsplit(self.path).path
        if fixture is not None and path.endswith('/preferences/'):
            self.api_request()
            request = type(self).account_requests[-1]
            type(self).preference_settings = request['body']['settings']
            type(self).preference_revision += 1
            identity = fixture['user']['id']
            self.api_response({
                'user_id': identity,
                'schema_version': 1,
                'revision': type(self).preference_revision,
                'settings': type(self).preference_settings
            }, user=identity)
            return
        self.send_error(404)

    def do_POST(self):
        fixture = type(self).account_fixture
        path = urlsplit(self.path).path
        if fixture is not None and type(self).personal_enabled and path.endswith('/personal/mutations/'):
            self.api_request()
            value = type(self).account_requests[-1]['body']
            identity = fixture['user']['id']
            type(self).personal_mutations.append((identity, value))
            self.api_response({
                'accepted': True, 'mutation_id': value['mutation_id'],
                'record': {'kind': value['kind'], 'entity_id': value['entity_id'],
                           'book_key': value['book_key'], 'revision': 1,
                           'payload': value['payload'],
                           'deleted': value['operation'] == 'delete'}
            }, user=identity)
            return
        if fixture is not None and path.endswith('/logout/'):
            admitted = fixture['user']['id']
            self.api_request()
            fixture['user'] = None
            self.api_response({'signed_out': True}, user=admitted)
            return
        self.send_error(404)

    def translate_path(self, path):
        path = unquote(urlsplit(path).path)
        if 'attack-probe' in path:
            self.probes.append(path)
        if not path.startswith('/reader-web/'):
            return str(ROOT / '__not_an_application_route__')
        relative = path[len('/reader-web/'):]
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
        self.context.add_init_script(
            "try { localStorage.setItem('manabi-reader-dictionary-setup-v1', 'skip') } catch {}")
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(error.stack or str(error)))
        StaticHandler.probes.clear()
        StaticHandler.session_gate = None
        StaticHandler.session_started = None
        StaticHandler.connections_gate = None
        StaticHandler.connections_started = None
        StaticHandler.account_fixture = None
        StaticHandler.account_requests = []
        StaticHandler.preference_revision = 0
        StaticHandler.preference_settings = {}

    def tearDown(self):
        # Keep diagnostics for this generated fixture only, never real account data.
        diagnostics = Path('test-results')
        diagnostics.mkdir(exist_ok=True)
        name = self._testMethodName
        try:
            (diagnostics / (name + '.html')).write_text(self.page.content())
            self.page.screenshot(path=str(diagnostics / (name + '.png')), full_page=True)
        finally:
            gate = StaticHandler.session_gate
            StaticHandler.session_gate = None
            StaticHandler.session_started = None
            connections_gate = StaticHandler.connections_gate
            StaticHandler.connections_gate = None
            StaticHandler.connections_started = None
            StaticHandler.account_fixture = None
            if gate is not None:
                gate.set()
            if connections_gate is not None:
                connections_gate.set()
            # A diagnostic failure must not leak a profile into the next test.
            self.context.close()
            if self.errors:
                print('Browser errors:', self.errors)
            self.assertEqual([], self.errors)

    def go_offline(self):
        self.context.set_offline(True)

    def open_book(self, view='paginated', writing='vertical-rl', font=None):
        settings = {'viewMode': view, 'writingMode': writing, 'hideFurigana': 'false', 'hideSpoilerImage': 'false'}
        self.context.add_init_script('if (location.origin === ' + json.dumps(self.origin) + ') { for (const [key,value] of Object.entries(' + json.dumps(settings) + ')) localStorage.setItem(key,value); }')
        if font:
            # Seed the fixture font on the import page only. Reapplying it on every
            # document would overwrite a later explicit user choice during reload.
            self.context.add_init_script(
                'if (location.origin === ' + json.dumps(self.origin) +
                ' && location.pathname.endsWith("/manage")) localStorage.setItem("fontFamilyGroupOne", ' +
                json.dumps(font) + ');'
            )
        self.page.goto(self.origin + '/reader-web/manage')
        # This attribute is installed by a Svelte action, not prerendered HTML.
        # Wait for real input handlers before assigning files to hidden SSR inputs.
        expect(self.page.locator('input[type=file][webkitdirectory]')).to_be_attached()
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files(
            {'name': 'acceptance.epub', 'mimeType': 'application/epub+zip', 'buffer': epub()})
        self.page.get_by_role('button', name='Read ' + TITLE, exact=True).click(timeout=30000)
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
        self.page.goto(self.origin + '/reader-web/manage')
        self.page.get_by_role('button', name='Library actions', exact=True).click()
        self.page.get_by_role('menuitem', name='Accounts and Libraries', exact=True).click()
        expect(self.page.get_by_role('heading', name='Accounts and libraries', exact=True)).to_be_visible()
        expect(self.page.get_by_text('Manabi account services are not available on this deployment. Local libraries still work.')).to_be_visible()
        self.assertTrue(self.page.get_by_role('link', name='Sign in to Manabi').get_attribute('href').startswith('/accounts/login/'))

    def test_yukyokasho_default_is_device_local_and_requires_both_faces(self):
        self.page.goto(self.origin + '/reader-web/settings#typography')
        primary = self.page.get_by_role('textbox', name='Primary / Serif font', exact=True)
        expect(primary).to_be_visible()
        available = self.page.evaluate('''async () => {
          const load = async (source) => {
            let timer;
            try {
              const face = new FontFace('__acceptance_yukyokasho__', source);
              return await Promise.race([
                face.load().then(() => face.status === 'loaded', () => false),
                new Promise(resolve => { timer = setTimeout(() => resolve(false), 1000); })
              ]);
            } finally { clearTimeout(timer); }
          };
          return (await load('local("YuKyokasho Medium"), local("YuKyokasho")')) &&
            (await load('local("YuKyokasho Yoko Medium"), local("YuKyokasho Yoko")'));
        }''')
        expect(primary).to_have_value('YuKyokasho' if available else 'Klee One', timeout=3000)
        # A device fallback must not replace the portable/account preference.
        self.assertIsNone(self.page.evaluate('localStorage.getItem("fontFamilyGroupOne")'))
        self.page.get_by_role('button', name='Show available primary / serif fonts', exact=True).click()
        expect(self.page.get_by_role('menuitemradio', name='YuKyokasho', exact=True)).to_have_count(1 if available else 0)

    def test_paginated_ruby_images_and_untrusted_resources(self):
        self.open_book(font='Klee One')
        self.assertEqual('ほん', self.page.locator('.book-content ruby rt').first.text_content())
        row = self.page.evaluate("""() => new Promise((resolve, reject) => {
          const open = indexedDB.open('books');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const req = db.transaction('data').objectStore('data').getAll();
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
              const value = req.result.find((book) => book.title === 'Reader browser acceptance');
              db.close();
              resolve(value?.epubPublication ?? null);
            };
          };
        })""")
        self.assertEqual('foliate-epub-v1', row['engine'])
        self.assertEqual('foliate', row['parser'])
        self.assertGreaterEqual(len(row['toc']), 2)
        self.assertGreaterEqual(len(row['pageList']), 1)
        self.assertGreaterEqual(len(row['landmarks']), 1)
        link = self.page.locator('#cross-note')
        self.assertEqual('chapter2.xhtml#note', link.get_attribute('data-manabi-epub-href'))
        self.assertEqual('#note', link.get_attribute('href'))
        link.evaluate('element => element.click()')
        self.page.wait_for_function(
            """() => document.querySelector('.book-content [data-manabi-spine-index="1"]') &&
                     document.querySelector('.book-content #note')?.textContent.includes('脚注の内容')"""
        )
        self.assertEqual(
            'all',
            self.page.locator('#legacy-tcy').evaluate('element => getComputedStyle(element).textCombineUpright'))
        self.page.wait_for_function(
            '() => document.querySelector("#safe-image")?.naturalWidth > 0'
        )
        self.assertEqual(0, self.page.locator('.book-content script, .book-content iframe, .book-content [onerror]').count())
        self.assertFalse(self.page.evaluate('Boolean(window.bookAttack)'))
        self.assertEqual([], StaticHandler.probes)
        self.assertEqual('Klee One', self.first_font())
        self.page.keyboard.press('ArrowLeft')
        expect(self.page.locator('.book-content')).to_be_visible()

    def test_continuous_horizontal_saved_explicit_font(self):
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
        # WebKit can keep the global FontFaceSet in `loading` after a cancelled
        # previous face even though the selected face completed. The Reader's
        # contract is selected-face completion plus usable, refreshed geometry.
        before = self.page.evaluate('window.scrollY')
        self.page.keyboard.press('PageDown')
        self.page.wait_for_function('(before) => window.scrollY != before', arg=before)
        expect(self.page.locator('.book-content')).to_contain_text('日本語')

    def test_offline_reload_preserves_book_and_never_caches_account_requests(self):
        self.page.goto(self.origin + '/reader-web/manage')
        scope = self.page.evaluate('navigator.serviceWorker.ready.then(registration => registration.scope)')
        self.assertEqual(self.origin + '/reader-web/', scope)
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
