/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import pLimit from 'p-limit';
import { getEventListeners } from 'node:events';
import { deferred, loadOfflineModule } from './fixtures/offline-module.mjs';

// Real handler/Base modules; only app observers and native filesystem streams
// are boundaries. Bytes are staged until close, with no real filesystem data.
function fixture({ sameName = false, cachedDirectory = true } = {}) {
  const calls = [],
    hooks = {},
    progress = [];
  const observer = { next() {} };
  const { api } = loadOfflineModule('apps/web/src/lib/data/storage/handler/filesystem-handler.ts', {
    globals: { File },
    modules: {
      '$lib/data/env': { ttuCompatibilityRootName: 'ttu-reader-data' },
      '$lib/data/store': {
        database: { listLoading$: observer, dataListChanged$: observer },
        fsStorageSource$: { getValue: () => '' }
      },
      '$lib/data/reading-goal': {},
      '$lib/functions/statistic-util': {},
      '$runtime/../ui/dialogs': { StorageUnlock: {} },
      '$lib/data/storage/storage-source-manager': { isRemoteContext: () => false },
      '$lib/data/dialog-manager': { dialogManager: { dialogs$: observer } },
      '$lib/data/storage/storage-handler-factory': {},
      '$lib/functions/replication/error-handler': {},
      '$lib/manabi/external-book-data': {},
      '$lib/functions/replication/replicator': { exporterVersion: 1 },
      '$lib/functions/replication/replication-progress': {
        replicationProgress$: { next: (value) => progress.push(value) }
      },
      '$lib/functions/file-loaders/utils/restored-book': {},
      '@zip.js/zip.js': {},
      'p-limit': pLimit
    }
  });
  const old = { name: sameName ? 'new.json' : 'old.json', bytes: 'original bytes' };
  const entries = new Map([[old.name, old]]);
  function writable(handle) {
    handle.isSameEntry = async (other) => {
      calls.push('same-entry');
      await hooks.sameEntry?.();
      return handle === other;
    };
    handle.createWritable = async () => {
      calls.push('open');
      await hooks.open?.();
      let staged;
      return {
        async write(data) {
          calls.push('write');
          staged = data;
          await hooks.write?.();
        },
        async close() {
          calls.push('close');
          await hooks.close?.();
          handle.bytes = staged;
        },
        async abort() {
          calls.push('abort');
          await hooks.abort?.();
        }
      };
    };
    return handle;
  }
  writable(old);
  const directory = {
    async getFileHandle(name) {
      calls.push('file');
      if (!entries.has(name)) entries.set(name, writable({ name, bytes: '' }));
      await hooks.file?.();
      return entries.get(name);
    },
    async removeEntry(name) {
      calls.push('delete:' + name);
      entries.delete(name);
    }
  };
  const root = {
    async getDirectoryHandle(name) {
      calls.push('directory:' + name);
      await hooks.directory?.();
      return directory;
    }
  };
  const handler = new api.FilesystemStorageHandler({}, 'filesystem');
  const cancel = new AbortController();
  handler.startContext({ title: 'Book' }, cancel.signal);
  if (cachedDirectory) handler.titleToDirectory.set('Book', directory);
  const files = [old];
  const run = () => handler.writeFile(root, 'new.json', 'exported bytes', files, old);
  return { handler, cancel, calls, hooks, entries, old, files, progress, run, root, directory };
}

test('a pre-cancelled export performs no filesystem mutations', async () => {
  const f = fixture({ cachedDirectory: false });
  f.cancel.abort();
  await assert.rejects(f.run(), { name: 'AbortError' });
  assert.deepEqual(f.calls, []);
  assert.equal(f.old.bytes, 'original bytes');
});

for (const boundary of ['directory', 'file', 'open', 'write'])
  test(`cancellation during ${boundary} stops subsequent mutations and preserves originals`, async () => {
    const f = fixture({ cachedDirectory: false });
    f.hooks[boundary] = () => f.cancel.abort();
    await assert.rejects(f.run(), { name: 'AbortError' });
    assert.equal(f.old.bytes, 'original bytes');
    assert.equal(f.entries.has('old.json'), true);
    assert.equal(f.calls.includes('close'), false);
    assert.equal(
      f.calls.some((call) => call.startsWith('delete:')),
      false
    );
    assert.equal(f.calls.includes('abort'), ['open', 'write'].includes(boundary));
    if (boundary === 'directory') assert.equal(f.calls.includes('file'), false);
    if (boundary === 'file') assert.equal(f.calls.includes('open'), false);
    if (boundary === 'open') assert.equal(f.calls.includes('write'), false);
  });

