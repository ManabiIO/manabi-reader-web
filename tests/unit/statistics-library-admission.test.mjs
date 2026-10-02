/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { IDBDatabase } from 'fake-indexeddb';
import { nativeFixture, runtimeAuthority } from './fixtures/statistics-controller.mjs';

const identity = (book, readerBookKey = `content:${book.contentHash.toLowerCase()}`) => ({
  bookId: book.id,
  title: book.title,
  contentHash: book.contentHash,
  lastBookModified: book.lastBookModified,
  readerBookKey
});
const payload = {
  admissionVersion: 1,
  librarySelection: { token: 'library-token', key: 'library-row' }
};
const queryFor = (selectionToken) => ({
  selectionToken,
  startDate: '1990-01-01',
  endDate: '2024-12-31',
  year: 2024,
  goalYear: 2024,
  weekStartsOn: 1,
  rangeTemplate: 'Custom',
  confirmDeletion: true,
  aggregation: 'none',
  sort: 'date',
  direction: 'asc',
  timeSource: 'readingTime',
  charactersSource: 'charactersRead',
  speedSource: 'lastReadingSpeed',
  page: 1,
  pageSize: 25,
  prefilteredBookKeys: [],
  heatmapAggregation: 'year',
  goalHeatmapAggregation: 'year'
});

test('bounded Library Open admits over10000 rows without reading history or granting a mutation proof', async () => {
  const f = await nativeFixture(),
    book = await f.book(1, 'Long history', 'a');
  const tx = f.nativeDb.transaction('readerStatistic', 'readwrite');
  for (let index = 0; index < 10005; index++)
    await tx.store.put(
      f.row(
        book.title,
        new Date(Date.UTC(1990, 0, index + 1)).toISOString().slice(0, 10),
        60,
        `content:${book.contentHash}`
      )
    );
  await tx.done;
  const route = f.load('statistics-react/native-route-dom.ts'),
    authority = runtimeAuthority();
  const seen = [],
    original = IDBDatabase.prototype.transaction;
  let admission;
  try {
    IDBDatabase.prototype.transaction = function (names, mode, ...rest) {
      seen.push({ names: Array.from(typeof names === 'string' ? [names] : names), mode });
      return original.call(this, names, mode, ...rest);
    };
    admission = await route.readNativeStatisticsRequest(payload, authority, {
      admitAccess: async () => [identity(book)]
    });
  } finally {
    IDBDatabase.prototype.transaction = original;
  }
  assert.deepEqual(Object.keys(admission).sort(), ['admissionVersion', 'bookId', 'selectionToken']);
  assert.ok(Buffer.byteLength(JSON.stringify(admission)) < 256);
  assert.ok(seen.length > 0);
  assert.ok(
    seen.every(
      (tx) =>
        tx.mode === 'readonly' &&
        tx.names.every((name) => ['data', 'readerBookScope', 'readerLocalIdentity'].includes(name))
    )
  );
  await assert.rejects(
    f.service.dispatchStatisticsAction(
      {
        type: 'delete-book-history',
        snapshotId: admission.selectionToken,
        bookId: book.id,
        title: book.title,
        bookKey: `content:${book.contentHash}`
      },
      authority
    ),
    /expired|changed accounts/
  );
  const owner = f.load('features/statistics/native-owner.dom.ts'),
    { StatisticsTransferAssembly } = f.load('features/statistics/transport.ts');
  const query = queryFor(admission.selectionToken),
    assembly = new StatisticsTransferAssembly();
  let cursor, result;
  do {
    const reply = await owner.readSharedStatisticsRequest(
      { sharedVersion: 1, query, ...(cursor ? { cursor } : {}) },
      authority
    );
    result = assembly.append(reply);
    cursor = reply.nextCursor;
  } while (cursor);
  assert.equal(result.books.length, 1);
  assert.equal(result.totalRows, 10005);
  assert.equal(result.totals.time, 10005 * 60);
  assert.equal(result.rows.length, 25);
  f.nativeDb.close();
});

