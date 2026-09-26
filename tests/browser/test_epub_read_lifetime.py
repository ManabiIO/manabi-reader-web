"""Image-bearing EPUB opening/departure through the built reader and native storage."""
import re
import unittest
from urllib.parse import parse_qs, urlsplit
from playwright.sync_api import expect
from test_epub_publication import EpubPublicationBrowser

P = "document.querySelector('foliate-paginator')"


class EpubReadLifetimeBrowser(EpubPublicationBrowser):
    def import_image_book(self):
        self.open_book(foliate=True, include_images=True)
        self.page.wait_for_function(f"() => {P}?.getContents?.()[0]?.doc?.querySelector('ruby')")
        url = self.page.url
        book_id = int(parse_qs(urlsplit(url).query)['id'][0])
        self.page.goto(self.origin + '/reader-web/manage')
        expect(self.page.get_by_role('button', name='Read Reader browser acceptance', exact=True)).to_be_visible()
        return url, book_id

    def test_saved_epub_open_commits_timestamp_without_rereading_image_bytes(self):
        url, book_id = self.import_image_book()
        self.page.evaluate("""id => new Promise((resolve,reject) => {
          const request=indexedDB.open('books');request.onerror=()=>reject(request.error);
          request.onsuccess=()=>{const db=request.result,tx=db.transaction('data','readwrite');
            const read=tx.objectStore('data').get(id);
            read.onsuccess=()=>{if(!read.result)throw new Error('Missing test book');
              tx.objectStore('data').put({...read.result,lastBookOpen:0});};
            tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};
        })""", book_id)
        # Observe only the subsequent saved-book open. Initial import must still
        # encode image bytes, and every observed call executes the native method.
        self.context.add_init_script("""(() => {
          window.imageReadsForLastOpen=0;
          const original=Blob.prototype.arrayBuffer;
          Blob.prototype.arrayBuffer=function(...args){
            if(this.type==='image/png')window.imageReadsForLastOpen++;
            return original.apply(this,args);
          };
        })()""")
        self.page.goto(url)
        self.page.wait_for_function(f"() => {P}?.getContents?.()[0]?.doc?.querySelector('ruby')")
        self.page.wait_for_function("""id => new Promise((resolve,reject) => {
          const request=indexedDB.open('books');request.onerror=()=>reject(request.error);
          request.onsuccess=()=>{const db=request.result,tx=db.transaction('data');
            const read=tx.objectStore('data').get(id);
            tx.oncomplete=()=>{db.close();resolve(read.result?.lastBookOpen>0);};
            tx.onabort=()=>{db.close();reject(tx.error);};};
        })""", arg=book_id)
        self.assertEqual(0, self.page.evaluate('window.imageReadsForLastOpen'))
        self.page.wait_for_function(f"() => {{const image={P}.getContents()[0].doc.querySelector('#safe-image');return image?.complete && image.naturalWidth>0;}}")
        image = self.page.evaluate(f"""() => {{const image={P}.getContents()[0].doc.querySelector('#safe-image');
          return image ? {{complete:image.complete,width:image.naturalWidth}} : null;}}""")
        self.assertIsNotNone(image)
        self.assertTrue(image['complete'])
        self.assertGreater(image['width'], 0)
        self.assertEqual([], self.errors)

    def test_immediate_reader_departure_preserves_image_book_without_page_errors(self):
        _, book_id = self.import_image_book()
        for cycle in range(12):
            with self.subTest(cycle=cycle):
                self.page.get_by_role('button', name='Read Reader browser acceptance', exact=True).click()
                expect(self.page).to_have_url(re.compile(r'/reader-web/b\?id='))
                # Leave before waiting for renderer readiness. This must not
                # leave image reads owned by an already departed page.
                self.page.goto(self.origin + '/reader-web/manage')
                expect(self.page.get_by_role('button', name='Read Reader browser acceptance', exact=True)).to_be_visible()
                self.assertEqual([], self.errors)
        summary = self.page.evaluate("""id=>new Promise((resolve,reject)=>{
          const request=indexedDB.open('books');request.onerror=()=>reject(request.error);
          request.onsuccess=()=>{const db=request.result,tx=db.transaction('data');
            const read=tx.objectStore('data').get(id);
            tx.oncomplete=()=>{db.close();const b=read.result;resolve(b&&{
              id:b.id,resources:b.epubPublication?.resources.length,images:Object.keys(b.blobs).length});};
            tx.onabort=()=>{db.close();reject(tx.error);};};
        })""", book_id)
        self.assertEqual(book_id, summary['id'])
        self.assertGreater(summary['resources'], 0)
        self.assertGreater(summary['images'], 0)


def load_tests(loader, tests, pattern):
    return unittest.TestSuite(EpubReadLifetimeBrowser(name) for name in EpubReadLifetimeBrowser.__dict__ if name.startswith('test_'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
