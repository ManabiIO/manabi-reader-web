"""Editors' Picks and first-read dictionary setup against the built web app."""

import re
import os
import tempfile
import threading
import unittest
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

from test_books_library import book
from test_static_reader import StaticHandler, ThreadingHTTPServer


class PicksHandler(StaticHandler):
    fail_download = False
    bad_feed = False
    requests = []
    epub_bytes = book('A Pick from Manabi')
    index_started = None
    index_gate = None

    def serve(self, body, content_type, status=200):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path.startswith('/static/reader/books/'):
            type(self).requests.append(path)
            if path.endswith('/opds/index.xml'):
                started = type(self).index_started
                gate = type(self).index_gate
                if started is not None:
                    started.set()
                if gate is not None:
                    gate.wait(timeout=30)
                self.serve(b'''<?xml version="1.0"?>
                  <feed xmlns="http://www.w3.org/2005/Atom">
                    <entry><title>All Books (6)</title>
                    <link rel="subsection" href="/static/reader/books/opds/feeds/all.xml"/></entry>
                  </feed>''', 'application/atom+xml')
            elif path.endswith('/opds/feeds/all.xml'):
                titles = ['First Pick', 'Second Pick', 'Third Pick', 'Fourth Pick',
                          'Fifth Pick', 'Sixth Pick']
                entries = []
                for number, title in enumerate(titles):
                    url = ('https://outside.example/book.epub' if type(self).bad_feed and number == 1
                           else '/static/reader/books/library/%d.epub' % number)
                    entries.append('<entry><id>pick-%d</id><title>%s</title><author><name>Author %d</name></author>'
                                   '<link rel="http://opds-spec.org/acquisition" type="application/epub+zip" href="%s"/>'
                                   '</entry>' % (number, title, number, url))
                payload = ('<feed xmlns="http://www.w3.org/2005/Atom">' + ''.join(entries) + '</feed>').encode()
                self.serve(payload, 'application/atom+xml')
            elif path.startswith('/static/reader/books/library/'):
                if type(self).fail_download:
                    self.serve(b'Unavailable', 'text/plain', 503)
                else:
                    self.serve(type(self).epub_bytes, 'application/epub+zip')
            else:
                self.send_error(404)
            return
        super().do_GET()


