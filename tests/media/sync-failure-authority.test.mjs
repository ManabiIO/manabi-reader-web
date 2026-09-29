import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { syncMedia } from '../../.cache/media-test-build/sync.js';
import { RangeDouble, TransactionFactory } from './transaction-double.mjs';

const key = 'content:' + 'a'.repeat(64);
const scope = 'account:original';
const info = (title) => ({
  version: 1,
  title,
  duration: 1,
  width: 0,
  height: 0,
  addedAt: 1
});
const server = () => ({
  kind: 'video_info',
  entity_id: key,
  book_key: key,
  revision: 1,
  deleted: false,
  payload: info('Remote title')
});
const rejected = (promise) =>
  promise.then(
    () => ({ fulfilled: true }),
    (reason) => ({ fulfilled: false, reason })
  );

async function harness(run) {
  const previous = globalThis.IDBKeyRange;
  globalThis.IDBKeyRange = RangeDouble;
  const store = new MediaStore(new TransactionFactory(), 'sync-failure-' + crypto.randomUUID());
  try {
    await store.edit(scope, 'video_info', key, key, info('Local title'));
    await run(store);
  } finally {
    await store.close();
    if (previous === undefined) delete globalThis.IDBKeyRange;
    else globalThis.IDBKeyRange = previous;
  }
}

for (const authority of ['current', 'revoked', 'throws']) {
  for (const reason of [null, undefined, 0, false, new Error('upload failed')]) {
    test(`upload retains ${String(reason)} rejection when authority is ${authority}`, () =>
      harness(async (store) => {
        let failed = false;
        let uploads = 0;
        const statuses = [];
        const result = await rejected(
          syncMedia(
            store,
            {
              userId: 'original',
              isCurrent() {
                if (!failed || authority === 'current') return true;
                if (authority === 'throws') throw new Error('secondary account failure');
                return false;
              },
              async request(_path, options) {
                assert.equal(options.userId, 'original');
                if (options.method !== 'POST')
                  return { items: [], next_cursor: 0, has_more: false };
                uploads++;
                failed = true;
                throw reason;
              }
            },
            new AbortController().signal,
            (status) => statuses.push(status)
          )
        );
        assert.equal(result.fulfilled, false);
        assert.equal(result.reason, reason, 'cleanup/diagnostics replaced the upload failure');
        assert.equal(uploads, 1);
        const saved = await store.get(scope, 'video_info', key);
        assert.equal(saved.payload.title, 'Local title');
        assert.ok(saved.pending, 'the unacknowledged mutation must remain retryable');
        assert.equal(saved.conflict, undefined);
        assert.equal(
          statuses.some((status) => status.state === 'synced'),
          false
        );
        assert.equal(
          statuses.filter((status) => status.state === 'error').length,
          authority === 'current' ? 1 : 0
        );
      }));
  }
}

for (const authority of ['current', 'revoked', 'throws']) {
  test(`a 412 conflict is applied only while its original account is current (${authority})`, () =>
    harness(async (store) => {
      let failed = false;
      const failure = { status: 412, current: server() };
      const statuses = [];
      const result = await rejected(
        syncMedia(
          store,
          {
            userId: 'original',
            isCurrent() {
              if (!failed || authority === 'current') return true;
              if (authority === 'throws') throw new Error('secondary account failure');
              return false;
            },
            async request(_path, options) {
              if (options.method !== 'POST') return { items: [], next_cursor: 0, has_more: false };
              failed = true;
              throw failure;
            }
          },
          new AbortController().signal,
          (status) => statuses.push(status)
        )
      );
      const saved = await store.get(scope, 'video_info', key);
      assert.equal(saved.payload.title, 'Local title');
      if (authority === 'current') {
        assert.equal(result.fulfilled, true);
        assert.deepEqual(saved.conflict, failure.current);
        assert.equal(statuses.at(-1).state, 'conflict');
      } else {
        assert.equal(result.fulfilled, false);
        assert.equal(result.reason, failure);
        assert.equal(saved.conflict, undefined);
        assert.ok(saved.pending, 'stale response consumed a pending mutation');
        assert.deepEqual(
          statuses.map((status) => status.state),
          ['syncing']
        );
      }
    }));
}

for (const reason of [null, 0, false]) {
  test(`cancel during mutation preserves ${String(reason)} even when account observation throws`, () =>
    harness(async (store) => {
      const controller = new AbortController();
      let uploaded = false;
      const result = await rejected(
        syncMedia(
          store,
          {
            userId: 'original',
            isCurrent() {
              if (uploaded) throw new Error('secondary account failure');
              return true;
            },
            async request(_path, options) {
              if (options.method !== 'POST') return { items: [], next_cursor: 0, has_more: false };
              uploaded = true;
              controller.abort(reason);
              return { accepted: true, mutation_id: options.value.mutation_id, record: server() };
            }
          },
          controller.signal
        )
      );
      assert.equal(result.fulfilled, false);
      assert.equal(result.reason, reason);
      const saved = await store.get(scope, 'video_info', key);
      assert.ok(saved.pending);
      assert.equal(saved.revision, 0);
    }));
}

test('an unavailable account still fails closed before contacting transport', () =>
  harness(async (store) => {
    let requests = 0;
    const result = await rejected(
      syncMedia(
        store,
        {
          userId: 'original',
          isCurrent() {
            throw new Error('no active account');
          },
          async request() {
            requests++;
            throw new Error('must not send');
          }
        },
        new AbortController().signal
      )
    );
    assert.equal(result.fulfilled, false);
    assert.match(String(result.reason), /signed-in account changed/);
    assert.equal(requests, 0);
    assert.equal((await store.get(scope, 'video_info', key)).pending, undefined);
  }));
