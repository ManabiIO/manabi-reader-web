"""Review regressions using the real static app, IDB, two tabs and WebDAV HTTP fixture."""
import unittest
from unittest.mock import patch
from playwright.sync_api import expect
from test_local_library_features import LocalFeatureBrowser, DavHandler, TITLE, archive_files, zip_bytes, yatsu_fixture


class LocalLibraryReview(LocalFeatureBrowser):
    def test_search_rebuilds_damaged_and_legacy_projection_cache(self):
        self.import_book('Cache recovery', body='<p>CACHE_RECOVERY 本を読む。</p>')
        self.search('CACHE_RECOVERY')
        hit = self.page.get_by_role('button', name='Open passage in Cache recovery: CACHE_RECOVERY', exact=True)
        expect(hit).to_be_visible()
        self.wait_rows('readerSearchProjection', lambda rows: len(rows)==1)
        # These are real saved cache rows; the immutable source and fingerprint remain unchanged.
        for damage in ('text', 'shape', 'legacy'):
            self.search('unmatched query')
            expect(self.page.get_by_text('No content matches.', exact=True)).to_be_visible()
            self.page.evaluate("""async damage => {
                const db = await new Promise((resolve, reject) => {
                    const r = indexedDB.open('books'); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error);
                });
                try { await new Promise((resolve, reject) => {
                    const tx = db.transaction('readerSearchProjection','readwrite'), store = tx.objectStore('readerSearchProjection');
                    tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error);
                    const get = store.getAll(); get.onsuccess = () => {
                        const row = get.result[0];
                        if (damage === 'text') row.resources[0].text = 'WRONG_CACHED_TEXT';
                        else if (damage === 'shape') row.resources = [{}];
                        else delete row.digest;
                        store.put(row);
                    };
                }); } finally { db.close(); }
            }""", damage)
            self.search('CACHE_RECOVERY')
            expect(hit).to_be_visible()
            expect(self.page.get_by_text('1 books could not be searched.', exact=False)).to_have_count(0)
            row = self.stores('books', ['readerSearchProjection'])['readerSearchProjection'][0]
            self.assertIn('CACHE_RECOVERY', row['resources'][0]['text'])
            self.assertRegex(row.get('digest',''), r'^[a-f0-9]{64}$')


    def open_notebook(self, page):
        page.get_by_role('button', name='Show reading controls', exact=True).click()
        page.get_by_role('button', name='Bookmarks and Notes', exact=True).click()
        notebook = page.get_by_role('region', name='Imported Yatsu notes', exact=True)
        expect(notebook.get_by_text('A book-wide note', exact=True)).to_be_visible()
        return notebook


    def test_yatsu_concurrent_note_edits_and_deletes_require_reload(self):
        self.open_migration(); self.migrate()
        self.page.get_by_role('link', name='Read '+TITLE, exact=True).click()
        notebook = self.open_notebook(self.page)
        other = self.context.new_page()
        try:
            other.goto(self.page.url)
            remote = self.open_notebook(other)
            notebook.get_by_role('button', name='Edit imported note', exact=True).click()
            notebook.get_by_label('Note', exact=True).fill('Draft in first tab')
            remote.get_by_role('button', name='Edit imported note', exact=True).click()
            remote.get_by_label('Note', exact=True).fill('Saved in second tab')
            remote.get_by_role('button', name='Save imported note', exact=True).click()
            expect(remote.get_by_text('Saved in second tab', exact=True)).to_be_visible()
            notebook.get_by_role('button', name='Save imported note', exact=True).click()
            expect(notebook.get_by_role('alert')).to_contain_text('changed since it was opened')
            expect(notebook.get_by_label('Note', exact=True)).to_have_value('Draft in first tab')
            row = next(r for r in self.stores('books', ['readerImportRecord'])['readerImportRecord'] if r['part']=='notes')
            self.assertEqual('Saved in second tab', row['body'])
            notebook.get_by_role('button', name='Reload latest notes', exact=True).click()
            expect(notebook.get_by_text('Saved in second tab', exact=True)).to_be_visible()
            notebook.get_by_role('button', name='Edit imported note', exact=True).click()
            notebook.get_by_label('Note', exact=True).fill('Saved after reload')
            notebook.get_by_role('button', name='Save imported note', exact=True).click()
            expect(notebook.get_by_text('Saved after reload', exact=True)).to_be_visible()
            remote.get_by_role('button', name='Remove imported note', exact=True).click()
            expect(remote.get_by_role('alert')).to_contain_text('changed since it was opened')
            row = next(r for r in self.stores('books', ['readerImportRecord'])['readerImportRecord'] if r['part']=='notes')
            self.assertEqual('Saved after reload', row['body'])
            self.assertFalse(row.get('deletedAt'))
        finally:
            other.close()


    def test_webdav_partial_text_response_is_not_imported_as_a_whole_book(self):
        self.dav.state['files'] = {'/Books/Partial.txt': 'これは本の途中まで。'.encode()}
        original_send = DavHandler.send

        def partial_response(handler, code, *args, **kwargs):
            if handler.command == 'GET' and handler.path.endswith('/Partial.txt'):
                code = 206
            return original_send(handler, code, *args, **kwargs)

        # The fixture server sends a real 206 response; browser fetch is not mocked.
        with patch.object(DavHandler, 'send', partial_response):
            self.configure_dav()
            self.page.get_by_role('button', name='Browse Test DAV', exact=True).click()
            self.page.get_by_role('button', name='Import Partial.txt', exact=True).click()
            expect(self.page.get_by_text('Unexpected WebDAV GET response: HTTP 206.', exact=False)).to_be_visible()
            self.assertEqual([], self.stores('books', ['data'])['data'])
            self.assertEqual([], self.stores('manabi-reader-integrations', ['books'])['books'])

    def test_yatsu_failed_preference_write_is_not_acknowledged_and_can_retry(self):
        self.context.add_init_script("""localStorage.setItem('fontSize', '20');
          localStorage.setItem('writingMode', 'vertical-rl');""")
        files = archive_files(yatsu_fixture())
        files['yatsu-local-settings.json'] = dict(app='Yatsu Reader', schemaVersion=1,
            settings={'fontSize': 26, 'writingMode': 'horizontal-tb'})
        self.open_migration(zip_bytes(files))
        settings = self.page.get_by_role('article').filter(has_text='Safe reader settings')
        self.page.get_by_text('Data to import', exact=True).click()
        self.page.get_by_label('Safe reader settings (optional)', exact=True).check()
        settings.get_by_role('checkbox').check()
        self.page.evaluate("""() => {
          window.originalSetItem = Storage.prototype.setItem;
          Storage.prototype.setItem = function(key, value) {
            if (key === 'writingMode' && value === 'horizontal-tb')
              throw new DOMException('Preference write failed', 'QuotaExceededError');
            return window.originalSetItem.call(this, key, value);
          };
        }""")
        try:
            self.migrate()
            expect(settings).to_contain_text('Not enough browser storage. This item was not imported')
            self.assertEqual('20', self.page.evaluate("localStorage.getItem('fontSize')"))
            self.assertEqual('vertical-rl', self.page.evaluate("localStorage.getItem('writingMode')"))
            self.assertIsNone(self.page.evaluate("localStorage.getItem('manabi-yatsu-settings-receipt-v1')"))
        finally:
            self.page.evaluate('() => { Storage.prototype.setItem = window.originalSetItem; }')
        self.migrate()
        self.assertEqual('26', self.page.evaluate("localStorage.getItem('fontSize')"))
        self.assertEqual('horizontal-tb', self.page.evaluate("localStorage.getItem('writingMode')"))
        self.assertIsNotNone(self.page.evaluate("localStorage.getItem('manabi-yatsu-settings-receipt-v1')"))


def load_tests(loader, _tests, _pattern):
    # Run only this pass's regressions here. The parent suite is run separately.
    return unittest.TestSuite(LocalLibraryReview(name) for name in LocalLibraryReview.__dict__
        if name.startswith('test_'))
