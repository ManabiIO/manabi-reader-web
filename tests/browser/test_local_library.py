"""Real browser filesystem handles through the production library UI and adapter.

The fixture uses Chromium's real origin-private filesystem, not mocked handles
or a replaced picker. Native OS chooser/permission dialogs still need manual
platform qualification; this suite checks import, local persistence, and physical series moves.
"""
from pathlib import Path
import threading
import time
import unittest
from playwright.sync_api import sync_playwright, expect
from playwright._impl._errors import TargetClosedError
from test_static_reader import StaticHandler, ThreadingHTTPServer

CONTENT = '地元の本。\n' + '日本語の物語を読みます。少しずつ先に進みます。\n' * 180


class LocalLibraryBrowser(unittest.TestCase):
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
        self.page.set_default_timeout(20000)
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(error.stack or str(error)))
        self.page.goto(self.origin + '/Reader-Web/connections')
        # Refresh connections exists, enabled, in the pre-hydration HTML. The
        # local-folder control is mounted only by onMount, and stays disabled
        # until initial account/storage loading finishes. Do not let this
        # fixture win the first IndexedDB open and create an empty schema.
        expect(self.page.get_by_role('button', name='Add local folder', exact=True)).to_be_enabled()
        expect(self.page.get_by_role('button', name='Refresh connections')).to_be_enabled()

    def tearDown(self):
        output = Path('test-results')
        output.mkdir(exist_ok=True)
        try:
            self.page.screenshot(path=str(output / (self._testMethodName + '.png')), full_page=True)
        except TargetClosedError:
            pass  # Keep the original browser/process failure as the primary error.
        try:
            self.context.close()
        except TargetClosedError:
            pass
        self.assertEqual([], self.errors)

    def seed(self, writable):
        # Initialize the capability at the storage boundary. All subsequent
        # interaction goes through the unchanged production UI/library adapter.
        self.page.evaluate('''async ({content,writable}) => {
          const root = await navigator.storage.getDirectory();
          const handle = await root.getDirectoryHandle('Fixture books', {create:true});
          const file = await handle.getFileHandle('local-book.txt', {create:true});
          const writer = await file.createWritable(); await writer.write(content); await writer.close();
          const id = 'local-' + crypto.randomUUID();
          await new Promise((resolve,reject) => {
            const open=indexedDB.open('manabi-reader-integrations',1);
            open.onupgradeneeded=()=>{
              // Only production code may create the integration schema.
              open.transaction.abort();
              reject(new Error('Integration storage was not initialized before fixture seeding'));
            };
            open.onerror=()=>reject(open.error);
            open.onsuccess=()=>{
              const db=open.result;
              try {
                const tx=db.transaction('localLibraries','readwrite');
                tx.oncomplete=()=>{db.close();resolve();};
                tx.onabort=()=>{db.close();reject(tx.error || new Error('Fixture transaction aborted'));};
                tx.onerror=()=>reject(tx.error);
                tx.objectStore('localLibraries').put({id,name:'Fixture books',handle,writable});
              } catch(error) {
                db.close();
                reject(error);
              }
            };
          });
        }''', {'content': CONTENT, 'writable': writable})
        self.page.get_by_role('button', name='Refresh connections').click()
        expect(self.page.get_by_role('button', name='Browse Fixture books')).to_be_visible()

    def original(self):
        return self.page.evaluate('''async () => {
          const root=await navigator.storage.getDirectory();
          const folder=await root.getDirectoryHandle('Fixture books');
          return await (await (await folder.getFileHandle('local-book.txt')).getFile()).text();
        }''')

    def documents(self):
        return self.page.evaluate('''async () => {
          const root=await navigator.storage.getDirectory();
          const folder=await root.getDirectoryHandle('Fixture books');
          let managed;try {managed=await folder.getDirectoryHandle('.manabi-reader');} catch {return [];}
          const values=[];
          for await (const [key,directory] of managed.entries()) {
            if(directory.kind!=='directory')continue;
            for await(const [name,file] of directory.entries()) {
              if(file.kind==='file')values.push({key,name,...JSON.parse(await (await file.getFile()).text())});
            }
          }
          return values;
        }''')

    def add_book(self, name, content):
        self.page.evaluate('''async ({name,content}) => {
          const root=await navigator.storage.getDirectory();
          const folder=await root.getDirectoryHandle('Fixture books');
          const file=await folder.getFileHandle(name,{create:true});
          const stream=await file.createWritable();await stream.write(content);await stream.close();
        }''', {'name': name, 'content': content})

    def import_book(self):
        self.page.get_by_role('button', name='Browse Fixture books').click()
        self.page.get_by_role('button', name='Import local-book.txt', exact=True).click()
        expect(self.page.get_by_role('link', name='Read local-book', exact=True)).to_be_visible(timeout=30000)
        return self.page.locator('article[aria-label="Reading sync for local-book"]')

    def test_readonly_disconnect_preserves_original_and_import(self):
        self.seed(False)
        article = self.import_book()
        expect(article.get_by_role('checkbox')).not_to_be_checked()
        self.assertEqual([], self.documents())
        self.assertEqual(CONTENT, self.original())
        self.page.get_by_role('button', name='Disconnect local folder', exact=True).click()
        expect(self.page.get_by_role('button', name='Browse Fixture books')).to_have_count(0)
        self.assertEqual(CONTENT, self.original())
        self.page.get_by_role('link', name='← Books', exact=True).click()
        expect(self.page.get_by_role('button', name='Read local-book', exact=True)).to_be_visible()

    def test_real_handle_reload_keeps_local_reading_data_without_folder_writeback(self):
        self.seed(True)
        self.import_book()
        self.page.get_by_role('link', name='Read local-book', exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false', timeout=35000)
        self.page.keyboard.press('ArrowLeft')
        self.page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        self.page.keyboard.press('KeyB')
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            saved = self.page.evaluate('''() => new Promise(resolve => {
              const r=indexedDB.open('books');r.onsuccess=()=>{const db=r.result,tx=db.transaction('bookmark');
                const q=tx.objectStore('bookmark').count();q.onsuccess=()=>resolve(q.result>0);
                tx.oncomplete=()=>db.close();};
            })''')
            if saved:
                break
            self.page.wait_for_timeout(50)
        self.assertTrue(saved)
        self.page.goto(self.origin + '/Reader-Web/connections')
        expect(self.page.get_by_role('button', name='Refresh connections')).to_be_enabled()
        self.assertEqual([], self.documents())
        self.assertEqual(CONTENT, self.original())
        self.page.reload()
        expect(self.page.get_by_role('button', name='Browse Fixture books')).to_be_visible()
        self.assertEqual([], self.documents())
        self.assertTrue(self.page.evaluate('''() => new Promise(resolve => {
          const r=indexedDB.open('books');r.onsuccess=()=>{const db=r.result,tx=db.transaction('bookmark');
            const q=tx.objectStore('bookmark').count();q.onsuccess=()=>resolve(q.result>0);
            tx.oncomplete=()=>db.close();};
        })'''))
        self.assertEqual(CONTENT, self.original())

    def test_library_groups_real_files_into_a_verified_series(self):
        self.seed(True)
        self.add_book('second-book.txt', '二冊目の本。\n' + CONTENT)
        self.page.goto(self.origin + '/Reader-Web/manage')
        expect(self.page.get_by_role('button', name='Read local-book', exact=True)).to_be_visible(
            timeout=30000)
        expect(self.page.get_by_role('button', name='Read second-book', exact=True)).to_be_visible()

        self.page.get_by_role('button', name='Library actions', exact=True).click()
        self.page.get_by_role('menuitem', name='Organize Library', exact=True).hover()
        self.page.get_by_role('menuitem', name='Create Series from Books…', exact=True).click()
        dialog = self.page.get_by_role('dialog', name='Create series')
        dialog.get_by_role('textbox', name='Name', exact=True).fill('Study Pair')
        checkboxes = dialog.get_by_role('checkbox')
        self.assertEqual(2, checkboxes.count())
        for index in range(checkboxes.count()):
            checkboxes.nth(index).check()
        dialog.get_by_role('button', name='Move into Series', exact=True).click()
        expect(self.page.get_by_role('button', name='Open series Study Pair', exact=True)).to_be_visible(
            timeout=30000)

        contents = self.page.evaluate('''async () => {
          const root=await navigator.storage.getDirectory();
          const folder=await root.getDirectoryHandle('Fixture books');
          const series=await folder.getDirectoryHandle('Study Pair');
          const names=[];for await(const [name] of series.entries())names.push(name);
          let original=false;try{await folder.getFileHandle('local-book.txt');original=true;}catch{}
          return {names:names.sort(),original};
        }''')
        self.assertEqual(
            ['.manabi-reader.yaml', 'local-book.txt', 'second-book.txt'], contents['names'])
        self.assertFalse(contents['original'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
