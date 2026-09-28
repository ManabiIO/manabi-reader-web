import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { loadOfflineModule, storeBoundary, deferred } from './fixtures/offline-module.mjs';

const key = 'books-organization-v1';
const empty = () => ({ version: 1, collections: [], books: {} });

function harness({ failFirstRead, failWrite, channelThrows = false, initial = empty() } = {}) {
  const records = new Map([[key, globalThis.structuredClone(initial)]]);
  const completion = deferred();
  // Observe the fixture's native completion independently, then count when the
  // production boundary obtains it. A missing production observer must fail an
  // assertion, not leak a deliberately injected rejection out of the test runner.
  completion.promise.catch(() => undefined);
  const request = deferred();
  const writes = [];
  const published = [];
  const broadcasts = [];
  const channels = [];
  let doneReads = 0;
  let aborted = 0;
  let transactions = 0;
  let reads = 0;
  const tx = {
    get done() {
      doneReads++;
      return completion.promise;
    },
    abort() {
      aborted++;
      completion.reject(new globalThis.DOMException('rolled back', 'AbortError'));
    },
    store: {
      get(name) {
        reads++;
        if (reads === 1) return request.promise;
        return Promise.resolve(globalThis.structuredClone(records.get(name)));
      },
      async put(value, name) {
        if (failWrite) throw failWrite;
        writes.push([name, globalThis.structuredClone(value)]);
      }
    }
  };
  const db = {
    get: async (_, name) => globalThis.structuredClone(records.get(name)),
    transaction(store, mode) {
      assert.equal(store, 'metadata');
      assert.equal(mode, 'readwrite');
      transactions++;
      if (failFirstRead) request.reject(failFirstRead);
      return tx;
    }
  };
  const { api } = loadOfflineModule('apps/web/src/lib/library/organization.ts', {
    modules: { 'svelte/store': storeBoundary(), idb: { openDB: async () => db } },
    globals: {
      BroadcastChannel: class {
        constructor(name) {
          assert.equal(name, key);
          if (channelThrows) throw new globalThis.DOMException('denied', 'SecurityError');
          channels.push(this);
        }
        postMessage(message) {
          broadcasts.push(message);
        }
        close() {
          this.closed = true;
        }
      }
    }
  });
  api.organization.subscribe((value) => published.push(globalThis.structuredClone(value)));
  return {
    api,
    records,
    completion,
    writes,
    published,
    broadcasts,
    channels,
    doneReads: () => doneReads,
    aborted: () => aborted,
    transactions: () => transactions,
    reads: () => reads,
    releaseRead: () => request.resolve(globalThis.structuredClone(records.get(key))),
    commit() {
      for (const [name, value] of writes) records.set(name, globalThis.structuredClone(value));
      completion.resolve();
    }
  };
}

const drain = () => setImmediate();

test('organization observes transaction completion before its initial read can fail', async () => {
  const h = harness();
  const result = h.api.createCollection('New shelf');
  await drain();
  const observed = h.doneReads();
  h.releaseRead();
  await drain();
  h.commit();
  await result;
  assert.ok(observed > 0, 'initial get was outside the transaction-settlement boundary');
});

test('initial metadata read failure drains rollback and cannot publish a collection', async () => {
  const failure = new globalThis.DOMException('could not read', 'UnknownError');
  const h = harness({ failFirstRead: failure });
  const result = h.api.createCollection('Not saved');
  await assert.rejects(result, (error) => error === failure);
  assert.equal(h.aborted(), 1, 'failed initial read must pass through rollback handling');
  assert.ok(h.doneReads() > 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.published.length, 1);
  assert.equal(h.broadcasts.length, 0);
  assert.deepEqual(h.records.get(key), empty());
});

test('native initial-read abort reports a visible save error', async () => {
  const failure = new globalThis.DOMException('', 'AbortError');
  const h = harness({ failFirstRead: failure });
  const result = h.api.createCollection('Not saved');
  await assert.rejects(result, (error) => {
    assert.equal(error.name, 'Error');
    assert.equal(error.cause, failure);
    assert.match(error.message, /library change could not be saved/);
    assert.match(error.message, /Try again/);
    return true;
  });
  assert.deepEqual(h.records.get(key), empty());
});

