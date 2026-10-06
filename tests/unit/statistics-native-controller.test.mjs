/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { fixture, nativeFixture } from './fixtures/statistics-controller.mjs';

test('native statistics queries reject malformed ranges, identifiers, and unbounded selections', async () => {
  const f = await nativeFixture();
  for (const query of [
    { startDate: '2024-02-30' },
    { startDate: '2025-01-01', endDate: '2024-01-01' },
    { bookIds: [-1] },
    { bookIds: Array(201).fill(1) },
    { year: Infinity },
    { page: 0 },
    { aggregation: 'other' },
    { direction: 'sideways' }
  ])
    assert.throws(
      () => f.service.normalizeNativeStatisticsQuery(query),
      /Invalid statistics filter/
    );
  f.nativeDb.close();
});

test('native snapshot reads proven identities only and never exposes orphan or foreign-profile rows', async () => {
  const f = await nativeFixture();
  const own = await f.book(1, 'Same title', 'a');
  const foreign = await f.book(2, 'Same title', 'b', 'other', 'other');
  await f.history(own, '2024-02-28', 60);
  await f.history(foreign, '2024-02-29', 900);
  await f.nativeDb.put(
    'readerStatistic',
    f.row('Orphan', '2024-02-29', 999, `content:${'c'.repeat(64)}`)
  );
  const result = await f.service.readStatisticsSnapshot({
    startDate: '2024-01-01',
    endDate: '2024-12-31',
    year: 2024
  });
  assert.equal(result.books.length, 1);
  assert.equal(result.books[0].id, 1);
  assert.equal(result.totals.time, 60);
  assert.equal(result.rows[0].time, 60);
  assert.equal(result.days.length, 366);
  assert.equal(
    result.rows.some((row) => row.title === 'Orphan'),
    false
  );
  await assert.rejects(f.service.readStatisticsSnapshot({ bookIds: [2] }), /no longer available/);
  f.nativeDb.close();
});

test('native snapshot refuses a content identity with a foreign shared-copy claimant', async () => {
  const f = await nativeFixture();
  const own = await f.book(1, 'My copy', 'a');
  await f.book(2, 'Foreign copy', 'a', 'other', 'other');
  await f.history(own, '2024-02-28', 60);
  const result = await f.service.readStatisticsSnapshot({ year: 2024 });
  assert.equal(result.books.length, 0);
  assert.equal(result.rows.length, 0);
  assert.ok(result.notices.some((notice) => notice.includes('could not be safely resolved')));
  f.nativeDb.close();
});

test('native selected-book filtering retains choices while history remains identity-scoped', async () => {
  const f = await nativeFixture();
  const first = await f.book(1, 'Same title', 'a');
  const second = await f.book(2, 'Same title', 'b');
  await f.history(first, '2024-02-28', 60);
  await f.history(second, '2024-02-29', 120);
  const result = await f.service.readStatisticsSnapshot({ year: 2024, bookIds: [1] });
  assert.equal(result.books.length, 2);
  assert.equal(result.totals.time, 60);
  assert.equal(result.rows.length, 1);
  f.nativeDb.close();
});

test('native whole-history deletion reuses the live identity transaction and keeps same-title siblings', async () => {
  const f = await nativeFixture();
  const first = await f.book(1, 'Same title', 'a');
  const second = await f.book(2, 'Same title', 'b');
  await f.history(first, '2024-02-28', 60);
  await f.history(second, '2024-02-29', 120);
  const action = {
    type: 'delete-book-history',
    snapshotId: (await f.service.readStatisticsSnapshot()).snapshotId,
    bookId: 1,
    title: first.title,
    bookKey: `content:${first.contentHash}`
  };
  await assert.rejects(
    f.service.dispatchStatisticsAction({ ...action, bookKey: `content:${second.contentHash}` }),
    /history changed/
  );
  assert.equal((await f.nativeDb.getAll('readerStatistic')).length, 2);
  await f.service.dispatchStatisticsAction({
    ...action,
    snapshotId: (await f.service.readStatisticsSnapshot()).snapshotId
  });
  const remaining = await f.nativeDb.getAll('readerStatistic');
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].bookKey, `content:${second.contentHash}`);
  assert.ok(await f.nativeDb.get('data', 1));
  f.nativeDb.close();
});

