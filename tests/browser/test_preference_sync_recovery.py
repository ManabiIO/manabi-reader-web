"""First-sync choice survives real HTTP failure and a fresh document.

The compiled Reader and native IndexedDB are real. Only the existing account
HTTP fixture returns controlled 503s; no Playwright route or storage substitute.
"""
import copy
import json
import time
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit

from playwright.sync_api import expect
from test_books_library import LibraryBase
from test_static_reader import StaticHandler


class PreferenceSyncRecovery(LibraryBase):
    def setUp(self):
        super().setUp()
        self.previous_fixture = copy.deepcopy(StaticHandler.account_fixture)
        self.previous_settings = copy.deepcopy(StaticHandler.preference_settings)
        self.previous_revision = StaticHandler.preference_revision
        self.previous_requests = StaticHandler.account_requests
        StaticHandler.account_fixture = {
            'user': {'id': '42', 'username': 'preference-recovery'},
            'csrf_token': 'c' * 64, 'providers': []
        }
        StaticHandler.preference_revision = 7
        StaticHandler.preference_settings = {'font_size': 12}
        StaticHandler.account_requests = []

    def tearDown(self):
        try:
            super().tearDown()
        finally:
            StaticHandler.account_fixture = self.previous_fixture
            StaticHandler.preference_settings = self.previous_settings
            StaticHandler.preference_revision = self.previous_revision
            StaticHandler.account_requests = self.previous_requests

    def snapshot(self):
        return self.page.evaluate('''async () => {
          const open = indexedDB.open('manabi-reader-integrations');
          const db = await new Promise((resolve, reject) => {
            open.onsuccess = () => resolve(open.result);
            open.onerror = () => reject(open.error);
          });
          try {
            return await new Promise((resolve, reject) => {
              const request = db.transaction('metadata').objectStore('metadata').get('preferences/42');
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
          } finally { db.close(); }
        }''')

    def exercise(self, method, *, reload=False):
        self.page.goto(self.origin + '/reader-web/connections')
        expect(self.page.get_by_text('preference-recovery', exact=True)).to_be_visible()
        # The selector is bound by the actual page. Selection and blur exercise
        # normal Svelte input handling before the user's consent is submitted.
        font = self.page.get_by_label('Font size', exact=True)
        font.fill('31')
        font.press('Tab')
        expect(font).to_have_value('31')
        self.page.get_by_label('When first enabling sync').select_option('local')
        original = getattr(StaticHandler, 'do_' + method)
        failures = []

        def fail_once(handler):
            if not failures and urlsplit(handler.path).path == '/api/reader-web/preferences/':
                handler.api_request()
                failures.append(method)
                body = json.dumps({'error': 'unavailable'}).encode()
                handler.send_response(503)
                handler.send_header('Content-Type', 'application/json')
                handler.send_header('Content-Length', str(len(body)))
                handler.send_header('Cache-Control', 'no-store')
                handler.send_header('X-Manabi-User', '42')
                handler.end_headers()
                handler.wfile.write(body)
                return
            return original(handler)

        with patch.object(StaticHandler, 'do_' + method, fail_once):
            self.page.get_by_label('Sync reader settings with this Manabi account', exact=True).check()
            status = self.page.get_by_role('status', name='Settings sync status')
            expect(status).to_contain_text('unavailable')
            self.assertEqual(failures, [method])
            # Wait for the failure snapshot's real transaction, not just its UI.
            deadline = time.monotonic() + 10
            while True:
                value = self.snapshot()
                if value and value.get('initialChoice') == 'local':
                    break
                self.assertLess(time.monotonic(), deadline, 'First-sync decision was not saved')
                self.page.wait_for_timeout(25)
            self.assertFalse(value['initialized'])
            self.assertEqual(31, value['local']['font_size'])
            if reload:
                self.page.reload()
            else:
                # One user choice only: drive ordinary recovery events while
                # allowing the production five-second backoff to elapse.
                deadline = time.monotonic() + 15
                while 'synced' not in status.inner_text():
                    self.assertLess(time.monotonic(), deadline, 'Automatic sync did not recover')
                    self.page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
                    self.page.wait_for_timeout(50)
            expect(status).to_contain_text('synced', timeout=15000)
            expect(self.page.get_by_label('Font size', exact=True)).to_have_value('31')
            value = self.snapshot()
            self.assertTrue(value['initialized'])
            self.assertIsNone(value.get('initialChoice'))
            self.assertEqual(31, value['local']['font_size'])
            self.assertEqual(31, StaticHandler.preference_settings['font_size'])
            self.assertNotIn('initialChoice', StaticHandler.preference_settings)
            self.assertEqual([], self.errors)


    def preference_request_count(self):
        return sum(1 for request in StaticHandler.account_requests
                   if request['path'].endswith('/preferences/'))

    def test_successful_manual_recovery_clears_previous_retry_after(self):
        self.page.goto(self.origin + '/reader-web/connections')
        expect(self.page.get_by_text('preference-recovery', exact=True)).to_be_visible()
        font = self.page.get_by_label('Font size', exact=True)
        font.fill('31')
        font.press('Tab')
        self.page.get_by_label('When first enabling sync').select_option('local')
        toggle = self.page.get_by_label(
            'Sync reader settings with this Manabi account', exact=True)
        status = self.page.get_by_role('status', name='Settings sync status')
        toggle.check()
        expect(status).to_contain_text('synced', timeout=15000)
        self.assertEqual(31, StaticHandler.preference_settings['font_size'])

        original = StaticHandler.do_GET
        failures = []

        def rate_limit_once(handler):
            if not failures and urlsplit(handler.path).path == '/api/reader-web/preferences/':
                handler.api_request()
                failures.append('GET')
                body = json.dumps({'error': 'rate_limited'}).encode()
                handler.send_response(429)
                handler.send_header('Content-Type', 'application/json')
                handler.send_header('Content-Length', str(len(body)))
                handler.send_header('Cache-Control', 'no-store')
                handler.send_header('Retry-After', '30')
                handler.send_header('X-Manabi-User', '42')
                handler.end_headers()
                handler.wfile.write(body)
                return
            return original(handler)

        with patch.object(StaticHandler, 'do_GET', rate_limit_once):
            font.fill('32')
            font.press('Tab')
            self.page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
            expect(status).to_contain_text('rate_limited', timeout=10000)
            self.assertEqual(['GET'], failures)

        # An explicit disable/re-enable is allowed to try immediately. Once that
        # succeeds, the obsolete Retry-After must not throttle later edits.
        toggle.uncheck()
        expect(status).to_contain_text('Off')
        toggle.check()
        expect(status).to_contain_text('synced', timeout=10000)
        self.assertEqual(32, StaticHandler.preference_settings['font_size'])
        before = self.preference_request_count()

        font.fill('33')
        font.press('Tab')
        deadline = time.monotonic() + 5
        while StaticHandler.preference_settings.get('font_size') != 33:
            self.assertLess(
                time.monotonic(), deadline,
                'Successful recovery left the previous server Retry-After active')
            self.page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
            self.page.wait_for_timeout(50)
        self.assertGreater(self.preference_request_count(), before)
        self.assertEqual([], self.errors)

    def test_first_sync_local_choice_recovers_get_failure(self):
        self.exercise('GET')

    def test_first_sync_local_choice_recovers_put_failure(self):
        self.exercise('PUT')

    def test_first_sync_local_choice_survives_document_reload(self):
        self.exercise('GET', reload=True)


if __name__ == '__main__':
    unittest.main(verbosity=2)
