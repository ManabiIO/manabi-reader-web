"""Real static application, worker, ZIP migration and HTTPS WebDAV qualification.

The server may delay or fail a worker resource; no replacement Worker, fetch,
IndexedDB, reader UI, migration engine, or WebDAV client is installed.
"""
import base64
from http.server import BaseHTTPRequestHandler
import io
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
import tempfile
import threading
import unittest
import zipfile
from urllib.parse import urlsplit, unquote
from xml.sax.saxutils import escape
from playwright.sync_api import sync_playwright, expect
from test_static_reader import StaticHandler, ThreadingHTTPServer, ROOT
from test_books_library import book

FIXTURE_TITLE = 'Manabi Yatsu Portability Fixture'


def zip_bytes(files):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, value in files.items():
            archive.writestr(name, value if isinstance(value, (bytes, str)) else json.dumps(value, ensure_ascii=False))
    return buffer.getvalue()


def yatsu_fixture(modified_note='A note about the whole book.'):
    path = Path(__file__).resolve().parents[1] / 'fixtures/yatsu/complete-local-backup-v11.zip'
    with zipfile.ZipFile(path) as archive:
        files = {name: archive.read(name) for name in archive.namelist() if not name.endswith('/')}
    folder = next(name.rsplit('/', 1)[0] for name in files if '/bookdata_' in name)
    stamp = 1790212589799
    files[f'{folder}/notes_1_11_{stamp}.json'] = [dict(bookTitle=FIXTURE_TITLE, syncId='synthetic-note', title='Whole-book thoughts', text=modified_note, dateCreated=stamp, dateModified=stamp)]
    files[f'{folder}/highlights_1_11_{stamp}.json'] = [dict(bookTitle=FIXTURE_TITLE, text='移行テスト', startOffset=4, endOffset=9, prefixContext='これは', suffixContext='用の短い文章です。', color='blue', dateCreated=stamp, note='<script>not executed</script>')]
    settings=json.loads(files['yatsu-local-settings.json'])
    settings['settings']['fontSize']=24
    settings['settings']['webdavPassword']='SHOULD_NOT_BE_IMPORTED'
    files['yatsu-local-settings.json']=settings
    return zip_bytes(files)


class PortabilityHandler(StaticHandler):
    worker_gate = None
    worker_started = None
    worker_failure = False

    def do_GET(self):
        if '/_app/immutable/workers/worker-' in self.path:
            if type(self).worker_started: type(self).worker_started.set()
            if type(self).worker_gate: type(self).worker_gate.wait(15)
            if type(self).worker_failure:
                self.send_error(503)
                return
        super().do_GET()


class DAVHandler(BaseHTTPRequestHandler):
    files = {}
    calls = []
    cors = True
    malicious = False

    def log_message(self, *args): pass

    def reply(self, code, body=b'', mime='application/octet-stream'):
        self.send_response(code)
        if type(self).cors:
            self.send_header('Access-Control-Allow-Origin', self.headers.get('Origin', '*'))
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Methods', 'OPTIONS, PROPFIND, GET, PUT')
            self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Depth, If-None-Match')
            self.send_header('Access-Control-Expose-Headers', 'ETag')
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('ETag', '"fixture"')
        self.end_headers()
        if body:
            try: self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError): pass

    def authorized(self):
        type(self).calls.append((self.command, self.path, dict(self.headers)))
        if self.headers.get('Authorization') != 'Basic ' + base64.b64encode(b'user:app-password').decode():
            self.reply(401)
            return False
        return True

    def do_OPTIONS(self): self.reply(204)

    def do_PROPFIND(self):
        if not self.authorized(): return
        if self.path != '/books/': self.reply(404); return
        entries = [('/books/', True, 0)] + [(name, False, len(data)) for name, data in type(self).files.items()]
        if type(self).malicious: entries.append(('/outside/stolen.txt', False, 1))
        xml = '<d:multistatus xmlns:d="DAV:">' + ''.join(
            f'<d:response><d:href>{escape(name)}</d:href><d:propstat><d:prop><d:resourcetype>{"<d:collection/>" if folder else ""}</d:resourcetype><d:getcontentlength>{length}</d:getcontentlength><d:getetag>"fixture"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>'
            for name, folder, length in entries) + '</d:multistatus>'
        self.reply(207, xml.encode(), 'application/xml')

    def do_GET(self):
        if not self.authorized(): return
        data = type(self).files.get(self.path)
        self.reply(404 if data is None else 200, data or b'')

    def do_PUT(self):
        if not self.authorized(): return
        payload = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        if self.headers.get('If-None-Match') != '*': self.reply(428); return
        if self.path in type(self).files: self.reply(412); return
        type(self).files[self.path] = payload
        self.reply(201)