test('native action rejects a switched profile before any database mutation', async () => {
  const f = await nativeFixture(),
    book = await f.book(1, 'One', 'a');
  await f.history(book, '2024-02-28');
  const snapshot = await f.service.readStatisticsSnapshot();
  f.scopeAbort.abort();
  await assert.rejects(
    f.service.dispatchStatisticsAction({
      type: 'delete-book-history',
      snapshotId: snapshot.snapshotId,
      bookId: 1,
      title: book.title,
      bookKey: `content:${book.contentHash}`
    }),
    /account_changed|changed accounts/
  );
  assert.equal((await f.nativeDb.getAll('readerStatistic')).length, 1);
  f.nativeDb.close();
});

async function nativeAction(f, book, values = {}, authority) {
  const snapshot = await f.service.readStatisticsSnapshot({ aggregation: 'none' }, authority);
  return {
    type: 'save-day',
    snapshotId: snapshot.snapshotId,
    bookId: book.id,
    bookKey: `content:${book.contentHash}`,
    title: book.title,
    date: '2024-02-28',
    mode: 'edit',
    time: 120,
    characters: 500,
    resetMinMax: false,
    ...values
  };
}
function runtimeAuthority(key = 'account-a:1') {
  const controller = new AbortController();
  return {
    controller,
    key,
    signal: controller.signal,
    assertCurrent() {
      controller.signal.throwIfAborted();
    }
  };
}

test('native manual entry creates only a proven book/day and never overwrites existing history', async () => {
  const f = await nativeFixture(),
    book = await f.book(1, 'New day', 'a');
  const action = await nativeAction(f, book, { mode: 'create', time: 0, characters: 0 });
  assert.equal((await f.service.dispatchStatisticsAction(action)).saved, true);
  const stored = await f.nativeDb.get('readerStatistic', [action.bookKey, action.date]);
  assert.equal(stored.readingTime, 0);
  assert.equal(stored.charactersRead, 0);
  assert.equal(
    (await f.nativeDb.get('lastModified', [action.bookKey, 'statistic'])).lastModifiedValue,
    stored.lastStatisticModified
  );
  const snapshot = await f.service.readStatisticsSnapshot({ aggregation: 'none' });
  assert.equal(snapshot.rows.length, 1, 'zero-time entries remain editable');
  assert.equal(snapshot.rows[0].entry.bookId, 1);
  assert.equal(snapshot.totals.days, 0);
  await assert.rejects(
    f.service.dispatchStatisticsAction({ ...action, snapshotId: snapshot.snapshotId }),
    /already has history/
  );
  assert.deepEqual(await f.nativeDb.get('readerStatistic', [action.bookKey, action.date]), stored);
  f.nativeDb.close();
});

test('native day editing preserves completion data, updates speed bounds, and supports explicit reset', async () => {
  const f = await nativeFixture(),
    book = await f.book(1, 'Finished', 'a');
  const row = await f.history(book, '2024-02-28', 60);
  row.completedBook = 1;
  row.completedData = { dateKey: '2024-02-28', charactersRead: 999 };
  row.minReadingSpeed = 100;
  row.altMinReadingSpeed = 120;
  row.maxReadingSpeed = 100000;
  await f.nativeDb.put('readerStatistic', row);
  const action = await nativeAction(f, book);
  await f.service.dispatchStatisticsAction(action);
  let saved = await f.nativeDb.get('readerStatistic', [action.bookKey, action.date]);
  assert.equal(saved.readingTime, 120);
  assert.equal(saved.charactersRead, 500);
  assert.equal(saved.lastReadingSpeed, 15000);
  assert.equal(saved.minReadingSpeed, 100);
  assert.equal(saved.maxReadingSpeed, 100000);
  assert.equal(saved.completedBook, 1);
  assert.deepEqual(saved.completedData, row.completedData);
  const reset = await nativeAction(f, book, { resetMinMax: true });
  await f.service.dispatchStatisticsAction(reset);
  saved = await f.nativeDb.get('readerStatistic', [action.bookKey, action.date]);
  assert.equal(saved.minReadingSpeed, 15000);
  assert.equal(saved.altMinReadingSpeed, 15000);
  assert.equal(saved.maxReadingSpeed, 15000);
  assert.deepEqual(saved.completedData, row.completedData);
  f.nativeDb.close();
});

