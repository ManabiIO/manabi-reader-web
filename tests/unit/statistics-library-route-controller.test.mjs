/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBDatabase } from 'fake-indexeddb';
import { nativeFixture, runtimeAuthority } from './fixtures/statistics-controller.mjs';

const libraryIdentity = (book, key = `content:${book.contentHash}`) => ({
  bookId: book.id,
  title: book.title,
  contentHash: book.contentHash,
  lastBookModified: book.lastBookModified,
  readerBookKey: key
});

test('Library statistics route resolves opaque admission then keeps every refresh scoped to its exact book', async () => {
  const f = await nativeFixture();
  const first = await f.book(1, 'Same title', 'a');
  const second = await f.book(2, 'Same title', 'b');
  await f.history(first, '2024-02-28', 60);
  await f.history(second, '2024-02-28', 900);
  const authority = runtimeAuthority();
  const requests = [];
  const route = f.load('statistics-react/native-route-dom.ts');
  const result = await route.readNativeStatisticsRequest(
    { librarySelection: { token: 'opaque-token', key: 'opaque-key' } },
    authority,
    {
      async admitAccess(payload, bound) {
        requests.push(payload);
        assert.equal(bound, authority);
        return [libraryIdentity(first)];
      }
    }
  );
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [
    { token: 'opaque-token', keys: ['opaque-key'], operation: 'open' }
  ]);
  assert.equal(result.books.length, 1);
  assert.equal(result.books[0].id, 1);
  assert.equal(result.totals.time, 60);
  const query = { selectionToken: result.query.selectionToken, year: 2024 };
  assert.ok(query.selectionToken);
  const next = await f.service.readStatisticsSnapshot(query, authority);
  assert.equal(next.totals.time, 60);
  assert.equal(next.books.length, 1);
  await assert.rejects(
    f.service.readStatisticsSnapshot({ ...query, bookIds: [2] }, authority),
    /invalid|expired/
  );
  const empty = await f.service.readStatisticsSnapshot(
    { ...query, bookSelection: 'selected', bookIds: [] },
    authority
  );
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.books.length, 1);
  const fresh = await f.service.readStatisticsSnapshot(query, authority);
  await f.service.dispatchStatisticsAction(
    {
      type: 'delete-book-history',
      snapshotId: fresh.snapshotId,
      bookId: 1,
      title: first.title,
      bookKey: libraryIdentity(first).readerBookKey
    },
    authority
  );
  const after = await f.service.readStatisticsSnapshot(query, authority);
  assert.equal(after.totals.time, 0);
  assert.equal((await f.nativeDb.getAll('readerStatistic')).length, 1);
  f.nativeDb.close();
});

test('Library statistics refuses malformed proof wrappers before admission and never substitutes raw route IDs', async () => {
  const f = await nativeFixture(),
    route = f.load('statistics-react/native-route-dom.ts');
  const authority = runtimeAuthority();
  let admitted = 0;
  for (const payload of [
    { librarySelection: null },
    { librarySelection: { token: 'x', key: 'y', id: 1 } },
    { librarySelection: { token: 'x', key: 'y' }, bookIds: [1] }
  ])
    await assert.rejects(
      route.readNativeStatisticsRequest(payload, authority, {
        async admitAccess() {
          admitted++;
          return [];
        }
      }),
      /Invalid/
    );
  assert.equal(admitted, 0);
  for (const selectionToken of ['missing-token', ['array'], 1, ' ', null])
    await assert.rejects(
      f.service.readStatisticsSnapshot({ selectionToken }, authority),
      /invalid|expired|Invalid/
    );
  for (const rawHint of [{ bookId: 1 }, { selection: 'missing-token' }, { title: 'Hint' }])
    await assert.rejects(f.service.readStatisticsSnapshot(rawHint, authority), /Invalid/);
  f.nativeDb.close();
});

