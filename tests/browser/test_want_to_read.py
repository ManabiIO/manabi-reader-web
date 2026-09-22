"""Browser acceptance for the built-in Want to Read collection."""
import re
import unittest
import time
import hashlib
import tempfile
import os
from pathlib import Path

from playwright.sync_api import expect

from test_books_library import LibraryBase, book
from test_static_reader import StaticHandler


class WantToReadBrowser(LibraryBase):
    def setUp(self):
        super().setUp()
        StaticHandler.account_fixture = None
        StaticHandler.account_requests = []
        StaticHandler.preference_revision = 0
        StaticHandler.preference_settings = {}

    def tearDown(self):
        StaticHandler.account_fixture = None
        StaticHandler.account_requests = []
        StaticHandler.preference_revision = 0
        StaticHandler.preference_settings = {}
        super().tearDown()

    def wait_for_wishlist_count(self, count):
        deadline = time.monotonic() + 20
        while True:
            rows = self.stores('manabi-reader-integrations', ['metadata'])['metadata']
            organization = next((value for value in rows
                                 if value.get('version') == 1 and 'collections' in value), None)
            wishlist = next((item for item in organization['collections']
                             if item['id'] == 'want-to-read'), None) if organization else None
            if wishlist and len(wishlist['members']) == count:
                return wishlist
            self.assertLess(time.monotonic(), deadline, 'Want to Read membership was not committed')
            self.page.wait_for_timeout(25)

    def import_bytes(self, title, contents, filename=None):
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files({
            'name': (filename or title) + '.epub', 'mimeType': 'application/epub+zip', 'buffer': contents
        })
        expect(self.page.get_by_role('button', name='Read ' + title, exact=True)).to_be_visible(timeout=30000)

    def seed_legacy_identity(self, title, *, custom_name='Legacy shelf', presentation=True):
        return self.page.evaluate('''async ({title, customName, presentation}) => {
          const open = (name) => new Promise((resolve, reject) => {
            const request = indexedDB.open(name);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const books = await open('books');
          const data = await new Promise((resolve, reject) => {
            const tx = books.transaction('data');
            const request = tx.objectStore('data').index('title').get(title);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          if (!data) throw new Error('Missing seeded book');
          const id = data.id;
          delete data.contentHash;
          data.lastBookModified = 1;
          await new Promise((resolve, reject) => {
            const tx = books.transaction('data', 'readwrite');
            tx.objectStore('data').put(data);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
          });
          books.close();
          const integrations = await open('manabi-reader-integrations');
          const organization = await new Promise((resolve, reject) => {
            const tx = integrations.transaction('metadata');
            const request = tx.objectStore('metadata').get('books-organization-v1');
            request.onsuccess = () => resolve(request.result || {version: 1, collections: [], books: {}});
            request.onerror = () => reject(request.error);
          });
          organization.collections = organization.collections.filter(item => item.id !== 'want-to-read' && item.name !== customName);
          organization.collections.push({id: 'want-to-read', name: 'Want to Read', members: ['book:' + id]});
          organization.collections.push({id: 'legacy-custom', name: customName, members: ['book:' + id]});
          if (presentation) {
            organization.books['book:' + id] = {
              title: 'Legacy override',
              cover: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/ZkAAAAASUVORK5CYII=',
              modifiedAt: 2
            };
          }
          await new Promise((resolve, reject) => {
            const tx = integrations.transaction('metadata', 'readwrite');
            tx.objectStore('metadata').put(organization, 'books-organization-v1');
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
          });
          integrations.close();
          return id;
        }''', {'title': title, 'customName': custom_name, 'presentation': presentation})

    def screenshot(self, name):
        directory = os.environ.get('WANT_TO_READ_SCREENSHOT_DIR')
        if directory:
            Path(directory).mkdir(parents=True, exist_ok=True)
            self.page.screenshot(path=str(Path(directory) / f'{self.engine}-{name}.png'), full_page=True)

    def test_builtin_collection_exists_when_empty_and_supports_url_views(self):
        self.page.set_viewport_size({'width': 1200, 'height': 900})
        rail = self.page.get_by_role('complementary', name='Collections', exact=True)
        expect(rail.get_by_role('button', name=re.compile(r'^Want to Read\b'))).to_be_visible()
        rail.get_by_role('button', name=re.compile(r'^Want to Read\b')).click()
        expect(self.page.get_by_role('heading', name='Want to Read', exact=True)).to_be_visible()
        expect(self.page.locator('.shelf-item')).to_have_count(0)
        self.screenshot('desktop-empty')
        self.assertIn('collection=want-to-read', self.page.url)
        await_ghost = self.page.evaluate('''async () => {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('manabi-reader-integrations');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            const tx = db.transaction('metadata', 'readwrite');
            const store = tx.objectStore('metadata');
            const value = await new Promise((resolve, reject) => {
              const request = store.get('books-organization-v1');
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            const row = value ?? {version: 1, collections: [], books: {}};
            row.collections = row.collections.filter(item => item.id !== 'want-to-read');
            row.collections.push({id: 'want-to-read', name: 'Want to Read', members: ['content:' + '0'.repeat(64)]});
            store.put(row, 'books-organization-v1');
            await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
          } finally { db.close(); }
        }''')
        self.assertIsNone(await_ghost)
        self.page.reload()
        rail = self.page.get_by_role('complementary', name='Collections', exact=True)
        expect(rail.get_by_role('button', name='Want to Read 0', exact=True)).to_be_visible()

        # The URL is a durable destination, including direct load and browser back.
        destination = self.page.url
        self.page.goto(self.origin + '/Reader-Web/manage')
        self.page.goto(destination)
        expect(self.page.get_by_role('heading', name='Want to Read', exact=True)).to_be_visible()
        self.page.go_back()
        expect(self.page).to_have_url(self.origin + '/Reader-Web/manage')
        self.page.go_forward()
        expect(self.page.get_by_role('heading', name='Want to Read', exact=True)).to_be_visible()

        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.page.reload()
        self.page.get_by_role('button', name='Collections', exact=True).click()
        sheet = self.page.locator('#library-collections-sheet')
        expect(sheet.get_by_role('button', name=re.compile(r'^Want to Read\b'))).to_be_visible()
        expect(sheet.get_by_role('button', name='Want to Read 0', exact=True)).to_be_visible()
        sheet.get_by_role('button', name=re.compile(r'^Want to Read\b')).click()
        expect(self.page.get_by_role('heading', name='Want to Read', exact=True)).to_be_visible()
        expect(sheet).to_have_count(0)
        browse = self.page.get_by_role('button', name='Browse Library', exact=True)
        expect(browse).to_be_visible()
        self.assertGreaterEqual(browse.bounding_box()['height'], 44)

    def test_book_menu_and_collection_dialog_preserve_other_membership(self):
        self.import_book('Wishlist one')
        self.import_book('Wishlist two')
        self.add_collection('Wishlist one', 'Also saved')

        self.menu('Wishlist one', 'Add to Want to Read')
        self.wait_for_wishlist_count(1)
        self.menu('Wishlist two', 'Add to Collection…')
        dialog = self.dialog()
        expect(dialog.get_by_role('checkbox', name='Want to Read', exact=True)).to_be_visible()
        dialog.get_by_role('checkbox', name='Want to Read', exact=True).check()
        dialog.get_by_role('button', name='Done', exact=True).click()
        expect(dialog).to_have_count(0)

        collections = self.stores('manabi-reader-integrations', ['metadata'])['metadata']
        organization = next(value for value in collections if value.get('version') == 1 and 'collections' in value)
        wishlist = next(value for value in organization['collections'] if value['id'] == 'want-to-read')
        self.assertEqual('Want to Read', wishlist['name'])
        self.assertEqual(2, len(wishlist['members']))
        self.assertTrue(all(member.startswith('content:') and len(member) == 72 for member in wishlist['members']))
        self.assertEqual(1, len(next(value for value in organization['collections'] if value['name'] == 'Also saved')['members']))

        self.choose_collection('Want to Read')
        expect(self.page.get_by_role('heading', name='Want to Read', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Read Wishlist one', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Read Wishlist two', exact=True)).to_be_visible()
        self.menu('Wishlist one', 'Remove from Want to Read')
        expect(self.page.get_by_role('button', name='Read Wishlist one', exact=True)).to_have_count(0)
        expect(self.page.get_by_role('button', name='Read Wishlist two', exact=True)).to_be_visible()
        self.page.reload()
        expect(self.page.get_by_role('button', name='Read Wishlist one', exact=True)).to_have_count(0)
        expect(self.page.get_by_role('button', name='Read Wishlist two', exact=True)).to_be_visible()

    def test_legacy_local_want_to_read_survives_older_empty_remote_organization(self):
        self.import_book('Legacy synced book')
        legacy_id = self.seed_legacy_identity('Legacy synced book', presentation=False)
        self.page.reload()
        self.choose_collection('Want to Read')
        expect(self.page.get_by_role('button', name='Read Legacy synced book', exact=True)).to_be_visible()
        self.screenshot('desktop-legacy-local')

        StaticHandler.account_fixture = {
            'user': {'id': '42', 'username': 'reader'}, 'csrf_token': 'c' * 64, 'providers': []
        }
        StaticHandler.preference_revision = 7
        StaticHandler.preference_settings = {
            'library_organization': {'version': 1, 'collections': [], 'books': {}}
        }
        self.page.goto(self.origin + '/Reader-Web/connections')
        self.page.get_by_label('Sync reader settings with this Manabi account', exact=True).check()
        expect(self.page.get_by_role('status', name='Settings sync status')).to_contain_text('synced')
        self.go_library()
        self.choose_collection('Want to Read')
        expect(self.page.get_by_role('button', name='Read Legacy synced book', exact=True)).to_be_visible()
        committed = self.wait_for_wishlist_count(1)
        self.assertIn('book:' + str(legacy_id), committed['members'])
        uploads = [request for request in StaticHandler.account_requests if request['method'] == 'PUT']
        self.assertTrue(uploads)
        for request in uploads:
            shared = request['body']['settings']['library_organization']
            self.assertNotIn('book:' + str(legacy_id), str(shared))
            self.assertTrue(all(member.startswith('content:') for collection in shared['collections'] for member in collection['members']))

    def test_real_export_backup_restore_promotes_legacy_aliases_and_reading_state(self):
        contents = book('Legacy backup book')
        self.import_bytes('Legacy backup book', contents)
        original = next(item for item in self.stores('books', ['data'])['data'] if item['title'] == 'Legacy backup book')
        expected_hash = hashlib.sha256(contents).hexdigest()
        self.page.evaluate('''title => new Promise((resolve, reject) => {
          const open = indexedDB.open('books');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction('statistic', 'readwrite');
            tx.objectStore('statistic').put({title, dateKey: '2026-09-20', charactersRead: 60,
              readingTime: 300, lastStatisticModified: 1000});
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => reject(tx.error);
          };
        })''', 'Legacy backup book')
        seeded_statistics = self.stores('books', ['statistic'])['statistic']
        self.menu('Legacy backup book', 'Mark as Finished')
        self.wait_bookmark(original['id'], lambda row: row.get('completion', {}).get('state') == 'finished')

        self.page.get_by_role('button', name='Library actions', exact=True).click()
        self.page.get_by_role('menuitem', name='Select Books', exact=True).click()
        self.page.get_by_role('button', name='Select all', exact=True).click()
        expect(self.page.get_by_text('1 selected', exact=True)).to_be_visible()
        self.page.get_by_role('button', name='Export', exact=True).click()
        self.page.get_by_role('button', name='Zip File', exact=True).click()
        for label in ('Book Data', 'Bookmark', 'Statistics'):
            self.page.get_by_label(label, exact=True).check()
        with self.page.expect_download(timeout=60000) as pending:
            self.page.get_by_role('button', name='Start', exact=True).click()
        raw = Path(pending.value.path()).read_bytes()
        # The exported ZIP carries the original content identity. Make the
        # existing local record legacy only after export, so restore must
        # promote the identity supplied by the backup into its retained ID.
        self.seed_legacy_identity('Legacy backup book')
        self.page.reload()

        self.page.get_by_role('button', name='Library actions', exact=True).click()
        self.page.get_by_role('menuitem', name='Add Books', exact=True).hover()
        self.page.get_by_role('menuitem', name='Import Backup', exact=True).click()
        chooser = self.page.locator('input[type=file][accept=".zip,application/zip"]')
        chooser.set_input_files({'name': 'legacy-backup.zip', 'mimeType': 'application/zip', 'buffer': raw})
        deadline = time.monotonic() + 60
        while True:
            restored = next(item for item in self.stores('books', ['data'])['data']
                            if item['title'] == 'Legacy backup book')
            organization = next(value for value in self.stores('manabi-reader-integrations', ['metadata'])['metadata']
                                if value.get('version') == 1 and 'collections' in value)
            aliases = [member for collection in organization['collections'] for member in collection['members']]
            if restored.get('contentHash') == expected_hash and 'content:' + expected_hash in aliases:
                break
            self.assertLess(time.monotonic(), deadline, 'backup import was not committed')
            self.page.wait_for_timeout(50)
        self.assertEqual(expected_hash, restored.get('contentHash'))
        self.assertEqual(original['id'], restored['id'])
        self.assertIn('content:' + expected_hash, aliases)
        self.assertNotIn('book:' + str(original['id']), aliases)
        self.assertIn('Legacy override', [value.get('title') for value in organization['books'].values()])
        self.assertTrue(any(value.get('cover') for value in organization['books'].values()))
        self.assertEqual(1, len(self.stores('books', ['bookmark'])['bookmark']))
        self.assertEqual(seeded_statistics, self.stores('books', ['statistic'])['statistic'])
        self.screenshot('desktop-backup-restored')

    def test_keyboard_remove_focus_and_local_cross_tab_visibility(self):
        self.import_book('Focus first')
        self.import_book('Focus last')
        self.menu('Focus first', 'Add to Want to Read')
        self.menu('Focus last', 'Add to Want to Read')
        self.wait_for_wishlist_count(2)
        self.choose_collection('Want to Read')
        focused = self.page.get_by_role('button', name='Actions for Focus first', exact=True)
        focused.focus()
        self.page.keyboard.press('Enter')
        # Let keyboard opening focus the first item before choosing another;
        # otherwise opening autofocus can replace this programmatic focus.
        menu = self.page.get_by_role('menu')
        expect(menu.get_by_role('menuitem').first).to_be_focused()
        remove = menu.get_by_role('menuitem', name='Remove from Want to Read', exact=True)
        remove.focus()
        expect(remove).to_be_focused()
        self.page.keyboard.press('Enter')
        expect(self.page.get_by_role('button', name='Read Focus first', exact=True)).to_have_count(0)
        expect(self.page.get_by_role('button', name='Read Focus last', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Actions for Focus last', exact=True)).to_be_focused()
        self.menu('Focus last', 'Remove from Want to Read')
        expect(self.page.locator('.shelf-item')).to_have_count(0)
        expect(self.page.get_by_role('button', name='Browse Library', exact=True)).to_be_focused()
        self.choose_collection('Books')
        self.menu('Focus first', 'Add to Want to Read')
        self.menu('Focus last', 'Add to Want to Read')
        self.wait_for_wishlist_count(2)
        self.screenshot('desktop-want-to-read')

        other = self.context.new_page()
        other.set_default_timeout(20000)
        other.on('pageerror', lambda error: self.errors.append(error.stack or str(error)))
        other.goto(self.origin + '/Reader-Web/manage?collection=want-to-read')
        expect(other.get_by_role('region', name='Library shelves')).to_have_attribute('aria-busy', 'false', timeout=30000)
        expect(other.get_by_role('button', name='Read Focus first', exact=True)).to_be_visible()
        expect(other.get_by_role('button', name='Read Focus last', exact=True)).to_be_visible()
        self.menu('Focus first', 'Remove from Want to Read')
        expect(other.get_by_role('button', name='Read Focus first', exact=True)).to_have_count(0, timeout=10000)
        expect(other.get_by_role('button', name='Read Focus last', exact=True)).to_be_visible()
        other.close()

        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.page.get_by_role('button', name='Collections', exact=True).click()
        sheet = self.page.locator('#library-collections-sheet')
        self.screenshot('phone-picker')
        expect(sheet.get_by_role('button', name=re.compile(r'^Want to Read\b'))).to_be_visible()

    def test_removed_book_is_hidden_until_identical_file_returns(self):
        original = book('Returning book')
        self.import_bytes('Returning book', original)
        previous_id = self.stores('books', ['data'])['data'][0]['id']
        self.menu('Returning book', 'Add to Want to Read')
        saved = self.wait_for_wishlist_count(1)['members']
        self.menu('Returning book', 'Remove from this browser…')
        expect(self.page.get_by_role('button', name='Read Returning book', exact=True)).to_have_count(0)
        self.choose_collection('Want to Read')
        expect(self.page.locator('.shelf-item')).to_have_count(0)
        rail = self.page.get_by_role('complementary', name='Collections', exact=True)
        expect(rail.get_by_role('button', name='Want to Read 0', exact=True)).to_be_visible()
        self.assertEqual(saved, self.wait_for_wishlist_count(1)['members'])
        self.choose_collection('Books')
        self.import_bytes('Returning book', original)
        new_id = self.stores('books', ['data'])['data'][0]['id']
        self.assertNotEqual(previous_id, new_id)
        self.choose_collection('Want to Read')
        expect(self.page.get_by_role('button', name='Read Returning book', exact=True)).to_be_visible()
        expect(rail.get_by_role('button', name='Want to Read 1', exact=True)).to_be_visible()
        self.assertEqual(saved, self.wait_for_wishlist_count(1)['members'])

    def test_bulk_want_to_read_actions_and_builtin_cannot_be_edited(self):
        self.import_book('Bulk wishlist one')
        self.import_book('Bulk wishlist two')
        self.page.get_by_role('button', name='Library actions', exact=True).click()
        self.page.get_by_role('menuitem', name='Select Books', exact=True).click()
        self.page.get_by_role('button', name='Select all', exact=True).click()
        expect(self.page.get_by_text('2 selected', exact=True)).to_be_visible()
        self.page.get_by_role('button', name='Selected book actions', exact=True).click()
        self.page.get_by_role('menuitem', name='Add to Want to Read', exact=True).click()
        expect(self.page.get_by_text('2 selected', exact=True)).to_be_visible()
        # Selected actions can report completion before the organization write
        # finishes; observe the committed membership before changing scope.
        self.wait_for_wishlist_count(2)
        self.page.get_by_role('button', name='Cancel selection', exact=True).click()
        self.choose_collection('Want to Read')
        expect(self.page.get_by_role('button', name='Read Bulk wishlist one', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Read Bulk wishlist two', exact=True)).to_be_visible()
        self.page.get_by_role('button', name='Library actions', exact=True).click()
        self.page.get_by_role('menuitem', name='Select Books', exact=True).click()
        self.page.get_by_role('button', name='Select all', exact=True).click()
        expect(self.page.get_by_text('2 selected', exact=True)).to_be_visible()
        self.page.get_by_role('button', name='Selected book actions', exact=True).click()
        self.page.get_by_role('menuitem', name='Remove from Want to Read', exact=True).click()
        self.page.get_by_role('button', name='Cancel selection', exact=True).click()
        expect(self.page.locator('.shelf-item')).to_have_count(0)

        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.page.get_by_role('button', name='Collections', exact=True).click()
        sheet = self.page.locator('#library-collections-sheet')
        sheet.get_by_role('button', name='Edit', exact=True).click()
        expect(sheet.get_by_role('button', name=re.compile('^Rename collection Want to Read$'))).to_have_count(0)
        expect(sheet.get_by_role('button', name=re.compile('^Delete collection Want to Read$'))).to_have_count(0)

    def test_want_to_read_does_not_change_reading_state_and_survives_sort_search(self):
        self.import_book('Want to Read Alpha')
        self.import_book('Want to Read Beta')
        before = self.stores('books', ['bookmark', 'statistic'])
        self.menu('Want to Read Alpha', 'Add to Want to Read')
        self.menu('Want to Read Beta', 'Add to Want to Read')
        self.wait_for_wishlist_count(2)
        self.assertEqual(before, self.stores('books', ['bookmark', 'statistic']))
        self.menu('Want to Read Alpha', 'Mark as Finished')
        expect(self.tile('Want to Read Alpha').locator('.progress-label')).to_have_text('Finished')
        finished = self.stores('books', ['bookmark', 'statistic'])
        self.assertEqual(before['statistic'], finished['statistic'])
        self.assertEqual(1, len(finished['bookmark']))
        self.assertEqual('finished', finished['bookmark'][0]['completion']['state'])
        self.menu('Want to Read Alpha', 'Remove from Want to Read')
        self.menu('Want to Read Alpha', 'Add to Want to Read')
        after = self.stores('books', ['bookmark', 'statistic'])
        self.assertEqual(finished, after)
        self.assertEqual(before['statistic'], finished['statistic'])

        self.choose_collection('Want to Read')
        self.choose_view('Title')
        self.choose_view('Ascending')
        self.choose_view('List')
        expect(self.page.locator('.shelf-list')).to_be_visible()
        expect(self.page.locator('.shelf-item').first).to_contain_text('Want to Read Alpha')
        self.choose_view('Descending')
        expect(self.page.locator('.shelf-item').first).to_contain_text('Want to Read Beta')
        search = self.page.get_by_role('searchbox', name='Search library', exact=True)
        search.fill('missing title')
        expect(self.page.locator('.shelf-item')).to_have_count(0)
        search.fill('Beta')
        expect(self.page.get_by_role('button', name='Read Want to Read Beta', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Read Want to Read Alpha', exact=True)).to_have_count(0)

    def test_keyboard_touch_controls_and_account_sync_roundtrip(self):
        portable_bytes = book('Portable wishlist')
        self.import_bytes('Portable wishlist', portable_bytes)
        self.menu('Portable wishlist', 'Add to Want to Read')
        self.wait_for_wishlist_count(1)
        first_data_id = next(item['id'] for item in self.stores('books', ['data'])['data']
                             if item['title'] == 'Portable wishlist')
        organization = next(value for value in self.stores('manabi-reader-integrations', ['metadata'])['metadata']
                            if value.get('version') == 1 and 'collections' in value)
        members = next(item['members'] for item in organization['collections'] if item['id'] == 'want-to-read')

        # Exercise the responsive rail/sheet boundary and keyboard activation.
        for width in (390, 768, 1024, 1440):
            self.page.set_viewport_size({'width': width, 'height': 844})
            if width < 1024:
                trigger = self.page.get_by_role('button', name='Collections', exact=True)
                trigger.focus()
                self.page.keyboard.press('Enter')
                sheet = self.page.locator('#library-collections-sheet')
                # The sheet schedules opening autofocus. Wait for it before
                # moving focus, or its first button can steal the next Enter.
                expect(sheet.get_by_role('button', name='Edit', exact=True)).to_be_focused()
                want = sheet.get_by_role('button', name=re.compile(r'^Want to Read\b'))
            else:
                want = self.page.get_by_role('complementary', name='Collections').get_by_role(
                    'button', name=re.compile(r'^Want to Read\b'))
            want.focus()
            expect(want).to_be_focused()
            self.page.keyboard.press('Enter')
            expect(self.page.get_by_role('heading', name='Want to Read', exact=True)).to_be_visible()
            if width < 1024:
                self.page.keyboard.press('Escape')

        # Touch path uses a genuine touch-enabled browser context and real menu.
        touch_profile = tempfile.TemporaryDirectory()
        touch = getattr(self.playwright, self.engine).launch_persistent_context(
            touch_profile.name, viewport={'width': 390, 'height': 844}, is_mobile=True,
            has_touch=True, reduced_motion='reduce')
        original = self.page
        self.page = touch.pages[0]
        self.page.on('pageerror', lambda error: self.errors.append(error.stack or str(error)))
        try:
            self.go_library()
            self.import_book('Touch wishlist')
            self.page.get_by_role('button', name='Actions for Touch wishlist', exact=True).tap()
            self.page.get_by_role('menuitem', name='Add to Want to Read', exact=True).tap()
            self.choose_collection('Want to Read')
            expect(self.page.get_by_role('button', name='Read Touch wishlist', exact=True)).to_be_visible()
        finally:
            touch.close()
            touch_profile.cleanup()
            self.page = original

        # Reuse the real optional session/preferences endpoints. The synced
        # payload must retain content identity and exclude browser-local keys.
        StaticHandler.account_fixture = {
            'user': {'id': '42', 'username': 'reader'}, 'csrf_token': 'c' * 64, 'providers': []
        }
        StaticHandler.account_requests = []
        StaticHandler.preference_revision = 0
        StaticHandler.preference_settings = {}
        self.page.goto(self.origin + '/Reader-Web/connections')
        self.page.get_by_label('Sync reader settings with this Manabi account', exact=True).check()
        expect(self.page.get_by_role('status', name='Settings sync status')).to_contain_text('synced')
        deadline = time.monotonic() + 15
        while not any(request['method'] == 'PUT' and request['path'].endswith('/preferences/')
                      for request in StaticHandler.account_requests):
            self.assertLess(time.monotonic(), deadline, 'organization preference was not uploaded')
            self.page.wait_for_timeout(25)
        put = next(request for request in StaticHandler.account_requests
                   if request['method'] == 'PUT' and request['path'].endswith('/preferences/'))
        shared = put['body']['settings']['library_organization']
        remote = next(item for item in shared['collections'] if item['id'] == 'want-to-read')
        self.assertTrue(set(members).issubset(set(remote['members'])))
        self.assertTrue(all(member.startswith('content:') for member in remote['members']))

        # A second real profile receives the shared membership for identical
        # bytes even though its IndexedDB book IDs differ. A same-named EPUB
        # with different bytes must not inherit that membership by filename.
        StaticHandler.preference_settings = put['body']['settings']
        StaticHandler.preference_revision = 1
        second_profile = tempfile.TemporaryDirectory()
        second = getattr(self.playwright, self.engine).launch_persistent_context(
            second_profile.name, viewport={'width': 1200, 'height': 900})
        previous_page = self.page
        self.page = second.pages[0]
        self.page.on('pageerror', lambda error: self.errors.append(error.stack or str(error)))
        try:
            self.go_library()
            self.import_book('Unrelated sentinel')
            self.import_bytes('Portable wishlist', portable_bytes)
            variant = book('Portable wishlist variant', body='<h1>Different internal title</h1><p>Different original bytes.</p>')
            self.import_bytes('Portable wishlist variant', variant, filename='Portable wishlist')
            self.page.goto(self.origin + '/Reader-Web/connections')
            self.page.get_by_label('Sync reader settings with this Manabi account', exact=True).check()
            expect(self.page.get_by_role('status', name='Settings sync status')).to_contain_text('synced')
            self.go_library()
            self.choose_collection('Want to Read')
            expect(self.page.get_by_role('button', name='Read Portable wishlist', exact=True)).to_have_count(1)
            content = self.stores('books', ['data'])['data']
            original = next(item for item in content if item['title'] == 'Portable wishlist')
            internal_variant = next(item for item in content if item['title'] == 'Portable wishlist variant')
            sentinel = next(item for item in content if item['title'] == 'Unrelated sentinel')
            hashes = [item.get('contentHash') for item in content]
            expected = hashlib.sha256(portable_bytes).hexdigest()
            self.assertEqual(expected, original['contentHash'])
            self.assertNotEqual(original['contentHash'], internal_variant['contentHash'])
            self.assertNotEqual(original['contentHash'], sentinel['contentHash'])
            self.assertNotEqual(first_data_id, original['id'])
            self.assertEqual(3, len(set(hashes)))
            self.assertEqual([], self.stores('books', ['bookmark'])['bookmark'])
        finally:
            second.close()
            second_profile.cleanup()
            self.page = previous_page


if __name__ == '__main__':
    unittest.main(verbosity=2)