test('native stale edits and duplicate submissions never overwrite a tracker update', async () => {
  const f = await nativeFixture(),
    book = await f.book(1, 'Concurrent', 'a');
  const row = await f.history(book, '2024-02-28');
  const action = await nativeAction(f, book);
  const newer = { ...row, completedBook: 1, lastStatisticModified: row.lastStatisticModified + 1 };
  await f.nativeDb.put('readerStatistic', newer);
  await assert.rejects(f.service.dispatchStatisticsAction(action), /history changed/);
  await assert.rejects(f.service.dispatchStatisticsAction(action), /expired/);
  assert.deepEqual(await f.nativeDb.get('readerStatistic', [action.bookKey, action.date]), newer);
  f.nativeDb.close();
});

test('native range deletion is inclusive, atomic across selected books, and retains other dates and same-title siblings', async () => {
  const f = await nativeFixture(),
    first = await f.book(1, 'Same', 'a'),
    second = await f.book(2, 'Same', 'b'),
    sibling = await f.book(3, 'Same', 'c');
  for (const book of [first, second, sibling]) {
    for (const date of ['2024-02-27', '2024-02-28', '2024-02-29']) await f.history(book, date);
  }
  const snapshot = await f.service.readStatisticsSnapshot();
  await f.service.dispatchStatisticsAction({
    type: 'delete-range',
    snapshotId: snapshot.snapshotId,
    bookIds: [1, 2],
    startDate: '2024-02-28',
    endDate: '2024-02-29'
  });
  const rows = await f.nativeDb.getAll('readerStatistic');
  assert.equal(rows.length, 5);
  assert.equal(rows.filter((row) => row.bookKey === `content:${sibling.contentHash}`).length, 3);
  assert.ok(
    rows
      .filter((row) => row.bookKey !== `content:${sibling.contentHash}`)
      .every((row) => row.dateKey === '2024-02-27')
  );
  f.nativeDb.close();
});

test('native range deletion refuses new rows and rolls back every selected identity', async () => {
  const f = await nativeFixture(),
    first = await f.book(1, 'One', 'a'),
    second = await f.book(2, 'Two', 'b');
  await f.history(first, '2024-02-28');
  await f.history(second, '2024-02-28');
  const snapshot = await f.service.readStatisticsSnapshot();
  await f.history(second, '2024-02-29');
  await assert.rejects(
    f.service.dispatchStatisticsAction({
      type: 'delete-range',
      snapshotId: snapshot.snapshotId,
      bookIds: [1, 2],
      startDate: '2024-02-28',
      endDate: '2024-02-29'
    }),
    /history changed/
  );
  assert.equal((await f.nativeDb.getAll('readerStatistic')).length, 3);
  assert.equal((await f.nativeDb.getAll('lastModified')).length, 0);
  f.nativeDb.close();
});

test('native same-ID title, identity, and ownership swaps reject a previously displayed edit', async () => {
  for (const change of [
    { title: 'Renamed' },
    { contentHash: 'b'.repeat(64) },
    { libraryOwner: 'other' }
  ]) {
    const f = await nativeFixture(),
      book = await f.book(1, 'Original', 'a');
    const row = await f.history(book, '2024-02-28');
    const action = await nativeAction(f, book);
    await f.nativeDb.put('data', { ...book, ...change });
    await assert.rejects(
      f.service.dispatchStatisticsAction(action),
      /changed|account|profile|ownership/
    );
    assert.deepEqual(await f.nativeDb.get('readerStatistic', [action.bookKey, action.date]), row);
    f.nativeDb.close();
  }
});

test('native mutation refuses a foreign shared-copy claimant added after the snapshot', async () => {
  const f = await nativeFixture(),
    book = await f.book(1, 'Original', 'a');
  const row = await f.history(book, '2024-02-28');
  const action = await nativeAction(f, book);
  await f.book(2, 'Other copy', 'a', 'other', 'other');
  await assert.rejects(f.service.dispatchStatisticsAction(action), /account|profile|ownership/);
  assert.deepEqual(await f.nativeDb.get('readerStatistic', [action.bookKey, action.date]), row);
  f.nativeDb.close();
});

