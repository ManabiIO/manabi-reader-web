import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  contentStatisticKey,
  migrateLegacyStatistics,
  visibleStatistics
} from '../../apps/web/src/lib/data/database/books-db/reader-statistics.ts';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
require('fake-indexeddb/auto');
const { openDB } = require('idb');

let serial = 0;
async function database() {
  return openDB(`content-statistics-${++serial}`, 1, {
    upgrade(db) {
      const data = db.createObjectStore('data', { keyPath: 'id' });
      data.createIndex('title', 'title');
      const legacy = db.createObjectStore('statistic', { keyPath: ['title', 'dateKey'] });
      legacy.createIndex('dateKey', 'dateKey');
      const content = db.createObjectStore('readerStatistic', { keyPath: ['bookKey', 'dateKey'] });
      content.createIndex('dateKey', 'dateKey');
      db.createObjectStore('readerStatisticMigration', { keyPath: 'title' });
      db.createObjectStore('readerLocalIdentity', { keyPath: 'bookId' });
    }
  });
}

const hash = (digit) => digit.repeat(64);
const book = (id, title, digit) => ({ id, title, ...(digit ? { contentHash: hash(digit) } : {}) });
const day = (title, dateKey, charactersRead) => ({
  title,
  dateKey,
  charactersRead,
  readingTime: 100,
  minReadingSpeed: 1,
  altMinReadingSpeed: 1,
  lastReadingSpeed: 1,
  maxReadingSpeed: 1,
  lastStatisticModified: 100
});

test('unambiguous legacy days migrate once without double counting', async () => {
  const db = await database();
  const copy = book(1, 'One book', 'a');
  await db.put('data', copy);
  await db.put('statistic', day(copy.title, '2026-09-20', 45));
  const key = contentStatisticKey(copy);
  assert.equal(await migrateLegacyStatistics(db, copy), key);
  assert.equal(await migrateLegacyStatistics(db, copy), key);
  assert.equal((await db.getAll('readerStatistic')).length, 1);
  assert.equal((await visibleStatistics(db)).length, 1);
  assert.equal((await visibleStatistics(db))[0].charactersRead, 45);
  db.close();
});

test('same-title different files preserve legacy day and keep new days separate', async () => {
  const db = await database();
  const first = book(1, 'Same title', 'a');
  const second = book(2, 'Same title', 'b');
  await db.put('data', first);
  await db.put('data', second);
  await db.put('statistic', day(first.title, '2026-09-20', 45));
  await migrateLegacyStatistics(db, first);
  assert.equal((await db.get('readerStatisticMigration', first.title)).state, 'ambiguous');
  assert.equal((await db.getAll('readerStatistic')).length, 0);
  await db.put('readerStatistic', {
    ...day(second.title, '2026-09-21', 72),
    bookKey: contentStatisticKey(second)
  });
  assert.deepEqual((await visibleStatistics(db)).map((row) => row.charactersRead).sort(), [45, 72]);
  db.close();
});

test('conflicting legacy titles for one content hash remain recoverable', async () => {
  const db = await database();
  const first = book(1, 'Old title', 'a');
  const second = book(2, 'New title', 'a');
  await db.put('data', first);
  await db.put('data', second);
  await db.put('statistic', day(first.title, '2026-09-20', 45));
  await db.put('statistic', day(second.title, '2026-09-20', 72));
  await migrateLegacyStatistics(db, first);
  await migrateLegacyStatistics(db, second);
  assert.equal((await db.get('readerStatisticMigration', second.title)).state, 'ambiguous');
  assert.equal((await db.getAll('readerStatistic')).length, 1);
  assert.deepEqual((await visibleStatistics(db)).map((row) => row.charactersRead).sort(), [45, 72]);
  db.close();
});

