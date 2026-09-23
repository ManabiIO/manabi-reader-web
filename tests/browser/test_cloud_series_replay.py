"""A completed cloud move is applied after the browser missed its response."""
import json
import threading
import time
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import expect, sync_playwright
from test_books_library import LibraryBase
from test_static_reader import StaticHandler, ThreadingHTTPServer


CONNECTION = 'f025a7a2-27d6-4ad8-830d-f5e01d51dcf1'
PLAN = 'df3e889b-4cec-45e0-9517-196f0e9b704e'
SOURCE_KEY = json.dumps(['42', CONNECTION, 'root'], separators=(',', ':'))


class SeriesHandler(StaticHandler):
    moved = False
    completed_plan = False

    def do_GET(self):
        path = urlsplit(self.path).path
        owner = '42'
        if path == '/api/reader-web/connections/':
            self.api_request()
            self.api_response({'items': [{
                'id': CONNECTION, 'provider': 'onedrive', 'roots': ['root'],
                'needs_reconnect': False
            }]}, user=owner)
            return
        prefix = f'/api/reader-web/connections/{CONNECTION}/'
        if path.startswith(prefix):
            self.api_request()
            operation = path[len(prefix):]
            if operation == 'series/capabilities/':
                self.api_response({
                    'provider': 'onedrive', 'root': 'root', 'operations': [],
                    'can_edit': False, 'reasons': ['read only'],
                    'item_permission': 'checked_at_execute', 'concurrency': 'unavailable',
                    'scope_upgrade': 'Files.ReadWrite'
                }, user=owner)
                return
            if operation == 'series/plans/':
                receipts = [{
                    'connection_id': CONNECTION, 'root': 'root', 'item_id': item,
                    'old_parent': 'root', 'new_parent': 'series', 'name': f'{item}.txt'
                } for item in ('first', 'second')]
                plan = {
                    'id': PLAN, 'root': 'root', 'operation': 'create_series',
                    'revision': 4, 'status': 'complete', 'issue': '',
                    'expires_at': '2026-09-24T00:00:00Z',
                    'preview': {'folder_name': 'Volumes', 'name': 'Volumes',
                                'book_names': ['first.txt', 'second.txt'],
                                'parent_id': 'root', 'destination_id': None},
                    'steps': [], 'receipts': receipts
                }
                self.api_response({'items': [plan] if type(self).completed_plan else []}, user=owner)
                return
            if operation == 'files/':
                parent = parse_qs(urlsplit(self.path).query).get('parent', ['root'])[0]
                files = [{'id': item, 'name': f'{item}.txt', 'kind': 'file', 'size': 20}
                         for item in ('first', 'second')]
                if type(self).moved:
                    items = ([{'id': 'series', 'name': 'Volumes', 'kind': 'folder'}]
                             if parent == 'root' else files if parent == 'series' else [])
                else:
                    items = files if parent == 'root' else []
                self.api_response({'items': items, 'cursor': ''}, user=owner)
                return
            if operation == 'file/':
                body = b'A short source book.\n'
                self.send_response(200)
                self.send_header('Content-Type', 'application/octet-stream')
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Manabi-User', owner)
                self.end_headers()
                self.wfile.write(body)
                return
        super().do_GET()


class CloudSeriesReceiptReplay(LibraryBase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), SeriesHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = 'http://127.0.0.1:' + str(cls.server.server_port)
        cls.playwright = sync_playwright().start()

    def setUp(self):
        SeriesHandler.moved = False
        SeriesHandler.completed_plan = False
        StaticHandler.account_fixture = {
            'user': {'id': '42', 'username': 'reader'}, 'csrf_token': 'c' * 64,
            'providers': []
        }
        super().setUp()

    def tearDown(self):
        try:
            super().tearDown()
        finally:
            StaticHandler.account_fixture = None
            SeriesHandler.moved = False
            SeriesHandler.completed_plan = False

    def snapshot(self):
        return self.page.evaluate('''async () => {
          const open = name => new Promise((resolve,reject) => {
            const request = indexedDB.open(name);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const read = request => new Promise((resolve,reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const integrations = await open('manabi-reader-integrations');
          const tx = integrations.transaction('metadata');
          const store = tx.objectStore('metadata');
          const [keys, values] = await Promise.all([read(store.getAllKeys()), read(store.getAll())]);
          integrations.close();
          const metadata = Object.fromEntries(keys.map((key,index) => [key,values[index]]));
          const books = await open('books');
          const bookTx = books.transaction(['data','bookmark','statistic']);
          const reading = {};
          for (const name of ['data','bookmark','statistic']) {
            reading[name] = await read(bookTx.objectStore(name).getAll());
          }
          books.close();
          return {metadata, reading};
        }''')

    def wait_snapshot(self, predicate):
        deadline = time.monotonic() + 20
        while True:
            snapshot = self.snapshot()
            if predicate(snapshot):
                return snapshot
            self.assertLess(time.monotonic(), deadline, 'Cloud receipt did not appear')
            self.page.wait_for_timeout(25)

    def test_completed_move_receipts_replay_after_reload(self):
        self.import_book('Unrelated browser book')
        catalog_key = 'library-catalog:' + SOURCE_KEY
        before = self.wait_snapshot(lambda value: catalog_key in value['metadata'])
        self.assertEqual('root', before['metadata'][catalog_key]['entries'][0]['parent'])

        # The provider completed both moves while this browser was closed.
        # Its next visit sees the committed plan and must apply the receipts.
        SeriesHandler.moved = True
        SeriesHandler.completed_plan = True
        self.page.reload()
        expect(self.page.get_by_role('region', name='Library shelves')).to_have_attribute(
            'aria-busy', 'false', timeout=30000)
        after = self.wait_snapshot(lambda value: len([
            key for key in value['metadata']
            if key.startswith(f'cloud-series-receipt:42:{CONNECTION}:{PLAN}:')
        ]) == 2 and any(entry['parent'] == 'series'
                       for entry in value['metadata'].get(catalog_key, {}).get('entries', [])))
        receipts = [key for key in after['metadata']
                    if key.startswith(f'cloud-series-receipt:42:{CONNECTION}:{PLAN}:')]
        self.assertEqual(2, len(receipts))
        self.assertEqual({'first', 'second'},
                         {entry['id'] for entry in after['metadata'][catalog_key]['entries']
                          if entry['kind'] == 'file'})
        self.assertEqual({'series'},
                         {entry['parent'] for entry in after['metadata'][catalog_key]['entries']
                          if entry['kind'] == 'file'})
        self.assertEqual(before['reading'], after['reading'])
        self.assertFalse(any(request['method'] == 'POST' and '/series/' in request['path']
                             for request in StaticHandler.account_requests))

        self.page.reload()
        expect(self.page.get_by_role('region', name='Library shelves')).to_have_attribute(
            'aria-busy', 'false', timeout=30000)
        again = self.wait_snapshot(lambda value: len([
            key for key in value['metadata']
            if key.startswith(f'cloud-series-receipt:42:{CONNECTION}:{PLAN}:')
        ]) == 2)
        self.assertEqual(after['reading'], again['reading'])
        self.assertEqual(2, len([key for key in again['metadata']
                                 if key.startswith(f'cloud-series-receipt:42:{CONNECTION}:{PLAN}:')]))


if __name__ == '__main__':
    import unittest
    unittest.main(verbosity=2)
