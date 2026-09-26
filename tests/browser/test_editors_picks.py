"""Editors' Picks and first-read dictionary setup against the built web app."""

import re
import json
from pathlib import Path
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
    book_started = None
    book_gate = None
    duplicate_ids = False
    malformed_feed = False
    download_status = 200

    def serve(self, body, content_type, status=200):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass  # The native client can deliberately cancel a held response.

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
                                   '</entry>' % (0 if type(self).duplicate_ids else number, title, number, url))
                payload = ('<feed xmlns="http://www.w3.org/2005/Atom">' + ''.join(entries) + '</feed>').encode()
                if type(self).malformed_feed:
                    payload = payload.replace(b'First Pick', b'First \xff Pick')
                self.serve(payload, 'application/atom+xml')
            elif path.startswith('/static/reader/books/library/'):
                started, gate = type(self).book_started, type(self).book_gate
                if started is not None:
                    started.set()
                if gate is not None:
                    gate.wait(timeout=30)
                if type(self).fail_download:
                    self.serve(b'Unavailable', 'text/plain', 503)
                else:
                    self.serve(type(self).epub_bytes, 'application/epub+zip', type(self).download_status)
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
        PicksHandler.book_started = None
        PicksHandler.book_gate = None
        PicksHandler.duplicate_ids = False
        PicksHandler.malformed_feed = False
        PicksHandler.download_status = 200
        PicksHandler.account_fixture = None
        PicksHandler.account_requests = []
        self.profile = tempfile.TemporaryDirectory()
        self.engine = os.environ.get('PICKS_BROWSER', 'chromium')
        self.context = getattr(self.playwright, self.engine).launch_persistent_context(
            user_data_dir=self.profile.name,
            viewport={'width': 390, 'height': 844})
        self.page = self.context.pages[0]
        self.page.set_default_timeout(30000)
        self.errors = []
        self.diagnostics = []
        self.page.on('pageerror', self.page_error)
        self.page.on('requestfailed', lambda request: self.diagnostics.append({
            'kind': 'requestfailed', 'url': request.url,
            'resource': request.resource_type, 'failure': request.failure,
            'page': self.page.url
        }))
        self.page.on('console', lambda message: self.diagnostics.append({
            'kind': 'console', 'type': message.type, 'text': message.text,
            'location': message.location, 'page': self.page.url
        }) if message.type == 'error' else None)
        self.context.expose_binding('recordPicksError', lambda source, record:
                                    self.diagnostics.append(record))
        self.context.add_init_script("""
          const record = entry => { void window.recordPicksError(entry).catch(() => {}); };
          const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
          URL.createObjectURL = function(blob) {
            const url = create.call(this, blob);
            record({kind:'blob-create',url,type:blob.type,size:blob.size,stack:new Error().stack});
            return url;
          };
          URL.revokeObjectURL = function(url) {
            record({kind:'blob-revoke',url,stack:new Error().stack});
            return revoke.call(this,url);
          };
          for (const type of ['error', 'unhandledrejection']) {
            window.addEventListener(type, event => {
              const error = event.error || event.reason;
              void window.recordPicksError({kind: type, page: location.href,
                message: event.message || String(error), name: error?.name,
                stack: error?.stack}).catch(() => {});
            });
          }
        """)

    def page_error(self, error):
        # WebKit console diagnostics can put the URL prefix in Error.name.
        # Preserve it, rather than losing the resource identity via str(error).
        message = f'{error.name}: {error.message}'
        self.errors.append(message)
        self.diagnostics.append({'kind': 'pageerror', 'message': message,
                                 'stack': error.stack, 'page': self.page.url})

    def tearDown(self):
        if PicksHandler.book_gate is not None:
            PicksHandler.book_gate.set()
        PicksHandler.book_started = None
        PicksHandler.book_gate = None
        PicksHandler.account_fixture = None
        if PicksHandler.index_gate is not None:
            PicksHandler.index_gate.set()
        PicksHandler.index_started = None
        PicksHandler.index_gate = None
        self.context.close()
        self.profile.cleanup()
        folder = Path('test-results')
        folder.mkdir(exist_ok=True)
        (folder / f'{self.engine}-{self._testMethodName}-diagnostics.json').write_text(
            json.dumps(self.diagnostics, ensure_ascii=False, indent=2))
        self.assertEqual([], self.errors)

    def library(self):
        self.page.goto(self.origin + '/reader-web/manage')
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
        expect(self.page).to_have_url(re.compile('/reader-web/b\\?id='))
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
        self.page.goto(self.origin + '/reader-web/manage')
        expect(self.page.get_by_role('button', name='Read A Pick from Manabi')).to_have_count(1)
        self.page.get_by_role('button', name='Library actions').click()
        self.page.get_by_role('menuitem', name='Add Books').click()
        self.page.get_by_role('menuitem', name="Editor's Picks").click()
        dialog = self.page.get_by_role('dialog').filter(has_text="Editor's Picks")
        expect(dialog.get_by_role('region', name="Editor's Picks books")).to_be_visible()
        dialog.get_by_role('button', name='Open').first.click()
        expect(self.page).to_have_url(re.compile('/reader-web/b\\?id='))
        self.page.goto(self.origin + '/reader-web/manage')
        expect(self.page.get_by_role('button', name='Read A Pick from Manabi')).to_have_count(1)

    def test_bad_catalog_url_and_download_failure(self):
        PicksHandler.bad_feed = True
        PicksHandler.fail_download = True
        self.library()
        region = self.page.get_by_role('region', name="Editor's Picks books")
        self.assertNotIn('Second Pick', region.locator('h4').all_text_contents())
        region.get_by_role('button', name='Open').first.click()
        expect(self.page.get_by_text('Could not open book')).to_be_visible()
        self.assertNotIn('/reader-web/b', self.page.url)
        self.assertFalse(any('outside.example' in value for value in PicksHandler.requests))

    def test_leaving_empty_library_while_catalog_loads_has_no_page_error(self):
        PicksHandler.index_started = threading.Event()
        PicksHandler.index_gate = threading.Event()
        self.page.goto(self.origin + '/reader-web/manage')
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

    def guest_session(self):
        return {'user': None, 'csrf_token': 'c' * 64, 'providers': []}

    def book_rows(self):
        return self.page.evaluate("""() => new Promise((resolve, reject) => {
          const open = indexedDB.open('books');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result, tx = db.transaction(['data', 'bookmark', 'lastItem']);
            const data = tx.objectStore('data').getAll();
            const bookmarks = tx.objectStore('bookmark').getAll();
            const last = tx.objectStore('lastItem').getAll();
            tx.oncomplete = () => { db.close(); resolve({books:data.result.map(
              ({id, title, contentHash}) => ({id, title, contentHash})),
              bookmarks:bookmarks.result, last:last.result}); };
            tx.onabort = () => { db.close(); reject(tx.error); };
          };
        })""")

    def prepare_foreign_book(self, catalog_copy=False):
        PicksHandler.account_fixture = self.guest_session()
        self.context.add_init_script("localStorage.setItem('manabi-reader-dictionary-setup-v1', 'skip')")
        self.library()
        title = 'A Pick from Manabi' if catalog_copy else 'Only Bob'
        self.page.locator('input[type=file][accept*=\".epub\"]').first.set_input_files({
            'name': 'owned.epub', 'mimeType':'application/epub+zip',
            'buffer': PicksHandler.epub_bytes if catalog_copy else book(title)})
        expect(self.page.get_by_role('button', name='Read ' + title, exact=True)).to_be_visible()
        self.page.evaluate("""async (title) => {
          const openDb = name => new Promise((resolve,reject) => {
            const request = indexedDB.open(name);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const books = await openDb('books');
          const rows = await new Promise((resolve,reject) => {
            const tx=books.transaction('data'), request=tx.objectStore('data').getAll();
            tx.oncomplete=()=>resolve(request.result); tx.onabort=()=>reject(tx.error);
          }); books.close();
          const selected=rows.find(row=>row.title===title);
          if(!selected) throw new Error('Imported fixture missing');
          const links=await openDb('manabi-reader-integrations');
          await new Promise((resolve,reject)=>{
            const tx=links.transaction('books','readwrite');
            tx.objectStore('books').put({id:'owned-fixture',sourceId:'owned-source',owner:'bob',
              root:'root',fileId:'book',name:'owned.epub',title,bookId:selected.id,
              contentHash:selected.contentHash,syncEnabled:false});
            tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
          }); links.close();
        }""", title)
        self.library()
        expect(self.page.get_by_role('button', name='Read ' + title, exact=True)).to_have_count(0)
        return title

    def test_catalog_does_not_open_a_foreign_account_cached_copy(self):
        self.prepare_foreign_book(catalog_copy=True)
        before = self.book_rows()
        self.page.get_by_role('region', name="Editor's Picks books").get_by_role(
            'button', name='Open').first.click()
        expect(self.page.get_by_text('Could not open book', exact=True)).to_be_visible(timeout=5000)
        self.assertIn('/manage', self.page.url)
        self.assertEqual(before, self.book_rows())

    def test_account_switch_away_and_back_cancels_download_and_allows_fresh_open(self):
        self.prepare_foreign_book()
        before = self.book_rows()
        PicksHandler.book_started, PicksHandler.book_gate = threading.Event(), threading.Event()
        self.page.get_by_role('region', name="Editor's Picks books").get_by_role(
            'button', name='Open').first.click()
        self.assertTrue(PicksHandler.book_started.wait(timeout=5))
        PicksHandler.account_fixture = {'user':{'id':'bob','username':'Bob'},
                                       'csrf_token':'c' * 64,'providers':[]}
        self.page.evaluate("window.dispatchEvent(new Event('online'))")
        expect(self.page.get_by_role('button', name='Read Only Bob', exact=True)).to_be_visible()
        PicksHandler.account_fixture = self.guest_session()
        self.page.evaluate("window.dispatchEvent(new Event('online'))")
        expect(self.page.get_by_role('button', name='Read Only Bob', exact=True)).to_have_count(0)
        region = self.page.get_by_role('region', name="Editor's Picks books")
        expect(region.get_by_role('button', name='Open').first).to_be_enabled(timeout=5000)
        PicksHandler.book_gate.set()
        self.assertEqual(before, self.book_rows())
        self.assertIn('/manage', self.page.url)
        region.get_by_role('button', name='Open').first.click()
        expect(self.page).to_have_url(re.compile('/reader-web/b\\?id='))
        expect(self.page.locator('.book-content').first).to_have_attribute('aria-busy','false')
        self.assertEqual(2, len(self.book_rows()['books']))

    def test_duplicate_catalog_ids_are_reported_and_retryable(self):
        PicksHandler.duplicate_ids = True
        self.page.goto(self.origin + '/reader-web/manage')
        expect(self.page.get_by_role('button', name='Try Again', exact=True)).to_be_visible(timeout=5000)
        self.assertEqual([], self.errors)
        PicksHandler.duplicate_ids = False
        self.page.get_by_role('button', name='Try Again', exact=True).click()
        expect(self.page.get_by_role('region', name="Editor's Picks books").locator('h4')).to_have_count(6)

    def test_partial_epub_response_is_not_a_successful_import(self):
        PicksHandler.download_status = 206
        self.library()
        before = self.book_rows()
        self.page.get_by_role('region', name="Editor's Picks books").get_by_role(
            'button', name='Open').first.click()
        expect(self.page.get_by_text('Could not open book', exact=True)).to_be_visible(timeout=5000)
        self.assertEqual(before, self.book_rows())
        self.assertIn('/manage', self.page.url)

    def test_invalid_utf8_feed_is_not_silently_rewritten(self):
        PicksHandler.malformed_feed = True
        self.page.goto(self.origin + '/reader-web/manage')
        expect(self.page.get_by_role('button', name='Try Again', exact=True)).to_be_visible(timeout=5000)
        self.assertEqual([], self.errors)
        PicksHandler.malformed_feed = False
        self.page.get_by_role('button', name='Try Again', exact=True).click()
        expect(self.page.get_by_role('region', name="Editor's Picks books").locator('h4')).to_have_count(6)

    def test_saved_library_does_not_start_a_transient_empty_catalog(self):
        self.context.add_init_script("localStorage.setItem('manabi-reader-dictionary-setup-v1', 'skip')")
        self.library()
        self.page.get_by_role('region', name="Editor's Picks books").get_by_role(
            'button', name='Open').first.click()
        expect(self.page).to_have_url(re.compile('/reader-web/b\\?id='))
        expect(self.page.locator('.book-content').first).to_have_attribute('aria-busy','false')
        PicksHandler.requests = []
        self.page.goto(self.origin + '/reader-web/manage')
        expect(self.page.get_by_role('button',name='Read A Pick from Manabi',exact=True)).to_be_visible()
        expect(self.page.get_by_role('region',name='Library shelves')).to_have_attribute('aria-busy','false')
        self.assertFalse(any(path.endswith('/opds/index.xml') for path in PicksHandler.requests),
                         PicksHandler.requests)

    def test_repeated_immediate_catalog_reader_departures(self):
        self.context.add_init_script("localStorage.setItem('manabi-reader-dictionary-setup-v1', 'skip')")
        self.library()
        self.page.get_by_role('region', name="Editor's Picks books").get_by_role(
            'button', name='Open').first.click()
        expect(self.page).to_have_url(re.compile('/reader-web/b\\?id='))
        for cycle in range(12):
            with self.subTest(cycle=cycle):
                self.diagnostics.append({'kind':'phase','cycle':cycle,'step':'depart-reader'})
                self.page.goto(self.origin + '/reader-web/manage')
                expect(self.page.get_by_role('button', name='Read A Pick from Manabi')).to_have_count(1)
                self.page.get_by_role('button', name='Library actions').click()
                self.page.get_by_role('menuitem', name='Add Books').click()
                self.page.get_by_role('menuitem', name="Editor's Picks").click()
                dialog = self.page.get_by_role('dialog').filter(has_text="Editor's Picks")
                dialog.get_by_role('button', name='Open').first.click()
                expect(self.page).to_have_url(re.compile('/reader-web/b\\?id='))
                self.assertEqual([], self.errors)
        self.page.goto(self.origin + '/reader-web/manage')
        expect(self.page.get_by_role('button', name='Read A Pick from Manabi')).to_have_count(1)
        self.assertEqual(1,len(self.book_rows()['books']))

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
