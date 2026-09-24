"""A completed cloud move is applied after the browser missed its response."""
import faulthandler
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
    uncertain_plan = False
    execute_requests = 0

    @classmethod
    def plan(cls, status):
        receipts = [{
            'connection_id': CONNECTION, 'root': 'root', 'item_id': item,
            'old_parent': 'root', 'new_parent': 'series', 'name': f'{item}.txt'
        } for item in ('first', 'second')] if status == 'complete' else []
        return {
            'id': PLAN, 'root': 'root', 'operation': 'create_series',
            'revision': 4, 'status': status, 'issue': '',
            'expires_at': '2026-09-24T00:00:00Z',
            'preview': {'folder_name': 'Volumes', 'name': 'Volumes',
                        'book_names': ['first.txt', 'second.txt'],
                        'parent_id': 'root', 'destination_id': None},
            'steps': [], 'receipts': receipts
        }

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
                status = 'complete' if type(self).completed_plan else 'reconcile'
                self.api_response({'items': [type(self).plan(status)]
                                   if type(self).completed_plan or type(self).uncertain_plan else []}, user=owner)
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

    def do_POST(self):
        if (type(self).uncertain_plan and urlsplit(self.path).path ==
                f'/api/reader-web/connections/{CONNECTION}/series/plans/{PLAN}/execute/'):
            self.api_request()
            type(self).execute_requests += 1
            status = 'running' if type(self).execute_requests == 1 else 'complete'
            if status == 'complete':
                type(self).moved = True
                type(self).completed_plan = True
                type(self).uncertain_plan = False
            self.api_response(type(self).plan(status), user='42')
            return
        super().do_POST()


class CloudSeriesReceiptReplay(LibraryBase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), SeriesHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = 'http://127.0.0.1:' + str(cls.server.server_port)
        cls.playwright = sync_playwright().start()

    def setUp(self):
        # A WebKit/IndexedDB stall must leave a useful stack instead of
        # consuming the entire workflow's 20-minute timeout.
        faulthandler.dump_traceback_later(90, exit=True)
        self.addCleanup(faulthandler.cancel_dump_traceback_later)
        SeriesHandler.moved = False
        SeriesHandler.completed_plan = False
        SeriesHandler.uncertain_plan = False
        SeriesHandler.execute_requests = 0
        StaticHandler.account_fixture = {
            'user': {'id': '42', 'username': 'reader'}, 'csrf_token': 'c' * 64,
            'providers': []
        }
        StaticHandler.account_requests = []
        if self._testMethodName == 'test_reconcile_action_sends_a_request_and_finishes_the_plan':
            print('cloud replay: opening second browser', flush=True)
        super().setUp()
        if self._testMethodName == 'test_reconcile_action_sends_a_request_and_finishes_the_plan':
            print('cloud replay: second browser ready', flush=True)

    def tearDown(self):
        try:
            super().tearDown()
        finally:
            StaticHandler.account_fixture = None
            SeriesHandler.moved = False
            SeriesHandler.completed_plan = False
            SeriesHandler.uncertain_plan = False
            SeriesHandler.execute_requests = 0

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

    def wait_for_previews(self):
        # The series tile starts two lazy file reads. Complete those before
        # closing WebKit's context; otherwise it reports the canceled fetches
        # as cross-origin page errors during test teardown.
        expect(self.page.get_by_role('region', name='Library shelves')).to_have_attribute(
            'aria-busy', 'false', timeout=30000)
        deadline = time.monotonic() + 20
        while sum(request['path'].endswith('/file/')
                  for request in StaticHandler.account_requests) < 2:
            self.assertLess(time.monotonic(), deadline, 'Visible cloud previews did not start')
            self.page.wait_for_timeout(25)
        self.page.wait_for_load_state('networkidle', timeout=30000)

    def test_completed_move_receipts_replay_after_reload(self):
        self.import_book('Unrelated browser book')
        catalog_key = 'library-catalog:' + SOURCE_KEY
        before = self.wait_snapshot(lambda value: catalog_key in value['metadata'])
        self.assertEqual('root', before['metadata'][catalog_key]['entries'][0]['parent'])
        self.wait_for_previews()

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

        self.wait_for_previews()
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
        self.wait_for_previews()

    def test_reconcile_action_sends_a_request_and_finishes_the_plan(self):
        print('cloud replay: waiting for initial previews', flush=True)
        self.wait_for_previews()
        print('cloud replay: reloading uncertain plan', flush=True)
        SeriesHandler.uncertain_plan = True
        self.page.reload()
        print('cloud replay: reviewing plan', flush=True)
        expect(self.page.get_by_role('button', name='Review Change')).to_be_visible()
        self.page.get_by_role('button', name='Review Change').click()
        expect(self.page.get_by_role('button', name='Reconcile Change')).to_be_visible()
        self.page.get_by_role('button', name='Reconcile Change').click()
        print('cloud replay: waiting for completion', flush=True)
        expect(self.page.get_by_text('Series updated. Reading progress, notes and collections were kept.')).to_be_visible()
        self.assertEqual(2, SeriesHandler.execute_requests)
        print('cloud replay: waiting for final previews', flush=True)
        self.wait_for_previews()


if __name__ == '__main__':
    import unittest
    unittest.main(verbosity=2)