test('native snapshot capabilities reject runtime account ABA and same-user generation replacement', async () => {
  const f = await nativeFixture(),
    book = await f.book(1, 'One', 'a');
  const row = await f.history(book, '2024-02-28');
  const old = runtimeAuthority();
  const action = await nativeAction(f, book, {}, old);
  old.controller.abort();
  const returned = runtimeAuthority('account-a:3');
  await assert.rejects(
    f.service.dispatchStatisticsAction(action, returned),
    /expired|changed accounts/
  );
  const fresh = await nativeAction(f, book, {}, returned);
  await assert.rejects(
    f.service.dispatchStatisticsAction(fresh, runtimeAuthority('account-a:4')),
    /changed accounts/
  );
  assert.deepEqual(await f.nativeDb.get('readerStatistic', [action.bookKey, action.date]), row);
  f.nativeDb.close();
});

test('native runtime abort after the final write request rolls back row and modification marker', async () => {
  const f = await nativeFixture(),
    book = await f.book(1, 'Rollback', 'a');
  const row = await f.history(book, '2024-02-28');
  const authority = runtimeAuthority();
  const action = await nativeAction(f, book, {}, authority);
  // Abort on the final lastModified request success, before IndexedDB commits.
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    const request = originalPut.apply(this, args);
    if (this.name === 'lastModified')
      request.addEventListener('success', () => authority.controller.abort(), { once: true });
    return request;
  };
  try {
    await assert.rejects(f.service.dispatchStatisticsAction(action, authority));
  } finally {
    IDBObjectStore.prototype.put = originalPut;
  }
  assert.deepEqual(await f.nativeDb.get('readerStatistic', [action.bookKey, action.date]), row);
  assert.equal((await f.nativeDb.getAll('lastModified')).length, 0);
  f.nativeDb.close();
});

test('native mutations bound payloads and snapshots; global ownerless goals stay explicitly gated', async () => {
  const f = await nativeFixture(),
    book = await f.book(1, 'Bounded', 'a');
  await f.history(book, '2024-02-28');
  const action = await nativeAction(f, book);
  for (const value of [
    { time: -1 },
    { time: 86401 },
    { time: 1.5 },
    { characters: Infinity },
    { characters: 100000001 },
    { date: '2024-02-30' }
  ]) {
    await assert.rejects(
      f.service.dispatchStatisticsAction({ ...action, ...value }),
      /Invalid statistics action/
    );
  }
  for (let i = 0; i < 4; i++) {
    const snapshot = await f.service.readStatisticsSnapshot();
    assert.equal(snapshot.goals.available, false);
    assert.match(snapshot.goals.reason, /without account ownership/);
  }
  await assert.rejects(f.service.dispatchStatisticsAction(action), /expired/);
  f.nativeDb.close();
});

test('native filters distinguish all books from an explicitly empty private selection', async () => {
  const f = await nativeFixture(),
    book = await f.book(1, 'Visible choice', 'a');
  await f.history(book, '2024-02-28');
  const empty = await f.service.readStatisticsSnapshot({ bookSelection: 'selected', bookIds: [] });
  assert.equal(empty.books.length, 1);
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.totals.time, 0);
  assert.equal(empty.allTime, null);
  assert.equal(empty.query.bookSelection, 'selected');
  const all = await f.service.readStatisticsSnapshot({ bookSelection: 'all' });
  assert.equal(all.rows.length, 1);
  assert.equal(all.allTime.startDate, '2024-02-28');
  f.nativeDb.close();
});

test('native single-entry deletion retains a conflicting secondary-identity row on the same date', async () => {
  const f = await nativeFixture(),
    book = await f.book(1, 'Two histories', 'a');
  const primary = await f.history(book, '2024-02-28', 60);
  const secondary = { ...primary, bookKey: 'local:retained-copy', readingTime: 90 };
  await f.nativeDb.put('readerLocalIdentity', { bookId: 1, uuid: 'retained-copy' });
  await f.nativeDb.put('readerStatistic', secondary);
  await f.nativeDb.put('readerStatisticMigration', {
    title: book.title,
    state: 'assigned',
    bookKey: primary.bookKey
  });
  const snapshot = await f.service.readStatisticsSnapshot({ aggregation: 'none' });
  assert.equal(snapshot.rows.length, 2);
  assert.ok(snapshot.rows.every((row) => row.entry));
  await f.service.dispatchStatisticsAction({
    type: 'delete-day',
    snapshotId: snapshot.snapshotId,
    bookId: 1,
    title: book.title,
    bookKey: primary.bookKey,
    date: primary.dateKey
  });
  assert.equal(
    await f.nativeDb.get('readerStatistic', [primary.bookKey, primary.dateKey]),
    undefined
  );
  assert.deepEqual(
    await f.nativeDb.get('readerStatistic', [secondary.bookKey, secondary.dateKey]),
    secondary
  );
  f.nativeDb.close();
});