class LibraryPortability(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),PortabilityHandler)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True); cls.thread.start()
        cls.origin=f'http://127.0.0.1:{cls.server.server_port}'
        cls.temp=tempfile.TemporaryDirectory()
        cert=Path(cls.temp.name)/'cert.pem'; key=Path(cls.temp.name)/'key.pem'
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        cls.dav=ThreadingHTTPServer(('127.0.0.1',0),DAVHandler)
        tls=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); tls.load_cert_chain(cert,key)
        cls.dav.socket=tls.wrap_socket(cls.dav.socket,server_side=True)
        cls.davthread=threading.Thread(target=cls.dav.serve_forever,daemon=True); cls.davthread.start()
        cls.davurl=f'https://127.0.0.1:{cls.dav.server_port}/books/'
        cls.playwright=sync_playwright().start()
        engine=os.environ.get('LIBRARY_BROWSER','chromium')
        options={}
        if engine=='chromium' and os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE'): options['executable_path']=os.environ['PLAYWRIGHT_CHROMIUM_EXECUTABLE']
        cls.browser=getattr(cls.playwright,engine).launch(**options)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.playwright.stop()
        for server,thread in [(cls.server,cls.thread),(cls.dav,cls.davthread)]: server.shutdown(); server.server_close(); thread.join()
        cls.temp.cleanup()

    def setUp(self):
        PortabilityHandler.worker_gate=None; PortabilityHandler.worker_failure=False; PortabilityHandler.worker_started=None
        DAVHandler.files={'/books/remote.epub':book('Remote library book',body='<p>A remote Japanese book 日本語</p>'),'/books/backup.zip':yatsu_fixture()}
        DAVHandler.calls=[]; DAVHandler.cors=True; DAVHandler.malicious=False
        self.context=self.browser.new_context(viewport={'width':1100,'height':850},accept_downloads=True,ignore_https_errors=True,service_workers='block')
        self.page=self.context.new_page(); self.page.set_default_timeout(20000)
        self.errors=[]; self.page.on('pageerror',lambda error:self.errors.append(str(error)))
        self.page.add_init_script("localStorage.setItem('manabi-reader-dictionary-setup-v1','skip');")

    def tearDown(self):
        if PortabilityHandler.worker_gate: PortabilityHandler.worker_gate.set()
        output=Path(os.environ.get('PORTABILITY_ARTIFACTS','/tmp/library-portability-browser')); output.mkdir(parents=True,exist_ok=True)
        try:
            self.page.screenshot(path=str(output/(self._testMethodName+'.png')),full_page=True)
            (output/(self._testMethodName+'.json')).write_text(json.dumps({'pageErrors':self.errors,'url':self.page.url}))
        finally: self.context.close()

    def visit(self,path='manage'):
        self.page.goto(self.origin+'/Reader-Web/'+path)
        self.page.wait_for_function("() => indexedDB.databases().then(d=>d.some(x=>x.name==='books'&&x.version===9))")

    def import_book(self,title,body):
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files({'name':title+'.epub','mimeType':'application/epub+zip','buffer':book(title,body=body)})
        expect(self.page.get_by_role('button',name='Read '+title,exact=True)).to_be_visible()

    def snapshot(self):
        return self.page.evaluate("""() => new Promise((resolve,reject)=> {const open=indexedDB.open('books'); open.onerror=()=>reject(open.error);open.onsuccess=()=> {const db=open.result; const tx=db.transaction(['data','bookmark','statistic','readerStatistic','readingGoal']);const results={};for(const name of tx.objectStoreNames){const read=tx.objectStore(name).getAll();read.onsuccess=()=>results[name]=read.result;}tx.oncomplete=()=>{db.close();resolve(results)};tx.onerror=()=>reject(tx.error)}})""")

    def search(self,text): self.page.get_by_role('searchbox',name='Search library',exact=True).fill(text)

    def test_metadata_opens_while_content_worker_is_delayed(self):
        self.visit(); self.import_book('Fast match','<p>slow text</p>')
        PortabilityHandler.worker_gate=threading.Event(); PortabilityHandler.worker_started=threading.Event()
        self.search('Fast')
        expect(self.page.get_by_role('heading',name=re.compile(r'^Books\b'))).to_be_visible()
        expect(self.page.get_by_role('heading',name='Content',exact=True)).to_be_visible()
        expect(self.page.get_by_role('button',name='Open Fast match',exact=True)).to_be_enabled()
        self.assertTrue(PortabilityHandler.worker_started.wait(10))
        self.page.get_by_role('button',name='Open Fast match',exact=True).click()
        expect(self.page).to_have_url(re.compile(r'/b\?id='))
        PortabilityHandler.worker_gate.set()
        expect(self.page.get_by_role('button',name='Show reading controls')).to_be_visible()
        self.assertEqual([],self.errors)

    def test_metadata_survives_worker_failure_and_content_retry(self):
        self.visit(); self.import_book('Independent book','<p>content needle 日本語</p>')
        PortabilityHandler.worker_failure=True; self.search('Independent')
        expect(self.page.get_by_role('button',name='Retry content search')).to_be_visible()
        expect(self.page.get_by_role('button',name='Open Independent book')).to_be_enabled()
        PortabilityHandler.worker_failure=False
        self.search('needle')
        self.page.get_by_role('button',name='Retry content search').click() if self.page.get_by_role('button',name='Retry content search').is_visible() else None
        expect(self.page.locator('[data-library-result=content]')).to_have_count(1)
        self.assertEqual([],self.errors)

    def test_content_matches_are_literal_unicode_and_navigate_as_preview(self):
        self.visit(); self.import_book('Search corpus','<p>Opening 日本語</p><p>前<ruby>猫<rt>ねこ</rt></ruby>𠮷　ＡＢＣ後</p><p hidden="">SECRET_HIDDEN</p>')
        self.search('abc')
        hit=self.page.locator('[data-library-result=content]'); expect(hit).to_have_count(1)
        expect(hit).to_contain_text('ＡＢＣ')
        before=self.snapshot()
        hit.click()
        expect(self.page.get_by_role('button',name='Return to where I was',exact=True)).to_be_visible(timeout=20000)
        after=self.snapshot()
        self.assertEqual(before['statistic'],after['statistic']); self.assertEqual(before['readerStatistic'],after['readerStatistic'])
        self.page.get_by_role('button',name='Return to where I was',exact=True).click()
        expect(self.page.get_by_role('button',name='Return to where I was',exact=True)).not_to_be_visible()
        self.assertEqual([],self.errors)

    def test_rapid_queries_discard_old_results_and_ime_does_not_search_partial_text(self):
        self.visit(); self.import_book('日本語の本','<p>猫 and dog</p>')
        self.search('猫'); self.search('dog')
        expect(self.page.locator('[data-library-result=content]')).to_have_count(1)
        expect(self.page.locator('[data-library-result=content] mark')).to_have_text('dog')
        search=self.page.get_by_role('searchbox',name='Search library',exact=True)
        search.dispatch_event('compositionstart'); search.fill('に')
        expect(self.page.locator('[data-library-result=content]')).to_have_count(0)
        search.evaluate("e => { e.value='日本語'; e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'日本語'})); }")
        expect(self.page.get_by_role('button',name='Open 日本語の本')).to_be_visible()
        search.press('ArrowDown'); expect(self.page.get_by_role('button',name='Open 日本語の本')).to_be_focused()
        self.assertEqual([],self.errors)

    def test_yatsu_all_study_categories_settings_and_repeat_import(self):
        self.visit('import-ttu?source=yatsu')
        picker=self.page.get_by_label('Choose Yatsu backup ZIPs',exact=True)
        payload={'name':'yatsu.zip','mimeType':'application/zip','buffer':yatsu_fixture()}
        picker.set_input_files(payload)
        row=self.page.get_by_role('article',name='Import '+FIXTURE_TITLE,exact=True)
        expect(row).to_contain_text('Saved Bookmarks: 1')
        expect(row).to_contain_text('Highlights: 1')
        expect(row).to_contain_text('Book Notes: 1')
        self.page.get_by_role('button',name='Import selected (1)',exact=True).click()
        expect(row.get_by_role('status')).to_have_text('Imported '+FIXTURE_TITLE+'.',timeout=60000)
        first=self.snapshot(); study=first['data'][0]['manabiImportedStudy']
        self.assertEqual(3,len(study['entries']))
        self.assertEqual(2,sum(bool(e.get('locator')) for e in study['entries']))
        self.assertFalse(any(e.get('locator') for e in study['entries'] if e['kind']=='notes'))
        self.assertNotEqual('24',self.page.evaluate("localStorage.getItem('fontSize')"),'settings must be opt-in')
        self.page.get_by_text('Data to import',exact=True).click()
        self.page.get_by_label('Safe Settings (optional)',exact=True).check()
        settings=self.page.get_by_role('article',name='Import Yatsu Settings',exact=True)
        settings.get_by_role('checkbox').check()
        self.page.get_by_role('button',name='Import selected (1)',exact=True).click()
        expect(settings.get_by_role('status')).to_have_text('Imported Yatsu Settings.')
        self.assertEqual('24',self.page.evaluate("localStorage.getItem('fontSize')"))
        self.assertNotIn('SHOULD_NOT_BE_IMPORTED',self.page.evaluate('JSON.stringify(localStorage)'))
        self.page.get_by_role('button',name='Clear list',exact=True).click(); picker.set_input_files(payload)
        self.page.get_by_role('button',name='Import selected (1)',exact=True).click()
        expect(self.page.get_by_role('article',name='Import '+FIXTURE_TITLE,exact=True).get_by_role('status')).to_have_text('Already imported; existing data kept.')
        self.assertEqual(first,self.snapshot())
        self.assertEqual([],self.errors)

    def test_yatsu_notes_are_editable_exportable_and_restorable_without_invented_bookmarks(self):
        self.visit('import-ttu?source=yatsu')
        self.page.get_by_label('Choose Yatsu backup ZIPs',exact=True).set_input_files({'name':'yatsu.zip','mimeType':'application/zip','buffer':yatsu_fixture()})
        self.page.get_by_role('button',name='Import selected (1)',exact=True).click()
        row=self.page.get_by_role('article',name='Import '+FIXTURE_TITLE,exact=True)
        expect(row.get_by_role('status')).to_have_text('Imported '+FIXTURE_TITLE+'.',timeout=60000)
        row.get_by_role('link',name='Read '+FIXTURE_TITLE).click()
        self.page.get_by_role('button',name='Show reading controls').click()
        self.page.get_by_role('button',name='Bookmarks and Notes',exact=True).click()
        panel=self.page.get_by_role('region',name='Imported from Yatsu',exact=True)
        expect(panel).to_be_visible()
        note=panel.locator('article').filter(has=self.page.get_by_text('Whole-book thoughts',exact=True))
        expect(note.get_by_role('button',name='Show in Book',exact=True)).to_have_count(0)
        note.get_by_role('button',name='Edit',exact=True).click()
        note.get_by_label('Book note',exact=True).fill('Edited in Manabi.')
        note.get_by_role('button',name='Save',exact=True).click()
        expect(note).to_contain_text('Edited in Manabi.')
        with self.page.expect_download() as download:
            panel.get_by_role('button',name='Export Imported Notes',exact=True).click()
        archive=Path(download.value.path()).read_bytes()
        self.assertIn('Edited in Manabi.',archive.decode())
        self.assertIn('A note about the whole book.',archive.decode(),'original source witness retained')
        note.get_by_role('button',name='Remove',exact=True).click()
        expect(panel.locator('article').filter(has=self.page.get_by_text('Whole-book thoughts',exact=True))).to_have_count(0)
        panel.get_by_label('Allow archive to replace conflicting imported notes').check()
        panel.get_by_label('Restore Imported Notes',exact=True).set_input_files({'name':'notes.json','mimeType':'application/json','buffer':archive})
        expect(panel.get_by_role('status')).to_have_text('Imported-note archive restored.')
        expect(panel).to_contain_text('Edited in Manabi.')
        self.assertEqual([],self.errors)

    def connect(self,writable=False,password='app-password'):
        self.visit('connections')
        self.page.get_by_role('button',name='Add WebDAV library',exact=True).click()
        form=self.page.get_by_role('form',name='Connect WebDAV',exact=True)
        form.get_by_label('Library name',exact=True).fill('My NAS')
        form.get_by_label('HTTPS folder URL',exact=True).fill(self.davurl)
        form.get_by_label('Username',exact=True).fill('user')
        form.get_by_label('App password',exact=True).fill(password)
        if writable: form.get_by_role('checkbox').check()
        form.get_by_role('button',name='Test and connect',exact=True).click()
        return form

    def test_webdav_direct_import_new_upload_conflict_and_lock(self):
        self.connect(writable=True)
        self.page.get_by_role('button',name='Browse My NAS',exact=True).click()
        self.page.get_by_role('button',name='Import remote.epub',exact=True).click()
        expect(self.page.get_by_role('link',name='Read Remote library book')).to_be_visible()
        upload=self.page.get_by_label('Upload new books or an exported backup',exact=True)
        upload.set_input_files({'name':'new.txt','mimeType':'text/plain','buffer':b'new content'})
        expect(self.page.get_by_role('button',name='Import new.txt',exact=True)).to_be_visible()
        self.assertEqual(b'new content',DAVHandler.files['/books/new.txt'])
        upload.set_input_files({'name':'new.txt','mimeType':'text/plain','buffer':b'overwrite attempt'})
        expect(self.page.get_by_role('status').filter(has_text='already exists')).to_be_visible()
        self.assertEqual(b'new content',DAVHandler.files['/books/new.txt'])
        self.assertEqual(['*','*'],[headers['If-None-Match'] for method,path,headers in DAVHandler.calls if method=='PUT'])
        self.assertNotIn('app-password',self.page.evaluate('JSON.stringify(localStorage)'))
        configs=self.page.evaluate("""() => new Promise(resolve=>{const o=indexedDB.open('manabi-reader-integrations');o.onsuccess=()=>{const d=o.result,t=d.transaction('metadata'),q=t.store??t.objectStore('metadata'),r=q.getAll();r.onsuccess=()=>{resolve(r.result);d.close()}}})""")
        self.assertNotIn('app-password',json.dumps(configs))
        self.page.reload()
        expect(self.page.get_by_role('article',name='WebDAV library My NAS')).to_contain_text('Locked')
        expect(self.page.get_by_role('button',name='Browse My NAS')).to_be_disabled()
        self.assertEqual(1,len(self.snapshot()['data']))
        self.assertEqual([],self.errors)

    def test_webdav_denied_auth_cors_and_escaped_root_are_reported_without_import(self):
        self.connect(password='wrong')
        expect(self.page.get_by_role('alert')).to_contain_text('access was denied')
        self.assertEqual([],self.snapshot()['data'])
        DAVHandler.cors=False
        form=self.page.get_by_role('form',name='Connect WebDAV',exact=True)
        form.get_by_label('App password',exact=True).fill('app-password')
        form.get_by_role('button',name='Test and connect',exact=True).click()
        expect(self.page.get_by_role('alert')).to_contain_text('CORS')
        DAVHandler.cors=True; DAVHandler.malicious=True
        form.get_by_label('App password',exact=True).fill('app-password')
        form.get_by_role('button',name='Test and connect',exact=True).click()
        expect(self.page.get_by_role('alert')).to_contain_text('outside the selected folder')
        self.assertFalse(any(path.startswith('/outside/') for _,path,_ in DAVHandler.calls))
        self.assertEqual([],self.snapshot()['data'])

    def test_webdav_backup_download_is_unchanged(self):
        self.connect(); self.page.get_by_role('button',name='Browse My NAS',exact=True).click()
        with self.page.expect_download() as download:
            self.page.get_by_role('button',name='Download backup backup.zip',exact=True).click()
        self.assertEqual(DAVHandler.files['/books/backup.zip'],Path(download.value.path()).read_bytes())
        self.assertEqual([],self.snapshot()['data'])
        self.assertFalse(any(method=='PUT' for method,_,_ in DAVHandler.calls))

if __name__=='__main__': unittest.main(verbosity=2)
