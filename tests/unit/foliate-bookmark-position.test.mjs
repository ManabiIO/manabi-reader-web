/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadOfflineModule } from './fixtures/offline-module.mjs';
import {
  bookmarkPosition,
  BookmarkSaveCoordinator,
  withBookmarkPosition,
  withoutBookmarkPosition
} from '../../apps/web/src/lib/reader-bookmark-position.ts';
import { makeLocator } from '../../apps/web/src/lib/reader-location.ts';
import { VisibleReaderLocation } from '../../apps/web/src/lib/foliate-epub/visible-reader-location.ts';
import { bookmark as portableBookmark } from '../../apps/web/src/lib/manabi/ttu-migration-format.ts';

const bookKey = `content:${'a'.repeat(64)}`;
const resource = { href: 'chapter.xhtml', spineIndex: 0, sectionId: 'chapter' };
const mark = () => ({ dataId: 1, exploredCharCount: 8, progress: 0.01, lastBookmarkModified: 123 });
const location = (start = 8) =>
  makeLocator(bookKey, { resource, text: '前半𠮷と後半の文章です。'.repeat(20), runs: [] }, start);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function domFixture(text = '前半𠮷後半') {
  const node = { nodeType: 3, textContent: text, data: text };
  const content = { childNodes: [node], isConnected: true, contains: (n) => n === node };
  const range = (start, end) => ({
    commonAncestorContainer: node,
    startContainer: node,
    endContainer: node,
    startOffset: start,
    endOffset: end,
    intersectsNode: (n) => n === node,
    cloneRange() {
      return { ...this };
    }
  });
  return { node, content, range };
}

test('exact position accompanies an unchanged legacy bookmark and owns nested input', async () => {
  const source = mark(),
    locator = await location();
  const saved = withBookmarkPosition(source, locator);
  source.exploredCharCount = 999;
  locator.resource.href = 'other.xhtml';
  assert.equal(saved.exploredCharCount, 8);
  assert.equal(bookmarkPosition(saved, bookKey).resource.href, resource.href);
  const read = bookmarkPosition(saved, bookKey);
  read.resource.spineIndex = 9;
  assert.equal(bookmarkPosition(saved, bookKey).resource.spineIndex, 0);
});

for (const [field, value] of Object.entries({
  dataId: 2,
  exploredCharCount: 9,
  progress: 1,
  lastBookmarkModified: 124
})) {
  test(`changing ${field} invalidates old precision rather than overriding the new bookmark`, async () => {
    const saved = withBookmarkPosition(mark(), await location());
    saved[field] = value;
    assert.equal(bookmarkPosition(saved, bookKey), undefined);
  });
}

test('wrong book, old versions and invalid point coordinates fail closed', async () => {
  const saved = withBookmarkPosition(mark(), await location());
  assert.equal(bookmarkPosition(saved, 'different-book'), undefined);
  for (const mutate of [
    (value) => {
      value.readerPosition.version = 99;
    },
    (value) => {
      value.readerPosition.locator.start = -1;
    },
    (value) => {
      value.readerPosition.locator.end += 1;
    },
    (value) => {
      value.readerPosition.locator.projectionVersion = 99;
    },
    (value) => {
      value.readerPosition.locator.resourceDigest = 'bad';
    },
    (value) => {
      value.readerPosition.locator.prefix = 'a'.repeat(33);
    }
  ]) {
    const invalid = structuredClone(saved);
    mutate(invalid);
    assert.equal(bookmarkPosition(invalid, bookKey), undefined);
  }
});

test('legacy bookmarks and invalid legacy coordinates remain fallback-only', async () => {
  assert.equal(bookmarkPosition(mark(), bookKey), undefined);
  for (const changes of [
    { progress: 'legacy-anchor' },
    { exploredCharCount: undefined },
    { progress: Infinity },
    { dataId: 0 }
  ]) {
    assert.equal(
      withBookmarkPosition({ ...mark(), ...changes }, await location()).readerPosition,
      undefined
    );
  }
});

test('ordinary legacy saves clear precision without mutating the prior record', async () => {
  const saved = withBookmarkPosition(mark(), await location());
  assert.deepEqual(withBookmarkPosition(saved), mark());
  assert.ok(saved.readerPosition);
});

