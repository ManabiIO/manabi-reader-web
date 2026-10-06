"""Repeat real collection creation with bounded event/transaction failure evidence.

Every attempt has a fresh persistent browser profile. No action is retried, no
storage operation is substituted, and a later success cannot waive a failure.
"""
import json
from pathlib import Path
import unittest
import time
from unittest.mock import patch
from urllib.parse import urlsplit

from playwright.sync_api import expect
from test_books_library import LibraryBase
from test_static_reader import StaticHandler


TRACE = r'''() => {
  const events = [];
  const note = (kind, details = {}) => {
    events.push({kind, time: performance.now(), ...details});
    if (events.length > 200) events.shift();
  };
  window.__collectionTrace = events;
  const describe = element => element instanceof Element ? {
    tag: element.tagName, id: element.id, role: element.getAttribute('role'),
    label: element.getAttribute('aria-label'), placeholder: element.getAttribute('placeholder'),
    text: element.textContent?.trim().slice(0, 100),
    value: element instanceof HTMLInputElement ? element.value : undefined
  } : null;
  for (const type of ['input', 'change', 'click', 'submit', 'reset', 'focusin', 'invalid']) {
    document.addEventListener(type, event => {
      if (!(event.target instanceof Element)) return;
      const target = event.target;
      if (target.closest('[role="dialog"], [role="menu"]') || type === 'reset') {
        note(type, {target: describe(target), trusted: event.isTrusted,
          input: document.querySelector('input[placeholder="New collection name"]')?.value});
      }
    }, true);
  }
  const value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(HTMLInputElement.prototype, 'value', {
    ...value,
    set(next) {
      if (this.placeholder === 'New collection name') {
        note('value-set', {before: value.get.call(this), next, stack: new Error().stack});
      }
      value.set.call(this, next);
    }
  });
  for (const method of ['get', 'put', 'delete', 'clear']) {
    const original = IDBObjectStore.prototype[method];
    IDBObjectStore.prototype[method] = function (...args) {
      const relevant = this.transaction.db.name === 'manabi-reader-integrations' &&
        this.name === 'metadata' && (method === 'clear' ||
          args[method === 'put' ? 1 : 0] === 'books-organization-v1');
      if (!relevant) return original.apply(this, args);
      const summary = object => object?.collections?.map(({id, name, members}) => ({id, name, members}));
      const data = {method, collections: method === 'put' ? summary(args[0]) : undefined};
      note('request', {...data, stack: new Error().stack});
      const request = original.apply(this, args);
      request.addEventListener('success', () => note('request-success', {
        method, collections: method === 'get' ? summary(request.result) : undefined
      }));
      request.addEventListener('error', () => note('request-error', {method, error: request.error?.name}));
      const tx = this.transaction;
      tx.addEventListener('complete', () => note('transaction-complete', data), {once: true});
      tx.addEventListener('abort', () => note('transaction-abort', {method, error: tx.error?.name}), {once: true});
      return request;
    };
  }
}'''