const plain = (value) => JSON.parse(JSON.stringify(value));
const measurementKeys = [
  'readingTime',
  'averageReadingTime',
  'averageWeightedReadingTime',
  'charactersRead',
  'averageCharactersRead',
  'averageWeightedCharactersRead',
  'lastReadingSpeed',
  'minReadingSpeed',
  'altMinReadingSpeed',
  'maxReadingSpeed'
];
function measuredRow(row) {
  return {
    ...row,
    id: `${row.bookKey ?? row.title}_${row.dateKey}`,
    averageReadingTime: row.readingTime,
    averageWeightedReadingTime: row.readingTime,
    averageCharactersRead: row.charactersRead,
    averageWeightedCharactersRead: row.charactersRead,
    averageReadingSpeed: row.lastReadingSpeed,
    averageWeightedReadingSpeed: row.lastReadingSpeed
  };
}
function originalAggregation(f) {
  return f.load(
    fileURLToPath(
      new URL('../../test/statistics/fixtures/statistics-aggregation-original.ts', import.meta.url)
    )
  ).originalAggregateStatistics;
}

test('shared aggregation is equivalent to the original for zero entries, day gaps, weights, and speed bounds', () => {
  const f = fixture();
  const aggregate = f.load('statistics-react/statistics-aggregation.ts').aggregateStatistics;
  const original = originalAggregation(f);
  const zero = measuredRow(f.row('One', '2024-01-01', 0, 'local:one'));
  const first = measuredRow({
    ...f.row('One', '2024-01-03', 60, 'local:one'),
    charactersRead: 120,
    minReadingSpeed: 10,
    altMinReadingSpeed: 20,
    maxReadingSpeed: 9000,
    lastReadingSpeed: 7200
  });
  const last = measuredRow({
    ...f.row('One', '2024-02-29', 180, 'local:one'),
    charactersRead: 540,
    minReadingSpeed: 30,
    altMinReadingSpeed: 40,
    maxReadingSpeed: 12000,
    lastReadingSpeed: 10800
  });
  const sameDay = measuredRow({ ...last, title: 'Other', bookKey: 'local:two' });
  for (const rows of [
    [],
    [zero],
    [first, last],
    [zero, first, last],
    [first, zero, last],
    [first, last, sameDay]
  ]) {
    for (const mode of Object.values(f.types.StatisticsReadingDataAggregationMode)) {
      const project = (entries) => entries.map((entry) => ({ ...entry, lastStatisticModified: 0 }));
      assert.deepEqual(plain(project(aggregate(rows, mode))), plain(project(original(rows, mode))));
    }
  }
  const [result] = aggregate([first, last], f.types.StatisticsReadingDataAggregationMode.TITLE);
  assert.equal(result.averageReadingTime, 120, 'calendar gaps add no denominator entries');
  assert.equal(result.averageWeightedReadingTime, 159);
  assert.equal(result.averageCharactersRead, 330);
  assert.equal(result.averageWeightedCharactersRead, 435);
  assert.equal(result.minReadingSpeed, 10);
  assert.equal(
    result.altMinReadingSpeed,
    0,
    'retain original grouped alternate-minimum initialization'
  );
  assert.equal(result.maxReadingSpeed, 10800, 'retain original maximum-of-daily-speed behavior');
  assert.equal(
    aggregate([first, zero, last], f.types.StatisticsReadingDataAggregationMode.TITLE)[0]
      .averageReadingTime,
    80,
    'retain original cumulative-time zero-entry counting; changing semantics is separate work'
  );
});