test('portable export retains exact old TTU fields and rejects leaking the local extension', async () => {
  const saved = withBookmarkPosition(mark(), await location());
  assert.throws(() => portableBookmark(saved, saved.lastBookmarkModified));
  const portable = withoutBookmarkPosition(saved);
  assert.deepEqual(portable, mark());
  assert.deepEqual(portableBookmark(portable, 123), portableBookmark(mark(), 123));
  assert.ok(saved.readerPosition);
});

test('explicit capture retains its source point across a page turn and delayed identity', async () => {
  const state = new VisibleReaderLocation(),
    identity = deferred();
  const { content, range } = domFixture();
  state.update(content, resource, range(4, 6));
  const captured = state.snapshot(identity.promise);
  state.update(content, resource, range(0, 2));
  content.isConnected = false;
  identity.resolve(bookKey);
  const result = await captured;
  assert.equal(result.start, 3);
  assert.equal(result.prefix, '前半𠮷');
  assert.equal(await state.capture(bookKey), undefined);
});

test('explicit capture snapshots mutable source text and explicit range before identity resolves', async () => {
  const state = new VisibleReaderLocation(),
    identity = deferred();
  const { node, content, range } = domFixture();
  const selected = range(4, 6);
  state.update(content, resource, range(0, 2));
  const pending = state.snapshot(identity.promise, selected);
  selected.startOffset = 0;
  node.textContent = node.data = 'changed';
  identity.resolve(bookKey);
  assert.equal((await pending).prefix, '前半𠮷');
});

test('empty or rejected identity cannot manufacture an exact position', async () => {
  const state = new VisibleReaderLocation(),
    { content, range } = domFixture();
  state.update(content, resource, range(0, 2));
  assert.equal(await state.snapshot(Promise.resolve('')), undefined);
  await assert.rejects(
    state.snapshot(Promise.reject(new Error('identity failed'))),
    /identity failed/
  );
});

test('save owns caller data before deferred preparation', async () => {
  const saves = new BookmarkSaveCoordinator(),
    pending = deferred(),
    writes = [],
    source = mark();
  const task = saves.save(source, {
    locate: () => pending.promise,
    write: async (data) => writes.push(data),
    isCurrent: () => true
  });
  source.dataId = 8;
  source.exploredCharCount = 999;
  pending.resolve(await location());
  const saved = await task;
  assert.equal(writes[0].dataId, 1);
  assert.equal(saved.exploredCharCount, 8);
});

test('newer Save wins even when an older digest finishes last', async () => {
  const saves = new BookmarkSaveCoordinator(),
    pending = deferred(),
    writes = [];
  const options = { write: async (data) => writes.push(data), isCurrent: () => true };
  const old = saves.save(mark(), { ...options, locate: () => pending.promise });
  const latest = await saves.save(
    { ...mark(), lastBookmarkModified: 124 },
    { ...options, locate: () => location(15) }
  );
  pending.resolve(await location());
  assert.equal(await old, undefined);
  assert.equal(latest.readerPosition.locator.start, 15);
  assert.equal(writes.length, 1);
});

for (const revoke of ['abort', 'destroy', 'invalidate', 'reader-replacement']) {
  test(`${revoke} during hashing prevents storage admission`, async () => {
    const saves = new BookmarkSaveCoordinator(),
      pending = deferred(),
      controller = new AbortController(),
      writes = [];
    let current = true;
    const task = saves.save(mark(), {
      locate: () => pending.promise,
      write: async (data) => writes.push(data),
      isCurrent: () => current,
      signal: controller.signal
    });
    if (revoke === 'abort') controller.abort();
    if (revoke === 'destroy') saves.destroy();
    if (revoke === 'invalidate') saves.invalidate();
    if (revoke === 'reader-replacement') current = false;
    pending.resolve(await location());
    assert.equal(await task, undefined);
    assert.equal(writes.length, 0);
  });
}

test('account departure cannot be undone by returning to its original value', async () => {
  const saves = new BookmarkSaveCoordinator(),
    pending = deferred(),
    controller = new AbortController(),
    writes = [];
  let profile = 'A';
  const task = saves.save(mark(), {
    locate: () => pending.promise,
    write: async (data) => writes.push(data),
    isCurrent: () => profile === 'A',
    signal: controller.signal
  });
  profile = 'B';
  controller.abort();
  profile = 'A';
  pending.resolve(await location());
  assert.equal(await task, undefined);
  assert.equal(writes.length, 0);
});