class EditorsPicksBrowser(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), PicksHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = 'http://127.0.0.1:%d' % cls.server.server_port
        cls.playwright = sync_playwright().start()

    @classmethod
    def tearDownClass(cls):
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        PicksHandler.fail_download = False
        PicksHandler.bad_feed = False
        PicksHandler.requests = []
        PicksHandler.index_started = None
        PicksHandler.index_gate = None
        self.profile = tempfile.TemporaryDirectory()
        self.engine = os.environ.get('PICKS_BROWSER', 'chromium')
        self.context = getattr(self.playwright, self.engine).launch_persistent_context(
            user_data_dir=self.profile.name,
            viewport={'width': 390, 'height': 844})
        self.page = self.context.pages[0]
        self.page.set_default_timeout(30000)
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))

    def tearDown(self):
        if PicksHandler.index_gate is not None:
            PicksHandler.index_gate.set()
        PicksHandler.index_started = None
        PicksHandler.index_gate = None
        self.context.close()
        self.profile.cleanup()
        self.assertEqual([], self.errors)

    def library(self):
        self.page.goto(self.origin + '/Reader-Web/manage')
        expect(self.page.get_by_role('region', name="Editor's Picks books")).to_be_visible()
        expect(self.page.get_by_role('button', name='Open').first).to_be_visible()

    def test_empty_state_order_scroll_and_open(self):
        self.library()
        for name in ['Import File(s)', 'Import Backup']:
            expect(self.page.get_by_role('button', name=name)).to_be_visible()
        for name in ['Import from Ttu Ebook Reader', 'Import from Yatsu Reader',
                     'Local folder', 'Google Drive', 'Dropbox', 'OneDrive']:
            expect(self.page.get_by_role('link', name=name)).to_be_visible()
        region = self.page.get_by_role('region', name="Editor's Picks books")
        self.assertEqual(['First Pick', 'Second Pick', 'Third Pick', 'Fourth Pick',
                          'Fifth Pick', 'Sixth Pick'], region.locator('h4').all_text_contents())
        self.assertTrue(region.evaluate('(node) => node.scrollHeight > node.clientHeight'))
        self.assertEqual(390, self.page.evaluate('document.documentElement.scrollWidth'))
        region.get_by_role('button', name='Open').first.click()
        expect(self.page).to_have_url(re.compile('/Reader-Web/b\\?id='))
        setup = self.page.get_by_role('dialog').filter(has_text='Look up words as you read')
        expect(setup).to_be_visible()
        expect(setup).to_contain_text('Jitendex')
        setup.get_by_role('button', name='Use another extension').click()
        expect(setup).not_to_be_visible()
        self.page.reload()
        # Visibility can come from the prerendered shell before the reader's
        # click handlers hydrate. Wait for the ready reading document.
        expect(self.page.locator('.book-content').first).to_have_attribute('aria-busy', 'false')
        expect(setup).not_to_be_visible()
        self.page.get_by_role('button', name='Show reading controls').click()
        self.page.get_by_role('button', name='Reading tools').click()
        self.page.get_by_role('menuitem', name='Dictionary Setup').click()
        expect(setup).to_be_visible()
        setup.get_by_role('button', name='Not now').click()
        self.page.goto(self.origin + '/Reader-Web/manage')
        expect(self.page.get_by_role('button', name='Read A Pick from Manabi')).to_have_count(1)
        self.page.get_by_role('button', name='Library actions').click()
        self.page.get_by_role('menuitem', name='Add Books').click()
        self.page.get_by_role('menuitem', name="Editor's Picks").click()
        dialog = self.page.get_by_role('dialog').filter(has_text="Editor's Picks")
        expect(dialog.get_by_role('region', name="Editor's Picks books")).to_be_visible()
        dialog.get_by_role('button', name='Open').first.click()
        expect(self.page).to_have_url(re.compile('/Reader-Web/b\\?id='))
        self.page.goto(self.origin + '/Reader-Web/manage')
        expect(self.page.get_by_role('button', name='Read A Pick from Manabi')).to_have_count(1)

    def test_bad_catalog_url_and_download_failure(self):
        PicksHandler.bad_feed = True
        PicksHandler.fail_download = True
        self.library()
        region = self.page.get_by_role('region', name="Editor's Picks books")
        self.assertNotIn('Second Pick', region.locator('h4').all_text_contents())
        region.get_by_role('button', name='Open').first.click()
        expect(self.page.get_by_text('Could not open book')).to_be_visible()
        self.assertNotIn('/Reader-Web/b', self.page.url)
        self.assertFalse(any('outside.example' in value for value in PicksHandler.requests))

    def test_leaving_empty_library_while_catalog_loads_has_no_page_error(self):
        PicksHandler.index_started = threading.Event()
        PicksHandler.index_gate = threading.Event()
        self.page.goto(self.origin + '/Reader-Web/manage')
        expect(self.page.get_by_role('heading', name='Make room for a good book')).to_be_visible()
        self.assertTrue(PicksHandler.index_started.wait(timeout=5))
        self.page.get_by_role('button', name='Collections', exact=True).click()
        sheet = self.page.locator('#library-collections-sheet')
        with self.page.expect_event('requestfailed', predicate=lambda request: request.url.endswith('/opds/index.xml')):
            sheet.get_by_role('button', name=re.compile(r'^Want to Read\b')).click()
        expect(self.page.get_by_role('heading', name='Want to Read', exact=True)).to_be_visible()
        PicksHandler.index_gate.set()
        self.assertFalse(any(path.endswith('/opds/feeds/all.xml') for path in PicksHandler.requests))
        expect(self.page.get_by_role('heading', name='Want to Read', exact=True)).to_be_visible()

    def test_installed_bridge_offers_jitendex_and_remembers_the_choice(self):
        self.context.add_init_script('''
            localStorage.setItem('manabi-reader-dictionary-setup-v1', 'manabitan');
            const markBridge = () => {
                const root = document.documentElement;
                if (!root) return false;
                root.dataset.manabitanContentScriptLoaded = 'true';
                root.dataset.manabitanReaderJitendexBridge = 'true';
                return true;
            };
            if (!markBridge()) {
                const observer = new MutationObserver(() => {
                    if (markBridge()) observer.disconnect();
                });
                observer.observe(document, { childList: true, subtree: true });
            }
        ''')
        self.library()
        self.page.get_by_role('region', name="Editor's Picks books").get_by_role(
            'button', name='Open').first.click()
        setup = self.page.get_by_role('dialog').filter(has_text='Look up words as you read')
        expect(setup.get_by_role('button', name='Install Jitendex')).to_be_visible()
        expect(setup.get_by_role('link', name='Get Manabitan')).to_have_count(0)
        setup.get_by_role('button', name='Install Jitendex').click()
        self.assertEqual('done', self.page.evaluate(
            "localStorage.getItem('manabi-reader-dictionary-setup-v1')"))
        self.page.reload()
        expect(setup).not_to_be_visible()


if __name__ == '__main__':
    unittest.main()
