"""Organization sync must update an already-open Library in another tab."""
import copy
import unittest

from playwright.sync_api import expect
from test_books_library import LibraryBase
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


if __name__ == '__main__':
    unittest.main(verbosity=2)
