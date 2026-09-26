"""Local feature qualification against the real static build and IndexedDB.

WebDAV is an independently running HTTP fixture with browser-enforced CORS,
Basic authentication and conditional writes. Chromium also checks actual OPTIONS
preflights; WebKit does not emit them in this loopback fixture. Worker fault injection is limited
to the explicit responsiveness case; all other searches execute the built worker.
"""
import base64
from contextlib import contextmanager
import socket
import hashlib
import io
import json
import os
from pathlib import Path
import re
import threading
import tempfile
import time
import unittest
from urllib.parse import quote, unquote, urlsplit
from xml.sax.saxutils import escape
import zipfile
from http.server import BaseHTTPRequestHandler
from playwright.sync_api import expect
from test_static_reader import ThreadingHTTPServer, StaticHandler
from test_books_library import LibraryBase, book, cross_resource_book

TITLE = 'Manabi Yatsu Portability Fixture'
STAMP = 1790212589793
FIXTURE = Path(__file__).parents[1] / 'fixtures/yatsu/complete-local-backup-v11.zip'


def archive_files(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        return {n: z.read(n) for n in z.namelist() if not n.endswith('/')}


def zip_bytes(files):
    b = io.BytesIO()
    with zipfile.ZipFile(b, 'w', zipfile.ZIP_DEFLATED) as z:
        for k, v in files.items():
            z.writestr(k, v if isinstance(v, (str, bytes)) else json.dumps(v, ensure_ascii=False))
    return b.getvalue()


def yatsu_fixture(*, note='A book-wide note', ambiguous=False, changed=0):
    files = archive_files(FIXTURE.read_bytes())
    nested = next(n for n in files if '/bookdata_' in n)
    package = archive_files(files[nested])
    static = json.loads(package['staticdata.json'])
    static['elementHtml'] = ('<section id="section-1"><h1>Fixture</h1>'
        '<p>最初の文章です。</p><p>唯一の<ruby>猫<rt>ねこ</rt></ruby>の文章です。</p>'
        '<p>同じ文章。</p><p>同じ文章。</p></section>')
    static['sections'] = [{'reference':'section-1','charactersWeight':1,'label':'Fixture','startCharacter':0,'characters':45}]
    package['staticdata.json'] = static
    files[nested] = zip_bytes(package)
    files[f'{TITLE}/highlights_1_11_{STAMP+changed}.json'] = [dict(
        bookTitle=TITLE, text='同じ文章。' if ambiguous else '唯一の猫の文章です。',
        startOffset=13, endOffset=24, color='blue', dateCreated=STAMP,
        note='My passage note', targetSectionId='section-1')]
    files[f'{TITLE}/notes_1_11_{STAMP+changed}.json'] = [dict(
        bookTitle=TITLE, title='Notebook title', text=note,
        syncId='portable-note', dateCreated=STAMP, dateModified=STAMP+changed)]
    return zip_bytes(files)


class DavHandler(BaseHTTPRequestHandler):
    """State is isolated by one server per test, with a real second origin."""
    def log_message(self, *_):
        pass

    @property
    def state(self):
        return self.server.state

    def send(self, code, data=b'', content='application/octet-stream', etag=None, extra=None):
        self.send_response(code)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Content-Type', content)
        self.send_header('Cache-Control', 'no-store')
        if self.state['cors']:
            self.send_header('Access-Control-Allow-Origin', self.state['origin'])
            self.send_header('Access-Control-Allow-Methods', 'OPTIONS, PROPFIND, GET, PUT, MKCOL')
            self.send_header('Access-Control-Allow-Headers', 'Authorization, Depth, Content-Type, If-Match, If-None-Match')
            self.send_header('Access-Control-Expose-Headers', 'ETag')
        if etag and self.state['etag']:
            self.send_header('ETag', etag)
        for k,v in (extra or {}).items():
            self.send_header(k,v)
        self.end_headers()
        if data:
            self.wfile.write(data)

    def auth(self):
        self.state['requests'].append((self.command, self.path, dict(self.headers)))
        if self.headers.get('Authorization') != 'Basic '+base64.b64encode(b'reader:test-password').decode():
            self.send(401)
            return False
        return True

    def do_OPTIONS(self):
        self.state['preflights'] += 1
        self.send(204)

    def do_PROPFIND(self):
        if not self.auth(): return
        path = unquote(urlsplit(self.path).path)
        if path not in self.state['folders']:
            self.send(404); return
        names = [path]
        if self.headers.get('Depth') == '1':
            names += [n for n in self.state['files'] if n.startswith(path) and '/' not in n[len(path):]]
            names += [n for n in self.state['folders'] if n != path and n.startswith(path) and '/' not in n[len(path):].rstrip('/')]
        if self.state.get('evil'):
            names.append('/outside/private.epub')
        rows = []
        for n in names:
            isdir = n in self.state['folders']
            body = self.state['files'].get(n, b'')
            etag = '&quot;'+hashlib.sha256(body).hexdigest()+'&quot;'
            rows.append('<d:response><d:href>'+escape(quote(n,safe='/'))+'</d:href><d:propstat><d:prop>'
                '<d:displayname>'+escape(n.rstrip('/').split('/')[-1])+'</d:displayname>'
                '<d:resourcetype>'+('<d:collection/>' if isdir else '')+'</d:resourcetype>'
                '<d:getcontentlength>'+str(len(body))+'</d:getcontentlength><d:getetag>'+etag+'</d:getetag>'
                '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>')
        self.send(207, ('<d:multistatus xmlns:d="DAV:">'+''.join(rows)+'</d:multistatus>').encode(), 'application/xml')

    def do_GET(self):
        if not self.auth(): return
        path = unquote(urlsplit(self.path).path)
        if self.state.get('redirect'):
            self.send(302, extra={'Location':self.state['redirect']}); return
        body = self.state['files'].get(path)
        if body is None:
            self.send(404); return
        gate = self.state.get('book_get_gate') if path.endswith('.epub') else None
        if gate:
            self.state['get_started'].set()
            gate.wait(15)
        etag = '"'+hashlib.sha256(body).hexdigest()+'"'
        if self.headers.get('If-Match') not in (None,etag):
            self.send(412); return
        self.send(200, body, 'application/epub+zip' if path.endswith('.epub') else 'application/json',etag)

    def do_MKCOL(self):
        if not self.auth(): return
        path = unquote(urlsplit(self.path).path)
        if not path.endswith('/'): path += '/'
        if path in self.state['folders']:
            self.send(405); return
        self.state['folders'].add(path)
        self.send(201)

    def do_PUT(self):
        if not self.auth(): return
        body = self.rfile.read(int(self.headers.get('Content-Length','0')))
        path = unquote(urlsplit(self.path).path)
        if not path.startswith('/Books/.manabi-reader/'):
            self.send(403); return
        old = self.state['files'].get(path)
        etag = '"'+hashlib.sha256(old).hexdigest()+'"' if old is not None else None
        if (old is None and self.headers.get('If-None-Match') != '*') or (old is not None and self.headers.get('If-Match') != etag) or self.state.get('conflict'):
            self.send(412); return
        gate = self.state.get('put_gate')
        if gate:
            self.state['put_started'].set()
            gate.wait(15)
        self.state['files'][path] = body
        self.state['puts'] += 1
        self.send(201 if old is None else 204, etag='"'+hashlib.sha256(body).hexdigest()+'"')


class LocalFeatureBrowser(LibraryBase):
    def setUp(self):
        super().setUp()
        self.dav = ThreadingHTTPServer(('127.0.0.1',0),DavHandler)
        self.dav.state = dict(origin=self.origin, cors=True, etag=True, folders={'/Books/'},
            files={'/Books/Offline.epub':book('WebDAV offline book',body='<p>WEBDAV_SEARCH_NEEDLE 本を読む。</p>')},
            requests=[],preflights=0,puts=0)
        self.dav_thread = threading.Thread(target=self.dav.serve_forever,daemon=True)
        self.dav_thread.start()
        self.dav_url = f'http://127.0.0.1:{self.dav.server_port}/Books/'

    def tearDown(self):
        try: super().tearDown()
        finally:
            self.dav.shutdown(); self.dav.server_close(); self.dav_thread.join()

    def wait_rows(self, store, predicate, db='books'):
        deadline=time.monotonic()+20
        while True:
            rows=self.stores(db,[store])[store]
            if predicate(rows): return rows
            self.assertLess(time.monotonic(),deadline,repr(rows))
            self.page.wait_for_timeout(50)

    @contextmanager
    def origin_unavailable(self):
        # WebKit 2359 rejects even a literal SW Response with set_offline(True)
        # (microsoft/playwright#42775). Stop the real HTTP listener instead, for
        # both engines; no request interception, synthetic cache, or skipped case.
        cls = type(self)
        address = cls.server.server_address
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join()
        try:
            with self.assertRaises(OSError):
                socket.create_connection(address, timeout=1)
            yield
        finally:
            cls.server = ThreadingHTTPServer(address, StaticHandler)
            cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
            cls.thread.start()

    def search(self, text):
        field=self.page.get_by_role('searchbox',name='Search library',exact=True)
        if not field.count() or not field.is_visible():
            self.page.get_by_role('button',name='Search library',exact=True).click()
        field.fill(text)

    def open_migration(self, raw=None):
        self.page.goto(self.origin+'/reader-web/import-ttu?source=yatsu')
        field=self.page.get_by_label('Choose Yatsu backup ZIPs',exact=True)
        expect(field).to_be_enabled()
        field.set_input_files({'name':'Yatsu.zip','mimeType':'application/zip','buffer':raw or yatsu_fixture()})
        expect(self.page.get_by_role('article',name='Import '+TITLE,exact=True)).to_be_visible()
        expect(field).to_be_enabled()

    def migrate(self):
        self.page.get_by_role('button',name=re.compile(r'^Import selected \(')).click()
        expect(self.page.get_by_label('Choose Yatsu backup ZIPs',exact=True)).to_be_enabled(timeout=60000)

    def configure_dav(self, writable=False):
        self.page.goto(self.origin+'/reader-web/connections')
        self.page.get_by_role('button',name='Add WebDAV folder',exact=True).click()
        self.page.get_by_label('Name',exact=True).fill('Test DAV')
        self.page.get_by_label('WebDAV folder URL',exact=True).fill(self.dav_url)
        self.page.get_by_label('Username',exact=True).fill('reader')
        self.page.get_by_label('Password or app password',exact=True).fill('test-password')
        # Remember is explicit here to permit cross-document/reload qualification.
        self.page.get_by_label('Remember password on this device',exact=True).check()
        if writable: self.page.get_by_label('Allow reading-data write-back in .manabi-reader',exact=True).check()
        self.page.get_by_role('button',name='Test and save WebDAV',exact=True).click()

    def connect_dav(self, writable=False, import_book=True):
        self.configure_dav(writable)
        expect(self.page.get_by_role('button',name='Browse Test DAV',exact=True)).to_be_visible()
        self.page.get_by_role('button',name='Browse Test DAV',exact=True).click()
        expect(self.page.get_by_role('button',name='Import Offline.epub',exact=True)).to_be_visible()
        if import_book:
            self.page.get_by_role('button',name='Import Offline.epub',exact=True).click()
            expect(self.page.get_by_role('link',name='Read WebDAV offline book',exact=True)).to_be_visible()

    def seed_resume(self, char=4, stamp=STAMP):
        self.page.evaluate('''({char,stamp})=>new Promise((resolve,reject)=>{
          const o=indexedDB.open('books');o.onsuccess=()=>{const db=o.result,tx=db.transaction(['data','bookmark'],'readwrite');
          tx.objectStore('data').getAll().onsuccess=e=>{const book=e.target.result[0];tx.objectStore('bookmark').put({dataId:book.id,exploredCharCount:char,progress:0.2,lastBookmarkModified:stamp});};
          tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error);};o.onerror=()=>reject(o.error);
        })''',dict(char=char,stamp=stamp))

    def test_two_sections_normalized_content_and_metadata_priority(self):
        self.import_book('Search metadata',creators=('Test Author',),body='<p>ＡＢＣ <ruby>猫<rt>ねこ</rt></ruby>が好き。</p>')
        self.import_book('Other novel',body='<p>Content-only SEARCH metadata mention.</p>')
        self.search('Search metadata')
        expect(self.page.get_by_role('heading',name='Books 1',exact=True)).to_be_visible()
        expect(self.page.get_by_role('heading',name='Content',exact=True)).to_be_visible()
        expect(self.page.get_by_role('button',name='Read Search metadata',exact=True)).to_be_enabled()
        expect(self.page.get_by_role('button',name=re.compile('^Open passage in Other novel:'))).to_be_visible()
        self.search('abc')
        hit=self.page.get_by_role('button',name='Open passage in Search metadata: ＡＢＣ',exact=True)
        expect(hit).to_be_visible()
        self.assertIn('ＡＢＣ',hit.inner_text())
        self.search('ねこ')
        expect(self.page.get_by_text('No content matches.',exact=True)).to_be_visible()
        self.assertEqual(0,self.page.get_by_role('button',name=re.compile('^Open passage in')).count())

    def test_metadata_clickable_with_worker_failure(self):
        self.import_book('Metadata still works',body='<p>Metadata still works.</p>')
        self.page.evaluate('''()=>{window.OriginalWorker=window.Worker;window.Worker=class{constructor(){throw new Error('test worker failure')}}}''')
        self.search('Metadata')
        expect(self.page.get_by_text('Content search could not start. Book matches are still available.',exact=True)).to_be_visible()
        self.page.get_by_role('button',name='Read Metadata still works',exact=True).click()
        expect(self.page).to_have_url(re.compile(r'/b\?id='))
        expect(self.page.get_by_text('Metadata still works.',exact=True)).to_be_visible()

    def test_cross_resource_result_is_preview_not_new_resume(self):
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files(
            {'name':'cross.epub','mimeType':'application/epub+zip','buffer':cross_resource_book()})
        expect(self.page.get_by_role('button',name='Read Cross Resource Return',exact=True)).to_be_visible()
        self.seed_resume(100)
        before=self.stores('books',['bookmark'])['bookmark']
        self.search('DESTINATION_UNIQUE')
        self.page.get_by_role('button',name='Open passage in Cross Resource Return: DESTINATION_UNIQUE',exact=True).click()
        expect(self.page.get_by_role('button',name='Return to where I was',exact=True)).to_be_visible(timeout=20000)
        self.assertEqual(before,self.stores('books',['bookmark'])['bookmark'])
        self.page.get_by_role('button',name='Return to where I was',exact=True).click()
        expect(self.page.get_by_role('button',name='Return to where I was',exact=True)).to_have_count(0)

    def test_yatsu_notes_highlights_repeat_and_original_records(self):
        self.open_migration()
        self.migrate()
        row=self.page.get_by_role('article',name='Import '+TITLE,exact=True)
        self.assertIn('Imported',row.inner_text())
        data=self.stores('books',['readerImportRecord','readerAnnotation','data'])
        self.assertEqual(3,len(data['readerImportRecord']))
        self.assertEqual(2,len(data['readerAnnotation']))
        note=next(r for r in data['readerImportRecord'] if r['part']=='notes')
        self.assertEqual('book-note',note['status'])
        self.assertEqual('A book-wide note',note['body'])
        self.assertEqual('A book-wide note',note['source']['text'])
        self.assertIsNone(self.page.evaluate("localStorage.getItem('manabi-yatsu-settings-receipt-v1')"))
        self.open_migration();self.migrate()
        after=self.stores('books',['readerImportRecord','readerAnnotation'])
        self.assertEqual(data['readerImportRecord'],after['readerImportRecord'])
        self.assertEqual(data['readerAnnotation'],after['readerAnnotation'])

    def test_yatsu_ambiguous_passage_retained_without_fake_anchor(self):
        self.open_migration(yatsu_fixture(ambiguous=True));self.migrate()
        data=self.stores('books',['readerImportRecord','readerAnnotation'])
        row=next(r for r in data['readerImportRecord'] if r['part']=='highlights')
        self.assertEqual('unresolved',row['status'])
        self.assertEqual('同じ文章。',row['quote'])
        self.assertEqual(1,len(data['readerAnnotation']))

    def test_direct_webdav_import_is_read_only_and_offline_searchable(self):
        original=self.dav.state['files']['/Books/Offline.epub']
        self.connect_dav()
        if self.engine == 'chromium':
            self.assertGreater(self.dav.state['preflights'], 0)
        self.assertEqual(0,self.dav.state['puts'])
        self.assertFalse(any(r[0]=='MKCOL' for r in self.dav.state['requests']))
        self.go_library()
        self.page.evaluate('() => navigator.serviceWorker.ready.then(() => true)')
        self.assertTrue(self.page.evaluate('!!navigator.serviceWorker.controller'))
        self.page.evaluate('window.__beforeOfflineReload = true')
        with self.origin_unavailable():
            response = self.page.reload()
            self.assertTrue(response.from_service_worker)
            self.assertTrue(self.page.evaluate('window.__beforeOfflineReload === undefined'))
            self.search('WEBDAV_SEARCH_NEEDLE')
            expect(self.page.get_by_role('button',name='Open passage in WebDAV offline book: WEBDAV_SEARCH_NEEDLE',exact=True)).to_be_visible()
        self.assertEqual(original,self.dav.state['files']['/Books/Offline.epub'])

    def test_webdav_opt_in_conditional_write_and_missing_remote(self):
        self.connect_dav(writable=True)
        self.seed_resume()
        self.page.get_by_label('Sync this book’s reading data with WebDAV',exact=True).check()
        self.page.get_by_role('button',name='Sync WebDAV offline book',exact=True).click()
        expect(self.page.get_by_text('Reading position, statistics, annotations and imported notes synced directly with WebDAV.',exact=True)).to_be_visible()
        self.assertEqual(1,self.dav.state['puts'])
        path=next(n for n in self.dav.state['files'] if n.endswith('.json'))
        record=json.loads(self.dav.state['files'][path])
        self.assertEqual(4,record['records']['resume']['exploredCharCount'])
        self.assertNotIn('dataId',record['records']['resume'])
        del self.dav.state['files'][path]
        before=self.stores('books',['bookmark'])['bookmark']
        self.page.get_by_role('button',name='Sync WebDAV offline book',exact=True).click()
        expect(self.page.get_by_role('button',name='Restore WebDAV file from this device',exact=True)).to_be_visible()
        self.assertEqual(before,self.stores('books',['bookmark'])['bookmark'])
        self.assertEqual(1,self.dav.state['puts'])
        self.page.get_by_role('button',name='Restore WebDAV file from this device',exact=True).click()
        expect(self.page.get_by_text('Reading position, statistics, annotations and imported notes synced directly with WebDAV.',exact=True)).to_be_visible()
        self.assertEqual(2,self.dav.state['puts'])


    def test_metadata_is_clickable_while_real_worker_results_are_held(self):
        self.import_book('Fast metadata', body='<p>Fast metadata content.</p>')
        self.page.evaluate("""()=>{const Native=window.Worker;window.searchWorkerMessages=0;
          window.Worker=class extends Native{constructor(url,options){super(url,options);
            if(String(url).includes('library-content-search-worker'))
              this.addEventListener('message',e=>{window.searchWorkerMessages++;e.stopImmediatePropagation()},true);
          }};}""")
        self.search('Fast')
        self.page.wait_for_function('() => window.searchWorkerMessages > 0')
        expect(self.page.get_by_text(re.compile('Searching content…'))).to_be_visible()
        expect(self.page.get_by_role('button',name='Read Fast metadata',exact=True)).to_be_enabled()
        self.page.get_by_role('button',name='Read Fast metadata',exact=True).click()
        expect(self.page.get_by_text('Fast metadata content.',exact=True)).to_be_visible()

    def test_search_cancellation_and_ime_commit_show_only_current_results(self):
        self.import_book('Alphabet',body='<p>ALPHA_ONLY</p><p>BETA_ONLY</p><p>日本語の本</p>')
        self.search('ALPHA_ONLY')
        self.search('BETA_ONLY')
        expect(self.page.get_by_role('button',name='Open passage in Alphabet: BETA_ONLY',exact=True)).to_be_visible()
        self.assertEqual(0,self.page.get_by_role('button',name='Open passage in Alphabet: ALPHA_ONLY',exact=True).count())
        field=self.page.get_by_role('searchbox',name='Search library',exact=True)
        field.evaluate("""e=>{e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
          e.value='日本語';e.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));
          e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'日本語'}));}""")
        expect(self.page.get_by_role('button',name='Open passage in Alphabet: 日本語',exact=True)).to_be_visible()
        self.assertEqual(0,self.page.get_by_role('button',name='Open passage in Alphabet: BETA_ONLY',exact=True).count())

    def test_search_revalidates_changed_source_even_without_timestamp_change(self):
        self.import_book('Reindexed book',body='<p>BEFORE_EDIT</p>')
        self.search('BEFORE_EDIT')
        expect(self.page.get_by_role('button',name='Open passage in Reindexed book: BEFORE_EDIT',exact=True)).to_be_visible()
        self.wait_rows('readerSearchProjection',lambda r:len(r)==1)
        self.page.evaluate("""()=>new Promise((resolve,reject)=>{const o=indexedDB.open('books');
          o.onsuccess=()=>{const db=o.result,tx=db.transaction('data','readwrite');tx.objectStore('data').getAll().onsuccess=e=>{
            const b=e.target.result[0];b.elementHtml=b.elementHtml.replace('BEFORE_EDIT','AFTER_EDIT');tx.objectStore('data').put(b);};
          tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}})""")
        self.search('AFTER_EDIT')
        expect(self.page.get_by_role('button',name='Open passage in Reindexed book: AFTER_EDIT',exact=True)).to_be_visible()
        self.search('BEFORE_EDIT')
        expect(self.page.get_by_text('No content matches.',exact=True)).to_be_visible()
        self.context.set_offline(True)
        self.search('AFTER_EDIT')
        expect(self.page.get_by_role('button',name='Open passage in Reindexed book: AFTER_EDIT',exact=True)).to_be_visible()

    def test_yatsu_edit_download_conflict_and_restore(self):
        self.open_migration();self.migrate()
        self.page.get_by_role('link',name='Read '+TITLE,exact=True).click()
        self.page.get_by_role('button',name='Show reading controls',exact=True).click()
        self.page.get_by_role('button',name='Bookmarks and Notes',exact=True).click()
        notebook=self.page.get_by_role('region',name='Imported Yatsu notes',exact=True)
        expect(notebook.get_by_text('A book-wide note',exact=True)).to_be_visible()
        notebook.get_by_role('button',name='Edit imported note',exact=True).click()
        notebook.get_by_label('Note',exact=True).fill('Edited locally')
        notebook.get_by_role('button',name='Save imported note',exact=True).click()
        expect(notebook.get_by_text('Edited locally',exact=True)).to_be_visible()
        with self.page.expect_download() as pending:
            notebook.get_by_role('button',name='Download imported notes',exact=True).click()
        raw=Path(pending.value.path()).read_bytes()
        archive=json.loads(raw)
        row=next(r for r in archive['records'] if r['part']=='notes')
        self.assertEqual('Edited locally',row['body']);self.assertEqual('A book-wide note',row['source']['text'])
        self.assertNotIn('accountId',row);self.assertNotIn('bookId',row)
        notebook.get_by_role('button',name='Remove imported note',exact=True).click()
        expect(notebook.get_by_text('Edited locally',exact=True)).to_have_count(0)
        notebook.get_by_role('button',name='Restore imported notes',exact=True).click()
        notebook.get_by_label('Choose imported notes archive',exact=True).set_input_files({'name':'notes.json','mimeType':'application/json','buffer':raw})
        expect(notebook.get_by_role('button',name='Use notebook archive',exact=True)).to_be_visible()
        notebook.get_by_role('button',name='Use notebook archive',exact=True).click()
        expect(notebook.get_by_text('Edited locally',exact=True)).to_be_visible()
        self.open_migration(yatsu_fixture(note='Changed in Yatsu',changed=1000));self.migrate()
        expect(self.page.get_by_role('button',name='Use imported data for '+TITLE,exact=True)).to_be_visible()
        rows=self.stores('books',['readerImportRecord'])['readerImportRecord']
        self.assertEqual('Edited locally',next(r for r in rows if r['part']=='notes')['body'])
        self.page.get_by_role('button',name='Use imported data for '+TITLE,exact=True).click()
        expect(self.page.get_by_label('Choose Yatsu backup ZIPs',exact=True)).to_be_enabled()
        rows=self.stores('books',['readerImportRecord'])['readerImportRecord']
        self.assertEqual('Changed in Yatsu',next(r for r in rows if r['part']=='notes')['body'])

    def test_yatsu_settings_are_explicit_and_do_not_enable_connections(self):
        files=archive_files(yatsu_fixture())
        files['yatsu-local-settings.json']=dict(app='Yatsu Reader',schemaVersion=1,settings={
            'fontSize':26,'writingMode':'horizontal-tb','autoReplication':True,'webdavPassword':'never-import'})
        self.open_migration(zip_bytes(files))
        settings=self.page.get_by_role('article').filter(has_text='Safe reader settings')
        self.assertEqual(1,settings.count())
        self.assertFalse(settings.get_by_role('checkbox').is_checked())
        self.page.get_by_text('Data to import',exact=True).click()
        self.page.get_by_label('Safe reader settings (optional)',exact=True).check()
        settings.get_by_role('checkbox').check()
        self.migrate()
        self.assertEqual('26',self.page.evaluate("localStorage.getItem('fontSize')"))
        self.assertIsNone(self.page.evaluate("localStorage.getItem('webdavPassword')"))
        self.assertNotEqual('true',self.page.evaluate("localStorage.getItem('autoReplication')"))
        self.assertEqual([],self.stores('manabi-reader-integrations',['books'])['books'])

    def sync_dav(self):
        before=len(self.dav.state['requests'])
        self.page.get_by_role('button',name='Sync WebDAV offline book',exact=True).click()
        deadline=time.monotonic()+20
        while len(self.dav.state['requests'])==before:
            self.assertLess(time.monotonic(),deadline,'Sync did not reach the WebDAV fixture')
            self.page.wait_for_timeout(20)
        expect(self.page.get_by_text('Reading position, statistics, annotations and imported notes synced directly with WebDAV.',exact=True)).to_be_visible()

    def establish_dav_state(self):
        self.connect_dav(writable=True);self.seed_resume()
        self.page.get_by_label('Sync this book’s reading data with WebDAV',exact=True).check()
        self.sync_dav()
        return next(n for n in self.dav.state['files'] if n.endswith('.json'))

    def test_webdav_disjoint_merge_and_same_field_conflict_require_a_choice(self):
        path=self.establish_dav_state()
        remote=json.loads(self.dav.state['files'][path]);remote['records']['resume']['exploredCharCount']=9
        remote['records']['resume']['lastBookmarkModified']=STAMP+10
        day=dict(dateKey='2026-09-23',charactersRead=5,readingTime=10,minReadingSpeed=1800,
            altMinReadingSpeed=1800,lastReadingSpeed=1800,maxReadingSpeed=1800,lastStatisticModified=STAMP)
        remote['records']['statistics/2026-09-23']=day
        self.dav.state['files'][path]=json.dumps(remote).encode()
        self.seed_resume(6,STAMP+20)
        self.page.get_by_role('button',name='Sync WebDAV offline book',exact=True).click()
        expect(self.page.get_by_role('button',name='Use WebDAV conflicts',exact=True)).to_be_visible()
        self.assertEqual(6,self.stores('books',['bookmark'])['bookmark'][0]['exploredCharCount'])
        self.assertEqual(1,self.dav.state['puts'])
        self.page.get_by_role('button',name='Keep device conflicts',exact=True).click()
        expect(self.page.get_by_text('Reading position, statistics, annotations and imported notes synced directly with WebDAV.',exact=True)).to_be_visible()
        after=json.loads(self.dav.state['files'][path])
        self.assertEqual(6,after['records']['resume']['exploredCharCount'])
        self.assertIn('statistics/2026-09-23',after['records'])
        self.assertEqual(1,len(self.stores('books',['readerStatistic'])['readerStatistic']))

    def test_webdav_does_not_apply_behind_another_reader_tab(self):
        self.connect_dav(writable=True);self.seed_resume()
        self.page.get_by_label('Sync this book’s reading data with WebDAV',exact=True).check()
        other=self.context.new_page()
        other.goto(self.origin+'/reader-web/b?id=1')
        expect(other.get_by_text('WEBDAV_SEARCH_NEEDLE 本を読む。',exact=True)).to_be_visible()
        self.page.get_by_role('button',name='Sync WebDAV offline book',exact=True).click()
        expect(self.page.get_by_text('A book is open in another tab. Return all reader tabs to the Library before syncing reading data.',exact=True)).to_be_visible()
        self.assertEqual(0,self.dav.state['puts'])
        other.close()
        # Closing a Playwright page acknowledges its UI closure, not the browser
        # process releasing its locks. Poll actual ownership, never a settling sleep.
        deadline = time.monotonic() + 10
        while any(lock['name'] == 'manabi-webdav-reader-lifetime-v1'
                  for lock in self.page.evaluate('navigator.locks.query()')['held']):
            self.assertLess(time.monotonic(), deadline, 'Closed reader retained its lease')
            self.page.wait_for_timeout(20)
        self.sync_dav();self.assertEqual(1,self.dav.state['puts'])

    def test_webdav_etag_conflict_does_not_advance_acknowledgement(self):
        path=self.establish_dav_state()
        before=self.stores('books',['readerExternalSync','bookmark'])
        self.seed_resume(7,STAMP+1);self.dav.state['conflict']=True
        self.page.get_by_role('button',name='Sync WebDAV offline book',exact=True).click()
        expect(self.page.get_by_role('article',name='Reading sync for WebDAV offline book',exact=True).get_by_text(re.compile('changed|conflict',re.I)).last).to_be_visible()
        self.assertEqual(before['readerExternalSync'],self.stores('books',['readerExternalSync'])['readerExternalSync'])
        self.assertEqual(4,json.loads(self.dav.state['files'][path])['records']['resume']['exploredCharCount'])
        self.assertEqual(7,self.stores('books',['bookmark'])['bookmark'][0]['exploredCharCount'])
        self.dav.state['conflict']=False;self.sync_dav()
        self.assertEqual(7,json.loads(self.dav.state['files'][path])['records']['resume']['exploredCharCount'])

    def test_webdav_missing_strong_etag_never_overwrites(self):
        path=self.establish_dav_state();before=self.dav.state['files'][path]
        self.seed_resume(7,STAMP+1);self.dav.state['etag']=False
        self.page.get_by_role('button',name='Sync WebDAV offline book',exact=True).click()
        expect(self.page.get_by_text('Expose a strong ETag response header in the WebDAV server’s CORS configuration.',exact=True)).to_be_visible()
        self.assertEqual(before,self.dav.state['files'][path]);self.assertEqual(1,self.dav.state['puts'])

    def test_webdav_disconnect_keeps_book_and_erases_connection_password(self):
        self.connect_dav()
        self.page.get_by_role('button',name='Disconnect Test DAV',exact=True).click()
        expect(self.page.get_by_role('button',name='Browse Test DAV',exact=True)).to_have_count(0)
        self.assertEqual(1,len(self.stores('books',['data'])['data']))
        db=self.stores('manabi-reader-integrations',['metadata','books'])
        self.assertNotIn('test-password',json.dumps(db))
        self.assertEqual([],db['books'])
        self.go_library();expect(self.page.get_by_role('button',name='Read WebDAV offline book',exact=True)).to_be_visible()

    def test_search_phone_layout_has_two_sections_and_no_horizontal_overflow(self):
        self.import_book('A long searchable title 日本語',body='<p>日本語の長い検索結果です。</p>')
        self.page.set_viewport_size(dict(width=390,height=844))
        self.search('日本語')
        expect(self.page.get_by_role('button',name='Open passage in A long searchable title 日本語: 日本語',exact=True)).to_be_visible()
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
        sections=self.page.locator('.library-search > section')
        self.assertEqual(2,sections.count())
        self.assertLess(sections.nth(0).bounding_box()['y'],sections.nth(1).bounding_box()['y'])



    def test_yatsu_author_and_series_import_without_physical_moves(self):
        files=archive_files(yatsu_fixture())
        name=next(n for n in files if '/bookmeta_' in n)
        meta=json.loads(files[name]);meta.update(author='試験 作家',series='物語全集',seriesPosition='2.5')
        files[name]=meta
        self.open_migration(zip_bytes(files));self.migrate()
        record=self.stores('books',['data'])['data'][0]
        self.assertEqual([{'name':'試験 作家'}],record['creators'])
        self.assertEqual('2.5',record['manabiTtuImport']['yatsuMetadata']['seriesPosition'])
        org=self.stores('manabi-reader-integrations',['metadata'])['metadata']
        organization=next(row for row in org if isinstance(row,dict) and 'collections' in row)
        self.assertIn('物語全集',[c['name'] for c in organization['collections']])
        self.go_library();self.search('試験 作家')
        expect(self.page.get_by_role('button',name='Read '+TITLE,exact=True)).to_be_visible()

    def test_webdav_two_devices_annotations_converge_without_revision_churn(self):
        self.establish_dav_state()
        self.page.get_by_role('link',name='Read WebDAV offline book',exact=True).click()
        self.page.get_by_role('button',name='Show reading controls',exact=True).click()
        self.page.get_by_role('button',name='Bookmarks and Notes',exact=True).click()
        self.page.get_by_role('button',name='Add Bookmark',exact=True).click()
        self.wait_rows('readerAnnotation',lambda rows:len(rows)==1)
        self.page.goto(self.origin+'/reader-web/connections');self.sync_dav()
        page_a=self.page
        # Use two durable device profiles, as for device A. WebKit's ephemeral
        # context cannot store Blob values in this runtime (even in a bare IDB
        # transaction); that capability failure has a separate rollback regression.
        profile_b = tempfile.TemporaryDirectory()
        device_b = getattr(self.playwright, self.engine).launch_persistent_context(
            profile_b.name, viewport=dict(width=1200,height=900))
        device_b.add_init_script("localStorage.setItem('manabi-reader-dictionary-setup-v1','skip')")
        try:
            self.page=device_b.new_page()
            self.page.on('pageerror',lambda e:self.errors.append(str(e)))
            self.connect_dav(writable=True)
            self.page.get_by_label('Sync this book’s reading data with WebDAV',exact=True).check()
            self.sync_dav()
            self.wait_rows('readerAnnotation',lambda rows:len(rows)==1)
            self.page.evaluate("""()=>new Promise((resolve,reject)=>{const o=indexedDB.open('books');o.onsuccess=()=>{
              const db=o.result,tx=db.transaction('readerAnnotation','readwrite');tx.store=tx.objectStore('readerAnnotation');
              tx.store.getAll().onsuccess=e=>{const a=e.target.result[0];a.revision=99;a.label='Changed on device B';a.modifiedAt='2026-09-25T06:00:00.000Z';tx.store.put(a)};
              tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}})""")
            self.sync_dav()
            page_b=self.page;self.page=page_a;self.sync_dav()
            rows=self.stores('books',['readerAnnotation'])['readerAnnotation']
            self.assertEqual('Changed on device B',rows[0]['label'])
            puts=self.dav.state['puts']
            self.sync_dav();self.page=page_b;self.sync_dav()
            self.assertEqual(puts,self.dav.state['puts'],'Unchanged local revision numbers must not cause reuploads')
        finally:
            self.page=page_a;device_b.close();profile_b.cleanup()

    def test_webdav_rejects_directory_escape_without_sending_credentials_to_it(self):
        self.connect_dav();self.dav.state['evil']=True
        self.page.get_by_role('button',name='Browse Test DAV',exact=True).click()
        expect(self.page.get_by_text('WebDAV returned a path outside the selected folder.',exact=True)).to_be_visible()
        self.assertFalse(any(path.startswith('/outside') for _,path,_ in self.dav.state['requests']))

    def test_repeated_yatsu_import_does_not_restore_removed_collection_membership(self):
        self.open_migration();self.migrate()
        self.page.evaluate("""()=>new Promise((resolve,reject)=>{const o=indexedDB.open('manabi-reader-integrations');o.onsuccess=()=>{
          const db=o.result,tx=db.transaction('metadata','readwrite'),st=tx.objectStore('metadata');
          st.get('books-organization-v1').onsuccess=e=>{const org=e.target.result;org.collections.forEach(c=>c.members=[]);st.put(org,'books-organization-v1')};
          tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}})""")
        self.open_migration();self.migrate()
        rows=self.stores('manabi-reader-integrations',['metadata'])['metadata']
        org=next(r for r in rows if isinstance(r,dict) and 'collections' in r)
        self.assertTrue(all(not c['members'] for c in org['collections']))

    def test_webdav_requires_real_cors_permission(self):
        self.dav.state['cors'] = False
        self.context.add_init_script("window.corsUnhandled = []; addEventListener('unhandledrejection', e => window.corsUnhandled.push(String(e.reason)))")
        self.configure_dav()
        expect(self.page.get_by_text(re.compile(r'^Cannot reach WebDAV\.'))).to_be_visible()
        if self.engine == 'chromium':
            self.assertGreater(self.dav.state['preflights'], 0)
        self.assertEqual([], self.stores('manabi-reader-integrations', ['books'])['books'])
        expect(self.page.get_by_role('button', name='Browse Test DAV', exact=True)).to_have_count(0)
        self.assertEqual([], self.page.evaluate('window.corsUnhandled'))
        # WebKit reports its native network access-control diagnostic as a
        # pageerror even when fetch rejection was handled. Admit only this
        # request's exact denial; all JS/unrelated errors still fail teardown.
        if self.engine == 'webkit':
            denial = '/' + urlsplit(self.dav_url).netloc + '/Books/ due to access control checks.'
            self.errors[:] = [message for message in self.errors if message != denial]

    def test_webdav_disconnect_during_import_never_restores_source_link(self):
        self.connect_dav(import_book=False)
        gate = threading.Event()
        self.dav.state.update(book_get_gate=gate, get_started=threading.Event())
        other = self.context.new_page()
        try:
            self.page.get_by_role('button', name='Import Offline.epub', exact=True).click()
            deadline = time.monotonic() + 10
            while not self.dav.state['get_started'].is_set():
                self.assertLess(time.monotonic(), deadline)
                self.page.wait_for_timeout(20)
            other.goto(self.origin + '/reader-web/connections')
            other.get_by_role('button', name='Disconnect Test DAV', exact=True).click()
            expect(other.get_by_role('button', name='Browse Test DAV', exact=True)).to_have_count(0)
            gate.set()
            expect(self.page.get_by_text('This WebDAV connection changed during import. The book was kept locally, but not reconnected.', exact=True)).to_be_visible()
            self.assertEqual([], self.stores('manabi-reader-integrations', ['books'])['books'])
            self.assertEqual(1, len(self.stores('books', ['data'])['data']))
        finally:
            gate.set()
            other.close()

    def test_webdav_book_storage_abort_is_reported_without_unhandled_rejection(self):
        self.connect_dav(import_book=False)
        # Fault only the real IDB transaction. No alternative persistence path.
        self.page.evaluate("""() => {
          const add = IDBObjectStore.prototype.add;
          IDBObjectStore.prototype.add = function(...args) {
            const request = add.apply(this, args);
            if (this.name === 'data') {
              IDBObjectStore.prototype.add = add;
              this.transaction.abort();
            }
            return request;
          };
        }""")
        self.page.get_by_role('button', name='Import Offline.epub', exact=True).click()
        expect(self.page.get_by_role('button', name='Import Offline.epub', exact=True)).to_be_enabled()
        expect(self.page.get_by_role('link', name='Read WebDAV offline book', exact=True)).to_have_count(0)
        self.assertEqual([], self.stores('books', ['data'])['data'])
        self.assertEqual([], self.stores('manabi-reader-integrations', ['books'])['books'])
        self.page.get_by_role('button', name='Import Offline.epub', exact=True).click()
        expect(self.page.get_by_role('link', name='Read WebDAV offline book', exact=True)).to_be_visible()
        self.assertEqual(1, len(self.stores('books', ['data'])['data']))
        self.assertEqual([], self.errors)

    def start_held_dav_sync(self):
        self.establish_dav_state()
        self.seed_resume(7, STAMP + 1)
        gate = threading.Event()
        self.dav.state.update(put_gate=gate, put_started=threading.Event())
        self.page.get_by_role('button', name='Sync WebDAV offline book', exact=True).click()
        deadline = time.monotonic() + 10
        while not self.dav.state['put_started'].is_set():
            self.assertLess(time.monotonic(), deadline, 'WebDAV write did not begin')
            self.page.wait_for_timeout(20)
        return gate

    def wait_source_operation_queued(self):
        deadline = time.monotonic() + 10
        while not any(lock['name'].startswith('manabi-reader:webdav-source:')
                      for lock in self.page.evaluate('navigator.locks.query()')['pending']):
            self.assertLess(time.monotonic(), deadline, 'Source change bypassed the active sync')
            self.page.wait_for_timeout(20)

    def test_disconnect_waits_for_inflight_sync_and_cannot_finish_before_its_commit(self):
        gate = self.start_held_dav_sync()
        other = self.context.new_page()
        try:
            other.goto(self.origin + '/reader-web/connections')
            other.get_by_role('button', name='Disconnect Test DAV', exact=True).click()
            self.wait_source_operation_queued()
            self.assertEqual(1, len(self.stores('manabi-reader-integrations', ['books'])['books']))
            gate.set()
            expect(other.get_by_role('button', name='Browse Test DAV', exact=True)).to_have_count(0)
            self.assertEqual([], self.stores('manabi-reader-integrations', ['books'])['books'])
            self.assertEqual(7, self.stores('books', ['bookmark'])['bookmark'][0]['exploredCharCount'])
            # The previous operation finished before disconnect completion; a new
            # manual sync from the stale tab must neither reconnect nor upload.
            puts = self.dav.state['puts']
            self.page.get_by_role('button', name='Sync WebDAV offline book', exact=True).click()
            expect(self.page.get_by_role('button', name='Sync WebDAV offline book', exact=True)).to_be_enabled()
            self.assertEqual(puts, self.dav.state['puts'])
        finally:
            gate.set(); other.close()

    def test_disable_sync_waits_for_active_operation_and_blocks_the_next_write(self):
        gate = self.start_held_dav_sync()
        other = self.context.new_page()
        try:
            other.goto(self.origin + '/reader-web/connections')
            other.get_by_label('Sync this book’s reading data with WebDAV', exact=True).uncheck()
            self.wait_source_operation_queued()
            gate.set()
            expect(other.get_by_text('WebDAV reading sync is off.', exact=True)).to_be_visible()
            links = self.stores('manabi-reader-integrations', ['books'])['books']
            self.assertFalse(links[0]['syncEnabled'])
            puts = self.dav.state['puts']
            self.seed_resume(9, STAMP + 2)
            self.page.get_by_role('button', name='Sync WebDAV offline book', exact=True).click()
            expect(self.page.get_by_text('Enable WebDAV reading sync for this book first.', exact=True)).to_be_visible()
            self.assertEqual(puts, self.dav.state['puts'])
        finally:
            gate.set(); other.close()


    def test_removing_write_permission_disables_book_consent_atomically(self):
        self.establish_dav_state()
        self.page.get_by_role('button', name='Unlock or edit Test DAV', exact=True).click()
        expect(self.page.get_by_label('WebDAV folder URL', exact=True)).to_be_disabled()
        expect(self.page.get_by_label('Username', exact=True)).to_be_disabled()
        self.page.get_by_label('Allow reading-data write-back in .manabi-reader', exact=True).uncheck()
        self.page.get_by_role('button', name='Test and save WebDAV', exact=True).click()
        expect(self.page.get_by_label('Sync this book’s reading data with WebDAV', exact=True)).not_to_be_checked()
        links = self.stores('manabi-reader-integrations', ['books'])['books']
        self.assertFalse(links[0]['syncEnabled'])
        self.assertEqual(1, self.dav.state['puts'])

    def test_mismatched_webdav_root_cannot_retarget_saved_reading_data(self):
        self.establish_dav_state()
        self.page.evaluate("""() => new Promise((resolve, reject) => {
          const request = indexedDB.open('manabi-reader-integrations');
          request.onsuccess = () => {
            const db = request.result, tx = db.transaction('metadata', 'readwrite'), store = tx.objectStore('metadata');
            store.openCursor().onsuccess = event => {
              const cursor = event.target.result;
              if (!cursor) return;
              if (String(cursor.key).startsWith('webdav-source:'))
                cursor.update({...cursor.value, url: cursor.value.url.replace('/Books/', '/Other/')});
              cursor.continue();
            };
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onabort = () => reject(tx.error);
          };
        })""")
        self.page.reload()
        self.page.get_by_role('button', name='Sync WebDAV offline book', exact=True).click()
        expect(self.page.get_by_text('This book belongs to a different WebDAV folder. Reimport it from the selected folder before enabling sync.', exact=True)).to_be_visible()
        self.assertEqual(1, self.dav.state['puts'])
        self.assertFalse(any(path.startswith('/Other/') for _, path, _ in self.dav.state['requests']))


if __name__ == "__main__":
    unittest.main(verbosity=2)