test('retiring a context while opening cannot write or populate the replacement title', async () => {
  const f = fixture();
  f.hooks.open = () => f.handler.startContext({ title: 'Replacement' }, f.cancel.signal);
  await assert.rejects(f.run(), { name: 'AbortError' });
  assert.deepEqual(f.calls, ['file', 'open', 'abort']);
  assert.equal(f.handler.titleToFiles.size, 0);
  assert.equal(f.old.bytes, 'original bytes');
});

for (const sameName of [false, true])
  test(`a rejected write aborts staged bytes and preserves the original error (${sameName})`, async () => {
    const f = fixture({ sameName });
    const failure = new Error('disk write failed');
    f.hooks.write = () => {
      throw failure;
    };
    f.hooks.abort = () => {
      throw new Error('abort failed too');
    };
    await assert.rejects(f.run(), (error) => error === failure);
    assert.equal(f.old.bytes, 'original bytes');
    assert.equal(f.entries.get(f.old.name), f.old);
    assert.deepEqual(f.calls, ['file', 'open', 'write', 'abort']);
  });

test('a successful close commits replacement bytes before removing the obsolete version', async () => {
  const f = fixture();
  await f.run();
  assert.equal(f.entries.get('new.json').bytes, 'exported bytes');
  assert.equal(f.entries.has('old.json'), false);
  assert.deepEqual(f.calls, ['file', 'open', 'write', 'close', 'same-entry', 'delete:old.json']);
  assert.equal(f.handler.titleToFiles.get('Book')[0], f.entries.get('new.json'));
  assert.deepEqual(f.files, [f.old], 'Input listing is not mutated');
});

for (const boundary of ['close', 'sameEntry'])
  test(`cancellation during ${boundary} acknowledges a successful commit and keeps the old version`, async () => {
    const f = fixture();
    const entered = deferred(),
      finish = deferred();
    f.hooks[boundary] = async () => {
      entered.resolve();
      await finish.promise;
    };
    const pending = f.run();
    await entered.promise;
    f.cancel.abort();
    finish.resolve();
    await pending;
    assert.equal(f.entries.get('new.json').bytes, 'exported bytes');
    assert.equal(f.old.bytes, 'original bytes');
    assert.equal(f.entries.has('old.json'), true);
    assert.equal(f.calls.includes('abort'), false);
    assert.equal(
      f.calls.some((call) => call.startsWith('delete:')),
      false
    );
    assert.equal(f.handler.titleToFiles.size, 0);
  });

test('a failed close preserves its error and attempts stream abort without deleting any named file', async () => {
  const f = fixture();
  const failure = new Error('close failed');
  f.hooks.close = () => {
    throw failure;
  };
  await assert.rejects(f.run(), (error) => error === failure);
  assert.equal(f.old.bytes, 'original bytes');
  assert.equal(f.entries.has('new.json'), true);
  assert.deepEqual(f.calls, ['file', 'open', 'write', 'close', 'abort']);
});

test('cancellation requests stream abort while a write is still pending and releases its listener', async () => {
  const f = fixture();
  const entered = deferred(),
    finish = deferred(),
    aborted = deferred();
  f.hooks.write = async () => {
    entered.resolve();
    await finish.promise;
  };
  f.hooks.abort = () => aborted.resolve();
  const pending = f.run();
  await entered.promise;
  f.cancel.abort();
  await aborted.promise;
  assert.equal(f.calls.includes('close'), false);
  assert.equal(f.old.bytes, 'original bytes');
  finish.resolve();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(f.calls.filter((call) => call === 'abort').length, 1);
  assert.equal(getEventListeners(f.cancel.signal, 'abort').length, 0);
});

test('same-name close acknowledges committed replacement bytes despite cancellation during close', async () => {
  const f = fixture({ sameName: true });
  f.hooks.close = () => f.cancel.abort();
  await f.run();
  assert.equal(
    f.old.bytes,
    'exported bytes',
    'Cancellation cannot restore bytes after close commits'
  );
  assert.deepEqual(f.calls, ['file', 'open', 'write', 'close']);
  assert.equal(getEventListeners(f.cancel.signal, 'abort').length, 0);
});

function progressFixture() {
  const f = fixture(),
    cards = [];
  f.handler.getExternalFile = async () => ({ file: f.old, files: f.files, rootDirectory: f.root });
  f.handler.addBookCard = (title, value) => cards.push({ title, value: structuredClone(value) });
  const save = () =>
    f.handler.saveProgress(new File(['exported bytes'], 'progress_1_8_123_0.5.json'));
  return { ...f, cards, save };
}
test('a normal progress export updates only its captured book after committing', async () => {
  const f = progressFixture();
  await f.save();
  assert.deepEqual(f.cards, [
    { title: 'Book', value: { lastBookmarkModified: 123, progress: 0.5 } }
  ]);
  assert.equal(f.entries.get('progress_1_8_123_0.5.json').bytes instanceof File, true);
});
for (const retire of ['context', 'source'])
  test(`a committed progress export cannot publish into a replacement ${retire}`, async () => {
    const f = progressFixture();
    f.hooks.close = () => {
      if (retire === 'context') f.handler.startContext({ title: 'Replacement' }, f.cancel.signal);
      else f.handler.storageSourceName = 'Another source';
    };
    await f.save();
    assert.deepEqual(f.cards, []);
    assert.equal(f.entries.has('old.json'), true);
    assert.equal(f.entries.has('progress_1_8_123_0.5.json'), true);
    assert.equal(f.handler.titleToFiles.size, 0);
  });
