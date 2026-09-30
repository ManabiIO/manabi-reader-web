"""First-sync choice survives real HTTP failure and a fresh document.

The compiled Reader and native IndexedDB are real. Only the existing account
HTTP fixture returns controlled 503s; no Playwright route or storage substitute.
"""
import copy
import json
import socket
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

    def snapshot(self, key='preferences/42'):
        return self.page.evaluate('''async key => {
          const open = indexedDB.open('manabi-reader-integrations');
          const db = await new Promise((resolve, reject) => {
            open.onsuccess = () => resolve(open.result);
            open.onerror = () => reject(open.error);
          });
          try {
            return await new Promise((resolve, reject) => {
              const request = db.transaction('metadata').objectStore('metadata').get(key);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
          } finally { db.close(); }
        }''', key)

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

    def test_lost_put_reply_then_same_setting_edit_converges_without_false_conflict(self):
        self.page.goto(self.origin + '/reader-web/connections')
        expect(self.page.get_by_text('preference-recovery', exact=True)).to_be_visible()
        font = self.page.get_by_label('Font size', exact=True)
        font.fill('30')
        font.press('Tab')
        self.page.get_by_label('When first enabling sync').select_option('local')
        toggle = self.page.get_by_label(
            'Sync reader settings with this Manabi account', exact=True)
        status = self.page.get_by_role('status', name='Settings sync status')
        toggle.check()
        expect(status).to_contain_text('synced', timeout=15000)
        self.assertEqual(30, StaticHandler.preference_settings['font_size'])

        original = StaticHandler.do_PUT
        dropped = []

        def commit_then_drop(handler):
            if not dropped and urlsplit(handler.path).path == '/api/reader-web/preferences/':
                handler.api_request()
                request = type(handler).account_requests[-1]
                type(handler).preference_settings = request['body']['settings']
                type(handler).preference_revision += 1
                dropped.append(type(handler).preference_revision)
                handler.close_connection = True
                try:
                    handler.connection.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                return
            return original(handler)

        with patch.object(StaticHandler, 'do_PUT', commit_then_drop):
            font.fill('31')
            font.press('Tab')
            self.page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
            expect(status).to_contain_text('unavailable', timeout=10000)
            self.assertEqual(31, StaticHandler.preference_settings['font_size'])
            deadline = time.monotonic() + 10
            while True:
                value = self.snapshot()
                pending = (value or {}).get('pendingUpload')
                if pending and pending.get('settings', {}).get('font_size') == 31:
                    break
                self.assertLess(time.monotonic(), deadline,
                                'Lost PUT identity was not saved before recovery')
                self.page.wait_for_timeout(25)

            # Change the exact same setting again before readback. Without the
            # retained request identity, base=30/local=32/remote=31 looks like
            # an unrelated two-sided conflict.
            font.fill('32')
            font.press('Tab')
            deadline = time.monotonic() + 15
            while StaticHandler.preference_settings.get('font_size') != 32:
                self.assertLess(time.monotonic(), deadline,
                                'Lost PUT acknowledgement did not converge')
                self.page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
                self.page.wait_for_timeout(50)

        expect(status).to_contain_text('synced', timeout=10000)
        expect(font).to_have_value('32')
        value = self.snapshot()
        self.assertEqual(32, value['local']['font_size'])
        self.assertEqual(32, value['base']['font_size'])
        self.assertIsNone(value.get('pendingUpload'))
        self.assertEqual(1, len(dropped))
        self.assertEqual([], self.errors)

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
        expect(status).to_contain_text('off')
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

    def exercise_accepted_application_recovery(self, *, edit=False):
        self.page.goto(self.origin + '/reader-web/connections')
        expect(self.page.get_by_text('preference-recovery', exact=True)).to_be_visible()
        self.page.get_by_label('Sync reader settings with this Manabi account', exact=True).check()
        status = self.page.get_by_role('status', name='Settings sync status')
        expect(status).to_contain_text('synced', timeout=15000)

        # Fail the local application of a later successful HTTP reply. Native
        # IndexedDB still executes; only this named organization write aborts.
        self.page.evaluate('''() => {
          window.__rejectAcceptedOrganization = true;
          window.__acceptedOrganizationAborts = 0;
          const put = IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put = function (value, key) {
            const request = put.apply(this, arguments);
            if (window.__rejectAcceptedOrganization &&
                this.transaction.db.name === 'manabi-reader-integrations' &&
                this.name === 'metadata' && key === 'books-organization-v1' &&
                value.collections.some(item => item.id === 'server-accepted')) {
              window.__acceptedOrganizationAborts++;
              this.transaction.abort();
            }
            return request;
          };
        }''')
        StaticHandler.preference_revision += 1
        StaticHandler.preference_settings = {
            **copy.deepcopy(StaticHandler.preference_settings),
            'library_organization': {
                'version': 1,
                'collections': [{
                    'id': 'server-accepted', 'name': 'Accepted server shelf', 'members': []
                }],
                'books': {}
            }
        }
        self.page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        expect(status).to_contain_text('unavailable', timeout=15000)
        self.assertGreater(self.page.evaluate('window.__acceptedOrganizationAborts'), 0)
        deadline = time.monotonic() + 10
        while True:
            saved = self.snapshot()
            collections = saved.get('local', {}).get('library_organization', {}).get('collections', [])
            if any(item['id'] == 'server-accepted' for item in collections):
                break
            self.assertLess(time.monotonic(), deadline, 'Accepted reply was not retained for recovery')
            self.page.wait_for_timeout(25)
        # An untouched empty organization need not have a stored row yet.
        prior = self.snapshot('books-organization-v1') or {}
        self.assertFalse(any(item['id'] == 'server-accepted'
                             for item in prior.get('collections', [])))

        attempted = []
        personal_attempted = []
        self.page.on('request', lambda request: attempted.append(request.url)
                     if urlsplit(request.url).path == '/api/reader-web/preferences/' else None)
        self.page.on('request', lambda request: personal_attempted.append(request.url)
                     if urlsplit(request.url).path.startswith('/api/reader-web/personal/') else None)
        error_start = len(self.errors)
        self.context.set_offline(True)
        try:
            self.assertFalse(self.page.evaluate('navigator.onLine'))
            # Keep the already loaded document. Unlike a route-specific abort
            # matcher, real offline mode also covers capability-query requests.
            if edit:
                font = self.page.get_by_label('Font size', exact=True)
                font.fill('31')
                font.press('Tab')
                expect(font).to_have_value('31')
            self.page.evaluate('window.__rejectAcceptedOrganization = false')
            deadline = time.monotonic() + 15
            while True:
                organization = self.snapshot('books-organization-v1') or {}
                if any(item['id'] == 'server-accepted' for item in organization.get('collections', [])):
                    break
                self.assertLess(time.monotonic(), deadline, 'Accepted settings did not apply offline')
                # Recovery events are repeatable; the edit and remote update are not retried.
                self.page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
                self.page.wait_for_timeout(50)
            self.assertEqual([], attempted, 'Local recovery attempted another preference request')
            self.assertEqual([], personal_attempted, 'Offline recovery started a personal-data request')
            self.assertTrue(any(item['id'] == 'server-accepted' for item in
                                self.snapshot()['local']['library_organization']['collections']))
            if edit:
                expect(self.page.get_by_label('Font size', exact=True)).to_have_value('31')
                self.assertEqual(31, self.snapshot()['local']['font_size'])
        finally:
            self.context.set_offline(False)
        if self.engine == 'webkit':
            # WebKit reports the account change-feed request as a page error
            # while this test deliberately takes the entire context offline.
            # The request is unrelated to preference recovery, is expected only
            # during this bounded offline interval, and is already handled by
            # the account sync lifetime. Keep every other page error visible.
            expected = [
                error for error in self.errors[error_start:]
                if '/api/reader-web/personal/changes/' in error
                and 'due to access control checks.' in error
            ]
            unexpected = [
                error for error in self.errors[error_start:]
                if error not in expected
            ]
            self.assertEqual([], unexpected)
            if expected:
                del self.errors[error_start:]
        self.page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        expect(status).to_contain_text('synced', timeout=15000)
        self.page.reload()
        expect(self.page.get_by_text('preference-recovery', exact=True)).to_be_visible()
        self.assertTrue(any(item['id'] == 'server-accepted' for item in
                            self.snapshot('books-organization-v1')['collections']))
        if edit:
            expect(self.page.get_by_label('Font size', exact=True)).to_have_value('31')
        self.assertEqual([], self.errors)

    def test_accepted_server_organization_recovers_offline_without_refetch(self):
        self.exercise_accepted_application_recovery()

    def test_accepted_server_organization_recovers_offline_preserving_later_edit(self):
        self.exercise_accepted_application_recovery(edit=True)

    def test_first_sync_local_choice_recovers_get_failure(self):
        self.exercise('GET')

    def test_first_sync_local_choice_recovers_put_failure(self):
        self.exercise('PUT')

    def test_first_sync_local_choice_survives_document_reload(self):
        self.exercise('GET', reload=True)


if __name__ == '__main__':
    unittest.main(verbosity=2)
