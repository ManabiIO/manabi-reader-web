"""Local-first reading history survives missing legacy managed state and source loss.

The fixture uses real IndexedDB and a real browser filesystem handle. Provider-
managed reading-state files are migration input, not an active replica.
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
            const db=open.result, tx=db.transaction(['data','bookmark','readerStatistic'],'readwrite');
            const books=tx.objectStore('data').getAll();
            books.onsuccess=()=>{
              const book=books.result.find(item=>item.title==='local-book');
              if(!book){tx.abort();return;}
              tx.objectStore('bookmark').put({dataId:book.id,exploredCharCount:30,
                progress:0.1,lastBookmarkModified:1789837322544});
              tx.objectStore('readerStatistic').put({title:book.title,bookKey:'content:'+book.contentHash,dateKey:'2026-09-19',
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
            const db=open.result,tx=db.transaction(['bookmark','readerStatistic']);
            const bookmarks=tx.objectStore('bookmark').getAll();
            const statistics=tx.objectStore('readerStatistic').getAll();
            tx.oncomplete=()=>{resolve({bookmarks:bookmarks.result,statistics:statistics.result});db.close();};
            tx.onerror=()=>reject(tx.error);
          };
        })''')

    def test_missing_legacy_managed_directory_keeps_local_history(self):
        self.seed(True)
        self.import_book()
        self.seed_history()
        before = self.local_history()
        self.assertEqual([], self.documents())
        self.page.reload()
        expect(self.page.get_by_role('button', name='Browse Fixture books')).to_be_visible()
        self.assertEqual(before, self.local_history())
        self.page.get_by_role('button', name='Sync local-book', exact=True).click()
        expect(self.page.get_by_role('button', name='Refresh connections')).to_be_enabled()
        self.assertEqual(before, self.local_history())
        self.assertEqual([], self.documents())
        self.assertEqual(CONTENT, self.original())

    def test_explicit_local_reset_does_not_restore_missing_managed_state(self):
        self.seed(True)
        self.import_book()
        self.seed_history()
        self.page.evaluate('''() => new Promise((resolve,reject) => {
          const open=indexedDB.open('books');open.onerror=()=>reject(open.error);
          open.onsuccess=()=>{const db=open.result,tx=db.transaction(['bookmark','readerStatistic'],'readwrite');
            tx.objectStore('bookmark').clear();tx.objectStore('readerStatistic').clear();
            tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};
        })''')
        self.page.reload()
        expect(self.page.get_by_role('button', name='Browse Fixture books')).to_be_visible()
        self.assertEqual({'bookmarks': [], 'statistics': []}, self.local_history())
        self.assertEqual([], self.documents())
        self.assertEqual(CONTENT, self.original())

    def test_imported_copy_remains_readable_after_source_file_disappears(self):
        self.seed(True)
        self.import_book()
        self.page.evaluate('''async () => {
          const root=await navigator.storage.getDirectory();
          const folder=await root.getDirectoryHandle('Fixture books');
          await folder.removeEntry('local-book.txt');
        }''')
        self.page.goto(self.origin + '/Reader-Web/manage')
        self.page.get_by_role('button', name='Read local-book', exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false', timeout=35000)
        self.assertIn('地元の本', self.page.locator('.book-content').inner_text())


if __name__ == '__main__':
    suite = unittest.TestSuite(ReadingRecoveryBrowser(name) for name in (
      'test_missing_legacy_managed_directory_keeps_local_history',
      'test_explicit_local_reset_does_not_restore_missing_managed_state',
      'test_imported_copy_remains_readable_after_source_file_disappears'))
    sys.exit(not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful())
