import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers';
import {
  readBookSummaries,
  updateBookLastRead
} from '../../apps/web/src/lib/data/database/books-db/book-records.ts';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function harness(records, { manual = false, fail = false } = {}) {
  const completion = deferred();
  const writes = [];
  let opened = 0;
  const tx = {
    done: completion.promise,
    abort() {
      completion.reject(new DOMException('rollback', 'AbortError'));
    },
    store: {
      async get(id) {
        return records.find((book) => book.id === id);
      },
      async put(value) {
        if (fail) {
          tx.abort();
          throw new DOMException('quota', 'QuotaExceededError');
        }
        writes.push(value);
        return value.id;
      },
      async openCursor() {
        const cursor = (index) =>
          index === records.length
            ? null
            : { value: records[index], continue: async () => cursor(index + 1) };
        return cursor(0);
      }
    }
  };
  if (!manual) completion.resolve();
  return {
    db: {
      transaction(name) {
        assert.equal(name, 'data');
        opened++;
        return tx;
      }
    },
    writes,
    completion,
    opened: () => opened
  };
}

const stored = () => ({
  id: 3,
  title: '新しい本',
  elementHtml: 'current content',
  characters: 20,
  blobs: { image: { format: 'reader-bytes-v1', type: 'image/png', bytes: new ArrayBuffer(8) } },
  lastBookOpen: 100,
  lastBookModified: 200,
  manabiTtuImport: { version: 1, sourceTitle: 'source', records: {} }
});

test('library summaries use a cursor and retain neither book text nor image buffers', async () => {
  const a = stored();
  a.coverImage = new Blob(['cover']);
  a.styleSheet = 'large CSS';
  const b = { ...stored(), id: 4, elementHtml: '' };
  const h = harness([a, b]);
  const summaries = await readBookSummaries(h.db);
  assert.equal(summaries.length, 2);
  assert.equal(summaries[0].coverImage, a.coverImage);
  assert.equal(summaries[0].title, a.title);
  assert.equal(summaries[0].isPlaceholder, false);
  assert.equal(summaries[1].isPlaceholder, true);
  for (const summary of summaries) {
    for (const key of ['blobs', 'elementHtml', 'styleSheet', 'htmlBackup', 'manabiTtuImport'])
      assert.equal(Object.hasOwn(summary, key), false, key);
  }
});

test('last-read changes preserve latest content and receipt, without encoding image bytes', async () => {
  const record = stored();
  const h = harness([record]);
  const result = await updateBookLastRead(h.db, record.id, 300);
  assert.equal(result.lastBookOpen, 300);
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.writes[0], { ...record, lastBookOpen: 300 });
  assert.equal(h.writes[0].blobs, record.blobs);
  assert.equal(h.writes[0].manabiTtuImport, record.manabiTtuImport);
  assert.equal(record.lastBookOpen, 100);
});

test('a delayed last-read update never resurrects a deleted book or lowers a newer timestamp', async () => {
  const absent = harness([]);
  assert.equal(await updateBookLastRead(absent.db, 3, 400), undefined);
  assert.equal(absent.writes.length, 0);
  const h = harness([stored()]);
  assert.equal((await updateBookLastRead(h.db, 3, 50)).lastBookOpen, 100);
  assert.equal(h.writes.length, 0);
});

test('metadata-only updates do not try to read unavailable legacy Blob backing', async () => {
  const image = new Blob(['legacy']);
  image.arrayBuffer = () => {
    throw new Error('must not read image bytes for a timestamp');
  };
  const record = { ...stored(), blobs: { image } };
  const h = harness([record]);
  await updateBookLastRead(h.db, 3, 400);
  assert.equal(h.writes[0].blobs.image, image);
});

test('invalid metadata updates fail before opening a transaction', async () => {
  for (const [id, timestamp] of [
    [0, 100],
    [3.5, 100],
    [3, NaN],
    [3, Infinity],
    [3, -1]
  ]) {
    const h = harness([stored()]);
    await assert.rejects(updateBookLastRead(h.db, id, timestamp), /invalid/);
    assert.equal(h.opened(), 0);
  }
});

test('metadata and list callers wait for transaction completion and observe aborts', async () => {
  for (const operation of [(db) => updateBookLastRead(db, 3, 500), readBookSummaries]) {
    const h = harness([stored()], { manual: true });
    let settled = false;
    const result = operation(h.db);
    result.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    const failure = new DOMException('Aborted after requests', 'AbortError');
    h.completion.reject(failure);
    await assert.rejects(result, (error) => error === failure);
  }
});

test('a request failure drains the separate transaction rejection', async () => {
  const h = harness([stored()], { manual: true, fail: true });
  await assert.rejects(updateBookLastRead(h.db, 3, 500), { name: 'QuotaExceededError' });
  assert.equal(h.writes.length, 0);
});