test('Library statistics fails closed for initial and later content replacement or metadata modification', async () => {
  for (const change of ['content', 'metadata', 'owner', 'foreign-copy']) {
    const f = await nativeFixture(),
      book = await f.book(1, 'Original', 'a'),
      authority = runtimeAuthority();
    await f.history(book, '2024-02-28');
    const result = await f.service.readStatisticsSnapshot({}, authority, libraryIdentity(book));
    if (change === 'content')
      await f.nativeDb.put('data', { ...book, contentHash: 'b'.repeat(64) });
    if (change === 'metadata') await f.nativeDb.put('data', { ...book, lastBookModified: 999 });
    if (change === 'owner')
      await f.nativeDb.put('readerBookScope', { bookId: 1, accountId: 'other' });
    if (change === 'foreign-copy') await f.book(2, 'Foreign', 'a', 'other', 'other');
    await assert.rejects(
      f.service.readStatisticsSnapshot({ selectionToken: result.query.selectionToken }, authority)
    );
    await assert.rejects(
      f.service.dispatchStatisticsAction(
        {
          type: 'delete-book-history',
          snapshotId: result.snapshotId,
          bookId: 1,
          title: book.title,
          bookKey: libraryIdentity(book).readerBookKey
        },
        authority
      )
    );
    assert.equal((await f.nativeDb.getAll('readerStatistic')).length, 1);
    await assert.rejects(f.service.readStatisticsSnapshot({}, authority, libraryIdentity(book)));
    f.nativeDb.close();
  }
});

test('Library statistics accepts an existing legacy UUID and refuses same-ID hashless reimports', async () => {
  const f = await nativeFixture(),
    authority = runtimeAuthority();
  const book = { ...(await f.book(1, 'Hashless', 'a')), contentHash: undefined };
  await f.nativeDb.put('data', book);
  const uuid = '11111111-1111-4111-8111-111111111111';
  await f.nativeDb.put('readerLocalIdentity', { bookId: 1, uuid });
  await f.nativeDb.put('readerStatistic', f.row(book.title, '2024-02-28', 60, `local:${uuid}`));
  const result = await f.service.readStatisticsSnapshot(
    {},
    authority,
    libraryIdentity(book, `local:${uuid}`)
  );
  assert.equal(result.totals.time, 60);
  await f.nativeDb.put('readerLocalIdentity', {
    bookId: 1,
    uuid: '22222222-2222-4222-8222-222222222222'
  });
  await assert.rejects(
    f.service.readStatisticsSnapshot({ selectionToken: result.query.selectionToken }, authority),
    /changed|invalid|expired/
  );
  await assert.rejects(
    f.service.dispatchStatisticsAction(
      {
        type: 'delete-book-history',
        snapshotId: result.snapshotId,
        bookId: 1,
        title: book.title,
        bookKey: `local:${uuid}`
      },
      authority
    ),
    /changed/
  );
  assert.equal((await f.nativeDb.getAll('readerStatistic')).length, 1);
  f.nativeDb.close();
});

test('Library selection expiry, bounded eviction, runtime generation and abort cannot become all-books reads', async () => {
  const f = await nativeFixture(),
    book = await f.book(1, 'Bounded selection', 'a'),
    authority = runtimeAuthority();
  const first = await f.service.readStatisticsSnapshot({}, authority, libraryIdentity(book));
  for (let i = 0; i < 4; i++)
    await f.service.readStatisticsSnapshot({}, authority, libraryIdentity(book));
  await assert.rejects(
    f.service.readStatisticsSnapshot({ selectionToken: first.query.selectionToken }, authority),
    /invalid|expired/
  );
  const newest = await f.service.readStatisticsSnapshot({}, authority, libraryIdentity(book));
  await assert.rejects(
    f.service.readStatisticsSnapshot(
      { selectionToken: newest.query.selectionToken },
      runtimeAuthority('account-a:3')
    ),
    /invalid|expired/
  );
  const now = Date.now;
  try {
    const future = now() + 600001;
    Date.now = () => future;
    await assert.rejects(
      f.service.readStatisticsSnapshot({ selectionToken: newest.query.selectionToken }, authority),
      /invalid|expired/
    );
  } finally {
    Date.now = now;
  }
  const final = await f.service.readStatisticsSnapshot({}, authority, libraryIdentity(book));
  authority.controller.abort();
  await assert.rejects(
    f.service.readStatisticsSnapshot({ selectionToken: final.query.selectionToken }, authority)
  );
  f.nativeDb.close();
});

