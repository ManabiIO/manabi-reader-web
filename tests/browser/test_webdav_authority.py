"""Built-app WebDAV authority checks with real IndexedDB and the HTTP fixture."""
import threading
import time
import unittest

from playwright.sync_api import expect

from test_local_library_features import LocalFeatureBrowser


class WebDavAuthorityBrowser(LocalFeatureBrowser):
    def test_retained_link_cannot_upload_a_foreign_persistent_owner(self):
        path = self.establish_dav_state()
        before = self.stores('books', ['bookmark', 'readerExternalSync'])
        remote = self.dav.state['files'][path]
        requests = len(self.dav.state['requests'])
        self.page.evaluate('''() => new Promise((resolve, reject) => {
          const request = indexedDB.open('books');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result, tx = db.transaction('data', 'readwrite');
            tx.objectStore('data').getAll().onsuccess = event => {
              const book = event.target.result[0];
              tx.objectStore('data').put({...book, libraryOwner: 'another-account'});
            };
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onabort = () => { db.close(); reject(tx.error); };
          };
        })''')
        self.page.get_by_role('button', name='Sync WebDAV offline book', exact=True).click()
        expect(self.page.get_by_text(
            'This WebDAV book is unavailable in the active account.', exact=True)).to_be_visible()
        self.assertEqual(before, self.stores('books', ['bookmark', 'readerExternalSync']))
        self.assertEqual(remote, self.dav.state['files'][path])
        self.assertEqual(1, self.dav.state['puts'])
        self.assertEqual(requests, len(self.dav.state['requests']))

    def test_foreign_same_byte_copy_cannot_expose_shared_content_state(self):
        path = self.establish_dav_state()
        before = self.stores('books', ['bookmark', 'readerExternalSync'])
        remote = self.dav.state['files'][path]
        self.page.evaluate('''() => new Promise((resolve, reject) => {
          const request = indexedDB.open('books');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result, tx = db.transaction('data', 'readwrite');
            tx.objectStore('data').getAll().onsuccess = event => {
              const book = event.target.result[0];
              tx.objectStore('data').add({...book, id: book.id + 1000000,
                title: 'Independent account copy', libraryOwner: 'another-account'});
            };
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onabort = () => { db.close(); reject(tx.error); };
          };
        })''')
        self.page.get_by_role('button', name='Sync WebDAV offline book', exact=True).click()
        expect(self.page.get_by_text(
            'These book copies have conflicting account ownership. WebDAV sync is paused.',
            exact=True)).to_be_visible()
        self.assertEqual(before, self.stores('books', ['bookmark', 'readerExternalSync']))
        self.assertEqual(remote, self.dav.state['files'][path])
        self.assertEqual(1, self.dav.state['puts'])

    def test_link_retargeted_during_get_cannot_acknowledge_or_apply_to_old_history(self):
        path = self.establish_dav_state()
        before = self.stores('books', ['bookmark', 'readerExternalSync'])
        remote = self.dav.state['files'][path]
        gate = threading.Event()
        started = threading.Event()
        self.dav.state.update(sync_get_gate=gate, get_started=started)
        try:
            self.page.get_by_role('button', name='Sync WebDAV offline book', exact=True).click()
            deadline = time.monotonic() + 20
            while not started.is_set():
                self.assertLess(time.monotonic(), deadline, 'Sync did not reach the WebDAV GET')
                self.page.wait_for_timeout(25)
            self.page.evaluate('''() => new Promise((resolve, reject) => {
                  const request = indexedDB.open('manabi-reader-integrations');
                  request.onerror = () => reject(request.error);
                  request.onsuccess = () => {
                    const db = request.result, tx = db.transaction('books', 'readwrite');
                    tx.objectStore('books').getAll().onsuccess = event => {
                      const link = event.target.result[0];
                      tx.objectStore('books').put({...link, fileId: link.fileId + '.moved'});
                    };
                    tx.oncomplete = () => { db.close(); resolve(); };
                    tx.onabort = () => { db.close(); reject(tx.error); };
                  };
                })''')
        finally:
            gate.set()
        expect(self.page.get_by_text(
            'This WebDAV sync was disabled or its book changed.', exact=True)).to_be_visible(
                timeout=15000)
        self.assertTrue(started.is_set())
        self.assertEqual(before, self.stores('books', ['bookmark', 'readerExternalSync']))
        self.assertEqual(remote, self.dav.state['files'][path])
        self.assertEqual(1, self.dav.state['puts'])

    def test_legacy_book_scope_blocks_a_stale_completion_action(self):
        self.import_book('Legacy completion scope')
        before = self.stores('books', ['bookmark', 'readerStatistic'])
        self.page.evaluate('''() => new Promise((resolve, reject) => {
          const request = indexedDB.open('books');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result, tx = db.transaction(['data', 'readerBookScope'], 'readwrite');
            tx.objectStore('data').getAll().onsuccess = event => {
              const book = event.target.result[0];
              tx.objectStore('readerBookScope').put({bookId: book.id, accountId: 'another-account'});
            };
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onabort = () => { db.close(); reject(tx.error); };
          };
        })''')
        self.menu('Legacy completion scope', 'Mark as Finished')
        expect(self.page.get_by_text('This book belongs to another account.', exact=True)).to_be_visible()
        self.assertEqual(before, self.stores('books', ['bookmark', 'readerStatistic']))


def load_tests(loader, _tests, _pattern):
    # Do not duplicate the inherited qualification suite when loaded by unittest.
    return unittest.TestSuite(WebDavAuthorityBrowser(name) for name in WebDavAuthorityBrowser.__dict__
                              if name.startswith('test_'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
