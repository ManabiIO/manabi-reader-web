"""Adversarial second-pass tests: actual app/IndexedDB and HTTP WebDAV fixture."""
import json
import gzip
from pathlib import Path
import unittest
from unittest.mock import patch
from playwright.sync_api import expect
from test_local_library_features import LocalFeatureBrowser, DavHandler, TITLE
from test_local_library_review import LocalLibraryReview


class LocalLibraryRefinement(LocalFeatureBrowser):
    def test_metadata_and_content_share_context_independent_search_folding(self):
        self.import_book('ΟΣ handbook', creators=('ΟΣ Author',), body='<p>ΟΣ 猫 ＡＢＣ ｶﾞ</p>')
        for query in ('ΟΣ', 'οσ', 'ος'):
            self.search(query)
            expect(self.page.get_by_role('button', name='Read ΟΣ handbook', exact=True)).to_be_enabled()
            expect(self.page.get_by_role('button', name='Open passage in ΟΣ handbook: ΟΣ', exact=True)).to_be_visible()
        self.search('ｶﾞ')
        expect(self.page.get_by_role('button', name='Open passage in ΟΣ handbook: ｶﾞ', exact=True)).to_be_visible()
        self.search('ΟΣ')
        self.page.get_by_role('button', name='Read ΟΣ handbook', exact=True).click()
        self.page.get_by_role('button', name='Show reading controls', exact=True).click()
        self.page.get_by_role('button', name='Reading tools', exact=True).click()
        self.page.get_by_role('menuitem', name='Search Book', exact=True).click()
        field = self.page.get_by_role('searchbox', name='Search within book', exact=True)
        field.fill('ΟΣ')
        expect(self.page.get_by_text('1 results', exact=True)).to_be_visible()
        self.page.get_by_label('Match case', exact=True).check()
        field.fill('ος')
        expect(self.page.get_by_text('0 results', exact=True)).to_be_visible()
        field.fill('ΟΣ')
        expect(self.page.get_by_text('1 results', exact=True)).to_be_visible()
        self.page.get_by_label('Match case', exact=True).uncheck()
        field.fill('ABC')
        expect(self.page.get_by_text('0 results', exact=True)).to_be_visible()

    def test_webdav_malformed_utf8_keeps_local_data_and_acknowledgement(self):
        path = self.establish_dav_state()
        before = self.stores('books', ['bookmark', 'readerExternalSync'])
        remote = json.loads(self.dav.state['files'][path])
        remote['records']['resume']['progress'] = 'BROKEN_UTF8'
        # Complete HTTP 200, matching byte count and ETag, but invalid JSON text encoding.
        self.dav.state['files'][path] = json.dumps(remote).encode().replace(b'BROKEN_UTF8', b'\xff')
        self.page.get_by_role('button', name='Sync WebDAV offline book', exact=True).click()
        expect(self.page.get_by_text('WebDAV reading data is not valid UTF-8.', exact=True)).to_be_visible()
        self.assertEqual(before, self.stores('books', ['bookmark', 'readerExternalSync']))
        self.assertEqual(1, self.dav.state['puts'])
        # Correcting the same remote file enables a normal retry, not a reset.
        remote['records']['resume']['progress'] = 0.5
        self.dav.state['files'][path] = json.dumps(remote).encode()
        self.sync_dav()
        self.assertEqual(0.5, self.stores('books', ['bookmark'])['bookmark'][0]['progress'])

    def test_webdav_short_complete_response_does_not_import_a_truncated_text_book(self):
        self.dav.state['files'] = {'/Books/Partial.txt': ('日本語の全文。' * 40).encode()}
        original = DavHandler.send
        def short_response(handler, code, data=b'', *args, **kwargs):
            if handler.command == 'GET' and handler.path.endswith('/Partial.txt') and code == 200:
                data = data[:12]  # 200 with a freshly correct Content-Length for truncated bytes.
            return original(handler, code, data, *args, **kwargs)
        with patch.object(DavHandler, 'send', short_response):
            self.configure_dav()
            self.page.get_by_role('button', name='Browse Test DAV', exact=True).click()
            self.page.get_by_role('button', name='Import Partial.txt', exact=True).click()
            expect(self.page.get_by_text('The WebDAV book download does not match the selected file size. Refresh the folder and try again.', exact=True)).to_be_visible()
            self.assertEqual([], self.stores('books', ['data'])['data'])
            self.assertEqual([], self.stores('manabi-reader-integrations', ['books'])['books'])
        self.page.get_by_role('button', name='Import Partial.txt', exact=True).click()
        self.wait_rows('data', lambda rows: len(rows) == 1)
        self.assertIn('日本語の全文。' * 40, self.stores('books', ['data'])['data'][0]['elementHtml'])

    def test_webdav_changed_get_etag_cannot_import_a_different_revision(self):
        original = DavHandler.send
        def changed_etag(handler, code, data=b'', content='application/octet-stream', etag=None, extra=None):
            if handler.command == 'GET' and code == 200:
                etag = '"unexpected-revision"'
            return original(handler, code, data, content, etag, extra)
        with patch.object(DavHandler, 'send', changed_etag):
            self.configure_dav()
            self.page.get_by_role('button', name='Browse Test DAV', exact=True).click()
            self.page.get_by_role('button', name='Import Offline.epub', exact=True).click()
            expect(self.page.get_by_text('The WebDAV book changed during download. Refresh the folder and try again.', exact=True)).to_be_visible()
            self.assertEqual([], self.stores('books', ['data'])['data'])
            self.assertEqual([], self.stores('manabi-reader-integrations', ['books'])['books'])
        self.page.get_by_role('button', name='Import Offline.epub', exact=True).click()
        self.wait_rows('data', lambda rows: len(rows) == 1)

    def test_webdav_transfer_compression_does_not_change_selected_file_size(self):
        # getcontentlength describes the selected file; transport Content-Length
        # describes the compressed response. Fetch decodes it before our check.
        original = DavHandler.send
        def compressed(handler, code, data=b'', content='application/octet-stream', etag=None, extra=None):
            if handler.command == 'GET' and code == 200:
                data = gzip.compress(data)
                extra = {**(extra or {}), 'Content-Encoding': 'gzip'}
            return original(handler, code, data, content, etag, extra)
        with patch.object(DavHandler, 'send', compressed):
            self.configure_dav()
            self.page.get_by_role('button', name='Browse Test DAV', exact=True).click()
            self.page.get_by_role('button', name='Import Offline.epub', exact=True).click()
            self.wait_rows('data', lambda rows: len(rows) == 1)
            self.assertIn('WEBDAV_SEARCH_NEEDLE', self.stores('books', ['data'])['data'][0]['elementHtml'])

    def test_webdav_invalid_listing_encoding_cannot_publish_a_connection(self):
        original = DavHandler.send
        def bad_listing(handler, code, data=b'', *args, **kwargs):
            if handler.command == 'PROPFIND' and code == 207:
                data = data.replace(b'Offline.epub', b'Invalid-\xff.epub')
            return original(handler, code, data, *args, **kwargs)
        with patch.object(DavHandler, 'send', bad_listing):
            self.configure_dav()
            expect(self.page.get_by_text('WebDAV directory listing is not valid UTF-8.', exact=True)).to_be_visible()
            expect(self.page.get_by_role('button', name='Browse Test DAV', exact=True)).to_have_count(0)
            self.assertEqual([], self.stores('manabi-reader-integrations', ['metadata'])['metadata'])

    def test_notebook_restore_does_not_hide_an_orphaned_anchored_passage(self):
        self.open_migration(); self.migrate()
        self.page.get_by_role('link', name='Read ' + TITLE, exact=True).click()
        notebook = LocalLibraryReview.open_notebook(self, self.page)
        with self.page.expect_download() as download:
            notebook.get_by_role('button', name='Download imported notes', exact=True).click()
        archive = json.loads(Path(download.value.path()).read_bytes())
        orphan = next(row for row in archive['records'] if row['part'] == 'highlights')
        orphan['id'] = '11111111-2222-5333-a444-555555555555'
        orphan.pop('annotationId', None)
        orphan.pop('appliedAnnotation', None)
        archive['records'] = [orphan]
        notebook.get_by_role('button', name='Restore imported notes', exact=True).click()
        notebook.get_by_label('Choose imported notes archive', exact=True).set_input_files({
            'name': 'orphaned-notes.json', 'mimeType': 'application/json',
            'buffer': json.dumps(archive).encode()})
        expect(notebook.get_by_text('Unlocated highlight', exact=True)).to_be_visible()
        expect(notebook.get_by_text('My passage note', exact=True)).to_be_visible()
        row = next(row for row in self.stores('books', ['readerImportRecord'])['readerImportRecord'] if row['id'] == orphan['id'])
        self.assertEqual('unresolved', row['status'])
        self.assertEqual(orphan['source'], row['source'])


    def test_failed_projection_cache_write_does_not_reject_or_block_content_results(self):
        self.import_book('Cache write failure', body='<p>CACHE_ABORT_NEEDLE 日本語</p>')
        self.page.evaluate("""() => {
          const Native = window.Worker;
          window.nativeSearchWorker = Native;
          window.cacheAborts = 0; window.cacheUnhandled = [];
          window.Worker = class extends Native {
            constructor(url, options) {
              if (!String(url).includes('library-content-search-worker')) { super(url, options); return; }
              const source = `
                const early = [];
                const hold = event => early.push(event.data);
                self.addEventListener('message', hold);
                self.addEventListener('unhandledrejection', event => {
                  self.postMessage({type:'fixture-unhandled', detail:String(event.reason)});
                });
                const put = IDBObjectStore.prototype.put;
                IDBObjectStore.prototype.put = function(...args) {
                  const request = put.apply(this, args);
                  if (this.name === 'readerSearchProjection') {
                    this.transaction.abort();
                    self.postMessage({type:'fixture-cache-abort'});
                  }
                  return request;
                };
                await import(${JSON.stringify(String(url))});
                self.removeEventListener('message', hold);
                for (const data of early) self.onmessage(new MessageEvent('message', {data}));
              `;
              const wrapper = URL.createObjectURL(new Blob([source], {type:'text/javascript'}));
              super(wrapper, options);
              this.addEventListener('message', ({data}) => {
                if (data.type === 'fixture-cache-abort') window.cacheAborts++;
                if (data.type === 'fixture-unhandled') window.cacheUnhandled.push(data.detail);
              });
              setTimeout(() => URL.revokeObjectURL(wrapper), 1000);
            }
          };
        }""")
        self.search('CACHE_ABORT_NEEDLE')
        expect(self.page.get_by_role('button', name='Open passage in Cache write failure: CACHE_ABORT_NEEDLE', exact=True)).to_be_visible()
        expect(self.page.get_by_text('1 matching passages.', exact=True)).to_be_visible()
        self.assertEqual(1, self.page.evaluate('window.cacheAborts'))
        self.assertEqual([], self.page.evaluate('window.cacheUnhandled'))
        self.assertEqual([], self.stores('books', ['readerSearchProjection'])['readerSearchProjection'])
        self.page.evaluate('() => { window.Worker = window.nativeSearchWorker; }')
        self.search('日本語')
        expect(self.page.get_by_role('button', name='Open passage in Cache write failure: 日本語', exact=True)).to_be_visible()
        self.wait_rows('readerSearchProjection', lambda rows: len(rows) == 1)


def load_tests(loader, _tests, _pattern):
    return unittest.TestSuite(LocalLibraryRefinement(name) for name in LocalLibraryRefinement.__dict__
        if name.startswith('test_'))