test('Library identity is rechecked inside the actual Statistics snapshot transaction', async () => {
  for (const change of ['content', 'uuid']) {
    const f = await nativeFixture(),
      authority = runtimeAuthority();
    const book = {
      ...(await f.book(1, 'Transaction race', 'a')),
      lastBookModified: 10,
      ...(change === 'uuid' ? { contentHash: undefined } : {})
    };
    await f.nativeDb.put('data', book);
    const uuid = '11111111-1111-4111-8111-111111111111';
    if (change === 'uuid') await f.nativeDb.put('readerLocalIdentity', { bookId: 1, uuid });
    const key = change === 'uuid' ? `local:${uuid}` : `content:${book.contentHash}`;
    await f.nativeDb.put('readerStatistic', f.row(book.title, '2024-02-28', 60, key));
    const original = IDBDatabase.prototype.transaction;
    let raced = false;
    IDBDatabase.prototype.transaction = function (names, mode, ...rest) {
      if (!raced && mode === 'readonly' && Array.from(names).includes('readerStatistic')) {
        raced = true;
        const write = original.call(
          this,
          change === 'uuid' ? ['readerLocalIdentity'] : ['data'],
          'readwrite'
        );
        if (change === 'uuid')
          write
            .objectStore('readerLocalIdentity')
            .put({ bookId: 1, uuid: '22222222-2222-4222-8222-222222222222' });
        else write.objectStore('data').put({ ...book, contentHash: 'b'.repeat(64) });
      }
      return original.call(this, names, mode, ...rest);
    };
    try {
      await assert.rejects(
        f.service.readStatisticsSnapshot({}, authority, libraryIdentity(book, key))
      );
    } finally {
      IDBDatabase.prototype.transaction = original;
    }
    assert.equal(raced, true);
    assert.equal((await f.nativeDb.getAll('readerStatistic')).length, 1);
    f.nativeDb.close();
  }
});

test('Library Statistics does not mint a missing legacy UUID and refuses ambiguous legacy deletion', async () => {
  const f = await nativeFixture(),
    authority = runtimeAuthority();
  const missing = { ...(await f.book(1, 'No UUID', 'a')), contentHash: undefined };
  await f.nativeDb.put('data', missing);
  await assert.rejects(
    f.service.readStatisticsSnapshot({}, authority, {
      ...libraryIdentity(missing),
      readerBookKey: undefined
    }),
    /original identity is unavailable/
  );
  assert.equal((await f.nativeDb.getAll('readerLocalIdentity')).length, 0);
  const first = await f.book(2, 'Ambiguous', 'b');
  await f.book(3, 'Ambiguous', 'c');
  await f.nativeDb.put('statistic', f.row(first.title, '2024-02-28', 60));
  const result = await f.service.readStatisticsSnapshot({}, authority, libraryIdentity(first));
  assert.equal(result.books[0].deletable, false);
  await assert.rejects(
    f.service.dispatchStatisticsAction(
      {
        type: 'delete-book-history',
        snapshotId: result.snapshotId,
        bookId: first.id,
        title: first.title,
        bookKey: libraryIdentity(first).readerBookKey
      },
      authority
    )
  );
  assert.equal((await f.nativeDb.getAll('statistic')).length, 1);
  f.nativeDb.close();
});