test('identical nested completion metadata does not create a false title conflict', async () => {
  const db = await database();
  const first = book(1, 'Old completion title', 'd');
  const second = book(2, 'New completion title', 'd');
  await db.put('data', first);
  await db.put('data', second);
  for (const copy of [first, second])
    await db.put('statistic', {
      ...day(copy.title, '2026-09-20', 45),
      completedBook: 1,
      completedData: { finishDate: '2026-09-20', totals: [45, 100] }
    });
  await migrateLegacyStatistics(db, first);
  await migrateLegacyStatistics(db, second);
  assert.equal((await db.get('readerStatisticMigration', second.title)).state, 'assigned');
  assert.equal((await visibleStatistics(db)).length, 1);
  db.close();
});

test('an unhashed book receives a stable local key, never a fabricated content hash', async () => {
  const db = await database();
  const copy = book(1, 'Unhashed');
  await db.put('data', copy);
  await db.put('statistic', day(copy.title, '2026-09-20', 12));
  const key = await migrateLegacyStatistics(db, copy);
  assert.match(key, /^local:[0-9a-f-]{36}$/);
  assert.equal(await migrateLegacyStatistics(db, copy), key);
  assert.equal((await visibleStatistics(db)).length, 1);
  db.close();
});

test('verification rekeys a previously local day without duplicating history', async () => {
  const db = await database();
  const local = book(1, 'Later verified');
  await db.put('data', local);
  await db.put('statistic', day(local.title, '2026-09-20', 12));
  const localKey = await migrateLegacyStatistics(db, local);
  const verified = book(1, local.title, 'c');
  await db.put('data', verified);
  const contentKey = await migrateLegacyStatistics(db, verified);
  assert.equal(contentKey, contentStatisticKey(verified));
  assert.equal(await db.get('readerStatistic', [localKey, '2026-09-20']), undefined);
  assert.equal((await db.get('readerStatistic', [contentKey, '2026-09-20'])).charactersRead, 12);
  assert.equal((await visibleStatistics(db)).length, 1);
  db.close();
});

test('identity conflict keeps a previously assigned legacy day represented once', async () => {
  const db = await database();
  const local = book(1, 'Assigned before verification');
  await db.put('data', local);
  await db.put('statistic', day(local.title, '2026-09-20', 12));
  const localKey = await migrateLegacyStatistics(db, local);
  const verified = book(1, local.title, 'e');
  await db.put('data', verified);
  await db.put('readerStatistic', {
    ...day(local.title, '2026-09-20', 90),
    bookKey: contentStatisticKey(verified)
  });
  await migrateLegacyStatistics(db, verified);
  const receipt = await db.get('readerStatisticMigration', local.title);
  assert.equal(receipt.state, 'identity-conflict');
  assert.equal(receipt.legacyAssigned, true);
  assert.equal((await db.get('readerStatistic', [localKey, '2026-09-20'])).charactersRead, 12);
  assert.deepEqual(
    (await visibleStatistics(db)).map((row) => row.charactersRead).sort((a, b) => a - b),
    [12, 90]
  );
  db.close();
});

test('identity conflict never hides a legacy day that was already ambiguous', async () => {
  const db = await database();
  const local = book(1, 'Ambiguous before verification');
  const other = book(2, local.title, 'a');
  await db.put('data', local);
  await db.put('data', other);
  await db.put('statistic', day(local.title, '2026-09-20', 5));
  const localKey = await migrateLegacyStatistics(db, local);
  assert.equal((await db.get('readerStatisticMigration', local.title)).state, 'ambiguous');
  await db.put('readerStatistic', {
    ...day(local.title, '2026-09-20', 12),
    bookKey: localKey
  });
  const verified = book(1, local.title, 'e');
  await db.put('data', verified);
  await db.put('readerStatistic', {
    ...day(local.title, '2026-09-20', 90),
    bookKey: contentStatisticKey(verified)
  });
  await migrateLegacyStatistics(db, verified);
  const receipt = await db.get('readerStatisticMigration', local.title);
  assert.equal(receipt.state, 'identity-conflict');
  assert.equal(receipt.legacyAssigned, false);
  assert.deepEqual(
    (await visibleStatistics(db)).map((row) => row.charactersRead).sort((a, b) => a - b),
    [5, 12, 90]
  );
  db.close();
});
