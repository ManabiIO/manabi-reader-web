"""Repeat real collection creation with bounded event/transaction failure evidence.

Every attempt has a fresh persistent browser profile. No action is retried, no
storage operation is substituted, and a later success cannot waive a failure.
"""
import json
from pathlib import Path
import unittest

from playwright.sync_api import expect
from test_books_library import LibraryBase


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


# Each fresh-profile run is independently required; these are not retries.
for method in ('pointer', 'keyboard'):
    for attempt in range(1, 5):
        def case(self, keyboard=(method == 'keyboard')):
            self.create_and_verify(keyboard)
        setattr(CollectionCommitBrowser, f'test_{method}_creation_{attempt}', case)


if __name__ == '__main__':
    unittest.main(verbosity=2)