test('admission-only Library Open rejects malformed versions/wrappers before Library access', async () => {
  const f = await nativeFixture(),
    route = f.load('statistics-react/native-route-dom.ts'),
    authority = runtimeAuthority();
  let calls = 0;
  const library = {
    admitAccess: async () => {
      calls++;
      return [];
    }
  };
  for (const request of [
    { admissionVersion: 2, librarySelection: payload.librarySelection },
    { admissionVersion: 1 },
    { ...payload, mode: 'snapshot' },
    { ...payload, librarySelection: { ...payload.librarySelection, bookId: 1 } },
    { ...payload, librarySelection: { token: ['token'], key: 'key' } },
    { ...payload, librarySelection: { token: 'token', key: '' } },
    { ...payload, librarySelection: { token: 'x'.repeat(129), key: 'key' } }
  ])
    await assert.rejects(route.readNativeStatisticsRequest(request, authority, library), /Invalid/);
  assert.equal(calls, 0);
  f.nativeDb.close();
});

test('admission-only Library Open fences replacements both before admission and before shared history read', async () => {
  const f = await nativeFixture(),
    book = await f.book(1, 'Original', 'a');
  await f.history(book, '2024-02-29');
  const route = f.load('statistics-react/native-route-dom.ts'),
    authority = runtimeAuthority(),
    expected = identity(book);
  await f.nativeDb.put('data', { ...book, contentHash: 'b'.repeat(64) });
  await assert.rejects(
    route.readNativeStatisticsRequest(payload, authority, { admitAccess: async () => [expected] }),
    /changed|identity/
  );
  assert.equal((await f.nativeDb.getAll('readerStatisticMigration')).length, 0);
  await f.nativeDb.put('data', book);
  const admitted = await route.readNativeStatisticsRequest(payload, authority, {
    admitAccess: async () => [expected]
  });
  await f.nativeDb.put('data', { ...book, title: 'Replacement' });
  const owner = f.load('features/statistics/native-owner.dom.ts');
  await assert.rejects(
    owner.readSharedStatisticsRequest(
      { sharedVersion: 1, query: queryFor(admitted.selectionToken) },
      authority
    ),
    /changed|identity|selection/
  );
  assert.equal((await f.nativeDb.getAll('readerStatisticMigration')).length, 0);
  assert.equal((await f.nativeDb.getAll('readerStatistic')).length, 1);
  f.nativeDb.close();
});

test('admission-only tokens cannot survive runtime/account ABA or foreign shared-copy claims', async () => {
  const f = await nativeFixture(),
    book = await f.book(1, 'Book', 'a');
  const route = f.load('statistics-react/native-route-dom.ts'),
    authority = runtimeAuthority();
  const admitted = await route.readNativeStatisticsRequest(payload, authority, {
    admitAccess: async () => [identity(book)]
  });
  authority.controller.abort();
  const owner = f.load('features/statistics/native-owner.dom.ts');
  await assert.rejects(
    owner.readSharedStatisticsRequest(
      { sharedVersion: 1, query: queryFor(admitted.selectionToken) },
      runtimeAuthority(authority.key)
    ),
    /abort|changed|expired/i
  );
  await f.book(2, 'Other owner', 'a', 'other', 'other');
  await assert.rejects(
    route.readNativeStatisticsRequest(payload, runtimeAuthority(), {
      admitAccess: async () => [identity(book)]
    }),
    /profile|ownership|account/
  );
  f.nativeDb.close();
});

test('admission-only legacy identities require the original existing UUID and never mint one', async () => {
  const f = await nativeFixture(),
    book = await f.book(1, 'Legacy', '');
  const uuid = 'a1234567-1234-1234-1234-123456789abc',
    expected = identity(book, `local:${uuid}`),
    route = f.load('statistics-react/native-route-dom.ts'),
    authority = runtimeAuthority();
  await assert.rejects(
    route.readNativeStatisticsRequest(payload, authority, { admitAccess: async () => [expected] }),
    /changed|identity/
  );
  assert.equal((await f.nativeDb.getAll('readerLocalIdentity')).length, 0);
  await f.nativeDb.put('readerLocalIdentity', {
    bookId: 1,
    uuid: 'b1234567-1234-1234-1234-123456789abc'
  });
  await assert.rejects(
    route.readNativeStatisticsRequest(payload, authority, { admitAccess: async () => [expected] }),
    /changed|identity/
  );
  await f.nativeDb.put('readerLocalIdentity', { bookId: 1, uuid });
  const admitted = await route.readNativeStatisticsRequest(payload, authority, {
    admitAccess: async () => [expected]
  });
  assert.equal(admitted.bookId, 1);
  assert.equal((await f.nativeDb.getAll('readerStatisticMigration')).length, 0);
  assert.equal((await f.nativeDb.getAll('readerStatistic')).length, 0);
  f.nativeDb.close();
});
