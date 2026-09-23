"""Real browser QA for externally changed fake cloud provider locators."""
import base64
import re
import threading
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import expect, sync_playwright

from test_books_library import BooksLibraryFilesystem, LibraryBase, book, raster
from test_static_reader import StaticHandler, ThreadingHTTPServer


GOOGLE = 'a8fa3b56-976e-4407-9c23-d48f3a665301'
DROPBOX = 'd219fcaf-d681-4cda-b09b-92a055882e29'
BYTES = book('Traveling volume')


class CloudRelocationHandler(StaticHandler):
    nodes = {}

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/api/reader-web/connections/':
            self.api_request()
            self.api_response({'items': [
                {'id': GOOGLE, 'provider': 'google', 'roots': ['google-root'],
                 'needs_reconnect': False},
                {'id': DROPBOX, 'provider': 'dropbox', 'roots': ['dropbox-root'],
                 'needs_reconnect': False}
            ]}, user='42')
            return
        for connection, root in ((GOOGLE, 'google-root'), (DROPBOX, 'dropbox-root')):
            prefix = f'/api/reader-web/connections/{connection}/'
            if not path.startswith(prefix):
                continue
            self.api_request()
            operation = path[len(prefix):]
            query = parse_qs(urlsplit(self.path).query)
            if operation == 'files/':
                parent = query.get('parent', [root])[0]
                items = [
                    {'id': item, 'name': value['name'], 'kind': value['kind'],
                     **({'size': len(value.get('bytes', BYTES))} if value['kind'] == 'file' else {})}
                    for item, value in type(self).nodes.get(connection, {}).items()
                    if value['parent'] == parent
                ]
                self.api_response({'items': items, 'cursor': ''}, user='42')
                return
            if operation == 'file/':
                item = query.get('id', [''])[0]
                value = type(self).nodes.get(connection, {}).get(item)
                if not value or value['kind'] != 'file':
                    self.send_response(404)
                    self.send_header('Content-Length', '0')
                    self.send_header('X-Manabi-User', '42')
                    self.end_headers()
                    return
                contents = value.get('bytes', BYTES)
                self.send_response(200)
                self.send_header('Content-Type', 'application/octet-stream')
                self.send_header('Content-Length', str(len(contents)))
                self.send_header('X-Manabi-User', '42')
                self.end_headers()
                self.wfile.write(contents)
                return
        super().do_GET()


