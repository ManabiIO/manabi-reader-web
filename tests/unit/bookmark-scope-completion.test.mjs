import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import {
  commitOwnedBookmark,
  readOwnedBookmark
} from '../../apps/web/src/lib/data/database/books-db/book-records.ts';

const source = readFileSync(
  new URL('../../apps/web/src/lib/data/database/books-db/database.service.ts', import.meta.url),
  'utf8'
);
const { structuredClone } = globalThis;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// Execute the production method bodies with a transaction whose completion is
// held after all requests. The profile switches in that otherwise untested gap.
function method(name, next, argumentsList, dependencies) {
  const body = source
    .split(`  async ${name}(${argumentsList}) {`)[1]
    .split(`\n  async ${next}(`)[0]
    .replace(/\n {2}}\s*$/, '');
  assert.ok(body, `Missing ${name} production method`);
  return new AsyncFunction(...dependencies, body);
}

function fixture() {
  let complete;
  let current = true;
  let stopped = 0;
  const done = new Promise((resolve) => (complete = resolve));
  const scope = {
    profileId: 'A',
    signal: new AbortController().signal,
    assertCurrent() {
      if (!current) throw new Error('account_changed');
    },
    stop() {
      stopped++;
    }
  };
  const tx = {
    done,
    abort() {},
    objectStore(name) {
      if (name === 'data') return { get: async () => ({ libraryOwner: 'A' }) };
      if (name === 'readerBookScope') return { get: async () => ({ accountId: 'A' }) };
      assert.equal(name, 'bookmark');
      return { get: async () => ({ dataId: 1, progress: 0.3 }), put: async () => 1 };
    }
  };
  const db = {
    transaction(stores) {
      assert.deepEqual(Array.from(stores), ['data', 'bookmark', 'readerBookScope']);
      return tx;
    }
  };
  return {
    scope,
    db,
    complete: () => complete(),
    revoke: () => (current = false),
    stopped: () => stopped
  };
}

test('bookmark read rejects a profile switch during transaction completion', async () => {
  const h = fixture();
  const read = method('getBookmark', 'putBookmark', 'dataId: number', [
    'dataId',
    'captureLibraryOperation',
    'readOwnedBookmark'
  ]);
  const pending = read.call({ db: Promise.resolve(h.db) }, 1, () => h.scope, readOwnedBookmark);
  await setImmediate();
  h.revoke();
  h.complete();
  await assert.rejects(pending, /account_changed/);
  assert.equal(h.stopped(), 1);
});

test('bookmark write withholds acknowledgment after a post-request profile switch', async () => {
  const h = fixture();
  const write = method('putBookmark', 'putAudioBook', 'bookmarkData: BooksDbBookmarkData', [
    'bookmarkData',
    'snapshotBookmarkData',
    'captureLibraryOperation',
    'commitOwnedBookmark'
  ]);
  const pending = write.call(
    { db: Promise.resolve(h.db) },
    { dataId: 1, progress: 0.5 },
    (value) => structuredClone(value),
    () => h.scope,
    commitOwnedBookmark
  );
  await setImmediate();
  h.revoke();
  h.complete();
  await assert.rejects(pending, /account_changed/);
  assert.equal(h.stopped(), 1);
});
