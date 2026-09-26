"""Parity acceptance for per-resource EPUB imports in the built application."""
import os
import threading
import unittest
from playwright.sync_api import sync_playwright, expect
from test_static_reader import ReaderBrowser, StaticHandler, ThreadingHTTPServer

P = "document.querySelector('foliate-paginator')"


class EpubResourceBrowser(ReaderBrowser):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), StaticHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = 'http://127.0.0.1:' + str(cls.server.server_port)
        cls.playwright = sync_playwright().start()
        cls.browser = getattr(cls.playwright, os.environ.get('EPUB_BROWSER', 'chromium')).launch()

    def open_epub(self):
        self.open_book(writing='horizontal-tb', font='Klee One', foliate=True)
        self.page.wait_for_function(f"() => {P}?.getContents()[0]?.doc.fonts.status === 'loaded' && {P}.pages > 4")
        self.page.emulate_media(reduced_motion='reduce')

    def records(self, store='data'):
        return self.page.evaluate('''store => new Promise((resolve,reject)=>{
          const open=indexedDB.open('books');open.onerror=()=>reject(open.error);
          open.onsuccess=()=>{const db=open.result,tx=db.transaction(store),q=tx.objectStore(store).getAll();
            q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);tx.oncomplete=()=>db.close()};
        })''', store)

    def focus_reader(self):
        self.page.evaluate(f"() => {P}.getContents()[0].doc.defaultView.focus()")

    def test_new_import_stores_portable_documents_and_loads_the_selected_real_font(self):
        self.open_epub()
        rows = self.records()
        self.assertEqual(len(rows), 1)
        book = rows[0]
        resources = book['epubPublication']['resources']
        self.assertGreater(len(resources), 0)
        self.assertEqual(book['elementHtml'], ''.join(r['html'] for r in resources))
        self.assertEqual(book['styleSheet'], '\n'.join(r['styleSheet'] for r in resources))
        self.assertEqual(book['characters'], sum(r['characters'] for r in resources))
        self.assertNotIn('blob:', book['elementHtml'])
        self.assertFalse(self.page.evaluate('Boolean(window.bookAttack)'))
        self.assertEqual([], StaticHandler.probes)
        self.page.wait_for_function(f'''() => [...{P}.getContents()[0].doc.fonts].some(face =>
          face.family.replaceAll('"','') === 'Klee One' && face.status === 'loaded')''')
        self.assertGreater(self.page.evaluate(f"{P}.getContents()[0].doc.querySelector('#safe-image').naturalWidth"), 0)

    def test_existing_keyboard_bookmark_and_repeated_page_turns_work_in_the_child_document(self):
        self.open_epub()
        initial = self.page.evaluate(f'{P}.page')
        self.focus_reader()
        for offset in [1, 2, 3]:
            self.page.keyboard.press('PageDown')
            self.page.wait_for_function(f'() => {P}.page === {initial + offset}')
            self.assertTrue(self.page.evaluate(f'{P}.getContents()[0].doc.hasFocus()'))
        self.page.keyboard.press('b')
        self.page.wait_for_function('''() => new Promise(resolve=>{
          const q=indexedDB.open('books');q.onsuccess=()=>{const db=q.result;
            const r=db.transaction('bookmark').objectStore('bookmark').getAll();
            r.onsuccess=()=>{resolve(r.result.some(x=>x.exploredCharCount>0));db.close()}};
        })''')
        saved = self.records('bookmark')
        self.page.reload()
        self.page.wait_for_function(f'() => {P}?.getContents()[0]?.doc && {P}.page > 1')
        self.assertEqual(saved, self.records('bookmark'))

    def test_search_return_restores_the_later_visible_page_not_chapter_start(self):
        self.open_epub()
        self.focus_reader()
        for _ in range(3):
            before = self.page.evaluate(f'{P}.page')
            self.page.keyboard.press('PageDown')
            self.page.wait_for_function(f'() => {P}.page === {before + 1}')
        origin = self.page.evaluate(f'{P}.page')
        self.page.get_by_role('button', name='Show reading controls', exact=True).click()
        self.page.get_by_role('button', name='Reading tools', exact=True).click()
        self.page.get_by_role('menuitem', name='Search Book', exact=True).click()
        search = self.page.get_by_role('dialog', name='Search Book', exact=True)
        search.get_by_role('searchbox', name='Search within book', exact=True).fill('安全な文章')
        search.locator('[aria-label="Search results"] button').first.click()
        back = self.page.get_by_role('button', name='Return to where I was', exact=True)
        expect(back).to_be_visible()
        self.page.wait_for_function(f'() => {P}.page < {origin}')
        back.click()
        self.page.wait_for_function(f'() => {P}.page === {origin}')
        expect(back).to_have_count(0)

    def test_legacy_stored_books_reopen_without_original_epub_bytes(self):
        self.open_epub()
        # Reproduce the previously shipped stored representation, not a different book.
        original = self.records()[0]
        self.page.evaluate('''() => new Promise((resolve,reject)=>{
          const q=indexedDB.open('books');q.onerror=()=>reject(q.error);q.onsuccess=()=>{
            const db=q.result,tx=db.transaction('data','readwrite'),s=tx.objectStore('data'),r=s.getAll();
            r.onsuccess=()=>{for(const value of r.result){delete value.epubPublication;s.put(value)}};
            tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>{db.close();reject(tx.error)};
          };
        })''')
        self.page.reload()
        self.page.wait_for_function(f"() => {P}?.getContents()[0]?.doc.querySelector('ruby rt')?.textContent === 'ほん'")
        restored = self.records()[0]
        self.assertEqual(original['id'], restored['id'])
        self.assertEqual(original.get('contentHash'), restored.get('contentHash'))
        self.assertEqual(original['elementHtml'], restored['elementHtml'])
        self.assertNotIn('epubPublication', restored)

    def test_image_epub_reopens_offline_with_its_resource_identity_intact(self):
        self.open_epub()
        original = self.records()[0]
        self.page.wait_for_function("async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated'")
        if not self.page.evaluate('!!navigator.serviceWorker.controller'):
            self.page.reload()
        self.page.wait_for_function('!!navigator.serviceWorker.controller')
        self.go_offline()
        self.page.reload()
        self.page.wait_for_function(f"() => {P}?.getContents()[0]?.doc.querySelector('#safe-image')?.naturalWidth > 0")
        restored = self.records()[0]
        self.assertEqual(original['epubPublication'], restored['epubPublication'])
        self.assertEqual(original['id'], restored['id'])


def load_tests(loader, tests, pattern):
    # Inherit setup/import helpers, not duplicate every legacy Reader test.
    return unittest.TestSuite(EpubResourceBrowser(name) for name in EpubResourceBrowser.__dict__ if name.startswith('test_'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