test('successful requests publish and broadcast only after native commit', async () => {
  const h = harness();
  const result = h.api.createCollection('Saved shelf', ['book:7']);
  h.releaseRead();
  await drain();
  assert.equal(h.writes.length, 1);
  assert.equal(h.published.length, 1);
  assert.equal(h.broadcasts.length, 0);
  h.commit();
  const id = await result;
  assert.equal(h.records.get(key).collections[0].id, id);
  assert.equal(h.published.at(-1).collections[0].name, 'Saved shelf');
  assert.deepEqual(h.broadcasts, ['changed']);
});

test('commit failure after a successful put retains the previous organization', async () => {
  const before = { ...empty(), collections: [{ id: 'existing', name: 'Keep', members: [] }] };
  const h = harness({ initial: before });
  const result = h.api.createCollection('Cannot commit');
  const rejected = assert.rejects(result, { name: 'QuotaExceededError' });
  h.releaseRead();
  await drain();
  assert.equal(h.writes.length, 1);
  h.completion.reject(new globalThis.DOMException('no space', 'QuotaExceededError'));
  await rejected;
  assert.deepEqual(h.records.get(key), before);
  assert.equal(h.published.length, 1);
  assert.equal(h.broadcasts.length, 0);
});

test('a failing mutation or put cannot publish its staged value', async () => {
  for (const duringChange of [true, false]) {
    const failure = new Error('injected write failure');
    const h = harness({ failWrite: duringChange ? undefined : failure });
    const result = h.api.updateOrganization((value) => {
      value.collections.push({ id: 'temp', name: 'Temporary', members: [] });
      if (duringChange) throw failure;
    });
    const rejected = assert.rejects(result, (error) => error === failure);
    h.releaseRead();
    await rejected;
    assert.equal(h.aborted(), 1);
    assert.equal(h.published.length, 1);
    assert.equal(h.broadcasts.length, 0);
    assert.deepEqual(h.records.get(key), empty());
  }
});

test('idempotent receipts and no-op mutations still await commit', async () => {
  for (const withReceipt of [false, true]) {
    const h = harness();
    const receipt = { key: 'import-receipt', value: 'same', modified: 5 };
    h.records.set(receipt.key, receipt);
    let changed = false;
    let settled = false;
    const result = h.api.updateOrganization(
      () => {
        changed = true;
      },
      withReceipt ? receipt : undefined
    );
    result.then(() => (settled = true));
    h.releaseRead();
    await drain();
    assert.equal(changed, !withReceipt);
    assert.equal(settled, false);
    h.commit();
    await result;
    assert.equal(h.writes.length, 0);
    assert.equal(h.broadcasts.length, 0);
    assert.equal(h.published.length, 1);
  }
});

test('migration receipt and organization publish in the same commit', async () => {
  const h = harness();
  const receipt = { key: 'import-receipt', value: 'new', modified: 9 };
  const result = h.api.updateOrganization((value) => {
    value.collections.push({ id: 'migrated', name: 'Imported', members: ['book:7'] });
  }, receipt);
  h.releaseRead();
  await drain();
  assert.deepEqual(
    h.writes.map(([name]) => name),
    [receipt.key, key]
  );
  h.commit();
  await result;
  assert.deepEqual(h.records.get(receipt.key), receipt);
  assert.equal(h.records.get(key).collections[0].name, 'Imported');
});

test('denied messaging leaves local collection reads and writes working', async () => {
  const h = harness({ channelThrows: true });
  const errors = [];
  const stop = h.api.watchOrganization((error) => errors.push(error));
  await drain();
  const result = h.api.createCollection('Local only');
  h.releaseRead();
  await drain();
  h.commit();
  await result;
  assert.equal(h.records.get(key).collections[0].name, 'Local only');
  assert.equal(h.published.at(-1).collections[0].name, 'Local only');
  assert.deepEqual(errors, []);
  assert.doesNotThrow(stop);
});

test('scope cancellation before storage opens starts no transaction', async () => {
  const h = harness();
  const controller = new globalThis.AbortController();
  const reason = new Error('profile ended');
  controller.abort(reason);
  await assert.rejects(
    h.api.updateOrganization(() => assert.fail('changed'), undefined, controller.signal),
    (error) => error === reason
  );
  assert.equal(h.transactions(), 0);
});

