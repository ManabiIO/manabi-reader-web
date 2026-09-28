"""Identity regressions through the built app, real IndexedDB, and fake provider I/O."""
import json
import re
import threading
import unittest

from playwright.sync_api import expect, sync_playwright

from test_books_library import LibraryBase, raster
from test_library_cloud_relocation import CloudRelocationHandler, GOOGLE, DROPBOX, BYTES
from test_static_reader import StaticHandler, ThreadingHTTPServer


class LibraryIdentityBrowser(LibraryBase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), CloudRelocationHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = 'http://127.0.0.1:' + str(cls.server.server_port)
        cls.playwright = sync_playwright().start()

    def setUp(self):
        CloudRelocationHandler.nodes = {
            GOOGLE: {'g-old': {'name': 'Original.epub', 'kind': 'file', 'parent': 'google-root'}},
            DROPBOX: {}
        }
        CloudRelocationHandler.preference_revision = 0
        CloudRelocationHandler.preference_settings = {}
        StaticHandler.account_fixture = {
            'user': {'id': '42', 'username': 'reader'},
            'csrf_token': 'c' * 64, 'providers': []
        }
        super().setUp()
        expect(self.page.get_by_role('button', name='Read Traveling volume', exact=True)).to_be_visible(
            timeout=30000)

    def tearDown(self):
        try:
            super().tearDown()
        finally:
            CloudRelocationHandler.nodes = {}
            CloudRelocationHandler.preference_revision = 0
            CloudRelocationHandler.preference_settings = {}
            StaticHandler.account_fixture = None

    def refresh(self):
        self.open_organize_menu()
        self.page.get_by_role('menuitem', name='Refresh Connected Folders', exact=True).click()
        expect(self.page.get_by_role('region', name='Library shelves')).to_have_attribute(
            'aria-busy', 'false', timeout=30000)

    def import_finished(self):
        self.menu('Traveling volume', 'Mark as Finished')
        expect(self.tile('Traveling volume').locator('.progress-label')).to_have_text('Finished')
        return self.stores('manabi-reader-integrations', ['books'])['books'][0]

    def test_reused_old_locator_preserves_the_moved_link_and_shares_progress(self):
        original = self.import_finished()
        before = self.stores('books', ['bookmark'])['bookmark'][0]['completion']
        # This is the persisted state emitted by local-series.relink: its row ID
        # remains unchanged while fileId moves. Only the storage fixture is seeded;
        # discovery, opening, hash verification and subsequent link writes are real.
        self.page.evaluate('''async link => {
          const db = await new Promise((resolve, reject) => {
            const r = indexedDB.open('manabi-reader-integrations');
            r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
          });
          const tx = db.transaction('books', 'readwrite');
          tx.objectStore('books').put({...link, fileId: 'g-moved', name: 'Moved.epub'});
          await new Promise((resolve, reject) => {
            tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
          });
          db.close();
        }''', original)
        CloudRelocationHandler.nodes[GOOGLE]['g-moved'] = {
            'name': 'Moved.epub', 'kind': 'file', 'parent': 'google-root'
        }
        for index in (0, 1):
            self.go_library()
            self.refresh()
            buttons = self.page.get_by_role('button', name='Read Traveling volume', exact=True)
            expect(buttons).to_have_count(2, timeout=30000)
            buttons.nth(index).click()
            expect(self.page.locator('.book-content')).to_have_attribute(
                'aria-busy', 'false', timeout=30000)
            self.page.wait_for_load_state('networkidle')
        links = self.stores('manabi-reader-integrations', ['books'])['books']
        self.assertEqual(2, len(links))
        self.assertEqual({'g-old', 'g-moved'}, {link['fileId'] for link in links})
        self.assertEqual({original['bookId']}, {link['bookId'] for link in links})
        self.assertEqual('g-moved', next(link['fileId'] for link in links if link['id'] == original['id']))
        self.assertEqual(1, len(self.stores('books', ['data'])['data']))
        self.assertEqual(before, self.stores('books', ['bookmark'])['bookmark'][0]['completion'])

    def test_removed_browser_records_do_not_leave_a_permanent_import_conflict(self):
        original = self.import_finished()
        self.menu('Traveling volume', 'Remove from this browser…')
        expect(self.page.locator('[data-book-key="book:%s"]' % original['bookId'])).to_have_count(0)
        self.assertEqual([], self.stores('books', ['data'])['data'])
        self.page.evaluate('''async link => {
          const db = await new Promise((resolve, reject) => {
            const r = indexedDB.open('manabi-reader-integrations');
            r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
          });
          const tx = db.transaction('books', 'readwrite');
          tx.objectStore('books').put(link);
          tx.objectStore('books').put({...link, id: 'retained-deleted-link',
            bookId: link.bookId + 1000000, fileId: 'another-removed-copy'});
          await new Promise((resolve, reject) => {
            tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
          });
          db.close();
        }''', original)
        self.go_library()
        button = self.page.get_by_role('button', name='Read Traveling volume', exact=True)
        expect(button).to_be_visible(timeout=30000)
        button.click()
        expect(self.page.locator('.book-content')).to_have_attribute(
            'aria-busy', 'false', timeout=30000)
        records = self.stores('books', ['data'])['data']
        self.assertEqual(1, len(records))
        self.assertNotEqual(original['bookId'], records[0]['id'])
        self.assertEqual(original['contentHash'], records[0]['contentHash'])

    def test_interrupted_link_publication_keeps_cloud_book_account_scoped(self):
        original = self.import_finished()
        saved = self.stores('books', ['data'])['data'][0]
        self.assertEqual('42', saved['libraryOwner'])
        self.page.evaluate('''async linkId => {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('manabi-reader-integrations');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const tx = db.transaction('books', 'readwrite');
          tx.objectStore('books').delete(linkId);
          await new Promise((resolve, reject) => {
            tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
          });
          db.close();
        }''', original['id'])
        CloudRelocationHandler.nodes[GOOGLE] = {}
        StaticHandler.account_fixture = {
            'user': {'id': 'other', 'username': 'other'},
            'csrf_token': 'c' * 64, 'providers': []
        }
        self.go_library()
        saved_tile = self.page.locator('[data-book-key="book:%s"]' % original['bookId'])
        expect(saved_tile).to_have_count(0)
        self.page.goto(self.origin + '/reader-web/b?id=' + str(original['bookId']))
        expect(self.page).to_have_url(re.compile(r'/reader-web/manage(?:[/?#]|$)'))
        expect(self.page.locator('.book-content')).to_have_count(0)
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files(
            {'name': 'Traveling volume.epub', 'mimeType': 'application/epub+zip', 'buffer': BYTES})
        expect(self.page.get_by_role('button', name='Read Traveling volume', exact=True)).to_be_visible()
        copies = self.stores('books', ['data'])['data']
        self.assertEqual(2, len(copies))
        self.assertEqual('42', next(row['libraryOwner'] for row in copies
                                    if row['id'] == original['bookId']))
        self.assertTrue(any(row['id'] != original['bookId'] and
                            row.get('libraryOwner') is None for row in copies))
        StaticHandler.account_fixture['user'] = {'id': '42', 'username': 'reader'}
        self.go_library()
        expect(saved_tile).to_be_visible(timeout=30000)

    def test_direct_exact_import_does_not_adopt_another_accounts_personal_scope(self):
        payload = b'account scoped direct import bytes\nsecond line\n'
        picker = self.page.locator('input[type=file][accept*=".epub"]').first
        picker.set_input_files({
            'name': 'Scoped.txt',
            'mimeType': 'text/plain',
            'buffer': payload
        })
        expect(self.page.get_by_role('button', name='Read Scoped', exact=True)).to_be_visible(
            timeout=30000)
        original = next(row for row in self.stores('books', ['data'])['data']
                        if row['title'] == 'Scoped')
        self.page.evaluate('''async id => {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('books');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const tx = db.transaction('readerBookScope', 'readwrite');
          tx.objectStore('readerBookScope').put({
            bookId: id, accountId: '42', hydrated: true
          });
          await new Promise((resolve, reject) => {
            tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
          });
          db.close();
        }''', original['id'])
        self.menu('Scoped', 'Mark as Finished')
        before = self.wait_bookmark(
            original['id'], lambda row: row.get('completion', {}).get('state') == 'finished')
        original_completion = before['completion']

        StaticHandler.account_fixture = {
            'user': {'id': 'other', 'username': 'other'},
            'csrf_token': 'c' * 64, 'providers': []
        }
        self.go_library()
        picker = self.page.locator('input[type=file][accept*=".epub"]').first
        picker.set_input_files({
            'name': 'Scoped-other-name.txt',
            'mimeType': 'text/plain',
            'buffer': payload
        })

        deadline = __import__('time').monotonic() + 20
        while True:
            rows = self.stores('books', ['data', 'bookmark', 'readerBookScope'])
            if len(rows['data']) == 2:
                break
            self.assertLess(__import__('time').monotonic(), deadline,
                            'second account did not receive an independent local record')
            self.page.wait_for_timeout(25)
        self.assertEqual(
            {original['id']},
            {row['bookId'] for row in rows['readerBookScope'] if row['accountId'] == '42'}
        )
        second = next(row for row in rows['data'] if row['id'] != original['id'])
        self.assertEqual(original['contentHash'], second['contentHash'])
        self.assertIsNone(second.get('libraryOwner'))
        self.assertEqual(
            original_completion,
            next(row for row in rows['bookmark'] if row['dataId'] == original['id'])['completion']
        )
        self.assertFalse(any(row['dataId'] == second['id'] for row in rows['bookmark']))

    def test_two_live_histories_at_one_locator_are_not_chosen_by_link_order(self):
        original = self.import_finished()
        duplicate_id = self.page.evaluate('''async link => {
          const open = name => new Promise((resolve, reject) => {
            const r = indexedDB.open(name);
            r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
          });
          const db = await open('books');
          const tx = db.transaction('data', 'readwrite');
          const id = link.bookId + 1000000;
          const r = tx.objectStore('data').get(link.bookId);
          r.onsuccess = () => tx.objectStore('data').put({...r.result, id, title: 'Independent history'});
          await new Promise((resolve, reject) => {
            tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
          });
          db.close();
          const integration = await open('manabi-reader-integrations');
          const write = integration.transaction('books', 'readwrite');
          write.objectStore('books').put({...link, id: 'competing-live-link', bookId: id});
          await new Promise((resolve, reject) => {
            write.oncomplete = resolve; write.onabort = () => reject(write.error);
          });
          integration.close();
          return id;
        }''', original)
        self.go_library()
        key = 'source:' + json.dumps(['42', GOOGLE, 'google-root', 'g-old'], separators=(',', ':'))
        tile = self.page.locator('[data-book-key=' + json.dumps(key) + ']')
        expect(tile).to_be_visible(timeout=30000)
        before = self.stores('books', ['data', 'bookmark'])
        tile.get_by_role('button', name='Read Traveling volume', exact=True).click()
        expect(self.page.get_by_text(re.compile('multiple saved reading histories'))).to_be_visible()
        expect(self.page.locator('.book-content')).to_have_count(0)
        self.assertEqual(before, self.stores('books', ['data', 'bookmark']))
        self.assertEqual({original['bookId'], duplicate_id}, {row['id'] for row in before['data']})

    def test_bytes_changed_after_preview_cannot_silently_select_another_book(self):
        # Change ZIP timestamp bytes without changing length or parseability:
        # the expected-hash guard, not only the size guard, must reject it.
        replacement = bytearray(BYTES)
        replacement[10] ^= 1
        CloudRelocationHandler.nodes[GOOGLE]['g-old']['bytes'] = bytes(replacement)
        self.page.get_by_role('button', name='Read Traveling volume', exact=True).click()
        expect(self.page.get_by_text(re.compile('source book changed'))).to_be_visible()
        expect(self.page.locator('.book-content')).to_have_count(0)
        self.assertEqual([], self.stores('books', ['data'])['data'])
        self.assertEqual([], self.stores('manabi-reader-integrations', ['books'])['books'])

    def test_short_successful_cloud_text_response_is_not_imported_as_a_complete_book(self):
        CloudRelocationHandler.nodes[GOOGLE] = {
            'g-text': {'name': 'Short.txt', 'kind': 'file', 'parent': 'google-root',
                       'bytes': b'This is the complete advertised book, not just a prefix.'}
        }
        self.page.route(re.compile(r'/connections/[^/]+/file/\?'), lambda route: route.fulfill(
            status=200, headers={'Content-Type': 'application/octet-stream', 'X-Manabi-User': '42'},
            body=b'This'))
        self.refresh()
        self.page.get_by_role('button', name='Read Short', exact=True).click()
        expect(self.page.get_by_text(re.compile('download does not match the selected size'))).to_be_visible()
        expect(self.page.locator('.book-content')).to_have_count(0)
        self.assertEqual([], self.stores('books', ['data'])['data'])

    def test_stale_remove_action_cannot_delete_a_now_foreign_owned_book(self):
        original = self.import_finished()
        before = self.stores('books', ['bookmark'])['bookmark']
        self.page.evaluate('''async id => {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('books');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const tx = db.transaction('data', 'readwrite');
          const store = tx.objectStore('data');
          const request = store.get(id);
          request.onsuccess = () => store.put({...request.result, libraryOwner: 'other'});
          await new Promise((resolve, reject) => {
            tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
          });
          db.close();
        }''', original['bookId'])
        self.menu('Traveling volume', 'Remove from this browser…')
        expect(self.page.get_by_text(re.compile('another account')).first).to_be_visible(timeout=30000)
        after = self.stores('books', ['data', 'bookmark'])
        self.assertEqual(before, after['bookmark'])
        self.assertEqual(1, len(after['data']))
        self.assertEqual(original['bookId'], after['data'][0]['id'])
        self.assertEqual('other', after['data'][0]['libraryOwner'])

    def organization_snapshot(self):
        rows = self.stores('manabi-reader-integrations', ['metadata'])['metadata']
        return next((row for row in rows if isinstance(row, dict)
                     and row.get('version') == 1 and 'collections' in row), None)

    def replace_selected_bytes(self):
        replacement = bytearray(BYTES)
        replacement[10] ^= 1
        CloudRelocationHandler.nodes[GOOGLE]['g-old']['bytes'] = bytes(replacement)

    def test_want_to_read_does_not_retarget_replacement_bytes(self):
        before = self.organization_snapshot()
        self.replace_selected_bytes()
        self.menu('Traveling volume', 'Add to Want to Read')
        expect(self.page.get_by_text(re.compile('source book changed')).first).to_be_visible()
        self.assertEqual(before, self.organization_snapshot())
        self.assertEqual([], self.stores('books', ['data'])['data'])
        self.assertEqual([], self.stores('manabi-reader-integrations', ['books'])['books'])

    def test_rename_does_not_apply_to_a_replacement_after_opening_the_dialog(self):
        before = self.organization_snapshot()
        self.menu('Traveling volume', 'Rename…')
        self.dialog().get_by_label('Name', exact=True).fill('Must not apply')
        self.replace_selected_bytes()
        self.dialog().get_by_role('button', name='Save', exact=True).click()
        expect(self.page.get_by_text(re.compile('source book changed')).first).to_be_visible()
        self.assertEqual(before, self.organization_snapshot())
        self.assertEqual([], self.stores('books', ['data'])['data'])

    def test_cover_uses_live_content_instead_of_the_first_stale_link(self):
        original = self.import_finished()
        stale_hash = ('1' if original['contentHash'].startswith('0') else '0') + original['contentHash'][1:]
        self.page.evaluate('''async ({link, hash}) => {
          const db = await new Promise((resolve, reject) => {
            const r = indexedDB.open('manabi-reader-integrations');
            r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
          });
          const tx = db.transaction('books', 'readwrite');
          tx.objectStore('books').put({...link, id: '!stale-content-claim',
            fileId: 'unavailable-old-file', contentHash: hash});
          await new Promise((resolve, reject) => {
            tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
          });
          db.close();
        }''', {'link': original, 'hash': stale_hash})
        self.go_library()
        with self.page.expect_file_chooser() as chooser:
            self.menu('Traveling volume', 'Change Cover…')
        chooser.value.set_files({
            'name': 'cover.png', 'mimeType': 'image/png',
            'buffer': raster(120, 180, (40, 120, 180))
        })
        expect(self.tile('Traveling volume').locator('img').first).to_have_attribute(
            'src', re.compile(r'^data:image/(?:png|webp);base64,'))
        organization = self.organization_snapshot()
        self.assertTrue(organization['books']['content:' + original['contentHash']]['cover'])
        self.assertFalse(organization['books'].get('content:' + stale_hash, {}).get('cover'))
        self.assertEqual(2, len(self.stores('manabi-reader-integrations', ['books'])['books']))

    def test_stale_cached_completion_cannot_modify_a_newly_foreign_book(self):
        original = self.import_finished()
        before = self.stores('books', ['bookmark'])['bookmark']
        # Retain the already-rendered shelf while a competing writer changes the
        # durable ownership. The command must check the row, not trust that UI.
        self.page.evaluate('''async id => {
          const db = await new Promise((resolve, reject) => {
            const r = indexedDB.open('books');
            r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
          });
          const tx = db.transaction('data', 'readwrite');
          const r = tx.objectStore('data').get(id);
          r.onsuccess = () => tx.objectStore('data').put({...r.result, libraryOwner: 'other'});
          await new Promise((resolve, reject) => {
            tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
          });
          db.close();
        }''', original['bookId'])
        self.menu('Traveling volume', 'Mark as Still Reading')
        expect(self.page.get_by_text('This book belongs to another account.', exact=True)).to_be_visible()
        self.assertEqual(before, self.stores('books', ['bookmark'])['bookmark'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