class CollectionCommitBrowser(LibraryBase):
    def setUp(self):
        super().setUp()
        self.page.evaluate(TRACE)
        self.trace_before_reload = None

    def tearDown(self):
        output = Path('test-results')
        output.mkdir(exist_ok=True)
        if not self.page.is_closed():
            (output / (self.engine + '-' + self._testMethodName + '-trace.json')).write_text(
                json.dumps(self.page.evaluate('window.__collectionTrace') or self.trace_before_reload, indent=2, ensure_ascii=False)
            )
        super().tearDown()

    def create_and_verify(self, keyboard):
        self.import_book('Finished selection')
        self.import_book('Still reading selection')
        name = 'Personal selection'
        if keyboard:
            self.menu('Still reading selection', 'Add to Collection…')
            dialog = self.dialog()
            field = dialog.get_by_label('New collection name', exact=True)
            field.fill(name)
            field.press('Enter')
            expect(dialog.get_by_role('checkbox', name=name, exact=True)).to_be_checked()
            dialog.get_by_role('button', name='Done', exact=True).click()
            expect(dialog).to_have_count(0)
        else:
            # Keep the exact previously failing interaction, without adding a
            # pre-submit assertion/RPC that could change its event ordering.
            self.add_collection('Still reading selection', name)
        rows = self.stores('manabi-reader-integrations', ['metadata'])['metadata']
        organization = next(row for row in rows if row.get('version') == 1 and 'collections' in row)
        collection = next(item for item in organization['collections'] if item['name'] == name)
        self.assertEqual(len(collection['members']), 1)
        self.trace_before_reload = self.page.evaluate('window.__collectionTrace')
        self.page.reload()
        self.choose_collection(name)
        expect(self.page.get_by_role('button', name='Read Still reading selection', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Read Finished selection', exact=True)).to_have_count(0)


    def test_initial_organization_read_abort_keeps_membership_and_allows_retry(self):
        self.import_book('Read abort book')
        self.add_collection('Read abort book', 'Existing shelf')
        expect(self.page.get_by_role('region', name='Library shelves')).to_have_attribute(
            'aria-busy', 'false'
        )
        rows = self.stores('manabi-reader-integrations', ['metadata'])['metadata']
        before = next(row for row in rows if row.get('version') == 1 and 'collections' in row)
        self.menu('Read abort book', 'Add to Collection…')
        dialog = self.dialog()
        field = dialog.get_by_label('New collection name', exact=True)
        field.fill('Retry shelf')
        # Fault injection aborts a real native transaction at its first read.
        # It does not replace storage, synthesize a successful write, or touch
        # previously committed records. The second user submission is explicit.
        self.page.evaluate('''() => {
          const original = IDBObjectStore.prototype.get;
          window.__organizationReadAbortCount = 0;
          IDBObjectStore.prototype.get = function (...args) {
            const request = original.apply(this, args);
            if (window.__organizationReadAbortCount === 0 &&
                this.transaction.db.name === 'manabi-reader-integrations' &&
                this.transaction.mode === 'readwrite' && this.name === 'metadata' &&
                args[0] === 'books-organization-v1') {
              window.__organizationReadAbortCount++;
              this.transaction.abort();
            }
            return request;
          };
        }''')
        dialog.get_by_role('button', name='Create', exact=True).click()
        expect(dialog.get_by_role('alert')).to_contain_text('The library change could not be saved')
        expect(field).to_have_value('Retry shelf')
        expect(dialog.get_by_role('checkbox', name='Retry shelf', exact=True)).to_have_count(0)
        self.assertEqual(1, self.page.evaluate('window.__organizationReadAbortCount'))
        rows = self.stores('manabi-reader-integrations', ['metadata'])['metadata']
        after = next(row for row in rows if row.get('version') == 1 and 'collections' in row)
        self.assertEqual(before, after)
        self.assertEqual([], self.errors)
        dialog.get_by_role('button', name='Create', exact=True).click()
        expect(dialog.get_by_role('checkbox', name='Retry shelf', exact=True)).to_be_checked()
        expect(dialog.get_by_role('checkbox', name='Existing shelf', exact=True)).to_be_checked()
        dialog.get_by_role('button', name='Done', exact=True).click()
        self.page.reload()
        self.choose_collection('Retry shelf')
        expect(self.page.get_by_role('button', name='Read Read abort book', exact=True)).to_be_visible()
        self.assertEqual([], self.errors)

    def test_denied_organization_channel_does_not_disable_local_collections(self):
        self.import_book('Local messaging book')
        # Deny only organization notifications; other app channels are unchanged.
        # The native browser database and compiled Svelte UI still perform all I/O.
        self.context.add_init_script('''(() => {
          const NativeChannel = window.BroadcastChannel;
          window.BroadcastChannel = new Proxy(NativeChannel, {
            construct(Target, args) {
              if (args[0] === 'books-organization-v1')
                throw new DOMException('Messaging denied by fixture', 'SecurityError');
              return Reflect.construct(Target, args);
            }
          });
        })()''')
        self.go_library()
        self.add_collection('Local messaging book', 'Local shelf')
        self.page.reload()
        self.choose_collection('Local shelf')
        expect(self.page.get_by_role('button', name='Read Local messaging book', exact=True)).to_be_visible()
        self.assertEqual([], self.errors)


    def prepare_preference_recovery(self, *, restore_collection=False):
        # Establish consent normally, then model an existing saved profile.
        StaticHandler.preference_revision = 0
        StaticHandler.preference_settings = {}
        StaticHandler.account_fixture = {
            'user': {'id': '42', 'username': 'offline-recovery'},
            'csrf_token': 'c' * 64,
            'providers': []
        }
        self.page.goto(self.origin + '/reader-web/connections')
        expect(self.page.get_by_text('Signed in as', exact=False)).to_contain_text('offline-recovery')
        self.page.get_by_label('Sync reader settings with this Manabi account', exact=True).check()
        expect(self.page.get_by_role('status', name='Settings sync status')).to_contain_text('synced')
        self.page.evaluate('''async ({restoreCollection, requireWorker}) => {
          const open = indexedDB.open('manabi-reader-integrations');
          const db = await new Promise((resolve, reject) => {
            open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
          });
          try {
            const tx = db.transaction('metadata', 'readwrite');
            const done = new Promise((resolve, reject) => {
              tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
            });
            const request = tx.objectStore('metadata').get('preferences/42');
            request.onsuccess = () => {
              const value = request.result;
              value.local.theme = 'light';
              if (restoreCollection) {
                value.local.library_organization = {
                  version: 1,
                  collections: [{id: 'offline-restored', name: 'Offline restored', members: []}],
                  books: {}
                };
                tx.objectStore('metadata').put(
                  {version: 1, collections: [], books: {}}, 'books-organization-v1');
              }
              tx.objectStore('metadata').put(value, 'preferences/42');
            };
            await done;
          } finally { db.close(); }
          if (!requireWorker) return;
          const deadline = Date.now() + 15000;
          while (Date.now() < deadline) {
            const registration = await navigator.serviceWorker.getRegistration('/reader-web/');
            if (registration?.active?.state === 'activated') return;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          throw new Error('Automatic offline worker did not activate');
        }''', {'restoreCollection': restore_collection, 'requireWorker': self.engine != 'webkit'})

    def enter_preference_outage(self):
        if self.engine == 'webkit':
            # WebKit cannot navigate uncached static routes fully offline, and
            # Playwright routing does not intercept its keepalive reads reliably.
            # Fail the real preferences HTTP endpoint, including versioned URLs,
            # while leaving the app shell and account identity reachable.
            self.preference_outage_requests = []
            original = StaticHandler.do_GET

            def unavailable(handler):
                if urlsplit(handler.path).path != '/api/reader-web/preferences/':
                    return original(handler)
                self.preference_outage_requests.append(handler.path)
                body = b'{"error":"unavailable"}'
                handler.send_response(503)
                handler.send_header('Content-Type', 'application/json')
                handler.send_header('Content-Length', str(len(body)))
                handler.send_header('Cache-Control', 'no-store')
                handler.send_header('X-Manabi-User', '42')
                handler.end_headers()
                handler.wfile.write(body)

            self.preference_outage_patch = patch.object(StaticHandler, 'do_GET', unavailable)
            self.preference_outage_patch.start()
        else:
            self.context.set_offline(True)

    def leave_preference_outage(self):
        if self.engine == 'webkit':
            outage = getattr(self, 'preference_outage_patch', None)
            if outage is not None:
                outage.stop()
        else:
            self.context.set_offline(False)

    def read_recovery_metadata(self, key):
        return self.page.evaluate('''async key => {
          const open = indexedDB.open('manabi-reader-integrations');
          const db = await new Promise((resolve, reject) => {
            open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
          });
          try {
            return await new Promise((resolve, reject) => {
              const request = db.transaction('metadata').objectStore('metadata').get(key);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
          } finally { db.close(); }
        }''', key)

    def recover_preference_until(self, key, predicate):
        deadline = time.monotonic() + 15
        while True:
            value = self.read_recovery_metadata(key)
            if predicate(value):
                return value
            self.assertLess(time.monotonic(), deadline, 'Offline preference recovery did not commit')
            # Exercise real event-driven recovery and its real five-second backoff.
            # This is predicate polling, not a retry of the edit/import action.
            self.page.evaluate('document.dispatchEvent(new Event("visibilitychange"))')
            self.page.wait_for_timeout(100)

    def wait_for_recovery_probe(self, probe):
        deadline = time.monotonic() + 15
        while not self.page.evaluate('(name) => window[name] > 0', probe):
            self.assertLess(time.monotonic(), deadline, f'{probe} did not observe a write')
            self.page.wait_for_timeout(25)

    def test_offline_preference_save_failure_retries_without_another_edit(self):
        old_fixture = StaticHandler.account_fixture
        old_revision = StaticHandler.preference_revision
        old_settings = StaticHandler.preference_settings
        try:
            self.prepare_preference_recovery()
            self.enter_preference_outage()
            self.page.goto(self.origin + '/reader-web/settings')
            expect(self.page.locator('html')).to_have_attribute('data-appearance', 'light')
            if self.engine == 'webkit':
                deadline = time.monotonic() + 15
                while not self.preference_outage_requests:
                    self.assertLess(time.monotonic(), deadline,
                                    'Preference restoration did not reach the API outage')
                    self.page.wait_for_timeout(25)
            self.page.evaluate('''() => {
              window.__failPreferenceSave = true;
              window.__preferenceSaveAborts = 0;
              window.__preferenceRecoveryEvents = [];
              const put = IDBObjectStore.prototype.put;
              IDBObjectStore.prototype.put = function(value, key) {
                const request = put.apply(this, arguments);
                if (this.transaction.db.name !== 'manabi-reader-integrations' ||
                    this.name !== 'metadata' || key !== 'preferences/42') return request;
                const tx = this.transaction;
                window.__preferenceRecoveryEvents.push({kind: 'put', theme: value.local.theme});
                tx.addEventListener('complete', () =>
                  window.__preferenceRecoveryEvents.push({kind: 'complete', theme: value.local.theme}),
                  {once: true});
                if (window.__failPreferenceSave) {
                  window.__preferenceSaveAborts++;
                  tx.abort();
                }
                return request;
              };
            }''')
            self.page.get_by_role('group', name='Appearance mode').get_by_role(
                'button', name='Dark', exact=True).click()
            self.wait_for_recovery_probe('__preferenceSaveAborts')
            expect(self.page.locator('html')).to_have_attribute('data-appearance', 'dark')
            self.assertEqual(self.read_recovery_metadata('preferences/42')['local']['theme'], 'light')
            self.page.evaluate('window.__failPreferenceSave = false')
            recovered = self.recover_preference_until(
                'preferences/42', lambda value: value['local']['theme'] == 'dark')
            self.assertTrue(recovered['enabled'])
            self.trace_before_reload = self.page.evaluate('window.__preferenceRecoveryEvents')
            self.page.reload()
            expect(self.page.locator('html')).to_have_attribute('data-appearance', 'dark')
            if self.engine == 'webkit':
                self.assertTrue(any('?book_presentation_version=1' in url
                                    for url in self.preference_outage_requests),
                                'The outage must intercept the real versioned preference read')
        finally:
            StaticHandler.account_fixture = old_fixture
            StaticHandler.preference_revision = old_revision
            StaticHandler.preference_settings = old_settings
            self.leave_preference_outage()

    def test_offline_profile_application_failure_preserves_unrelated_edits_on_retry(self):
        old_fixture = StaticHandler.account_fixture
        old_revision = StaticHandler.preference_revision
        old_settings = StaticHandler.preference_settings
        try:
            self.prepare_preference_recovery(restore_collection=True)
            self.context.add_init_script('''(() => {
              window.__failOrganizationApply = true;
              window.__organizationApplyAborts = 0;
              window.__preferenceRecoveryEvents = [];
              const put = IDBObjectStore.prototype.put;
              IDBObjectStore.prototype.put = function(value, key) {
                const request = put.apply(this, arguments);
                if (this.transaction.db.name !== 'manabi-reader-integrations' ||
                    this.name !== 'metadata' || key !== 'books-organization-v1' ||
                    !value.collections.some(item => item.id === 'offline-restored')) return request;
                const tx = this.transaction;
                window.__preferenceRecoveryEvents.push({kind: 'organization-put'});
                tx.addEventListener('complete', () =>
                  window.__preferenceRecoveryEvents.push({kind: 'organization-complete'}),
                  {once: true});
                if (window.__failOrganizationApply) {
                  window.__organizationApplyAborts++;
                  tx.abort();
                }
                return request;
              };
            })();''')
            self.enter_preference_outage()
            self.page.goto(self.origin + '/reader-web/settings')
            self.wait_for_recovery_probe('__organizationApplyAborts')
            expect(self.page.locator('html')).to_have_attribute('data-appearance', 'light')
            self.assertEqual(self.read_recovery_metadata('books-organization-v1')['collections'], [])
            self.page.get_by_role('group', name='Appearance mode').get_by_role(
                'button', name='Dark', exact=True).click()
            expect(self.page.locator('html')).to_have_attribute('data-appearance', 'dark')
            self.page.evaluate('window.__failOrganizationApply = false')
            self.recover_preference_until(
                'books-organization-v1',
                lambda value: any(item['id'] == 'offline-restored' for item in value['collections']))
            preferences = self.recover_preference_until(
                'preferences/42', lambda value: value['local']['theme'] == 'dark')
            self.assertTrue(any(
                item['id'] == 'offline-restored'
                for item in preferences['local']['library_organization']['collections']))
            expect(self.page.locator('html')).to_have_attribute('data-appearance', 'dark')
            self.trace_before_reload = self.page.evaluate('window.__preferenceRecoveryEvents')
            self.page.reload()
            expect(self.page.locator('html')).to_have_attribute('data-appearance', 'dark')
            self.assertTrue(any(
                item['id'] == 'offline-restored'
                for item in self.read_recovery_metadata('books-organization-v1')['collections']))
        finally:
            StaticHandler.account_fixture = old_fixture
            StaticHandler.preference_revision = old_revision
            StaticHandler.preference_settings = old_settings
            self.leave_preference_outage()


# Each fresh-profile run is independently required; these are not retries.
for method in ('pointer', 'keyboard'):
    for attempt in range(1, 5):
        def case(self, keyboard=(method == 'keyboard')):
            self.create_and_verify(keyboard)
        setattr(CollectionCommitBrowser, f'test_{method}_creation_{attempt}', case)


if __name__ == '__main__':
    unittest.main(verbosity=2)
