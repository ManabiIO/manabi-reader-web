"""Organization sync must update an already-open Library in another tab."""
import copy
import time
import unittest

from playwright.sync_api import expect
from test_books_library import LibraryBase, book
from test_static_reader import StaticHandler


class LibraryOrganizationSync(LibraryBase):
    def tearDown(self):
        try:
            super().tearDown()
        finally:
            StaticHandler.account_fixture = None
            StaticHandler.account_requests = []
            StaticHandler.preference_revision = 0
            StaticHandler.preference_settings = {}
            StaticHandler.personal_enabled = False
            StaticHandler.personal_mutations = []

    def test_remote_membership_updates_open_library_and_survives_reload(self):
        self.import_book('Before sync')
        self.import_book('After sync')
        self.menu('Before sync', 'Add to Want to Read')
        self.choose_collection('Want to Read')
        expect(self.page.get_by_role('button', name='Read Before sync', exact=True)).to_be_visible()
        rows = self.stores('books', ['data'])['data']
        after_key = 'content:' + next(row['contentHash'] for row in rows if row['title'] == 'After sync')
        StaticHandler.account_fixture = {
            'user': {'id': '42', 'username': 'reader'}, 'csrf_token': 'c' * 64, 'providers': []
        }
        StaticHandler.preference_revision = 0
        StaticHandler.preference_settings = {}
        self.page.goto(self.origin + '/Reader-Web/connections')
        self.page.get_by_label('Sync reader settings with this Manabi account', exact=True).check()
        status = self.page.get_by_role('status', name='Settings sync status')
        expect(status).to_contain_text('synced')

        library = self.context.new_page()
        library.on('pageerror', lambda error: self.errors.append(error.stack or str(error)))
        try:
            library.goto(self.origin + '/Reader-Web/manage?collection=want-to-read')
            expect(library.get_by_role('region', name='Library shelves')).to_have_attribute('aria-busy', 'false')
            expect(library.get_by_role('button', name='Read Before sync', exact=True)).to_be_visible()
            # Another device has replaced the shared membership. Sync it from
            # the Connections tab while the Library remains mounted.
            remote = copy.deepcopy(StaticHandler.preference_settings)
            wishlist = next(item for item in remote['library_organization']['collections']
                            if item['id'] == 'want-to-read')
            wishlist['members'] = [after_key]
            StaticHandler.preference_settings = remote
            StaticHandler.preference_revision += 1
            self.page.get_by_role('button', name='Sync settings now', exact=True).click()
            expect(library.get_by_role('button', name='Read After sync', exact=True)).to_be_visible(timeout=10000)
            expect(library.get_by_role('button', name='Read Before sync', exact=True)).to_have_count(0)
            expect(status).to_contain_text('synced')
            # A reported successful sync must already be durable in IndexedDB.
            organization = next(row for row in self.stores('manabi-reader-integrations', ['metadata'])['metadata']
                                if row.get('version') == 1 and 'collections' in row)
            self.assertEqual([after_key], next(item['members'] for item in organization['collections']
                                              if item['id'] == 'want-to-read'))
            library.reload()
            expect(library.get_by_role('button', name='Read After sync', exact=True)).to_be_visible()
            expect(library.get_by_role('button', name='Read Before sync', exact=True)).to_have_count(0)
        finally:
            library.close()

    def test_same_title_different_files_pause_legacy_statistics_sync(self):
        self.import_book('Shared title', color=(100, 55, 45))
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files({
            'name': 'second-copy.epub',
            'mimeType': 'application/epub+zip',
            'buffer': book('Shared title', color=(45, 100, 55))
        })
        deadline = time.monotonic() + 15
        while True:
            rows = self.stores('books', ['data'])['data']
            if len(rows) == 2:
                break
            self.assertLess(time.monotonic(), deadline, 'Second import did not create a book')
            self.page.wait_for_timeout(25)
        self.assertEqual(2, len(rows), 'Second import did not produce a distinct book')
        self.assertEqual(2, len({row['contentHash'] for row in rows}))
        StaticHandler.account_fixture = {
            'user': {'id': '42', 'username': 'reader'}, 'csrf_token': 'c' * 64, 'providers': []
        }
        self.page.goto(self.origin + '/Reader-Web/connections')
        status = self.page.locator('section[aria-labelledby="reading-sync-heading"] [role="status"]')
        expect(status).to_contain_text('Reading sync is paused because different books share a title',
                                       timeout=10000)
        self.assertEqual([], [request for request in StaticHandler.account_requests
                              if '/personal/' in request['path']])
        self.assertEqual(2, len(self.stores('books', ['data'])['data']))
        self.page.goto(self.origin + '/Reader-Web/manage')
        first = self.page.locator('[data-book-key="book:%d"]' % rows[0]['id'])
        second = self.page.locator('[data-book-key="book:%d"]' % rows[1]['id'])
        expect(first).to_be_visible()
        expect(second).to_be_visible()
        first.get_by_role('button', name='Actions for Shared title', exact=True).click()
        self.page.get_by_role('menuitem', name='Remove from this browser…', exact=True).click()
        expect(first).to_have_count(0)
        expect(second).to_be_visible()
        self.assertEqual([rows[1]['id']],
                         [row['id'] for row in self.stores('books', ['data'])['data']])

    def test_account_switch_keeps_annotation_outbox_bound_to_original_account(self):
        self.import_book('Account fence')
        StaticHandler.personal_enabled = True
        StaticHandler.personal_mutations = []
        StaticHandler.account_fixture = {
            'user': {'id': '42', 'username': 'reader-a'}, 'csrf_token': 'c' * 64,
            'providers': []
        }
        self.page.goto(self.origin + '/Reader-Web/connections')
        status = self.page.locator('section[aria-labelledby="reading-sync-heading"] [role="status"]')
        expect(status).to_contain_text('synced', timeout=15000)

        annotation_id = self.page.evaluate('''async () => {
          const opened=indexedDB.open('books');
          const db=await new Promise((resolve,reject)=>{opened.onsuccess=()=>resolve(opened.result);
            opened.onerror=()=>reject(opened.error);});
          const book=await new Promise((resolve,reject)=>{const tx=db.transaction('data');
            const q=tx.objectStore('data').getAll();q.onsuccess=()=>resolve(q.result[0]);
            q.onerror=()=>reject(q.error);});
          const bookKey='content:'+book.contentHash;
          const id=crypto.randomUUID(), mutation=crypto.randomUUID(), now=new Date().toISOString();
          const value={id,bookKey,kind:'bookmark',targets:[{version:1,bookKey,
            resource:{href:'chapter.xhtml',spineIndex:0,sectionId:'chapter'},
            projectionVersion:1,resourceDigest:'0'.repeat(64),start:0,end:0,
            quote:'',prefix:'',suffix:''}],createdAt:now,modifiedAt:now,revision:1};
          const tx=db.transaction(['readerAnnotation','readerAnnotationScope','readerAnnotationOutbox'],'readwrite');
          tx.objectStore('readerAnnotation').put(value);
          tx.objectStore('readerAnnotationScope').put({annotationId:id,accountId:'42'});
          tx.objectStore('readerAnnotationOutbox').put({id:mutation,accountId:'42',
            bookKey,annotationId:id,baseRevision:0,localRevision:1,value,createdAt:now});
          await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
            tx.onerror=()=>reject(tx.error);});db.close();return id;
        }''')
        StaticHandler.account_fixture['user'] = {'id': '43', 'username': 'reader-b'}
        self.page.get_by_role('button', name='Refresh connections').click()
        expect(self.page.get_by_text('Signed in as', exact=False)).to_contain_text('reader-b')
        expect(status).to_contain_text('synced', timeout=15000)

        self.assertFalse(any(user == '43' and request['entity_id'] == annotation_id
                             for user, request in StaticHandler.personal_mutations))
        pending = self.stores('books', ['readerAnnotationOutbox'])['readerAnnotationOutbox']
        self.assertTrue(any(row['annotationId'] == annotation_id and row['accountId'] == '42'
                            for row in pending))
        StaticHandler.account_fixture['user'] = {'id': '42', 'username': 'reader-a'}
        self.page.get_by_role('button', name='Refresh connections').click()
        expect(self.page.get_by_text('Signed in as', exact=False)).to_contain_text('reader-a')
        deadline = time.monotonic() + 15
        while not any(user == '42' and request['entity_id'] == annotation_id
                      for user, request in StaticHandler.personal_mutations):
            self.assertLess(time.monotonic(), deadline, 'Account A mutation did not resume')
            self.page.wait_for_timeout(50)
        expect(status).to_contain_text('synced', timeout=15000)

    def test_offline_bookmark_survives_reload_and_syncs_on_reconnect(self):
        self.import_book('Offline annotation')
        book_id = self.stores('books', ['data'])['data'][0]['id']
        StaticHandler.personal_enabled = True
        StaticHandler.personal_mutations = []
        StaticHandler.account_fixture = {
            'user': {'id': '42', 'username': 'reader'}, 'csrf_token': 'c' * 64,
            'providers': []
        }
        self.page.goto(self.origin + '/Reader-Web/connections')
        status = self.page.locator('section[aria-labelledby="reading-sync-heading"] [role="status"]')
        expect(status).to_contain_text('synced', timeout=15000)
        self.page.goto(self.origin + '/Reader-Web/b?id=' + str(book_id))
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false', timeout=35000)
        self.page.evaluate('''async () => {await navigator.serviceWorker.ready;
          if (!navigator.serviceWorker.controller) await new Promise(resolve =>
            navigator.serviceWorker.addEventListener('controllerchange', resolve, {once:true}));}''')
        self.context.set_offline(True)
        self.page.get_by_role('button', name='Show reading controls', exact=True).click()
        self.page.get_by_role('button', name='Bookmarks and Notes', exact=True).click()
        self.page.get_by_role('button', name='Add Bookmark', exact=True).click()
        expect(self.page.get_by_label('Saved annotations').get_by_text('Bookmark', exact=False)).to_be_visible()
        annotation = self.stores('books', ['readerAnnotation'])['readerAnnotation'][0]
        self.assertFalse(any(request['kind'] == 'annotation'
                             for _, request in StaticHandler.personal_mutations))
        if self.engine != 'webkit':
            self.page.get_by_role('dialog', name='Bookmarks & Notes').get_by_role('button', name='Close').click()
            self.page.reload()
            expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false', timeout=35000)
            self.page.get_by_role('button', name='Show reading controls', exact=True).click()
            self.page.get_by_role('button', name='Bookmarks and Notes', exact=True).click()
            expect(self.page.get_by_label('Saved annotations').get_by_text('Bookmark', exact=False)).to_be_visible()
        # Playwright WebKit's set_offline prevents even a controlled service
        # worker from serving a URL already present in CacheStorage. Cover its
        # offline edit/reconnect path here; Chromium covers offline reload.
        self.assertEqual(annotation['id'], self.stores('books', ['readerAnnotation'])['readerAnnotation'][0]['id'])
        self.context.set_offline(False)
        self.page.evaluate("window.dispatchEvent(new Event('online'))")
        deadline = time.monotonic() + 15
        while not any(user == '42' and request['entity_id'] == annotation['id']
                      for user, request in StaticHandler.personal_mutations):
            self.assertLess(time.monotonic(), deadline, 'Offline bookmark did not sync')
            self.page.wait_for_timeout(50)


if __name__ == '__main__':
    unittest.main(verbosity=2)