test('rejected Library legacy UUID admissions cannot migrate title rows or assign replacement ownership', async () => {
  for (const replacement of ['different', 'missing', 'transaction-race', 'transaction-deletion']) {
    const f = await nativeFixture(),
      authority = runtimeAuthority();
    const book = {
      ...(await f.book(1, 'Hashless raced', 'a')),
      contentHash: undefined,
      lastBookModified: 10
    };
    await f.nativeDb.put('data', book);
    const oldUuid = '11111111-1111-4111-8111-111111111111',
      newUuid = '22222222-2222-4222-8222-222222222222';
    await f.nativeDb.put('readerLocalIdentity', { bookId: 1, uuid: oldUuid });
    const admission = libraryIdentity(book, `local:${oldUuid}`);
    const legacy = f.row(book.title, '2024-02-28', 60);
    await f.nativeDb.put('statistic', legacy);
    if (replacement === 'different')
      await f.nativeDb.put('readerLocalIdentity', { bookId: 1, uuid: newUuid });
    if (replacement === 'missing') await f.nativeDb.delete('readerLocalIdentity', 1);
    const original = IDBDatabase.prototype.transaction;
    let raced = false;
    if (replacement.startsWith('transaction-'))
      IDBDatabase.prototype.transaction = function (names, mode, ...rest) {
        if (
          !raced &&
          mode === 'readwrite' &&
          Array.from(names).includes('readerStatisticMigration')
        ) {
          raced = true;
          const write = original.call(this, ['readerLocalIdentity'], 'readwrite');
          if (replacement === 'transaction-deletion')
            write.objectStore('readerLocalIdentity').delete(1);
          else write.objectStore('readerLocalIdentity').put({ bookId: 1, uuid: newUuid });
        }
        return original.call(this, names, mode, ...rest);
      };
    try {
      await assert.rejects(
        f.service.readStatisticsSnapshot({}, authority, admission),
        /changed|invalid|expired/
      );
    } finally {
      IDBDatabase.prototype.transaction = original;
    }
    assert.equal((await f.nativeDb.getAll('readerStatistic')).length, 0);
    assert.equal((await f.nativeDb.getAll('readerStatisticMigration')).length, 0);
    assert.equal((await f.nativeDb.getAll('lastModified')).length, 0);
    assert.deepEqual(await f.nativeDb.get('statistic', [book.title, '2024-02-28']), legacy);
    assert.equal(
      (await f.nativeDb.get('readerLocalIdentity', 1))?.uuid,
      replacement === 'missing' || replacement === 'transaction-deletion' ? undefined : newUuid
    );
    if (replacement.startsWith('transaction-')) assert.equal(raced, true);
    f.nativeDb.close();
  }
});

test('valid Library legacy admission keeps ordinary migration semantics', async () => {
  const f = await nativeFixture(),
    authority = runtimeAuthority();
  const book = {
    ...(await f.book(1, 'Stable legacy', 'a')),
    contentHash: undefined,
    lastBookModified: 10
  };
  await f.nativeDb.put('data', book);
  const uuid = '11111111-1111-4111-8111-111111111111';
  await f.nativeDb.put('readerLocalIdentity', { bookId: 1, uuid });
  await f.nativeDb.put('statistic', f.row(book.title, '2024-02-28', 60));
  const result = await f.service.readStatisticsSnapshot(
    {},
    authority,
    libraryIdentity(book, `local:${uuid}`)
  );
  assert.equal(result.totals.time, 60);
  assert.equal(result.books[0].deletable, true);
  assert.equal((await f.nativeDb.getAll('readerStatistic')).length, 1);
  assert.equal(
    (await f.nativeDb.get('readerStatisticMigration', book.title)).bookKey,
    `local:${uuid}`
  );
  assert.equal((await f.nativeDb.get('readerLocalIdentity', 1)).uuid, uuid);
  f.nativeDb.close();
});

test('Library Statistics accepts canonicalized casing of an existing valid content hash', async () => {
  const f = await nativeFixture(),
    authority = runtimeAuthority();
  const book = await f.book(1, 'Uppercase hash', 'A');
  const hash = book.contentHash.toLowerCase(),
    key = `content:${hash}`;
  await f.nativeDb.put('readerStatistic', f.row(book.title, '2024-02-28', 60, key));
  const result = await f.service.readStatisticsSnapshot({}, authority, {
    ...libraryIdentity(book, key),
    contentHash: hash
  });
  assert.equal(result.totals.time, 60);
  assert.equal(result.books[0].bookKey, key);
  const next = await f.service.readStatisticsSnapshot(
    { selectionToken: result.query.selectionToken },
    authority
  );
  assert.equal(next.totals.time, 60);
  await f.service.dispatchStatisticsAction(
    {
      type: 'delete-book-history',
      snapshotId: next.snapshotId,
      bookId: 1,
      title: book.title,
      bookKey: key
    },
    authority
  );
  assert.equal((await f.nativeDb.getAll('readerStatistic')).length, 0);
  f.nativeDb.close();
});
