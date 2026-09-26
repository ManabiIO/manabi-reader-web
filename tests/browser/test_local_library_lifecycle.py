"""Connection consent/lifetime and imported-note recovery using the real app."""
import json
import hashlib
import time
import unittest
from playwright.sync_api import expect
from test_local_library_features import LocalFeatureBrowser


class LocalLibraryLifecycle(LocalFeatureBrowser):
    def connection_row(self):
        return next(row for row in self.stores('manabi-reader-integrations', ['metadata'])['metadata']
                    if isinstance(row, dict) and str(row.get('id', '')).startswith('webdav-'))

    def edit_connection(self):
        self.page.get_by_role('button', name='Unlock or edit Test DAV', exact=True).click()
        return self.page.get_by_role('form', name='WebDAV connection', exact=True)

    def hold_source_lock(self, source_id):
        self.page.evaluate("""async id => {
            window.sourceLockHeld = new Promise(acquired => {
                window.sourceLockWork = navigator.locks.request('manabi-reader:webdav-source:' + id,
                    () => new Promise(release => { window.releaseSourceLock = release; acquired(); }));
            });
            await window.sourceLockHeld;
        }""", source_id)

    def release_source_lock(self):
        self.page.evaluate('async () => { window.releaseSourceLock(); await window.sourceLockWork; }')

    def test_cancel_pending_connection_save_keeps_configuration_and_password(self):
        self.configure_dav()
        expect(self.page.get_by_role('button', name='Browse Test DAV', exact=True)).to_be_visible()
        before = self.connection_row()
        form = self.edit_connection()
        form.get_by_label('Name', exact=True).fill('Canceled change')
        form.get_by_label('Remember password on this device', exact=True).uncheck()
        self.hold_source_lock(before['id'])
        try:
            form.get_by_role('button', name='Test and save WebDAV', exact=True).click()
            # Poll real lock state: Playwright versions may not await an async predicate.
            deadline = time.monotonic() + 10
            while not self.page.evaluate("async () => (await navigator.locks.query()).pending.length > 0"):
                self.assertLess(time.monotonic(), deadline)
                self.page.wait_for_timeout(25)
            form.get_by_role('button', name='Cancel', exact=True).click()
        finally:
            self.release_source_lock()
        expect(self.page.get_by_role('button', name='Add WebDAV folder', exact=True)).to_be_enabled()
        self.assertEqual(before, self.connection_row())
        expect(self.page.get_by_role('button', name='Browse Test DAV', exact=True)).to_be_visible()

    def test_cancel_during_connection_write_aborts_the_uncommitted_transaction(self):
        self.configure_dav()
        expect(self.page.get_by_role('button', name='Browse Test DAV', exact=True)).to_be_visible()
        before = self.connection_row()
        form = self.edit_connection()
        form.get_by_label('Name', exact=True).fill('Canceled inside transaction')
        form.get_by_label('Remember password on this device', exact=True).uncheck()
        self.page.evaluate("""() => {
            window.originalDavPut = IDBObjectStore.prototype.put;
            window.canceledDavWrite = false;
            IDBObjectStore.prototype.put = function(...args) {
                const request = window.originalDavPut.apply(this, args);
                if (this.name === 'metadata' && this.transaction.db.name === 'manabi-reader-integrations') {
                    window.canceledDavWrite = true;
                    const form = document.querySelector('form[aria-label="WebDAV connection"]');
                    [...form.querySelectorAll('button')].find(b => b.textContent.trim() === 'Cancel').click();
                }
                return request;
            };
        }""")
        try:
            form.get_by_role('button', name='Test and save WebDAV', exact=True).click()
            expect(self.page.get_by_role('button', name='Add WebDAV folder', exact=True)).to_be_enabled()
            self.assertTrue(self.page.evaluate('() => window.canceledDavWrite'))
            self.assertEqual(before, self.connection_row())
        finally:
            self.page.evaluate('() => { IDBObjectStore.prototype.put = window.originalDavPut; }')

    def test_leaving_connections_cancels_a_pending_save(self):
        self.configure_dav()
        expect(self.page.get_by_role('button', name='Browse Test DAV', exact=True)).to_be_visible()
        before = self.connection_row()
        form = self.edit_connection()
        form.get_by_label('Name', exact=True).fill('Unmounted change')
        self.hold_source_lock(before['id'])
        try:
            form.get_by_role('button', name='Test and save WebDAV', exact=True).click()
            deadline = time.monotonic() + 10
            while not self.page.evaluate("async () => (await navigator.locks.query()).pending.length > 0"):
                self.assertLess(time.monotonic(), deadline)
                self.page.wait_for_timeout(25)
            self.page.get_by_role('link', name='← Books', exact=True).click()
            expect(self.page.get_by_role('region', name='Library shelves', exact=True)).to_have_attribute('data-hydrated', 'true')
        finally:
            self.release_source_lock()
        # A subsequent lock acquisition drains the canceled predecessor.
        self.page.evaluate("async id => navigator.locks.request('manabi-reader:webdav-source:' + id, () => {})", before['id'])
        self.assertEqual(before, self.connection_row())

    def test_disconnect_transaction_failure_preserves_connection_and_can_retry(self):
        self.connect_dav(writable=True)
        before = self.stores('manabi-reader-integrations', ['metadata', 'books'])
        self.page.goto(self.origin + '/reader-web/connections')
        self.page.evaluate("""() => {
            window.originalDavDelete = IDBObjectStore.prototype.delete;
            IDBObjectStore.prototype.delete = function(...args) {
                const request = window.originalDavDelete.apply(this, args);
                if (this.name === 'books' && this.transaction.db.name === 'manabi-reader-integrations')
                    this.transaction.abort();
                return request;
            };
        }""")
        try:
            self.page.get_by_role('button', name='Disconnect Test DAV', exact=True).click()
            expect(self.page.get_by_role('button', name='Add WebDAV folder', exact=True)).to_be_enabled()
            self.assertEqual(before, self.stores('manabi-reader-integrations', ['metadata', 'books']))
        finally:
            self.page.evaluate('() => { IDBObjectStore.prototype.delete = window.originalDavDelete; }')
        self.page.get_by_role('button', name='Disconnect Test DAV', exact=True).click()
        expect(self.page.get_by_role('button', name='Browse Test DAV', exact=True)).to_have_count(0)
        self.assertEqual({'metadata': [], 'books': []}, self.stores('manabi-reader-integrations', ['metadata', 'books']))
        self.assertEqual(1, len(self.stores('books', ['data'])['data']))

    def test_stale_connection_editor_cannot_resurrect_a_disconnected_source(self):
        self.configure_dav()
        expect(self.page.get_by_role('button', name='Browse Test DAV', exact=True)).to_be_visible()
        form = self.edit_connection()
        other = self.context.new_page()
        try:
            other.goto(self.page.url)
            other.get_by_role('button', name='Disconnect Test DAV', exact=True).click()
            expect(other.get_by_role('button', name='Browse Test DAV', exact=True)).to_have_count(0)
            form.get_by_role('button', name='Test and save WebDAV', exact=True).click()
            expect(self.page.get_by_role('button', name='Add WebDAV folder', exact=True)).to_be_enabled()
            self.assertEqual([], self.stores('manabi-reader-integrations', ['metadata'])['metadata'])
            expect(self.page.get_by_text('This WebDAV connection changed or was disconnected. Reload WebDAV connections before saving again.', exact=True)).to_be_visible()
            self.page.get_by_role('button', name='Reload WebDAV connections', exact=True).click()
            expect(self.page.get_by_role('form', name='WebDAV connection', exact=True)).to_have_count(0)
            expect(self.page.get_by_role('button', name='Browse Test DAV', exact=True)).to_have_count(0)
        finally:
            other.close()

    def test_stale_connection_editor_cannot_restore_revoked_write_permission(self):
        self.connect_dav(writable=True)
        self.seed_resume()
        self.page.get_by_label('Sync this book’s reading data with WebDAV', exact=True).check()
        self.page.goto(self.origin + '/reader-web/connections')
        form = self.edit_connection()
        other = self.context.new_page()
        try:
            other.goto(self.page.url)
            other.get_by_role('button', name='Unlock or edit Test DAV', exact=True).click()
            other.get_by_label('Allow reading-data write-back in .manabi-reader', exact=True).uncheck()
            other.get_by_role('button', name='Test and save WebDAV', exact=True).click()
            expect(other.get_by_role('button', name='Browse Test DAV', exact=True)).to_be_visible()
            expect(other.get_by_role('form', name='WebDAV connection', exact=True)).to_have_count(0)
            form.get_by_label('Name', exact=True).fill('Stale editor')
            form.get_by_role('button', name='Test and save WebDAV', exact=True).click()
            expect(self.page.get_by_role('button', name='Add WebDAV folder', exact=True)).to_be_enabled()
            self.assertFalse(self.connection_row()['writable'])
            self.assertEqual('Test DAV', self.connection_row()['name'])
            self.assertTrue(all(not row['syncEnabled'] for row in self.stores('manabi-reader-integrations', ['books'])['books']))
            self.page.get_by_role('button', name='Reload WebDAV connections', exact=True).click()
            expect(self.page.get_by_role('form', name='WebDAV connection', exact=True)).to_have_count(0)
            refreshed = self.edit_connection()
            expect(refreshed.get_by_label('Allow reading-data write-back in .manabi-reader', exact=True)).not_to_be_checked()
            refreshed.get_by_label('Name', exact=True).fill('Current editor')
            refreshed.get_by_role('button', name='Test and save WebDAV', exact=True).click()
            expect(self.page.get_by_role('button', name='Browse Current editor', exact=True)).to_be_visible()
            self.assertFalse(self.connection_row()['writable'])
        finally:
            other.close()

    def test_webdav_annotation_after_its_import_record_retains_the_link(self):
        path = self.establish_dav_state()
        remote = json.loads(self.dav.state['files'][path])
        note_id = '11111111-2222-5333-a444-555555555555'
        key = remote['bookKey']
        source = {'text': 'WEBDAV_SEARCH_NEEDLE'}
        stamp = '2026-09-25T00:00:00.000Z'
        remote['records']['import/' + note_id] = {
            'id': note_id, 'bookKey': key, 'part': 'highlights',
            'source': source, 'sourceCanonical': json.dumps(source, separators=(',', ':')),
            'status': 'anchored', 'annotationId': note_id, 'label': 'Remote highlight',
            'body': 'Paired note', 'quote': source['text'],
            'importedBody': 'Paired note', 'importedLabel': 'Remote highlight',
            'createdAt': stamp, 'modifiedAt': stamp
        }
        book = self.stores('books', ['data'])['data'][0]
        remote['records']['annotation/' + note_id] = {
            'id': note_id, 'bookKey': key, 'kind': 'highlight', 'body': 'Paired note',
            'createdAt': stamp, 'modifiedAt': stamp, 'revision': 1,
            'targets': [{'version': 1, 'bookKey': key,
                         'resource': book['publicationManifest']['resources'][0],
                         'projectionVersion': 2, 'resourceDigest': hashlib.sha256('WEBDAV_SEARCH_NEEDLE 本を読む。'.encode()).hexdigest(),
                         'start': 0, 'end': len(source['text']), 'quote': source['text'],
                         'prefix': '', 'suffix': ' 本を読む。'}]
        }
        self.dav.state['files'][path] = json.dumps(remote).encode()
        self.sync_dav()
        row = self.stores('books', ['readerImportRecord'])['readerImportRecord'][0]
        self.assertEqual('anchored', row['status'])
        self.assertEqual(note_id, row['annotationId'])
        puts = self.dav.state['puts']
        self.sync_dav()
        self.assertEqual(puts, self.dav.state['puts'])

    def test_webdav_unlinked_passage_remains_visible_and_sync_converges(self):
        path = self.establish_dav_state()
        remote = json.loads(self.dav.state['files'][path])
        note_id = '11111111-2222-5333-a444-555555555555'
        source = {'text': 'Remote passage'}
        remote['records']['import/' + note_id] = {
            'id': note_id, 'bookKey': remote['bookKey'], 'part': 'highlights',
            'source': source, 'sourceCanonical': json.dumps(source, separators=(',', ':')),
            'status': 'anchored', 'annotationId': note_id, 'label': 'Recover remote note',
            'body': 'A remote orphan note', 'quote': 'Remote passage',
            'importedBody': 'A remote orphan note', 'importedLabel': 'Recover remote note',
            'createdAt': '2026-09-25T00:00:00.000Z', 'modifiedAt': '2026-09-25T00:00:00.000Z'
        }
        self.dav.state['files'][path] = json.dumps(remote).encode()
        self.sync_dav()
        rows = self.stores('books', ['readerImportRecord'])['readerImportRecord']
        self.assertEqual('unresolved', rows[0]['status'])
        self.assertEqual(source, rows[0]['source'])
        self.sync_dav()
        puts = self.dav.state['puts']
        self.sync_dav()
        self.assertEqual(puts, self.dav.state['puts'])
        self.page.get_by_role('link', name='Read WebDAV offline book', exact=True).click()
        self.page.get_by_role('button', name='Show reading controls', exact=True).click()
        self.page.get_by_role('button', name='Bookmarks and Notes', exact=True).click()
        notebook = self.page.get_by_role('region', name='Imported Yatsu notes', exact=True)
        expect(notebook.get_by_text('Unlocated highlight', exact=True)).to_be_visible()
        expect(notebook.get_by_text('A remote orphan note', exact=True)).to_be_visible()
        notebook.get_by_role('button', name='Edit imported note', exact=True).click()
        notebook.get_by_label('Note', exact=True).fill('Recovered and edited')
        notebook.get_by_role('button', name='Save imported note', exact=True).click()
        expect(notebook.get_by_text('Recovered and edited', exact=True)).to_be_visible()


def load_tests(loader, _tests, _pattern):
    return unittest.TestSuite(LocalLibraryLifecycle(name) for name in LocalLibraryLifecycle.__dict__
                              if name.startswith('test_'))