test('scope cancellation during first read aborts and drains without publication', async () => {
  const h = harness();
  const controller = new globalThis.AbortController();
  const reason = new Error('profile changed');
  const result = h.api.updateOrganization(
    () => assert.fail('stale mutation'),
    undefined,
    controller.signal
  );
  const rejected = assert.rejects(result, (error) => error === reason);
  await drain();
  controller.abort(reason);
  h.releaseRead();
  await rejected;
  assert.ok(h.aborted() > 0);
  assert.ok(h.doneReads() > 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.broadcasts.length, 0);
  assert.equal(h.published.length, 1);
});

test('revoking a settings apply while commit is pending retains existing collections', async () => {
  const h = harness();
  const controller = new globalThis.AbortController();
  const incoming = { ...empty(), collections: [{ id: 'remote', name: 'Remote', members: [] }] };
  const result = h.api.organizationPreference.next(incoming, controller.signal);
  const reason = new Error('sync disabled');
  const rejected = assert.rejects(result, (error) => error === reason);
  h.releaseRead();
  await drain();
  assert.equal(h.writes.length, 1);
  controller.abort(reason);
  await rejected;
  assert.deepEqual(h.records.get(key), empty());
  assert.equal(h.published.length, 1);
  assert.equal(h.broadcasts.length, 0);
});

test('committed local operations detach cancellation without pretending to undo a commit', async () => {
  const h = harness();
  const controller = new globalThis.AbortController();
  const result = h.api.updateOrganization(
    (value) => {
      value.collections.push({ id: 'done', name: 'Committed', members: [] });
    },
    undefined,
    controller.signal
  );
  h.releaseRead();
  await drain();
  h.commit();
  await result;
  controller.abort();
  assert.equal(h.aborted(), 0);
  assert.equal(h.records.get(key).collections[0].name, 'Committed');
});

test('owner change after commit suppresses stale organization publication', async () => {
  const h = harness();
  let current = true;
  const result = h.api.updateOrganization(
    (value) => {
      value.collections.push({ id: 'owned', name: 'Former owner', members: [] });
    },
    undefined,
    () => {
      if (!current) throw new Error('owner changed');
    }
  );
  h.releaseRead();
  await drain();
  assert.equal(h.writes.length, 1);
  h.commit();
  current = false;
  await result;
  assert.equal(h.records.get(key).collections[0].name, 'Former owner');
  assert.equal(h.published.length, 1);
  assert.equal(h.broadcasts.length, 0);
});

test('migration receipt fields are captured before database suspension', async () => {
  const h = harness();
  const receipt = { key: 'receipt-original', value: 'original', modified: 3 };
  const result = h.api.updateOrganization((value) => {
    value.collections.push({ id: 'done', name: 'Saved', members: [] });
  }, receipt);
  receipt.key = 'receipt-replaced';
  receipt.value = 'replaced';
  receipt.modified = 999;
  h.releaseRead();
  await drain();
  h.commit();
  await result;
  assert.deepEqual(h.records.get('receipt-original'), {
    key: 'receipt-original',
    value: 'original',
    modified: 3
  });
  assert.equal(h.records.has('receipt-replaced'), false);
});

test('organization rejects more than 50,000 total memberships before writing', async () => {
  const h = harness();
  const result = h.api.updateOrganization((value) => {
    value.collections.push({
      id: 'too-many',
      name: 'Too many',
      members: Array.from({ length: 50_001 }, (_, index) => `member-${index}`)
    });
  });
  const rejected = assert.rejects(result, /invalid or exceeds its size limit/);
  h.releaseRead();
  await rejected;
  assert.equal(h.writes.length, 0);
  assert.equal(h.aborted(), 1);
  assert.deepEqual(h.records.get(key), empty());
});

test('book presentation titles use the 1,000-character presentation limit, not collection-name limits', async () => {
  const h = harness();
  const title = '長'.repeat(500);
  const result = h.api.presentBook('book:long-title', { title });
  h.releaseRead();
  await drain();
  assert.equal(h.writes.length, 1);
  h.commit();
  await result;
  assert.equal(h.records.get(key).books['book:long-title'].title, title);
});
