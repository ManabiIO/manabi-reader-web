/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import pLimit from 'p-limit';
import { loadOfflineModule, deferred } from './fixtures/offline-module.mjs';

function fixture(remove) {
  const observer = { next() {} };
  const { api } = loadOfflineModule('apps/web/src/lib/data/storage/handler/filesystem-handler.ts', {
    modules: {
      '$lib/data/env': { ttuCompatibilityRootName: 'ttu-reader-data' },
      '$lib/data/logger': { logger: { error() {}, warn() {} } },
      '$lib/data/store': {
        database: { dataListChanged$: observer },
        fsStorageSource$: { getValue: () => '' }
      },
      '$lib/data/reading-goal': {},
      '$lib/functions/statistic-util': {},
      '$lib/data/dialog-manager': { dialogManager: {} },
      '$runtime/../ui/dialogs': { StorageUnlock: class {} },
      '$lib/data/storage/storage-source-manager': { isRemoteContext: () => false },
      '$lib/data/storage/storage-handler-factory': {},
      '$lib/manabi/external-book-data': {},
      '$lib/functions/file-loaders/utils/restored-book': {},
      '$lib/functions/replication/replicator': { exporterVersion: 1 },
      '$lib/functions/replication/replication-progress': { replicationProgress$: observer },
      '@zip.js/zip.js': {},
      'p-limit': pLimit
    }
  });
  const handler = new api.FilesystemStorageHandler({}, 'fs');
  const removed = [];
  let rootReads = 0;
  handler.ensureRoot = async () => {
    rootReads++;
    return {
      async removeEntry(name, options) {
        assert.equal(options.recursive, true);
        await remove?.(name);
        removed.push(name);
      }
    };
  };
  for (const [index, title] of ['A', 'B', 'C'].entries()) {
    handler.titleToBookCard.set(title, { id: index + 1, title });
    handler.titleToDirectory.set(title, {});
    handler.titleToFiles.set(title, []);
  }
  return { handler, removed, rootReads: () => rootReads };
}

test('filesystem deletion: an already-cancelled operation never opens the library', async () => {
  const f = fixture(),
    cancel = new AbortController();
  cancel.abort();
  await assert.rejects(f.handler.deleteBookData(['A', 'B', 'C'], cancel.signal), {
    name: 'AbortError'
  });
  assert.equal(f.rootReads(), 0);
  assert.deepEqual(f.removed, []);
});

test(
  'filesystem deletion: cancellation settles and preserves all remaining books',
  { timeout: 2000 },
  async () => {
    const started = deferred(),
      finish = deferred(),
      cancel = new AbortController();
    const f = fixture(async (name) => {
      assert.equal(name, 'A');
      started.resolve();
      await finish.promise;
    });
    const pending = f.handler.deleteBookData(['A', 'B', 'C'], cancel.signal);
    await started.promise;
    cancel.abort();
    finish.resolve();
    const result = await pending;
    assert.equal(result.error, '');
    assert.deepEqual(Array.from(result.deleted), [1]);
    assert.deepEqual(f.removed, ['A']);
    assert.deepEqual(Array.from(f.handler.titleToBookCard.keys()), ['B', 'C']);
    assert.deepEqual(Array.from(f.handler.titleToDirectory.keys()), ['B', 'C']);
  }
);

test('filesystem deletion: cancellation during root discovery cannot admit a deletion', async () => {
  const f = fixture(),
    cancel = new AbortController(),
    discover = f.handler.ensureRoot;
  f.handler.ensureRoot = async () => {
    const root = await discover();
    cancel.abort();
    return root;
  };
  await assert.rejects(f.handler.deleteBookData(['A', 'B', 'C'], cancel.signal), {
    name: 'AbortError'
  });
  assert.deepEqual(f.removed, []);
  assert.deepEqual(Array.from(f.handler.titleToBookCard.keys()), ['A', 'B', 'C']);
});

test('filesystem deletion: a failed book stays intact while later explicit deletions complete', async () => {
  const f = fixture(async (name) => {
    if (name === 'B') throw new Error('Permission denied');
  });
  const result = await f.handler.deleteBookData(['A', 'B', 'C'], new AbortController().signal);
  assert.deepEqual(Array.from(result.deleted), [1, 3]);
  assert.match(result.error, /Permission denied/);
  assert.deepEqual(f.removed, ['A', 'C']);
  assert.deepEqual(Array.from(f.handler.titleToBookCard.keys()), ['B']);
});

test('filesystem deletion: a completed old-source delete cannot clear new-source book metadata', async () => {
  let handler;
  const f = fixture(async () => {
    handler.clearData();
    handler.storageSourceName = 'Replacement source';
    handler.titleToBookCard.set('A', { id: 99, title: 'A' });
  });
  handler = f.handler;
  const result = await handler.deleteBookData(['A', 'B', 'C'], new AbortController().signal);
  assert.deepEqual(f.removed, ['A']);
  assert.deepEqual(Array.from(result.deleted), [1]);
  assert.equal(handler.titleToBookCard.get('A').id, 99);
});