class CloudRelocationBrowser(LibraryBase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), CloudRelocationHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = 'http://127.0.0.1:' + str(cls.server.server_port)
        cls.playwright = sync_playwright().start()

    def setUp(self):
        CloudRelocationHandler.nodes = {
            GOOGLE: {'g-old': {'name': 'Old.epub', 'kind': 'file', 'parent': 'google-root'}},
            DROPBOX: {}
        }
        CloudRelocationHandler.preference_revision = 0
        CloudRelocationHandler.preference_settings = {}
        StaticHandler.account_fixture = {
            'user': {'id': '42', 'username': 'reader'},
            'csrf_token': 'c' * 64, 'providers': []
        }
        super().setUp()

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

    def test_disk_cloud_disk_keeps_organization_without_storage_sidecars(self):
        if self.engine != 'chromium':
            self.skipTest('Writable local-folder fixture requires Chromium')
        CloudRelocationHandler.nodes[GOOGLE] = {}
        self.refresh()
        BooksLibraryFilesystem.seed_files(self, {'LocalA/Volume.epub': BYTES})
        expect(self.page.get_by_role('button', name='Read Traveling volume', exact=True)).to_be_visible(
            timeout=30000)
        self.add_collection('Traveling volume', 'Across sources')
        self.menu('Traveling volume', 'Rename…')
        self.dialog().get_by_label('Name', exact=True).fill('My portable volume')
        self.dialog().get_by_role('button', name='Save', exact=True).click()
        with self.page.expect_file_chooser() as chooser:
            self.menu('My portable volume', 'Change Cover…')
        chooser.value.set_files({
            'name': 'cover.png', 'mimeType': 'image/png',
            'buffer': raster(120, 180, (40, 120, 180))
        })
        local = self.page.locator('.shelf-item').filter(
            has=self.page.get_by_role('img', name='Local folder: Library fixture'))
        expect(local.get_by_role('button', name='Read My portable volume', exact=True)).to_be_visible()
        cover = local.locator('img').first
        expect(cover).to_have_attribute('src', re.compile(r'^data:image/(?:png|webp);base64,'))
        override = cover.get_attribute('src')
        local_id = self.stores('manabi-reader-integrations', ['books'])['books'][0]['bookId']
        reading = self.stores('books', ['bookmark', 'statistic'])

        CloudRelocationHandler.nodes[GOOGLE] = {
            'g-cloud': {'name': 'Cloud.epub', 'kind': 'file', 'parent': 'google-root'}
        }
        self.refresh()
        google = self.page.locator('.shelf-item').filter(
            has=self.page.get_by_role('img', name='Google Drive'))
        expect(google.get_by_role('button', name='Read My portable volume', exact=True)).to_be_visible(
            timeout=30000)
        expect(google.locator('img').first).to_have_attribute('src', override)

        self.page.evaluate('''async () => {
          const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('Library fixture');
          await(await root.getDirectoryHandle('LocalA')).removeEntry('Volume.epub');
        }''')
        self.refresh()
        expect(google.get_by_role('button', name='Read My portable volume', exact=True)).to_be_visible()
        self.page.evaluate('''async encoded => {
          const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('Library fixture');
          const destination=await(await root.getDirectoryHandle('LocalB',{create:true})).getDirectoryHandle('Nested',{create:true});
          const writer=await(await destination.getFileHandle('Returned.epub',{create:true})).createWritable();
          await writer.write(Uint8Array.from(atob(encoded),character=>character.charCodeAt(0)));
          await writer.close();
        }''', base64.b64encode(BYTES).decode())
        self.refresh()
        local = self.page.locator('.shelf-item').filter(
            has=self.page.get_by_role('img', name='Local folder: Library fixture'))
        expect(local.get_by_role('button', name='Read My portable volume', exact=True)).to_have_count(
            1, timeout=30000)
        expect(local.locator('img').first).to_have_attribute('src', override)
        self.assertEqual(reading, self.stores('books', ['bookmark', 'statistic']))
        self.choose_collection('Across sources')
        expect(local.get_by_role('button', name='Read My portable volume', exact=True)).to_be_visible()
        local.get_by_role('button', name='Read My portable volume', exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false', timeout=30000)
        links = self.stores('manabi-reader-integrations', ['books'])['books']
        self.assertIn('LocalB/Nested/Returned.epub', [link['fileId'] for link in links])
        self.assertIn(local_id, [link['bookId'] for link in links])

    def test_same_title_with_changed_bytes_does_not_inherit_collections_or_cover(self):
        expect(self.page.get_by_role('button', name='Read Traveling volume', exact=True)).to_be_visible(
            timeout=30000)
        self.add_collection('Traveling volume', 'Only original bytes')
        self.menu('Traveling volume', 'Rename…')
        self.dialog().get_by_label('Name', exact=True).fill('Personal original')
        self.dialog().get_by_role('button', name='Save', exact=True).click()
        CloudRelocationHandler.nodes[DROPBOX] = {
            'd-different': {'name': 'Same title.epub', 'kind': 'file', 'parent': 'dropbox-root',
                            'bytes': book('Traveling volume', color=(30, 170, 90))}
        }
        self.refresh()
        dropbox = self.page.locator('.shelf-item').filter(
            has=self.page.get_by_role('img', name='Dropbox'))
        expect(dropbox.get_by_role('button', name='Read Traveling volume', exact=True)).to_be_visible(
            timeout=30000)
        expect(dropbox.get_by_role('button', name='Read Personal original', exact=True)).to_have_count(0)
        self.choose_collection('Only original bytes')
        expect(self.page.get_by_role('button', name='Read Personal original', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Read Traveling volume', exact=True)).to_have_count(0)

    def test_changed_cloud_id_nested_move_and_second_provider_keep_portable_organization(self):
        expect(self.page.get_by_role('button', name='Read Traveling volume', exact=True)).to_be_visible(
            timeout=30000)
        self.add_collection('Traveling volume', 'Portable cloud shelf')
        self.menu('Traveling volume', 'Rename…')
        self.dialog().get_by_label('Name', exact=True).fill('Personal traveling volume')
        self.dialog().get_by_role('button', name='Save', exact=True).click()
        expect(self.page.get_by_role('button', name='Read Personal traveling volume', exact=True)).to_be_visible()
        with self.page.expect_file_chooser() as chooser:
            self.menu('Personal traveling volume', 'Change Cover…')
        chooser.value.set_files({
            'name': 'cover.png', 'mimeType': 'image/png',
            'buffer': raster(120, 180, (40, 120, 180))
        })
        cover = self.tile('Personal traveling volume').locator('img')
        expect(cover).to_have_attribute('src', re.compile(r'^data:image/(?:png|webp);base64,'))
        override = cover.get_attribute('src')
        original_links = self.stores('manabi-reader-integrations', ['books'])['books']
        self.assertEqual('g-old', original_links[0]['fileId'])
        original_book_id = original_links[0]['bookId']
        portable_key = 'content:' + original_links[0]['contentHash']
        self.page.goto(self.origin + '/Reader-Web/connections')
        self.page.get_by_label('Sync reader settings with this Manabi account', exact=True).check()
        expect(self.page.get_by_role('status', name='Settings sync status')).to_contain_text('synced')
        shared = CloudRelocationHandler.preference_settings['library_organization']
        self.assertEqual('Personal traveling volume', shared['books'][portable_key]['title'])
        self.assertTrue(shared['books'][portable_key]['cover'].startswith('data:image/'))
        self.assertIn(portable_key, next(collection['members'] for collection in shared['collections']
                                         if collection['name'] == 'Portable cloud shelf'))
        self.go_library()
        reading = self.stores('books', ['bookmark', 'statistic'])

        # A provider can replace the native ID and add nested directories
        # outside Manabi. Its old locator is no longer an identity.
        CloudRelocationHandler.nodes[GOOGLE] = {
            'g-series': {'name': 'Series', 'kind': 'folder', 'parent': 'google-root'},
            'g-nested': {'name': 'Nested', 'kind': 'folder', 'parent': 'g-series'},
            'g-new': {'name': 'Renamed.epub', 'kind': 'file', 'parent': 'g-nested'}
        }
        self.refresh()
        expect(self.page.get_by_role('button', name='Read Personal traveling volume', exact=True)).to_have_count(
            1, timeout=30000)
        expect(self.tile('Personal traveling volume').locator('img')).to_have_attribute('src', override)

        # The same bytes then appear at another cloud provider. Both physical
        # copies inherit the content-keyed title and cover without copying a
        # sidecar or changing the original EPUB.
        CloudRelocationHandler.nodes[DROPBOX] = {
            'd-new': {'name': 'Other.epub', 'kind': 'file', 'parent': 'dropbox-root'}
        }
        self.refresh()
        buttons = self.page.get_by_role('button', name='Read Personal traveling volume', exact=True)
        expect(buttons).to_have_count(2, timeout=30000)
        images = self.page.locator('.shelf-item').filter(has=buttons).locator('img')
        expect(images).to_have_count(2)
        for image in images.all():
            expect(image).to_have_attribute('src', override)
        self.assertEqual(reading, self.stores('books', ['bookmark', 'statistic']))

        # Remove the Google copy. A filtered collection still counts the
        # available content once, and the Dropbox copy retains the overrides.
        CloudRelocationHandler.nodes[GOOGLE] = {}
        self.refresh()
        expect(buttons).to_have_count(1, timeout=30000)
        self.choose_collection('Portable cloud shelf')
        expect(buttons).to_have_count(1, timeout=30000)
        self.menu('Personal traveling volume', 'Add to Collection…')
        expect(self.dialog().get_by_role('checkbox', name='Portable cloud shelf')).to_be_checked()
        self.dialog().get_by_role('button', name='Done').click()
        self.page.get_by_role('button', name='Read Personal traveling volume', exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false', timeout=30000)
        links = self.stores('manabi-reader-integrations', ['books'])['books']
        self.assertIn('d-new', [link['fileId'] for link in links])
        self.assertEqual({original_book_id}, {link['bookId'] for link in links})


if __name__ == '__main__':
    import unittest
    unittest.main(verbosity=2)
