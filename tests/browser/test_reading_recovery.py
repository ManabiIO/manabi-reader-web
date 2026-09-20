"""Actual static Reader + real IndexedDB and filesystem, no intercepted calls.

Remote removal and reset are distinct real filesystem operations. Test setup
seeds reading records at their persistence boundary, not a replacement adapter.
"""
import sys
import unittest
from playwright.sync_api import expect
from test_local_library import LocalLibraryBrowser, CONTENT


class ReadingRecoveryBrowser(LocalLibraryBrowser):
    def seed_history(self):
        self.page.evaluate('''() => new Promise((resolve, reject) => {
          const open=indexedDB.open('books');
          open.onerror=()=>reject(open.error);
          open.onsuccess=()=>{
            const db=open.result, tx=db.transaction(['data','bookmark','statistic'],'readwrite');
            const books=tx.objectStore('data').getAll();
            books.onsuccess=()=>{
              const book=books.result.find(item=>item.title==='local-book');
              if(!book){tx.abort();return;}
              tx.objectStore('bookmark').put({dataId:book.id,exploredCharCount:30,
                progress:0.1,lastBookmarkModified:1789837322544});
              tx.objectStore('statistic').put({title:book.title,dateKey:'2026-09-19',
                charactersRead:60,readingTime:300,minReadingSpeed:720,altMinReadingSpeed:720,
                lastReadingSpeed:720,maxReadingSpeed:720,lastStatisticModified:1789837322544});
            };
            tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
          };
        })''')

    def local_history(self):
        return self.page.evaluate('''() => new Promise((resolve,reject)=>{
          const open=indexedDB.open('books');open.onerror=()=>reject(open.error);
          open.onsuccess=()=>{
            const db=open.result,tx=db.transaction(['bookmark','statistic']);
            const bookmarks=tx.objectStore('bookmark').getAll();
            const statistics=tx.objectStore('statistic').getAll();
            tx.oncomplete=()=>{resolve({bookmarks:bookmarks.result,statistics:statistics.result});db.close();};
            tx.onerror=()=>reject(tx.error);
          };
        })''')

    def article(self):
        return self.page.locator('article[aria-label="Reading sync for local-book"]')

    def synced_history(self):
        self.seed(True)
        self.import_book()
        # First import has no bookmark, no remote file, and an empty baseline.
        # First real reading must still be able to create its initial remote file.
        self.seed_history()
        self.article().get_by_role('button',name='Sync local-book',exact=True).click()
        expect(self.article().get_by_role('status')).to_contain_text('Saved to this folder')
        self.assertTrue(self.documents())
        return self.local_history()

    def test_missing_remote_history_is_preserved_across_reload_and_explicitly_restored(self):
        before=self.synced_history()
        self.page.evaluate('''async () => {
          const root=await navigator.storage.getDirectory();
          const folder=await root.getDirectoryHandle('Fixture books');
          await folder.removeEntry('.manabi-reader',{recursive:true});
        }''')
        for _ in range(2):
            self.article().get_by_role('button',name='Sync local-book',exact=True).click()
            expect(self.article().get_by_role('status')).to_contain_text('reading-data file is missing')
            self.assertEqual(before,self.local_history())
            self.assertEqual([],self.documents())
            # There is no remote version to select and no destructive empty reset.
            expect(self.article().get_by_role('button',name='Use the library’s reading data',exact=True)).to_have_count(0)
            self.page.reload()
            expect(self.page.get_by_role('button',name='Refresh connections')).to_be_enabled()
        self.article().get_by_role('button',name='Sync local-book',exact=True).click()
        self.article().get_by_role('button',name='Keep this device’s reading data',exact=True).click()
        expect(self.article().get_by_role('status')).to_contain_text('Saved to this folder')
        self.assertEqual(before,self.local_history())
        documents=self.documents()
        self.assertEqual(1,len(documents))
        self.assertEqual(30,documents[0]['value']['bookmark']['exploredCharCount'])
        self.assertEqual(300,documents[0]['value']['statistics']['2026-09-19']['readingTime'])
        self.assertEqual(CONTENT,self.original())

    def test_intentional_empty_document_remains_a_valid_reset(self):
        self.synced_history()
        self.page.evaluate('''async () => {
          const root=await navigator.storage.getDirectory();
          const folder=await root.getDirectoryHandle('Fixture books');
          const managed=await folder.getDirectoryHandle('.manabi-reader');
          for await (const directory of managed.values()) {
            if(directory.kind!=='directory')continue;
            const documents=[];
            for await(const file of directory.values())documents.push(JSON.parse(await(await file.getFile()).text()));
            const consumed=new Set(documents.flatMap(item=>item.parents));
            const heads=documents.filter(item=>!consumed.has(item.id));
            const id=crypto.randomUUID();
            const value={...heads[0].value,bookmark:null,statistics:{}};
            const writer=await(await directory.getFileHandle(id+'.json',{create:true})).createWritable();
            await writer.write(JSON.stringify({version:1,id,parents:heads.map(item=>item.id),
              createdAt:new Date().toISOString(),value}));await writer.close();
          }
        }''')
        self.article().get_by_role('button',name='Sync local-book',exact=True).click()
        expect(self.article().get_by_role('status')).to_contain_text('Saved to this folder')
        self.assertEqual({'bookmarks':[],'statistics':[]},self.local_history())
        self.assertEqual(CONTENT,self.original())

    def test_restoring_missing_file_after_local_reset_writes_a_reset_document(self):
        self.synced_history()
        self.page.evaluate('''async () => {
          const root=await navigator.storage.getDirectory();
          await(await root.getDirectoryHandle('Fixture books')).removeEntry('.manabi-reader',{recursive:true});
          await new Promise(resolve=>{const open=indexedDB.open('books');open.onsuccess=()=>{
            const db=open.result,tx=db.transaction(['bookmark','statistic'],'readwrite');
            tx.objectStore('bookmark').clear();tx.objectStore('statistic').clear();
            tx.oncomplete=()=>{db.close();resolve();};};});
        }''')
        self.article().get_by_role('button',name='Sync local-book',exact=True).click()
        expect(self.article().get_by_role('status')).to_contain_text('reading-data file is missing')
        self.article().get_by_role('button',name='Keep this device’s reading data',exact=True).click()
        expect(self.article().get_by_role('status')).to_contain_text('Saved to this folder')
        documents=self.documents()
        self.assertEqual(1,len(documents))
        self.assertIsNone(documents[0]['value']['bookmark'])
        self.assertEqual({},documents[0]['value']['statistics'])


if __name__ == '__main__':
    suite=unittest.TestSuite(ReadingRecoveryBrowser(name) for name in (
      'test_missing_remote_history_is_preserved_across_reload_and_explicitly_restored',
      'test_intentional_empty_document_remains_a_valid_reset',
      'test_restoring_missing_file_after_local_reset_writes_a_reset_document'))
    sys.exit(not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful())