test('native measurement choices match the original web columns and reject malformed selectors', async () => {
  const f = await nativeFixture();
  const contract = f.load('statistics-react/native-contract.ts');
  assert.deepEqual(
    plain(contract.nativeStatisticsTimeSources),
    plain(f.types.readingTimeDataSources)
  );
  assert.deepEqual(
    plain(contract.nativeStatisticsCharactersSources),
    plain(f.types.charactersDataSources)
  );
  assert.deepEqual(
    plain(contract.nativeStatisticsSpeedSources),
    plain(f.types.readingSpeedDataSources)
  );
  for (const query of [
    null,
    false,
    [],
    'time',
    { endDate: 5 },
    { startDate: {} },
    { timeSource: 'charactersRead' },
    { timeSource: null },
    { timeSource: '__proto__' },
    { charactersSource: 'averageReadingTime' },
    { speedSource: 'averageReadingSpeed' },
    { speedSource: [] },
    { heatmapAggregation: 'all' },
    { heatmapAggregation: 1 },
    { heatmapAggregation: null },
    { sort: 'maxReadingSpeed' }
  ]) {
    assert.throws(
      () => f.service.normalizeNativeStatisticsQuery(query),
      /Invalid statistics filter/
    );
  }
  const defaults = f.service.normalizeNativeStatisticsQuery();
  assert.equal(defaults.timeSource, 'readingTime');
  assert.equal(defaults.charactersSource, 'charactersRead');
  assert.equal(defaults.speedSource, 'lastReadingSpeed');
  assert.equal(defaults.heatmapAggregation, 'year');
  f.nativeDb.close();
});

test('native measurements use the original aggregation only for proven selected identities and dates', async () => {
  const f = await nativeFixture();
  const own = await f.book(1, 'Same title', 'a');
  const sibling = await f.book(2, 'Same title', 'b');
  const foreign = await f.book(3, 'Same title', 'c', 'other', 'other');
  const rows = [];
  for (const [date, time, characters] of [
    ['2024-01-01', 0, 0],
    ['2024-01-03', 60, 120],
    ['2024-02-29', 180, 540]
  ]) {
    const row = {
      ...(await f.history(own, date, time)),
      charactersRead: characters,
      minReadingSpeed: 10,
      altMinReadingSpeed: 20,
      maxReadingSpeed: 12000,
      completedData: { private: 'completion-not-for-native' }
    };
    rows.push(row);
    await f.nativeDb.put('readerStatistic', row);
  }
  await f.history(own, '2025-01-01', 777);
  await f.history(sibling, '2024-01-03', 888);
  await f.history(foreign, '2024-01-03', 999);
  await f.nativeDb.put(
    'readerStatistic',
    f.row('Orphan', '2024-01-03', 9999, `content:${'d'.repeat(64)}`)
  );
  for (const [aggregation, mode] of [
    ['title', 'TITLE'],
    ['date', 'DATE'],
    ['none', 'NONE']
  ]) {
    const snapshot = await f.service.readStatisticsSnapshot({
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      year: 2024,
      bookIds: [1],
      aggregation,
      sort: 'date',
      direction: 'asc',
      timeSource: 'averageWeightedReadingTime',
      charactersSource: 'averageCharactersRead',
      speedSource: 'maxReadingSpeed'
    });
    const expected = originalAggregation(f)(
      rows.map(measuredRow),
      f.types.StatisticsReadingDataAggregationMode[mode]
    );
    assert.equal(snapshot.rows.length, expected.length);
    for (let index = 0; index < expected.length; index++) {
      const measurements = Object.fromEntries(
        measurementKeys.map((key) => [key, expected[index][key]])
      );
      assert.deepEqual(plain(snapshot.rows[index].measurements), measurements);
    }
    assert.equal(snapshot.totals.time, 240);
    assert.equal(snapshot.totals.characters, 660);
    assert.equal(snapshot.totals.days, 2);
    assert.equal(JSON.stringify(snapshot).includes('completion-not-for-native'), false);
    assert.equal(JSON.stringify(snapshot).includes('Orphan'), false);
    assert.equal(snapshot.goals.available, false);
    if (aggregation === 'none')
      assert.equal(snapshot.rows[0].entry.bookId, 1, 'zero-time day remains editable');
  }
  const empty = await f.service.readStatisticsSnapshot({
    bookSelection: 'selected',
    bookIds: [],
    timeSource: 'averageReadingTime'
  });
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.totals.time, 0);
  f.nativeDb.close();
});

