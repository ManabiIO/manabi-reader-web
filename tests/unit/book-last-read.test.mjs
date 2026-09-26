import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import { updateBookLastRead } from '../../apps/web/src/lib/data/database/books-db/book-records.ts';

function database(current, done = Promise.resolve()) {
  const writes = [];
  let calls = 0;
  const transaction = {
    done,
    abort() {},
    store: {
      async get(id) {
        assert.equal(id, 1);
        return current;
      },
      async put(value) {
        writes.push(value);
      }
    }
  };
  return {
    writes,
    get calls() {
      return calls;
    },
    transaction(store, mode) {
      calls++;
      assert.equal(store, 'data');
      assert.equal(mode, 'readwrite');
      return transaction;
    }
  };
}

const currentBook = () => ({
  id: 1,
  title: 'Current title',
  elementHtml: '<p>Current content</p>',
  blobs: { image: { format: 'reader-bytes-v1', type: 'image/png', bytes: new ArrayBuffer(3) } },
  lastBookOpen: 100,
  storageSource: 'Keep source',
  contentHash: 'a'.repeat(64),
  manabiTtuImport: { version: 2 }
});

test('last-read changes only the timestamp on the current stored record', async () => {
  const current = currentBook();
  const db = database(current);
  const result = await updateBookLastRead(db, 1, 200);
  assert.deepEqual(db.writes, [{ ...current, lastBookOpen: 200 }]);
  assert.equal(db.writes[0].blobs, current.blobs);
  assert.equal(current.lastBookOpen, 100);
  assert.equal(result.title, current.title);
  assert.equal(result.lastBookOpen, 200);
});

test('deleted books and newer timestamps are not overwritten', async () => {
  const missing = database(undefined);
  assert.equal(await updateBookLastRead(missing, 1, 200), undefined);
  assert.deepEqual(missing.writes, []);
  const db = database(currentBook());
  assert.equal((await updateBookLastRead(db, 1, 50)).lastBookOpen, 100);
  assert.equal((await updateBookLastRead(db, 1, 100)).lastBookOpen, 100);
  assert.deepEqual(db.writes, []);
});

test('legacy Blob records are not read or converted by a timestamp write', async () => {
  const image = new Blob(['legacy']);
  image.arrayBuffer = () => {
    throw new Error('A timestamp write must not read image bytes');
  };
  const current = { ...currentBook(), blobs: { image }, coverImage: image };
  const db = database(current);
  await updateBookLastRead(db, 1, 200);
  assert.equal(db.writes[0].blobs.image, image);
  assert.equal(db.writes[0].coverImage, image);
});

test('invalid identifiers and timestamps fail before opening a write transaction', async () => {
  const db = database(currentBook());
  for (const [id, timestamp] of [[0, 1], [1.5, 1], [1, -1], [1, NaN], [1, Infinity]]) {
    await assert.rejects(updateBookLastRead(db, id, timestamp), /invalid/);
  }
  assert.equal(db.calls, 0);
});

test('completion remains pending until commit, and a commit failure is propagated', async () => {
  let commit;
  const db = database(
    currentBook(),
    new Promise((resolve) => (commit = resolve))
  );
  let settled = false;
  const pending = updateBookLastRead(db, 1, 200).then(() => (settled = true));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  commit();
  await pending;
  const failure = new DOMException('Commit rejected', 'AbortError');
  await assert.rejects(
    updateBookLastRead(database(currentBook(), Promise.reject(failure)), 1, 200),
    (error) => error === failure
  );
});

test('the actual browser handler uses only current identity and metadata for last-read', async () => {
  const source = readFileSync(
    new URL('../../apps/web/src/lib/data/storage/handler/browser-handler.ts', import.meta.url),
    'utf8'
  );
  const body = source
    .split('  async updateLastRead(book: BooksDbBookData) {')[1]
    .split('\n  async getFilenameForRecentCheck')[0]
    .replace(/\n  }\s*$/, '');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const invoke = new AsyncFunction(
    'book',
    'database',
    'updateBookLastRead',
    'BaseStorageHandler',
    body
  );
  const db = database(currentBook());
  const cards = [];
  await invoke.call(
    { addBookCard: (...args) => cards.push(args) },
    { ...currentBook(), title: 'Stale title', elementHtml: '<p>Stale</p>', lastBookOpen: 200 },
    { db: Promise.resolve(db) },
    updateBookLastRead,
    { getBookCharacters: () => 10 }
  );
  assert.equal(cards[0][0], 'Current title');
  assert.equal(cards[0][1].lastBookOpen, 200);
  assert.equal(db.writes[0].elementHtml, '<p>Current content</p>');
});
