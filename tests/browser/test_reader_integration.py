"""Integration regressions against real imports, native storage, and the static UI."""
from playwright.sync_api import expect
from test_books_library import LibraryBase, book
import test_shared_ttu as shared


class ReaderIntegration(LibraryBase):
    seed_shared_source = shared.SharedTtuBrowser.seed_shared_source
    read_shared_files = shared.SharedTtuBrowser.read_shared_files

    def test_shared_library_preserves_same_title_copies_without_duplicate_rows(self):
        title = 'Two distinct local copies'
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files([
            {'name': 'first.epub', 'mimeType': 'application/epub+zip',
             'buffer': book(title, body='<p>First edition. 日本語の文章。</p>')},
            {'name': 'second.epub', 'mimeType': 'application/epub+zip',
             'buffer': book(title, body='<p>Second edition. 異なる文章。</p>')},
        ])
        expect(self.page.get_by_role('button', name='Read ' + title, exact=True)).to_have_count(2)
        before = self.stores('books', ['data', 'bookmark', 'readerStatistic'])
        self.assertEqual(2, len(before['data']))
        self.seed_shared_source()
        self.page.goto(self.origin + '/reader-web/shared-library')
        navigation = self.page.get_by_role('navigation', name='Reader navigation', exact=True)
        links = navigation.get_by_role('link')
        expect(links).to_have_count(3)
        bounds = [links.nth(i).bounding_box() for i in range(3)]
        for left, right in zip(bounds, bounds[1:]):
            self.assertGreaterEqual(right['x'] - left['x'] - left['width'], 11)
        publish = self.page.get_by_role('region', name='Publish browser books', exact=True)
        choice = publish.get_by_role('checkbox', name=title, exact=True)
        expect(choice).to_have_count(1)
        expect(choice).to_be_disabled()
        expect(publish.get_by_text('2 local copies share this title.', exact=False)).to_be_visible()
        expect(publish.get_by_role('button', name='Publish selected browser books')).to_be_disabled()
        self.assertEqual(before, self.stores('books', ['data', 'bookmark', 'readerStatistic']))
        self.assertEqual({}, self.read_shared_files())
        # Ambiguity must not block a different, unambiguous title in the same folder.
        self.go_library()
        self.import_book('A unique local book')
        self.page.goto(self.origin + '/reader-web/shared-library')
        self.page.get_by_role('checkbox', name='A unique local book', exact=True).check()
        self.page.get_by_role('button', name='Publish selected browser books').click()
        expect(self.page.get_by_role('status')).to_contain_text('published in Ttu Ebook Reader format')
        self.assertEqual(['A unique local book'], list(self.read_shared_files()))
        expect(choice).to_be_disabled()

    def test_shared_publish_list_does_not_reveal_another_accounts_book(self):
        title = 'Other account private book'
        self.import_book(title)
        stored = self.stores('books', ['data'])['data'][0]
        self.seed_shared_source()
        self.page.evaluate('''async book => {
            await new Promise((resolve, reject) => {
                const open = indexedDB.open('manabi-reader-integrations');
                open.onerror = () => reject(open.error);
                open.onsuccess = () => {
                    const db = open.result, tx = db.transaction('books', 'readwrite');
                    tx.objectStore('books').put({id:'foreign-book-link', bookId:book.id,
                        owner:'other-account', sourceId:'foreign-cloud', root:'/', fileId:'foreign-file',
                        title:book.title, name:book.title+'.epub', contentHash:book.contentHash,
                        syncEnabled:false});
                    tx.oncomplete = () => { db.close(); resolve(); };
                    tx.onabort = () => { db.close(); reject(tx.error); };
                };
            });
        }''', stored)
        self.go_library()
        expect(self.page.get_by_role('button', name='Read ' + title, exact=True)).to_have_count(0)
        self.page.goto(self.origin + '/reader-web/shared-library')
        expect(self.page.get_by_role('button', name='Refresh shared library')).to_be_enabled()
        expect(self.page.get_by_role('region', name='Publish browser books').get_by_text(title, exact=True)).to_have_count(0)
        self.assertEqual({}, self.read_shared_files())
        self.assertEqual(1, len(self.stores('books', ['data'])['data']))
