import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { TransactionFactory } from './transaction-double.mjs';

const scope = 'account:guard',
  key = 'content:' + '9'.repeat(64);
const server = {
  kind: 'video_info',
  entity_id: key,
  book_key: key,
  revision: 1,
  payload: { version: 1, title: 'Guarded', duration: 1, width: 1, height: 1, addedAt: 1 },
  deleted: false
};
const turn = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const outcome = (promise) =>
  promise.then(
    (value) => ({ ok: true, value }),
    (reason) => ({ ok: false, reason })
  );

for (const reason of [null, 0, false])
  test(`guarded database opening detaches before late open: ${reason}`, async () => {
    const factory = new TransactionFactory();
    factory.holdOpen = true;
    const store = new MediaStore(factory, 'late-open');
    const owner = new AbortController();
    const pending = outcome(
      store.accept(scope, server, {
        signal: owner.signal,
        check: () => owner.signal.throwIfAborted()
      })
    );
    owner.abort(reason);
    try {
      assert.deepEqual(await Promise.race([pending, turn().then(() => 'stalled')]), {
        ok: false,
        reason
      });
      assert.equal(factory.transactions.length, 0);
    } finally {
      factory.releaseOpen();
      await pending;
      await store.close();
    }
    assert.equal(factory.transactions.length, 0);
    assert.equal(
      factory.connections.every((connection) => connection.closed),
      true
    );
  });

test('transaction callback rechecks authority after waiting behind another transaction', async () => {
  const factory = new TransactionFactory(),
    store = new MediaStore(factory, 'queued-guard');
  await store.local(scope, 'sync', 'cursor');
  const gate = deferred();
  factory.queue = gate.promise;
  let current = true;
  const pending = outcome(
    store.accept(scope, server, {
      signal: new AbortController().signal,
      check: () => {
        if (!current) throw new Error('Authority retired');
      }
    })
  );
  await turn();
  current = false;
  gate.resolve();
  try {
    const result = await pending;
    assert.equal(result.ok, false);
    assert.match(String(result.reason), /Authority retired/);
    assert.equal(await store.get(scope, 'video_info', key), undefined);
    assert.equal(factory.putCount, 0);
  } finally {
    gate.resolve();
    await store.close();
  }
});

test('write guard captures signal and check before a caller mutates its options', async () => {
  const factory = new TransactionFactory(),
    store = new MediaStore(factory, 'captured-guard');
  await store.local(scope, 'sync', 'cursor');
  const gate = deferred();
  factory.queue = gate.promise;
  const owner = new AbortController();
  let current = true;
  const guard = {
    signal: owner.signal,
    check: () => {
      if (!current) throw new Error('Captured authority expired');
    }
  };
  const pending = outcome(store.accept(scope, server, guard));
  guard.signal = new AbortController().signal;
  guard.check = () => {};
  current = false;
  gate.resolve();
  try {
    assert.match(String((await pending).reason), /Captured authority expired/);
    assert.equal(await store.get(scope, 'video_info', key), undefined);
  } finally {
    gate.resolve();
    await store.close();
  }
});

test('abort after cursor put but before commit rolls back without notifying readers', async () => {
  const factory = new TransactionFactory(),
    store = new MediaStore(factory, 'cursor-rollback');
  const owner = new AbortController();
  let notices = 0;
  const stop = store.subscribe(() => {
    notices++;
  });
  const tx = store.tx.bind(store);
  store.tx = (names, mode, work, ...rest) =>
    tx(
      names,
      mode,
      (...args) => {
        work(...args);
        if (mode === 'readwrite') owner.abort(0);
      },
      ...rest
    );
  try {
    await assert.rejects(
      store.putLocal(scope, 'sync', 'cursor', 4, {
        signal: owner.signal,
        check: () => owner.signal.throwIfAborted()
      }),
      (reason) => reason === 0
    );
    assert.equal(await store.local(scope, 'sync', 'cursor'), undefined);
    assert.equal(notices, 0);
  } finally {
    stop();
    await store.close();
  }
});

test('cancellation does not erase a completed cursor commit', async () => {
  const store = new MediaStore(new TransactionFactory(), 'cursor-committed');
  const owner = new AbortController();
  try {
    await store.putLocal(scope, 'sync', 'cursor', 4, {
      signal: owner.signal,
      check: () => owner.signal.throwIfAborted()
    });
    owner.abort();
    assert.equal(await store.local(scope, 'sync', 'cursor'), 4);
  } finally {
    await store.close();
  }
});
