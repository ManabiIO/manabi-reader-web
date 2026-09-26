/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import { updateBookLastRead } from '../../apps/web/src/lib/data/database/books-db/book-records.ts';

const tick = () => new Promise((resolve) => setImmediate(resolve));

// Deterministic transaction ownership tests; the built-app companion uses native
// IndexedDB and actual image-bearing EPUB import/open/departure.
function database(value) {
  let stored = value;
  const transactions = [];
  return {
    transactions,
    get stored() {
      return stored;
    },
    transaction(name, mode) {
      assert.equal(name, 'data');
      assert.equal(mode, 'readwrite');
      let resolve, reject, pending;
      const tx = {
        done: new Promise((accept, fail) => {
          resolve = accept;
          reject = fail;
        }),
        store: {
          get: async (id) => (stored?.id === id ? stored : undefined),
          put: async (next) => {
            pending = next;
          }
        },
        commit() {
          if (pending) stored = pending;
          resolve();
        },
        abort() {
          reject(new DOMException('Transaction aborted', 'AbortError'));
        }
      };
      transactions.push(tx);
      return tx;
    }
  };
}

const book = () => ({
  id: 1,
  title: 'Updated title',
  characters: 12,
  lastBookOpen: 100,
  lastBookModified: 200,
  elementHtml: '<div id="ttu-epub-0">新しい本</div>',
  blobs: { picture: { format: 'reader-bytes-v1', bytes: new Uint8Array([1, 2]).buffer } },
  epubPublication: { version: 1, resources: [{ spineIndex: 0, href: 'a.xhtml' }] },
  manabiTtuImport: { sourceTitle: 'Old title' }
});

test('last-read preserves the current complete publication and waits for transaction commit', async () => {
  const current = book();
  const db = database(current);
  const pending = updateBookLastRead(db, 1, 300);
  let acknowledged = false;
  pending.then(() => {
    acknowledged = true;
  });
  await tick();
  assert.equal(acknowledged, false);
  assert.equal(db.stored.lastBookOpen, 100);
  db.transactions[0].commit();
  const summary = await pending;
  assert.deepEqual(db.stored, { ...current, lastBookOpen: 300 });
  assert.equal(summary.title, 'Updated title');
  assert.equal('blobs' in summary, false);
  assert.equal('elementHtml' in summary, false);
  assert.equal(db.stored.epubPublication, current.epubPublication);
});

test('last-read never rereads or converts legacy Blob resources', async () => {
  const current = book();
  const image = new Blob(['png'], { type: 'image/png' });
  image.arrayBuffer = () => assert.fail('A metadata update must not read image bytes');
  current.blobs.picture = image;
  const db = database(current);
  const pending = updateBookLastRead(db, 1, 300);
  await tick();
  db.transactions[0].commit();
  await pending;
  assert.equal(db.stored.blobs.picture, image);
});

test('an older last-read timestamp is monotonic and does not write', async () => {
  const current = book();
  const db = database(current);
  const pending = updateBookLastRead(db, 1, 50);
  db.transactions[0].store.put = () => assert.fail('Timestamp must not move backward');
  await tick();
  db.transactions[0].commit();
  assert.equal((await pending).lastBookOpen, 100);
  assert.equal(db.stored, current);
});

test('a removed book is not recreated by an in-flight reader timestamp', async () => {
  const db = database(undefined);
  const pending = updateBookLastRead(db, 1, 300);
  db.transactions[0].store.put = () => assert.fail('Deleted books must stay deleted');
  await tick();
  db.transactions[0].commit();
  assert.equal(await pending, undefined);
  assert.equal(db.stored, undefined);
});

test('a native transaction abort is drained and never acknowledges a timestamp', async () => {
  const current = book();
  const db = database(current);
  const pending = updateBookLastRead(db, 1, 300);
  const rejection = assert.rejects(pending, { name: 'AbortError' });
  await tick();
  db.transactions[0].abort();
  await rejection;
  assert.equal(db.stored, current);
});

test('invalid metadata writes fail before opening a transaction', async () => {
  const db = database(book());
  for (const [id, timestamp] of [
    [0, 1],
    [1.5, 1],
    [1, NaN],
    [1, -1],
    [1, Infinity]
  ])
    await assert.rejects(updateBookLastRead(db, id, timestamp), /invalid/);
  assert.equal(db.transactions.length, 0);
});
