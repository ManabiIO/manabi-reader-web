"""Real browser filesystem handles through the production library UI and adapter.

The fixture uses Chromium's real origin-private filesystem, not mocked handles
or a replaced picker. Native OS chooser/permission dialogs still need manual
platform qualification; this suite proves read/write/persistence/conflict logic.
"""
from http.server import ThreadingHTTPServer
from pathlib import Path
import threading
import time
import unittest
from playwright.sync_api import sync_playwright, expect
from test_static_reader import StaticHandler

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
        expect(self.page.get_by_role('button', name='Refresh connections')).to_be_enabled()

    def tearDown(self):
        output = Path('test-results')
        output.mkdir(exist_ok=True)
        self.page.screenshot(path=str(output / (self._testMethodName + '.png')), full_page=True)
        self.context.close()
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
            open.onerror=()=>reject(open.error);
            open.onsuccess=()=>{const db=open.result,tx=db.transaction('localLibraries','readwrite');
              tx.objectStore('localLibraries').put({id,name:'Fixture books',handle,writable});
              tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};
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
        expect(self.page.get_by_text('local-book', exact=True)).to_be_visible()

    def test_real_handle_reload_writeback_and_external_conflict(self):
        self.seed(True)
        article = self.import_book()
        self.page.get_by_role('link', name='Read local-book', exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy','false',timeout=35000)
        self.page.keyboard.press('ArrowLeft')
        self.page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        self.page.keyboard.press('KeyB')
        deadline=time.monotonic()+10
        saved=False
        while time.monotonic()<deadline:
            saved=self.page.evaluate('''() => new Promise(resolve=>{
              const r=indexedDB.open('books');r.onsuccess=()=>{const db=r.result,tx=db.transaction('bookmark');
              const q=tx.objectStore('bookmark').count();q.onsuccess=()=>resolve(q.result>0);tx.oncomplete=()=>db.close();};
            })''')
            if saved: break
            self.page.wait_for_timeout(50)
        self.assertTrue(saved)
        self.page.goto(self.origin+'/Reader-Web/connections')
        expect(self.page.get_by_role('button',name='Refresh connections')).to_be_enabled()
        article=self.page.locator('article[aria-label="Reading sync for local-book"]')
        article.get_by_role('button',name='Sync local-book',exact=True).click()
        expect(article.get_by_role('status')).to_contain_text('Saved to this folder',timeout=20000)
        copies=self.documents()
        self.assertTrue(copies)
        self.assertTrue(any(copy['value']['bookmark'] is not None for copy in copies))
        self.assertEqual(CONTENT,self.original())
        self.page.reload()
        expect(self.page.get_by_role('button',name='Browse Fixture books')).to_be_visible()
        # Simulate a real second writer arriving from an OS cloud-sync client by
        # adding a concurrent immutable record, not intercepting adapter calls.
        self.page.evaluate('''async () => {
          const root=await navigator.storage.getDirectory();
          const folder=await root.getDirectoryHandle('Fixture books');
          const managed=await folder.getDirectoryHandle('.manabi-reader');
          for await(const [key,directory] of managed.entries()){
            for await(const [name,file] of directory.entries()){
              const old=JSON.parse(await (await file.getFile()).text());
              if(!old.value.bookmark)continue;
              const id=crypto.randomUUID();
              const value=structuredClone(old.value);value.bookmark.progress=0.99;
              const copy={version:1,id,parents:[],createdAt:new Date().toISOString(),value};
              const newFile=await directory.getFileHandle(id+'.json',{create:true});
              const stream=await newFile.createWritable();await stream.write(JSON.stringify(copy));await stream.close();return;
            }
          }
          throw new Error('No saved bookmark fixture');
        }''')
        article=self.page.locator('article[aria-label="Reading sync for local-book"]')
        article.get_by_role('button',name='Sync local-book',exact=True).click()
        expect(article.get_by_role('status')).to_contain_text('concurrent saves',timeout=20000)
        article.get_by_role('button',name='Keep this device’s reading data',exact=True).click()
        expect(article.get_by_role('status')).to_contain_text('Saved to this folder',timeout=20000)
        copies=self.documents()
        consumed={parent for copy in copies for parent in copy['parents']}
        heads=[copy for copy in copies if copy['id'] not in consumed]
        self.assertEqual(1,len(heads))
        self.assertGreaterEqual(len(heads[0]['parents']),2)
        self.assertNotEqual(0.99,heads[0]['value']['bookmark']['progress'])
        self.assertEqual(CONTENT,self.original())


if __name__ == '__main__':
    unittest.main(verbosity=2)
