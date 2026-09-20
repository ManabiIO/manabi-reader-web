"""Real static Library UI, EPUB parsing, IndexedDB and browser filesystem acceptance.

No mocked storage, replaced picker, imported substitute UI or request interception.
Filesystem cases run on Chromium; the browser-only cases also run on WebKit.
"""
import base64
import io
import json
import os
import re
from pathlib import Path
import struct
import tempfile
import threading
import time
import unittest
import zipfile
import zlib
from http.server import ThreadingHTTPServer
from xml.sax.saxutils import escape
from playwright.sync_api import sync_playwright, expect
from test_static_reader import StaticHandler


def raster(width=240, height=360, color=(155, 75, 45)):
    def chunk(kind, value):
        return struct.pack('>I', len(value)) + kind + value + struct.pack('>I', zlib.crc32(kind + value) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress((b'\0' + bytes(color) * width) * height)) + chunk(b'IEND', b''))


def book(title, spine='', style='body{writing-mode:horizontal-tb}', body=None, size=(240, 360)):
    output = io.BytesIO()
    if body is None:
        body = '<h1>' + escape(title) + '</h1>' + '<p>日本語の本を読みます。文章を丁寧に読み進めます。</p>' * 180
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('mimetype', 'application/epub+zip')
        archive.writestr('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>')
        archive.writestr('OEBPS/book.opf', '<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">' + escape(title) + '</dc:title><dc:language xmlns:dc="http://purl.org/dc/elements/1.1/">ja</dc:language></metadata><manifest><item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/><item id="style" href="Styles/book.css" media-type="text/css"/><item id="cover" href="Images/cover.png" media-type="image/png" properties="cover-image"/></manifest><spine' + (' page-progression-direction="' + spine + '"' if spine else '') + '><itemref idref="chapter"/></spine></package>')
        archive.writestr('OEBPS/Text/chapter.xhtml', '<html><head><link rel="stylesheet" href="../Styles/book.css"/></head><body>' + body + '</body></html>')
        archive.writestr('OEBPS/Styles/book.css', style)
        archive.writestr('OEBPS/Images/cover.png', raster(*size))
    return output.getvalue()


class LibraryBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), StaticHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = 'http://127.0.0.1:' + str(cls.server.server_port)
        cls.playwright = sync_playwright().start()

    @classmethod
    def tearDownClass(cls):
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.profile = tempfile.TemporaryDirectory()
        self.engine = os.environ.get('LIBRARY_BROWSER', 'chromium')
        self.context = getattr(self.playwright, self.engine).launch_persistent_context(
            self.profile.name, viewport={'width': 1200, 'height': 900})
        self.page = self.context.pages[0]
        self.page.set_default_timeout(20000)
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(error.stack or str(error)))
        StaticHandler.probes.clear()
        self.go_library()

    def tearDown(self):
        output = Path('test-results')
        output.mkdir(exist_ok=True)
        try:
            self.page.screenshot(path=str(output / (self.engine + '-' + self._testMethodName + '.png')), full_page=True)
            (output / (self.engine + '-' + self._testMethodName + '.html')).write_text(self.page.content())
        finally:
            self.context.close()
            self.profile.cleanup()
        self.assertEqual([], self.errors)
        self.assertEqual([], StaticHandler.probes)

    def go_library(self):
        self.page.goto(self.origin + '/Reader-Web/manage')
        expect(self.page.locator('input[type=file][webkitdirectory]')).to_be_attached()
        expect(self.page.get_by_role('region', name='Library shelves')).to_have_attribute('aria-busy', 'false', timeout=30000)

    def import_book(self, title='Library test', **options):
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files(
            {'name': title + '.epub', 'mimeType': 'application/epub+zip', 'buffer': book(title, **options)})
        expect(self.page.get_by_role('button', name='Read ' + title, exact=True)).to_be_visible(timeout=30000)

    def tile(self, title):
        return self.page.locator('.shelf-item').filter(has=self.page.get_by_role('button', name='Read ' + title, exact=True))

    def menu(self, title, action):
        self.page.get_by_role('button', name='Actions for ' + title, exact=True).click()
        self.page.get_by_role('menuitem', name=action, exact=True).click()

    def dialog(self):
        return self.page.locator('[data-slot="dialog-content"]')

    def stores(self, database, names):
        return self.page.evaluate('''async ({database,names}) => {
          const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(database);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
          try {const tx=db.transaction(names),result={};
            await Promise.all(names.map(name=>new Promise((resolve,reject)=>{const r=tx.objectStore(name).getAll();r.onsuccess=()=>{result[name]=r.result;resolve();};r.onerror=()=>reject(r.error);})));return result;
          } finally {db.close();}
        }''', {'database': database, 'names': names})

    def wait_bookmark(self, data_id, predicate):
        # Playwright 1.63 wait_for_function treats a predicate Promise as truthy
        # before its eventual boolean result. Read committed rows and poll the
        # actual value with a bounded deadline, never a fixed settling sleep.
        deadline = time.monotonic() + 20
        while True:
            rows = self.stores('books', ['bookmark'])['bookmark']
            row = next((value for value in rows if value['dataId'] == data_id), None)
            if row is not None and predicate(row):
                return row
            self.assertLess(time.monotonic(), deadline, 'Bookmark condition not met: ' + repr(row))
            self.page.wait_for_timeout(25)

    def add_collection(self, title, name):
        self.menu(title, 'Add to Collection…')
        self.dialog().get_by_label('New collection name', exact=True).fill(name)
        self.dialog().get_by_role('button', name='Create', exact=True).click()
        expect(self.dialog().get_by_role('checkbox', name=name, exact=True)).to_be_checked()
        self.dialog().get_by_role('button', name='Done', exact=True).click()

    def choose_view(self, name):
        self.page.get_by_role('button', name='Library view options', exact=True).click()
        self.page.get_by_role('menuitemradio', name=name, exact=True).click()