test('native sorting uses the selected measurement and direction, with numeric-title ties', async () => {
  const f = await nativeFixture();
  const rows = [];
  for (const [id, title, digit, values] of [
    [
      1,
      'Book 10',
      'a',
      [
        [60, 120, 30, 90],
        [180, 540, 20, 100]
      ]
    ],
    [2, 'Book 2', 'b', [[180, 350, 20, 100]]],
    [3, 'Book 3', 'c', [[120, 240, 40, 100]]]
  ]) {
    const book = await f.book(id, title, digit);
    for (let index = 0; index < values.length; index++) {
      const [time, charactersRead, minReadingSpeed, altMinReadingSpeed] = values[index];
      const row = {
        ...(await f.history(book, `2024-01-0${index + 1}`, time)),
        charactersRead,
        minReadingSpeed,
        altMinReadingSpeed,
        maxReadingSpeed: time * 100,
        lastReadingSpeed: Math.ceil((charactersRead * 3600) / time)
      };
      await f.nativeDb.put('readerStatistic', row);
      rows.push(row);
    }
  }
  const expected = originalAggregation(f)(
    rows.map(measuredRow),
    f.types.StatisticsReadingDataAggregationMode.TITLE
  );
  for (const key of measurementKeys) {
    const sort = key.includes('Time')
      ? 'time'
      : key.includes('Characters') || key === 'charactersRead'
        ? 'characters'
        : 'speed';
    const source =
      sort === 'time' ? 'timeSource' : sort === 'characters' ? 'charactersSource' : 'speedSource';
    for (const direction of ['asc', 'desc']) {
      const snapshot = await f.service.readStatisticsSnapshot({ [source]: key, sort, direction });
      const order = [...expected]
        .sort(
          (a, b) =>
            (a[key] - b[key]) * (direction === 'asc' ? 1 : -1) ||
            a.title.localeCompare(b.title, 'ja-JP', { numeric: true })
        )
        .map((row) => row.title);
      assert.deepEqual(plain(snapshot.rows.map((row) => row.title)), order);
    }
  }
  f.nativeDb.close();
});

test('native selected-measurement sorting happens before bounded pagination', async () => {
  const f = await nativeFixture();
  const book = await f.book(1, 'Page', 'a');
  for (let day = 1; day <= 26; day++) {
    const row = await f.history(book, `2024-01-${String(day).padStart(2, '0')}`, day * 60);
    await f.nativeDb.put('readerStatistic', { ...row, maxReadingSpeed: day * 100 });
  }
  const query = {
    aggregation: 'none',
    sort: 'speed',
    speedSource: 'maxReadingSpeed',
    direction: 'desc'
  };
  const first = await f.service.readStatisticsSnapshot(query);
  const second = await f.service.readStatisticsSnapshot({ ...query, page: 2 });
  assert.equal(first.rows.length, 25);
  assert.equal(first.rows[0].measurements.maxReadingSpeed, 2600);
  assert.equal(second.rows.length, 1);
  assert.equal(second.rows[0].measurements.maxReadingSpeed, 100);
  assert.equal(second.query.page, 2);
  assert.equal(second.pages, 2);
  f.nativeDb.close();
});

test('native all-time heatmap reuses global metrics while keeping one bounded year of owned days', async () => {
  const f = await nativeFixture();
  const own = await f.book(1, 'Owned', 'a');
  const foreign = await f.book(2, 'Foreign', 'b', 'other', 'other');
  for (const date of ['2023-12-30', '2023-12-31', '2024-01-01', '2024-02-29'])
    await f.history(own, date);
  await f.history(foreign, '2024-01-02', 999);
  const yearly = await f.service.readStatisticsSnapshot({ year: 2024 });
  const all = await f.service.readStatisticsSnapshot({
    year: 2024,
    heatmapAggregation: 'all-time'
  });
  assert.equal(yearly.longestStreak, 1);
  assert.equal(all.longestStreak, 3);
  assert.equal(all.longestStreakStartDate, '2023-12-30');
  assert.match(all.daysRead, /^4 \/ 62 days/);
  assert.equal(all.days.length, 366);
  assert.ok(all.days.every((day) => day.date.startsWith('2024-')));
  assert.deepEqual(plain(all.longestStreakDates), ['2024-01-01']);
  assert.equal(all.days.find((day) => day.date === '2024-01-02').time, 0);
  assert.equal(all.goals.available, false);
  const previous = await f.service.readStatisticsSnapshot({
    year: 2023,
    heatmapAggregation: 'all-time'
  });
  assert.equal(previous.days.length, 365);
  assert.equal(previous.longestStreak, 3);
  assert.deepEqual(plain(previous.longestStreakDates), ['2023-12-30', '2023-12-31']);
  f.nativeDb.close();
});
