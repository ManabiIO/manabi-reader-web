"""Real browser coverage for cached account ownership without network authority."""
import re
import time

from playwright.sync_api import expect
from test_books_library import LibraryBase
from test_static_reader import StaticHandler


class OfflineAccountProfile(LibraryBase):
    def tearDown(self):
        try:
            super().tearDown()
        finally:
            StaticHandler.account_fixture = None

    def test_owned_book_opens_offline_and_disappears_after_confirmed_signout(self):
        self.import_book('Account-only book')
        book = self.stores('books', ['data'])['data'][0]
        book_id = book['id']
        self.page.evaluate('''async ({bookId, contentHash}) => {
          const open = name => new Promise((resolve, reject) => {
            const request = indexedDB.open(name);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const commit = tx => new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onabort = () => reject(tx.error);
            tx.onerror = () => reject(tx.error);
          });
          const integration = await open('manabi-reader-integrations');
          const link = integration.transaction('books', 'readwrite');
          link.objectStore('books').put({
            id:'account-only-link', sourceId:'account-source', owner:'42', root:'',
            fileId:'account-file', name:'Account-only book.epub', contentHash,
            bookId, title:'Account-only book', syncEnabled:false
          });
          await commit(link); integration.close();
          const books = await open('books');
          const scope = books.transaction('readerBookScope', 'readwrite');
          scope.objectStore('readerBookScope').put({bookId, accountId:'42'});
          await commit(scope); books.close();
        }''', {'bookId': book_id, 'contentHash': book['contentHash']})
        StaticHandler.account_fixture = {
            'user': {'id': '42', 'username': 'reader-a'},
            'csrf_token': 'c' * 64, 'providers': []
        }
        self.page.goto(self.origin + '/reader-web/connections')
        expect(self.page.get_by_text('reader-a', exact=True)).to_be_visible()
        self.page.goto(self.origin + '/reader-web/manage')
        expect(self.page.get_by_role('button', name='Read Account-only book', exact=True)).to_be_visible()
        self.page.goto(self.origin + '/reader-web/b?id=' + str(book_id))
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false', timeout=35000)
        self.page.evaluate('''async () => { await navigator.serviceWorker.ready;
          if (!navigator.serviceWorker.controller) await new Promise(resolve =>
            navigator.serviceWorker.addEventListener('controllerchange', resolve, {once:true})); }''')
        if self.engine != 'webkit':
            self.context.set_offline(True)
            self.page.reload()
            expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false', timeout=35000)
            self.context.set_offline(False)
        other = self.context.new_page()
        other.goto(self.origin + '/reader-web/connections')
        StaticHandler.account_fixture['user'] = None
        other.evaluate("localStorage.removeItem('manabi-reader-local-profile-v1')")
        expect(self.page).to_have_url(re.compile(r'/reader-web/manage(?:[/?#]|$)'))
        other.close()
        self.page.goto(self.origin + '/reader-web/connections')
        self.page.get_by_role('button', name='Refresh connections', exact=True).click()
        expect(self.page.get_by_text('Signed in as', exact=False)).to_have_count(0)
        assert self.page.evaluate("localStorage.getItem('manabi-reader-local-profile-v1')") is None
        self.page.goto(self.origin + '/reader-web/manage')
        expect(self.page.get_by_role('button', name='Read Account-only book', exact=True)).to_have_count(0)
        self.page.goto(self.origin + '/reader-web/b?id=' + str(book_id))
        expect(self.page).to_have_url(re.compile(r'/reader-web/manage(?:[/?#]|$)'))
        expect(self.page.locator('.book-content')).to_have_count(0)

    def test_account_annotation_is_hidden_on_a_public_book_after_signout(self):
        self.import_book('Public local book')
        book_id = self.stores('books', ['data'])['data'][0]['id']
        StaticHandler.account_fixture = {
            'user': {'id': '42', 'username': 'reader-a'},
            'csrf_token': 'c' * 64, 'providers': []
        }
        self.page.goto(self.origin + '/reader-web/connections')
        expect(self.page.get_by_text('reader-a', exact=True)).to_be_visible()
        self.page.goto(self.origin + '/reader-web/b?id=' + str(book_id))
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false', timeout=35000)
        self.page.get_by_role('button', name='Show reading controls', exact=True).click()
        self.page.get_by_role('button', name='Bookmarks and Notes', exact=True).click()
        self.page.get_by_role('button', name='Add Bookmark', exact=True).click()
        saved = self.page.get_by_label('Saved annotations')
        expect(saved.get_by_text('Bookmark', exact=False)).to_be_visible()
        deadline = time.monotonic() + 10
        while True:
            scopes = self.stores('books', ['readerAnnotationScope'])['readerAnnotationScope']
            if scopes:
                self.assertEqual('42', scopes[0]['accountId'])
                break
            self.assertLess(time.monotonic(), deadline, 'Bookmark scope did not commit.')
            self.page.wait_for_timeout(25)
        StaticHandler.account_fixture['user'] = None
        self.page.goto(self.origin + '/reader-web/connections')
        self.page.get_by_role('button', name='Refresh connections', exact=True).click()
        self.page.goto(self.origin + '/reader-web/b?id=' + str(book_id))
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false', timeout=35000)
        self.page.get_by_role('button', name='Show reading controls', exact=True).click()
        self.page.get_by_role('button', name='Bookmarks and Notes', exact=True).click()
        expect(self.page.get_by_label('Saved annotations').get_by_text(
            'No saved bookmarks or notes yet.', exact=True)).to_be_visible()