class BooksLibraryBrowser(LibraryBase):
    def test_mobile_grid_list_fitted_covers_and_authored_binding(self):
        self.import_book('Left binding', spine='ltr', style='body{writing-mode:vertical-rl}')
        self.import_book('Right binding', spine='rtl', size=(180, 380))
        self.page.set_viewport_size({'width':390, 'height':844})
        for title, direction in [('Left binding', 'ltr'), ('Right binding', 'rtl')]:
            tile = self.tile(title)
            expect(tile.locator('.cover-stage')).to_have_attribute('data-direction', direction)
            tile.locator('img').evaluate('img => img.decode()')
            geometry = tile.locator('.book-thumbnail').evaluate('e => {const c=e.querySelector(".cover-surface");return [e.clientWidth,e.clientHeight,c.clientWidth,c.clientHeight];}')
            self.assertLessEqual(geometry[2], geometry[0] + 1)
            self.assertLessEqual(geometry[3], geometry[1] + 1)
            expect(tile.locator('.progress-label')).to_have_text('0%')
            expect(tile.get_by_role('img')).to_have_count(0)
        self.choose_view('List')
        expect(self.page.locator('.shelf-list')).to_be_visible()
        expect(self.tile('Right binding').get_by_role('heading', name='Right binding')).to_be_visible()
        self.page.reload()
        expect(self.page.locator('.shelf-list')).to_be_visible()
        self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), 391)
        self.choose_view('Grid')
        expect(self.page.locator('.shelf-grid')).to_be_visible()

    def test_compact_library_header_preserves_management_actions(self):
        self.import_book('Header book')
        self.page.set_viewport_size({'width':390, 'height':844})
        header = self.page.get_by_role('banner', name='Library toolbar')
        expect(self.page).to_have_title(re.compile(r'Library'))
        expect(header.get_by_role('heading', name='Library', exact=True)).to_be_visible()
        expect(header.get_by_role('button', name='Collections', exact=True)).to_be_visible()
        expect(header.get_by_role('button', name='Library actions', exact=True)).to_be_visible()
        for obsolete in ('Add books', 'Browser', 'Select books', 'Help', 'Navigate'):
            expect(header.get_by_role('button', name=obsolete, exact=True)).to_have_count(0)

        header.get_by_role('button', name='Library actions', exact=True).click()
        expect(self.page.get_by_role('menuitem', name='Select Books', exact=True)).to_be_visible()
        expect(self.page.get_by_role('menuitem', name='Add Books', exact=True)).to_be_visible()
        expect(self.page.get_by_role('menuitem', name='Accounts and Libraries', exact=True)).to_be_visible()
        expect(self.page.get_by_role('menuitem', name='Statistics', exact=True)).to_be_visible()
        expect(self.page.get_by_role('menuitem', name='Settings', exact=True)).to_be_visible()
        self.page.get_by_role('menuitem', name='Select Books', exact=True).click()
        expect(header.get_by_role('button', name='Cancel selection', exact=True)).to_be_visible()
        header.get_by_role('button', name='Cancel selection', exact=True).click()

        header.get_by_role('button', name='Collections', exact=True).click()
        expect(self.page.locator('[data-slot="sheet-content"]').get_by_role(
            'heading', name='Collections', exact=True)).to_be_visible()
        self.page.keyboard.press('Escape')
        expect(self.page.locator('[data-slot="sheet-content"]')).to_have_count(0)
        self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), 391)

    def test_direction_uses_css_cascade_not_language_and_ignores_hidden_text(self):
        self.import_book('Japanese horizontal')
        self.import_book('Japanese vertical', style='body{writing-mode:horizontal-tb} main.story{writing-mode:vertical-rl}', body='<main class="story">' + '<p>縦書きの文章を読みます。</p>' * 50 + '</main>')
        self.import_book('Hidden vertical', style='.hidden{display:none;writing-mode:vertical-rl}', body='<div class="hidden"><p>' + '隠された文章。' * 1000 + '</p></div><p>' + '横書きの本文。' * 100 + '</p>')
        self.import_book('Unresolved style', style='@import url(/attack-probe); body{writing-mode:vertical-rl}')
        self.import_book('Mixed directions', style='', body='<div style="writing-mode:vertical-rl">' + '文章。' * 100 + '</div><div style="writing-mode:horizontal-tb">' + '文章。' * 100 + '</div>')
        for title, expected in [('Japanese horizontal','ltr'),('Japanese vertical','rtl'),('Hidden vertical','ltr'),('Unresolved style','unknown'),('Mixed directions','unknown')]:
            expect(self.tile(title).locator('.cover-stage')).to_have_attribute('data-direction', expected)

    def test_finish_date_and_still_reading_preserve_progress_and_statistics(self):
        self.import_book()
        before = self.stores('books', ['bookmark','statistic'])
        self.menu('Library test', 'Mark as Finished')
        expect(self.tile('Library test').locator('.progress-label')).to_have_text('Finished')
        completed = self.stores('books', ['bookmark','statistic'])
        self.assertEqual(before['statistic'], completed['statistic'])
        self.assertEqual(0, completed['bookmark'][0]['progress'])
        self.menu('Library test', 'Edit Finished Date…')
        self.dialog().get_by_label('Finished on', exact=True).fill('2024-02-29')
        self.dialog().get_by_role('button', name='Save', exact=True).click()
        expect(self.dialog()).to_have_count(0)
        self.assertEqual('2024-02-29', self.stores('books',['bookmark'])['bookmark'][0]['completion']['finishedOn'])
        self.page.reload()
        expect(self.tile('Library test').locator('.progress-label')).to_have_text('Finished')
        self.menu('Library test', 'Mark as Still Reading')
        expect(self.tile('Library test').locator('.progress-label')).to_have_text('0%')
        still = self.stores('books', ['bookmark','statistic'])
        self.assertEqual(completed['statistic'], still['statistic'])
        self.assertEqual(0, still['bookmark'][0]['progress'])
        self.assertEqual('reading', still['bookmark'][0]['completion']['state'])
        self.assertNotIn('finishedOn', still['bookmark'][0]['completion'])

    def test_collections_are_many_to_many_and_deletion_does_not_delete_books(self):
        self.import_book('Collection book')
        self.add_collection('Collection book', 'Favorites')
        self.add_collection('Collection book', 'Japanese')
        self.page.reload()
        self.menu('Collection book', 'Add to Collection…')
        expect(self.dialog().get_by_role('checkbox', name='Favorites')).to_be_checked()
        expect(self.dialog().get_by_role('checkbox', name='Japanese')).to_be_checked()
        self.dialog().get_by_role('checkbox', name='Favorites').uncheck()
        expect(self.dialog().get_by_role('checkbox', name='Japanese')).to_be_checked()
        self.dialog().get_by_role('button', name='Done').click()
        self.page.get_by_role('button', name='Collections', exact=True).click()
        sheet = self.page.locator('[data-slot="sheet-content"]')
        sheet.get_by_role('button', name='Edit collections', exact=True).click()
        sheet.get_by_role('button', name='Rename collection Japanese', exact=True).click()
        self.dialog().get_by_label('Name', exact=True).fill('Reading in Japanese')
        self.dialog().get_by_role('button', name='Save', exact=True).click()
        expect(sheet.get_by_role('button', name='Rename collection Reading in Japanese', exact=True)).to_be_visible()
        sheet.get_by_role('button', name='Delete collection Reading in Japanese', exact=True).click()
        self.dialog().get_by_role('button', name='Delete Collection', exact=True).click()
        expect(self.dialog()).to_have_count(0)
        self.page.keyboard.press('Escape')
        expect(self.page.get_by_role('button', name='Read Collection book', exact=True)).to_be_visible()
        self.assertEqual(1, len(self.stores('books', ['data'])['data']))

    def test_existing_reader_autosaves_cannot_erase_library_finish_decision(self):
        self.import_book('Open reader')
        self.page.get_by_role('button', name='Read Open reader', exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false', timeout=30000)
        reader = self.page
        self.page = self.context.new_page()
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.go_library()
        self.menu('Open reader', 'Mark as Finished')
        expect(self.tile('Open reader').locator('.progress-label')).to_have_text('Finished')
        before = self.stores('books', ['bookmark'])['bookmark'][0]
        reader.bring_to_front()
        reader.keyboard.press('PageDown')
        # Let the existing three-second reader autosave actually persist. Do not
        # replace it with a direct database write or merely check unchanged data.
        after = self.wait_bookmark(before['dataId'],
            lambda row: row.get('lastBookmarkModified', 0) > before['lastBookmarkModified'])
        self.assertGreater(after['lastBookmarkModified'], before['lastBookmarkModified'])
        self.page.bring_to_front()
        self.assertEqual(before['completion'], after['completion'])
        self.menu('Open reader', 'Mark as Still Reading')
        expect(self.tile('Open reader').locator('.progress-label')).not_to_have_text('Finished')
        reader.close()


    def test_finished_and_custom_collections_filter_the_actual_library(self):
        self.import_book('Finished selection')
        self.import_book('Still reading selection')
        self.add_collection('Still reading selection', 'Personal selection')
        self.menu('Finished selection', 'Mark as Finished')
        expect(self.tile('Finished selection').locator('.progress-label')).to_have_text('Finished')
        def choose(name):
            self.page.get_by_role('button', name='Collections', exact=True).click()
            self.page.locator('[data-slot="sheet-content"]').get_by_role('button', name=re.compile('^' + re.escape(name) + r'\b')).click()
        choose('Finished')
        expect(self.page.get_by_role('heading', name='Finished', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Read Finished selection', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Read Still reading selection', exact=True)).to_have_count(0)
        choose('Personal selection')
        expect(self.page.get_by_role('heading', name='Personal selection', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Read Still reading selection', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Read Finished selection', exact=True)).to_have_count(0)
        self.page.reload()
        expect(self.page.get_by_role('button', name='Read Still reading selection', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Read Finished selection', exact=True)).to_have_count(0)
        choose('Books')
        expect(self.page.get_by_role('button', name='Read Finished selection', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Read Still reading selection', exact=True)).to_be_visible()

    def test_finished_date_and_binding_survive_real_export_migration_and_repeat(self):
        self.import_book('Portable finished book', spine='rtl')
        expect(self.tile('Portable finished book').locator('.cover-stage')).to_have_attribute('data-direction', 'rtl')
        self.menu('Portable finished book', 'Mark as Finished')
        expect(self.tile('Portable finished book').locator('.progress-label')).to_have_text('Finished')
        self.menu('Portable finished book', 'Edit Finished Date…')
        self.dialog().get_by_label('Finished on', exact=True).fill('2024-02-29')
        self.dialog().get_by_role('button', name='Save', exact=True).click()
        expect(self.dialog()).to_have_count(0)
        before = self.stores('books', ['bookmark','statistic','data'])
        self.page.get_by_role('button', name='Library actions', exact=True).click()
        self.page.get_by_role('menuitem', name='Select Books', exact=True).click()
        self.page.get_by_role('button', name='Select all', exact=True).click()
        expect(self.page.get_by_text('1 selected', exact=True)).to_be_visible()
        self.page.get_by_role('button', name='Export', exact=True).click()
        self.page.get_by_role('button', name='Zip File', exact=True).click()
        for label in ('Book Data','Bookmark','Statistics'):
            self.page.get_by_label(label, exact=True).check()
        with self.page.expect_download(timeout=60000) as pending:
            self.page.get_by_role('button', name='Start', exact=True).click()
        raw = Path(pending.value.path()).read_bytes()
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            name = next(name for name in archive.namelist() if '/bookdata_' in name)
            with zipfile.ZipFile(io.BytesIO(archive.read(name))) as content:
                static = json.loads(content.read('staticdata.json'))
                self.assertEqual({'value':'rtl','source':'spine'}, static['pageDirection'])
                self.assertEqual('ja', static['language'])
        original = self.page
        with tempfile.TemporaryDirectory() as profile:
            destination = getattr(self.playwright, self.engine).launch_persistent_context(profile)
            self.page = destination.pages[0]
            self.page.on('pageerror', lambda e: self.errors.append(str(e)))
            try:
                self.page.goto(self.origin + '/Reader-Web/import-ttu')
                chooser = self.page.get_by_label('Choose Ttu export ZIPs', exact=True)
                chooser.set_input_files({'name':'library-backup.zip','mimeType':'application/zip','buffer':raw})
                expect(chooser).to_be_enabled()
                self.page.get_by_role('button', name=re.compile(r'^Import selected \(')).click()
                imported = self.page.get_by_role('article', name='Import Portable finished book', exact=True)
                expect(imported.get_by_role('status')).to_have_text('Imported Portable finished book.', timeout=30000)
                migrated = self.stores('books', ['bookmark','statistic','data'])
                self.assertEqual(before['bookmark'][0]['completion'], migrated['bookmark'][0]['completion'])
                self.assertEqual(before['bookmark'][0]['progress'], migrated['bookmark'][0]['progress'])
                self.assertEqual(before['statistic'], migrated['statistic'])
                self.assertEqual(before['data'][0]['pageDirection'], migrated['data'][0]['pageDirection'])
                self.page.get_by_role('button', name='Select all', exact=True).click()
                self.page.get_by_role('button', name=re.compile(r'^Import selected \(')).click()
                expect(imported.get_by_role('status')).to_contain_text('Already imported', timeout=30000)
                self.assertEqual(migrated['bookmark'], self.stores('books', ['bookmark'])['bookmark'])
                self.go_library()
                expect(self.tile('Portable finished book').locator('.progress-label')).to_have_text('Finished')
                expect(self.tile('Portable finished book').locator('.cover-stage')).to_have_attribute('data-direction', 'rtl')
                self.page.reload()
                expect(self.tile('Portable finished book').locator('.progress-label')).to_have_text('Finished')
                self.assertEqual('2024-02-29', self.stores('books', ['bookmark'])['bookmark'][0]['completion']['finishedOn'])
            finally:
                Path('test-results').mkdir(exist_ok=True)
                self.page.screenshot(path='test-results/' + self.engine + '-portable-completion.png', full_page=True)
                destination.close()
                self.page = original


    def test_explicit_reader_completion_supersedes_still_reading(self):
        self.import_book('Finish once more')
        self.menu('Finish once more', 'Mark as Finished')
        expect(self.tile('Finish once more').locator('.progress-label')).to_have_text('Finished')
        self.menu('Finish once more', 'Mark as Still Reading')
        expect(self.tile('Finish once more').locator('.progress-label')).to_have_text('0%')
        before = self.stores('books', ['bookmark'])['bookmark'][0]
        self.assertEqual('reading', before['completion']['state'])
        self.page.get_by_role('button', name='Read Finish once more', exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false', timeout=30000)
        toolbar = self.page.get_by_role('banner', name='Reader toolbar')
        if not toolbar.is_visible():
            self.page.get_by_role('button', name='Show reading controls', exact=True).click()
        toolbar.get_by_role('button', name='Reading tools', exact=True).click()
        self.page.get_by_role('menuitem', name='Complete Book', exact=True).click()
        self.page.get_by_role('dialog').get_by_role('button', name='Confirm', exact=True).click()
        self.wait_bookmark(before['dataId'],
            lambda row: row.get('completion', {}).get('state') == 'finished')
        after = self.stores('books', ['bookmark','statistic'])
        self.assertEqual('finished', after['bookmark'][0]['completion']['state'])
        self.assertGreater(after['bookmark'][0]['completion']['modifiedAt'], before['completion']['modifiedAt'])
        self.assertTrue(any(row.get('completedBook') == 1 for row in after['statistic']))
        self.go_library()
        expect(self.tile('Finish once more').locator('.progress-label')).to_have_text('Finished')
        self.page.reload()
        expect(self.tile('Finish once more').locator('.progress-label')).to_have_text('Finished')


class BooksLibraryFilesystem(LibraryBase):
    def seed_files(self, files):
        self.page.goto(self.origin + '/Reader-Web/connections')
        expect(self.page.get_by_role('button', name='Refresh connections')).to_be_enabled()
        self.source_id = self.page.evaluate('''async files => {
          const handle=await (await navigator.storage.getDirectory()).getDirectoryHandle('Library fixture',{create:true});
          for(const [path,data] of Object.entries(files)) {const parts=path.split('/'),name=parts.pop();let dir=handle;for(const part of parts)dir=await dir.getDirectoryHandle(part,{create:true});const file=await dir.getFileHandle(name,{create:true});const w=await file.createWritable();await w.write(Uint8Array.from(atob(data),c=>c.charCodeAt(0)));await w.close();}
          const id='local-'+crypto.randomUUID();
          await new Promise((resolve,reject)=>{const r=indexedDB.open('manabi-reader-integrations',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('localLibraries','readwrite');tx.objectStore('localLibraries').put({id,name:'Library fixture',handle,writable:true});tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)};r.onerror=()=>reject(r.error)});
          return id;
        }''', {path: base64.b64encode(data).decode() for path,data in files.items()})
        self.go_library()

    def disk(self):
        return self.page.evaluate('''async () => {
          const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('Library fixture'),result={};
          async function visit(dir,prefix='') {for await(const [name,item] of dir.entries()){const path=prefix+name;if(item.kind==='directory')await visit(item,path+'/');else {const file=await item.getFile();result[path]=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map(n=>n.toString(16).padStart(2,'0')).join('');}}}
          await visit(root);return result;
        }''')

    def test_recursive_series_covers_filters_and_readonly_scanning(self):
        self.seed_files({'Wrapper/Volumes/1.epub':book('Volume 1'), 'Wrapper/Volumes/2.epub':book('Volume 2'),
            'Wrapper/Volumes/.Manabi-Reader.yaml':b'name: "Named series"\n',
            'Wrapper/Volumes/5.epub':book('Volume 5'),'Wrapper/Volumes/Nested/3.epub':book('Volume 3'),'Wrapper/Volumes/Nested/4.epub':book('Volume 4'),
            'Singleton/Deep/Only.epub':book('Single book')})
        before = self.disk()
        expect(self.page.get_by_role('button',name='Open series Named series',exact=True)).to_be_visible()
        expect(self.page.get_by_role('button',name='Read Single book',exact=True)).to_be_visible(timeout=30000)
        expect(self.page.get_by_role('button',name='Open series Wrapper',exact=True)).to_have_count(0)
        tile = self.page.locator('.shelf-item').filter(has=self.page.get_by_role('button',name='Open series Named series',exact=True))
        expect(tile.locator('.cover-stack')).to_have_attribute('data-cover-count','2')
        expect(tile.get_by_role('img',name='Local folder: Library fixture',exact=True)).to_be_visible()
        self.page.get_by_role('button',name='Open series Named series',exact=True).click()
        expect(self.page.locator('.series-hero .cover-stack')).to_have_attribute('data-cover-count','5')
        expect(self.page.get_by_role('button',name='Open series Nested',exact=True)).to_be_visible()
        expect(self.page.locator('.shelf-item').first).to_have_class(re.compile(r'\bseries-item\b'))
        self.choose_view('Descending')
        expect(self.page.locator('.shelf-item').first).to_have_class(re.compile(r'\bseries-item\b'))
        self.page.get_by_role('button',name='Open series Nested',exact=True).click()
        expect(self.page.get_by_role('button',name='Read Volume 3',exact=True)).to_be_visible(timeout=30000)
        self.menu('Volume 3','Mark as Finished')
        self.choose_view('Not Finished')
        expect(self.page.get_by_role('button',name='Read Volume 3',exact=True)).to_have_count(0)
        expect(self.page.get_by_role('button',name='Read Volume 4',exact=True)).to_be_visible()
        expect(self.page.get_by_role('heading',name='Nested',exact=True)).to_be_visible()
        self.assertEqual(before,self.disk())

    def test_combine_moves_actual_files_preserving_import_progress_membership_and_name(self):
        self.seed_files({'A/First.epub':book('First book'),'B/Second.epub':book('Second book')})
        expect(self.page.get_by_role('button',name='Read First book',exact=True)).to_be_visible(timeout=30000)
        self.menu('First book','Mark as Finished')
        expect(self.tile('First book').locator('.progress-label')).to_have_text('Finished')
        self.add_collection('First book','Kept collection')
        old_reading=self.stores('books',['bookmark','statistic'])
        old_links=self.stores('manabi-reader-integrations',['books'])['books']
        before=self.disk()
        self.page.get_by_role('button',name='Organize',exact=True).click()
        self.page.get_by_role('menuitem',name='Create Series from Books…',exact=True).click()
        self.dialog().get_by_label('Name',exact=True).fill('Combined')
        for checkbox in self.dialog().get_by_role('checkbox').all(): checkbox.check()
        self.dialog().get_by_role('button',name='Move into Series',exact=True).click()
        expect(self.dialog()).to_have_count(0,timeout=30000)
        expect(self.page.get_by_role('button',name='Open series Combined',exact=True)).to_be_visible()
        after=self.disk()
        self.assertEqual(before['A/First.epub'],after['Combined/First.epub'])
        self.assertEqual(before['B/Second.epub'],after['Combined/Second.epub'])
        self.assertNotIn('A/First.epub',after);self.assertNotIn('B/Second.epub',after)
        self.assertIn('Combined/.Manabi-Reader.yaml',after)
        self.assertFalse(any('operation-' in key for key in after))
        self.assertEqual(old_reading,self.stores('books',['bookmark','statistic']))
        new_links=self.stores('manabi-reader-integrations',['books'])['books']
        self.assertEqual(old_links[0]['id'],new_links[0]['id'])
        self.assertEqual(old_links[0]['bookId'],new_links[0]['bookId'])
        self.assertEqual('Combined/First.epub',new_links[0]['fileId'])
        self.page.get_by_role('button',name='Open series Combined',exact=True).click()
        self.menu('First book','Add to Collection…')
        expect(self.dialog().get_by_role('checkbox',name='Kept collection',exact=True)).to_be_checked()
        self.dialog().get_by_role('button',name='Done',exact=True).click()
        self.page.get_by_role('button',name='Actions for series Combined',exact=True).click()
        self.page.get_by_role('menuitem',name='Rename Series…',exact=True).click()
        self.dialog().get_by_label('Name',exact=True).fill('シリーズ')
        self.dialog().get_by_role('button',name='Save',exact=True).click()
        expect(self.page.get_by_role('heading',name='シリーズ',exact=True)).to_be_visible()
        self.page.reload()
        expect(self.page.get_by_role('heading',name='シリーズ',exact=True)).to_be_visible()
        self.assertEqual(after['Combined/First.epub'],self.disk()['Combined/First.epub'])

    def test_resume_durable_copied_journal_through_actual_library_button(self):
        self.seed_files({'One.epub':book('Recovery one'),'Two.epub':book('Recovery two')})
        before=self.disk()
        self.page.evaluate('''async sourceId => {
          const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('Library fixture');
          const folder=await root.getDirectoryHandle('Recovered',{create:true});const id=crypto.randomUUID(),files=[];
          for(const name of ['One.epub','Two.epub']) {const original=await(await root.getFileHandle(name)).getFile();const w=await(await folder.getFileHandle(name,{create:true})).createWritable();await w.write(original);await w.close();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await original.arrayBuffer()))).map(n=>n.toString(16).padStart(2,'0')).join('');files.push({from:name,to:'Recovered/'+name,hash});}
          for(const [name,text] of [['.manabi-reader-operation-'+id,id],['.Manabi-Reader.yaml','name: "Recovered"\\n']]) {const w=await(await folder.getFileHandle(name,{create:true})).createWritable();await w.write(text);await w.close();}
          await root.removeEntry('One.epub');
          await new Promise((resolve,reject)=>{const r=indexedDB.open('manabi-reader-integrations',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('metadata','readwrite');tx.objectStore('metadata').put({version:1,id,sourceId,parent:'',folder:'Recovered',name:'Recovered',files,phase:'copied'},'library-file-operation:'+sourceId);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}});
        }''',self.source_id)
        self.page.reload()
        self.page.get_by_role('button',name='Resume Folder Change',exact=True).click()
        expect(self.page.get_by_role('button',name='Resume Folder Change',exact=True)).to_have_count(0,timeout=30000)
        expect(self.page.get_by_role('button',name='Open series Recovered',exact=True)).to_be_visible()
        after=self.disk()
        self.assertEqual(before['One.epub'],after['Recovered/One.epub'])
        self.assertEqual(before['Two.epub'],after['Recovered/Two.epub'])
        self.assertNotIn('One.epub',after);self.assertNotIn('Two.epub',after)
        self.page.reload()
        expect(self.page.get_by_role('button',name='Resume Folder Change',exact=True)).to_have_count(0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
