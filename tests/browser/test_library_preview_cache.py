"""Production preview persistence with real Chromium files, IndexedDB and reloads."""
import unittest
from playwright.sync_api import expect
import test_books_library as fixtures


class PreviewCacheBrowser(fixtures.LibraryBase):
    seed_files = fixtures.BooksLibraryFilesystem.seed_files
    disk = fixtures.BooksLibraryFilesystem.disk

    def test_preview_bytes_round_trip_without_importing_or_changing_originals(self):
        self.seed_files({'First.epub': fixtures.book('Cached first', spine='rtl', creators=('Preview Author',)),
                         'Second.epub': fixtures.book('Cached second', spine='ltr')})
        before = self.disk()
        for title in ('Cached first', 'Cached second'):
            expect(self.page.get_by_role('button', name='Read ' + title, exact=True)).to_be_visible(timeout=30000)
            image = self.tile(title).locator('img')
            expect(image).to_be_visible()
            image.evaluate('img => img.decode()')
        self.assertEqual([], self.stores('books', ['data'])['data'])
        self.assertEqual([], self.stores('manabi-reader-integrations', ['books'])['books'])
        self.import_book('Saved selection anchor')
        self.page.get_by_role('button', name='Library actions', exact=True).click()
        self.page.get_by_role('menuitem', name='Select Books', exact=True).click()
        preview = self.page.get_by_role('button', name='Select Cached first', exact=True)
        expect(preview).to_be_disabled()
        expect(preview).to_have_attribute(
            'title', 'Save this book to the browser before selecting it')
        self.assertEqual(1, len(self.stores('books', ['data'])['data']))
        self.assertEqual([], self.stores('manabi-reader-integrations', ['books'])['books'])
        self.page.get_by_role('button', name='Cancel selection', exact=True).click()
        snapshot = '''async () => {
          const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('manabi-library-previews',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
          try {const rows=await new Promise((resolve,reject)=>{const r=db.transaction('previews').objectStore('previews').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
            return rows.map(row=>({key:row.key,title:row.title,scannedAt:row.scannedAt,direction:row.pageDirection.value,
              creators:row.creators||[],metadataVersion:row.metadataVersion,contentHash:row.contentHash,
              bytes:row.imageData instanceof ArrayBuffer ? row.imageData.byteLength : 0,blobStored:'imagePath' in row,type:row.imageType})).sort((a,b)=>a.key.localeCompare(b.key));
          } finally {db.close();}
        }'''
        saved = self.page.evaluate(snapshot)
        self.assertEqual(2, len(saved))
        for row in saved:
            self.assertGreater(row['bytes'], 0)
            self.assertLessEqual(row['bytes'], 1024 * 1024)
            self.assertFalse(row['blobStored'])
            self.assertIn(row['type'], ('image/png','image/jpeg','image/webp'))
            self.assertEqual(2, row['metadataVersion'])
            self.assertRegex(row['contentHash'], r'^[a-f0-9]{64}$')
        first = next(row for row in saved if row['title'] == 'Cached first')
        self.assertEqual([{'name':'Preview Author'}], first['creators'])
        self.page.reload()
        for title, direction in (('Cached first','rtl'),('Cached second','ltr')):
            expect(self.page.get_by_role('button', name='Read ' + title, exact=True)).to_be_visible(timeout=30000)
            self.tile(title).locator('img').evaluate('img => img.decode()')
            expect(self.tile(title).locator('.cover-stage')).to_have_attribute('data-direction', direction)
        self.assertEqual(saved, self.page.evaluate(snapshot))
        self.assertEqual(before, self.disk())
        self.assertEqual(1, len(self.stores('books', ['data'])['data']))


if __name__ == '__main__':
    unittest.main(verbosity=2)
