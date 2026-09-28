import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  contentStatisticKey,
  deleteStatisticsForIdentityPlan,
  migrateLegacyStatistics,
  preserveCompletedStatistic,
  readStatisticsRecoverySnapshot,
  statisticIdentityPlan,
  titlesWithMultipleStatisticIdentities,
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
      db.createObjectStore('readerBookScope', { keyPath: 'bookId' });
      db.createObjectStore('lastModified', { keyPath: ['title', 'dataType'] });
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

test('a delayed tracker write cannot erase a completed day or its totals', () => {
  const existing = {
    ...day('A book', '2026-09-20', 120),
    bookKey: `content:${hash('a')}`,
    lastStatisticModified: 300,
    completedBook: 1,
    completedData: { finishDate: '2026-09-20' }
  };
  const stale = { ...existing, charactersRead: 80, lastStatisticModified: 200 };
  delete stale.completedBook;
  delete stale.completedData;
  assert.deepEqual(preserveCompletedStatistic(existing, stale, false), existing);
  const laterReading = { ...stale, charactersRead: 140, lastStatisticModified: 400 };
  assert.deepEqual(preserveCompletedStatistic(existing, laterReading, false), {
    ...laterReading,
    completedBook: 1,
    completedData: existing.completedData
  });
  assert.deepEqual(preserveCompletedStatistic(existing, laterReading, true), laterReading);
  const movedAway = { ...stale, charactersRead: 120, lastStatisticModified: 500 };
  assert.deepEqual(preserveCompletedStatistic(movedAway, existing, true), movedAway);
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

test('raw recovery retains keyed rows, unresolved legacy days, and migration receipts', async () => {
  const db = await database();
  const first = book(1, 'Same title', 'a');
  const second = book(2, 'Same title', 'b');
  await db.put('data', first);
  await db.put('data', second);
  await db.put('statistic', day('Same title', '2026-09-20', 45));
  await migrateLegacyStatistics(db, first);
  const keyed = { ...day('Same title', '2026-09-21', 72), bookKey: contentStatisticKey(second) };
  await db.put('readerStatistic', keyed);

  const snapshot = await readStatisticsRecoverySnapshot(db);
  const roundTrip = JSON.parse(JSON.stringify(snapshot));
  assert.equal(roundTrip.format, 'manabi-reader-statistics-recovery');
  assert.equal(roundTrip.version, 1);
  assert.deepEqual(roundTrip.books, [
    { id: 1, title: 'Same title', contentHash: hash('a') },
    { id: 2, title: 'Same title', contentHash: hash('b') }
  ]);
  assert.deepEqual(roundTrip.contentRows, [keyed]);
  assert.deepEqual(roundTrip.legacyRows, [day('Same title', '2026-09-20', 45)]);
  assert.deepEqual(roundTrip.migrationReceipts, [{ title: 'Same title', state: 'ambiguous' }]);
  assert.deepEqual(
    titlesWithMultipleStatisticIdentities([...roundTrip.contentRows, ...roundTrip.legacyRows]),
    ['Same title']
  );
  assert.deepEqual(titlesWithMultipleStatisticIdentities([keyed]), []);
  db.close();
});

test('raw recovery retains assigned legacy source and local identity receipts', async () => {
  const db = await database();
  const copy = book(1, 'Unverified');
  await db.put('data', copy);
  await db.put('statistic', day(copy.title, '2026-09-20', 12));
  const bookKey = await migrateLegacyStatistics(db, copy);
  const snapshot = JSON.parse(JSON.stringify(await readStatisticsRecoverySnapshot(db)));
  assert.equal(snapshot.contentRows[0].bookKey, bookKey);
  assert.equal(snapshot.legacyRows[0].charactersRead, 12);
  assert.deepEqual(snapshot.migrationReceipts, [{ title: copy.title, state: 'assigned', bookKey }]);
  assert.equal(`local:${snapshot.localIdentities[0].uuid}`, bookKey);
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


test('statistics deletion plan refuses unresolved same-title legacy history', async () => {
  const db = await database();
  const first = book(1, 'Same deletion title', 'a');
  const second = book(2, 'Same deletion title', 'b');
  await db.put('data', first);
  await db.put('data', second);
  await db.put('statistic', day(first.title, '2026-09-20', 45));
  await db.put('readerStatistic', {
    ...day(first.title, '2026-09-21', 72),
    bookKey: contentStatisticKey(first)
  });

  const plan = await statisticIdentityPlan(db, first.id);
  assert.equal(plan.bookKey, contentStatisticKey(first));
  assert.deepEqual(plan.keys, [contentStatisticKey(first)]);
  assert.equal(plan.unresolvedLegacy, true);
  assert.equal(plan.legacyTitle, undefined);
  assert.equal((await db.get('readerStatisticMigration', first.title)).state, 'ambiguous');
  db.close();
});

test('statistics identity planning refuses a replacement that appeared during confirmation', async () => {
  const db = await database();
  const selected = book(1, 'Confirmation replacement', 'a');
  await db.put('data', selected);
  await db.put('readerStatistic', {
    ...day(selected.title, '2026-09-20', 31),
    bookKey: contentStatisticKey(selected)
  });
  const expected = { title: selected.title, contentHash: selected.contentHash };
  await db.put('data', book(selected.id, selected.title, 'b'));

  await assert.rejects(
    statisticIdentityPlan(db, selected.id, undefined, expected),
    /book changed/
  );
  assert.equal((await db.getAll('readerStatistic')).length, 1);
  assert.equal((await db.getAll('readerStatisticMigration')).length, 0);
  db.close();
});

test('statistics deletion plan can delete a same-title sibling while legacy is assigned elsewhere', async () => {
  const db = await database();
  const first = book(1, 'Assigned sibling title', 'a');
  await db.put('data', first);
  await db.put('statistic', day(first.title, '2026-09-20', 12));
  const firstPlan = await statisticIdentityPlan(db, first.id);
  assert.equal(firstPlan.legacyTitle, first.title);

  const second = book(2, first.title, 'b');
  await db.put('data', second);
  await db.put('readerStatistic', {
    ...day(second.title, '2026-09-21', 44),
    bookKey: contentStatisticKey(second)
  });
  const secondPlan = await statisticIdentityPlan(db, second.id);
  assert.equal(secondPlan.unresolvedLegacy, false);
  assert.equal(secondPlan.legacyTitle, undefined);

  await deleteStatisticsForIdentityPlan(db, second.id, secondPlan);
  assert.equal(
    (await db.get('readerStatistic', [contentStatisticKey(first), '2026-09-20'])).charactersRead,
    12
  );
  assert.equal(await db.get('readerStatistic', [contentStatisticKey(second), '2026-09-21']), undefined);
  assert.equal((await db.get('statistic', [first.title, '2026-09-20'])).charactersRead, 12);
  db.close();
});

test('statistics deletion plan maps assigned legacy history to the selected logical book', async () => {
  const db = await database();
  const copy = book(1, 'Assigned deletion', 'c');
  await db.put('data', copy);
  await db.put('statistic', day(copy.title, '2026-09-20', 12));

  const plan = await statisticIdentityPlan(db, copy.id);
  assert.equal(plan.bookKey, contentStatisticKey(copy));
  assert.deepEqual(plan.keys, [contentStatisticKey(copy)]);
  assert.equal(plan.legacyTitle, copy.title);
  assert.equal(plan.unresolvedLegacy, false);
  assert.equal(
    (await db.get('readerStatistic', [plan.bookKey, '2026-09-20'])).charactersRead,
    12
  );
  db.close();
});

test('statistics deletion plan includes retained pre-hash identity after a resolved conflict', async () => {
  const db = await database();
  const local = book(1, 'Conflict deletion');
  await db.put('data', local);
  await db.put('statistic', day(local.title, '2026-09-20', 12));
  const localKey = await migrateLegacyStatistics(db, local);
  const verified = book(1, local.title, 'd');
  await db.put('data', verified);
  await db.put('readerStatistic', {
    ...day(local.title, '2026-09-20', 90),
    bookKey: contentStatisticKey(verified)
  });
  await migrateLegacyStatistics(db, verified);

  const plan = await statisticIdentityPlan(db, verified.id);
  assert.equal(plan.bookKey, contentStatisticKey(verified));
  assert.deepEqual(new Set(plan.keys), new Set([contentStatisticKey(verified), localKey]));
  assert.equal(plan.legacyTitle, verified.title);
  assert.equal(plan.unresolvedLegacy, false);
  db.close();
});

test('statistics deletion plan keeps ambiguous legacy history fail-closed across identity conflict', async () => {
  const db = await database();
  const local = book(1, 'Ambiguous conflict deletion');
  const other = book(2, local.title, 'a');
  await db.put('data', local);
  await db.put('data', other);
  await db.put('statistic', day(local.title, '2026-09-20', 5));
  const localKey = await migrateLegacyStatistics(db, local);
  await db.put('readerStatistic', {
    ...day(local.title, '2026-09-21', 12),
    bookKey: localKey
  });
  const verified = book(1, local.title, 'e');
  await db.put('data', verified);
  await db.put('readerStatistic', {
    ...day(local.title, '2026-09-21', 90),
    bookKey: contentStatisticKey(verified)
  });
  await migrateLegacyStatistics(db, verified);

  const plan = await statisticIdentityPlan(db, verified.id);
  assert.equal(plan.unresolvedLegacy, true);
  assert.equal(plan.legacyTitle, undefined);
  assert.deepEqual(new Set(plan.keys), new Set([contentStatisticKey(verified), localKey]));
  db.close();
});


test('identity deletion removes keyed history and its safely assigned legacy source', async () => {
  const db = await database();
  const copy = book(1, 'Delete assigned legacy', 'f');
  await db.put('data', copy);
  await db.put('statistic', day(copy.title, '2026-09-20', 12));
  const plan = await statisticIdentityPlan(db, copy.id);
  assert.equal(plan.legacyTitle, copy.title);
  assert.equal((await db.getAll('statistic')).length, 1);
  assert.equal((await db.getAll('readerStatistic')).length, 1);

  await deleteStatisticsForIdentityPlan(db, copy.id, plan);

  assert.deepEqual(await db.getAll('statistic'), []);
  assert.deepEqual(await db.getAll('readerStatistic'), []);
  const modified = await db.getAll('lastModified');
  assert.deepEqual(
    new Set(modified.map((entry) => entry.title)),
    new Set([copy.title, contentStatisticKey(copy)])
  );
  assert.ok(modified.every((entry) => entry.dataType === 'statistic'));
  db.close();
});

test('identity deletion refuses a stale plan without removing either history', async () => {
  const db = await database();
  const first = book(1, 'Stale deletion plan', 'a');
  await db.put('data', first);
  await db.put('readerStatistic', {
    ...day(first.title, '2026-09-20', 30),
    bookKey: contentStatisticKey(first)
  });
  const plan = await statisticIdentityPlan(db, first.id);
  const replacement = book(first.id, first.title, 'b');
  await db.put('data', replacement);
  await db.put('readerStatistic', {
    ...day(first.title, '2026-09-21', 40),
    bookKey: contentStatisticKey(replacement)
  });

  await assert.rejects(
    deleteStatisticsForIdentityPlan(db, first.id, plan),
    /identity changed/
  );
  assert.deepEqual(
    new Set((await db.getAll('readerStatistic')).map((row) => row.charactersRead)),
    new Set([30, 40])
  );
  db.close();
});

test('identity deletion rechecks persistent reader ownership inside its transaction', async () => {
  const db = await database();
  const copy = book(1, 'Owned deletion', 'c');
  await db.put('data', copy);
  await db.put('readerBookScope', { bookId: copy.id, accountId: 'alice' });
  await db.put('readerStatistic', {
    ...day(copy.title, '2026-09-20', 55),
    bookKey: contentStatisticKey(copy)
  });
  const plan = await statisticIdentityPlan(db, copy.id);
  const controller = new AbortController();
  const guard = {
    signal: controller.signal,
    assertCurrent() {},
    validate(_book, owner) {
      if (owner && owner.accountId !== 'bob') throw new Error('belongs to another account');
    },
    validateCopy(_book, owner) {
      if (owner && owner.accountId !== 'bob') throw new Error('belongs to another account');
    }
  };

  await assert.rejects(
    deleteStatisticsForIdentityPlan(db, copy.id, plan, guard),
    /another account/
  );
  assert.equal((await db.getAll('readerStatistic')).length, 1);
  assert.equal((await db.getAll('lastModified')).length, 0);
  db.close();
});