test('writes serialize and an old completed write cannot acknowledge into a newer save', async () => {
  const saves = new BookmarkSaveCoordinator(),
    gate = deferred(),
    entered = deferred(),
    writes = [];
  const first = saves.save(mark(), {
    write: async (data) => {
      writes.push(data);
      entered.resolve();
      await gate.promise;
    },
    isCurrent: () => true
  });
  await entered.promise;
  const second = saves.save(
    { ...mark(), lastBookmarkModified: 124 },
    { write: async (data) => writes.push(data), isCurrent: () => true }
  );
  await Promise.resolve();
  assert.equal(writes.length, 1);
  gate.resolve();
  assert.equal(await first, undefined);
  assert.equal((await second).lastBookmarkModified, 124);
  assert.deepEqual(
    writes.map((value) => value.lastBookmarkModified),
    [123, 124]
  );
});

test('queued save rechecks cancellation after the preceding storage write finishes', async () => {
  const saves = new BookmarkSaveCoordinator(),
    gate = deferred(),
    entered = deferred(),
    controller = new AbortController(),
    writes = [];
  const first = saves.save(mark(), {
    write: async (data) => {
      writes.push(data);
      entered.resolve();
      await gate.promise;
    },
    isCurrent: () => true
  });
  await entered.promise;
  const second = saves.save(mark(), {
    signal: controller.signal,
    write: async (data) => writes.push(data),
    isCurrent: () => true
  });
  controller.abort();
  gate.resolve();
  assert.equal(await first, undefined);
  assert.equal(await second, undefined);
  assert.equal(writes.length, 1);
});

test('capture and write failures propagate without poisoning later saves', async () => {
  const saves = new BookmarkSaveCoordinator(),
    write = async () => {},
    isCurrent = () => true;
  await assert.rejects(
    saves.save(mark(), {
      locate: async () => {
        throw new Error('digest');
      },
      write,
      isCurrent
    }),
    /digest/
  );
  await assert.rejects(
    saves.save(mark(), {
      write: async () => {
        throw new Error('storage');
      },
      isCurrent
    }),
    /storage/
  );
  assert.deepEqual(await saves.save(mark(), { write, isCurrent }), mark());
});

test('late failure after destruction is drained without writing or publishing', async () => {
  const saves = new BookmarkSaveCoordinator(),
    pending = deferred();
  const task = saves.save(mark(), {
    locate: () => pending.promise,
    write: async () => assert.fail('no write'),
    isCurrent: () => true
  });
  saves.destroy();
  pending.reject(new Error('retired digest'));
  assert.equal(await task, undefined);
});

function browserHandler(database) {
  class BaseStorageHandler {
    static reportProgress() {}
  }
  const { api } = loadOfflineModule('apps/web/src/lib/data/storage/handler/browser-handler.ts', {
    modules: {
      '$lib/data/database/books-db/book-binary': {},
      '$lib/data/database/books-db/book-records': {},
      '$lib/data/storage/handler/base-handler': { BaseStorageHandler },
      '$lib/data/store': { database },
      '$lib/functions/replication/replication-options': {},
      '$lib/data/storage/storage-types': {},
      '$lib/library/organization': {},
      '$lib/data/database/books-db/reader-statistics': {},
      '$lib/functions/replication/replication-error': {}
    },
    globals: { File: globalThis.File }
  });
  const handler = new api.BrowserStorageHandler();
  handler.currentContext = { id: 1, title: 'Book' };
  return handler;
}

test('production browser export strips local precision without altering stored coordinates', async () => {
  const saved = withBookmarkPosition(mark(), await location());
  const handler = browserHandler({ getBookmark: async () => saved });
  const exported = await handler.getProgress();
  assert.deepEqual(exported, mark());
  exported.progress = 1;
  assert.equal(saved.progress, 0.01);
  assert.ok(saved.readerPosition);
});

test('production portable import cannot install a caller-supplied local precision hint', async () => {
  const saved = withBookmarkPosition(mark(), await location());
  let stored;
  const handler = browserHandler({
    putBookmark: async (value) => {
      stored = value;
    }
  });
  handler.currentContext.id = 2;
  await handler.saveProgress(saved);
  assert.deepEqual(stored, { ...mark(), dataId: 2 });
  assert.equal(saved.dataId, 1);
  assert.ok(saved.readerPosition);
});

test('production browser progress export retains absence instead of creating a bookmark', async () => {
  const handler = browserHandler({ getBookmark: async () => undefined });
  assert.equal(await handler.getProgress(), undefined);
});