for (const retire of ['context', 'source'])
  test(`retirement during progress discovery cannot redirect an export to a replacement ${retire}`, async () => {
    const f = progressFixture(),
      found = deferred();
    f.handler.getExternalFile = () => found.promise;
    const operation = f.save();
    if (retire === 'context') f.handler.startContext({ title: 'Replacement' }, f.cancel.signal);
    else f.handler.storageSourceName = 'Another source';
    found.resolve({ file: f.old, files: f.files, rootDirectory: f.root });
    await assert.rejects(operation, { name: 'AbortError' });
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.cards, []);
    assert.equal(f.entries.size, 1);
  });
test('retirement during book preparation cannot start a filesystem write', async () => {
  const f = progressFixture();
  f.handler.zipBookData = async () => {
    f.handler.startContext({ title: 'Replacement' }, f.cancel.signal);
    return 'prepared bytes';
  };
  await assert.rejects(
    f.handler.saveBook({ characters: 5, lastBookModified: 1, lastBookOpen: 2 }),
    { name: 'AbortError' }
  );
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.cards, []);
});
test('root metadata export retains its original context across discovery', async () => {
  const f = fixture(),
    found = deferred();
  f.handler.readingGoalsMergeMode = 'replace';
  f.handler.getRootFile = () => found.promise;
  const operation = f.handler.saveReadingGoals([], 123);
  f.handler.startContext({ title: 'Replacement' }, f.cancel.signal);
  found.resolve({ file: undefined, rootDirectory: f.directory });
  await assert.rejects(operation, { name: 'AbortError' });
  assert.deepEqual(f.calls, []);
  assert.equal(f.entries.size, 1);
});

test('clearing a source invalidates old writes even when the source name returns to the same value', async () => {
  const f = fixture();
  f.hooks.file = () => f.handler.clearData();
  await assert.rejects(f.run(), { name: 'AbortError' });
  assert.equal(f.old.bytes, 'original bytes');
  assert.equal(f.calls.includes('open'), false);
});
test('a retired directory scan cannot repopulate or clear the replacement source cache', async () => {
  const f = fixture(),
    entered = deferred(),
    finish = deferred();
  const directory = {
    name: 'Book',
    async *values() {
      entered.resolve();
      await finish.promise;
      yield { kind: 'file', name: 'bookdata_1_8_5_1_2.zip' };
    }
  };
  const pending = f.handler.setTitleData([directory]);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await entered.promise;
  f.handler.clearData();
  f.handler.storageSourceName = 'Replacement source';
  const replacement = { id: 99, title: 'Replacement' };
  f.handler.titleToBookCard.set('Replacement', replacement);
  finish.resolve();
  await rejected;
  assert.deepEqual(Array.from(f.handler.titleToBookCard.keys()), ['Replacement']);
  assert.equal(f.handler.titleToBookCard.get('Replacement'), replacement);
});
test('a retired permission lookup cannot return or replace another source root', async () => {
  const f = fixture(),
    entered = deferred(),
    finish = deferred();
  const oldRoot = {
    async queryPermission() {
      entered.resolve();
      await finish.promise;
      return 'granted';
    }
  };
  f.handler.rootDirectory = oldRoot;
  const pending = f.handler.ensureRoot();
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await entered.promise;
  f.handler.clearData();
  f.handler.storageSourceName = 'Replacement source';
  const replacement = { queryPermission: async () => 'granted' };
  f.handler.rootDirectory = replacement;
  finish.resolve();
  await rejected;
  assert.equal(f.handler.rootDirectory, replacement);
});
test('a missing old book cannot clear a newly selected book in the same source', async () => {
  const f = fixture(),
    replacement = [{ name: 'newer.json' }];
  f.handler.titleToFiles.set('Replacement', replacement);
  const root = {
    async getDirectoryHandle() {
      f.handler.startContext({ title: 'Replacement' }, f.cancel.signal);
      throw new DOMException('missing', 'NotFoundError');
    }
  };
  assert.deepEqual(Array.from(await f.handler.getExternalFiles(root)), []);
  assert.equal(f.handler.titleToFiles.get('Replacement'), replacement);
});
