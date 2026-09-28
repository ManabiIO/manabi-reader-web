/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

const { IDBObjectStore, DOMException } = globalThis;
const title = '日本語の本';
const bookKey = `content:${'a'.repeat(64)}`;
const otherKey = `content:${'b'.repeat(64)}`;
const stores = ['statistic', 'readerStatistic', 'lastModified', 'data', 'bookmark'];
const dates = ['2024-02-28', '2024-02-29', '2024-03-01', '2024-03-02'];
function equal(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
function assert(value, message) {
  if (!value) throw new Error(message);
}
async function rejects(work, name) {
  try {
    await work();
  } catch (error) {
    if (name) equal(error.name, name, 'Rejection type');
    return;
  }
  throw new Error('Operation unexpectedly succeeded');
}

export async function runCases({ DatabaseService, openDB, deleteDB }) {
  const results = [];
  async function run(name, work) {
    const databaseName = `statistics-deletion-${globalThis.crypto.randomUUID()}`;
    let db;
    const originalPut = IDBObjectStore.prototype.put;
    const originalDelete = IDBObjectStore.prototype.delete;
    try {
      db = await openDB(databaseName, 1, {
        upgrade(database) {
          database.createObjectStore('statistic', { keyPath: ['title', 'dateKey'] });
          database.createObjectStore('readerStatistic', { keyPath: ['bookKey', 'dateKey'] });
          const modified = database.createObjectStore('lastModified', {
            keyPath: ['title', 'dataType']
          });
          // Fault injection only: ordinary records do not use this index.
          modified.createIndex('fixtureUnique', 'fixtureUnique', { unique: true });
          database.createObjectStore('data', { keyPath: 'id' });
          database.createObjectStore('bookmark', { keyPath: 'dataId' });
        }
      });
      const seed = db.transaction(stores, 'readwrite');
      for (const dateKey of dates) {
        await seed.objectStore('statistic').put({ title, dateKey, readingTime: 60 });
        await seed.objectStore('readerStatistic').put({ bookKey, title, dateKey, readingTime: 60 });
      }
      await seed
        .objectStore('statistic')
        .put({ title: 'Other', dateKey: dates[1], readingTime: 90 });
      await seed.objectStore('readerStatistic').put({
        bookKey: otherKey,
        title,
        dateKey: dates[1],
        readingTime: 120
      });
      for (const identity of [title, bookKey, 'Other', otherKey])
        await seed.objectStore('lastModified').put({
          title: identity,
          dataType: 'statistic',
          lastModifiedValue: 100
        });
      await seed.objectStore('data').put({ id: 7, title, contentHash: 'a'.repeat(64) });
      await seed.objectStore('bookmark').put({ dataId: 7, exploredCharCount: 42 });
      await seed.done;
      const service = Object.create(DatabaseService.prototype);
      service.db = Promise.resolve(db);
      const snapshot = async () => {
        const tx = db.transaction(stores);
        const value = {};
        for (const store of stores) value[store] = await tx.objectStore(store).getAll();
        await tx.done;
        return value;
      };
      const before = await snapshot();
      await work({
        service,
        db,
        before,
        snapshot,
        databaseName,
        reopen: async () => {
          db.close();
          db = await openDB(databaseName, 1);
          return snapshot();
        }
      });
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, error: error.stack || String(error) });
    } finally {
      IDBObjectStore.prototype.put = originalPut;
      IDBObjectStore.prototype.delete = originalDelete;
      db?.close();
      await deleteDB(databaseName);
    }
  }
  const selectedDates = (snapshot, store, key, value) =>
    snapshot[store].filter((row) => row[key] === value).map((row) => row.dateKey);
  const marker = (snapshot, key) =>
    snapshot.lastModified.find((row) => row.title === key)?.lastModifiedValue;
  const unrelated = (snapshot) => ({
    data: snapshot.data,
    bookmark: snapshot.bookmark,
    legacy: snapshot.statistic.filter((row) => row.title === 'Other'),
    modern: snapshot.readerStatistic.filter((row) => row.bookKey === otherKey),
    markers: snapshot.lastModified.filter((row) => ['Other', otherKey].includes(row.title))
  });

  await run('invalid or reversed bounds never open a deletion transaction', async (h) => {
    let transactions = 0;
    h.service.db = Promise.resolve({
      transaction(...args) {
        transactions++;
        return h.db.transaction(...args);
      }
    });
    for (const [start, end] of [
      ['', dates[1]],
      [dates[1], ''],
      [dates[2], dates[1]],
      ['invalid', dates[1]],
      ['2024-02-30', dates[2]],
      ['2023-02-29', dates[2]],
      ['2024-2-01', dates[2]],
      [dates[1], '2024-13-01'],
      [null, dates[1]]
    ]) {
      await rejects(() => h.service.deleteStatisticEntries([title], false, start, end, [bookKey]));
      equal(await h.snapshot(), h.before, 'Invalid request must preserve all stores');
    }
    equal(transactions, 0, 'Validation must precede transaction admission');
  });
  await run('inclusive leap-day deletion survives connection reopening', async (h) => {
    await h.service.deleteStatisticEntries([title], false, dates[1], dates[2], [bookKey]);
    const after = await h.reopen();
    equal(selectedDates(after, 'statistic', 'title', title), [dates[0], dates[3]], 'Legacy dates');
    equal(
      selectedDates(after, 'readerStatistic', 'bookKey', bookKey),
      [dates[0], dates[3]],
      'Modern dates'
    );
    equal(unrelated(after), unrelated(h.before), 'Unrelated history and book state');
  });
  await run('a single selected day does not widen to its neighboring days', async (h) => {
    await h.service.deleteStatisticEntries([title], false, dates[1], dates[1], [bookKey]);
    const after = await h.snapshot();
    equal(
      selectedDates(after, 'statistic', 'title', title),
      [dates[0], dates[2], dates[3]],
      'Legacy dates'
    );
    equal(
      selectedDates(after, 'readerStatistic', 'bookKey', bookKey),
      [dates[0], dates[2], dates[3]],
      'Modern dates'
    );
  });
  await run('checked range deletion commits both modification markers', async (h) => {
    await h.service.deleteStatisticEntries([title], true, dates[1], dates[2], [bookKey]);
    const after = await h.snapshot();
    assert(marker(after, title) > 100 && marker(after, bookKey) > 100, 'Both markers must advance');
    equal(marker(after, title), marker(after, bookKey), 'One transaction timestamp');
    equal(unrelated(after), unrelated(h.before), 'Unrelated records');
  });
  await run('checked empty range leaves every record and marker intact', async (h) => {
    await h.service.deleteStatisticEntries([title], true, '2020-01-01', '2020-01-02', [bookKey]);
    equal(await h.snapshot(), h.before, 'Empty range');
  });
  await run('only explicit empty bounds delete the whole selected history', async (h) => {
    await h.service.deleteStatisticEntries([title], true, '', '', [bookKey]);
    const after = await h.snapshot();
    equal(selectedDates(after, 'statistic', 'title', title), [], 'Selected legacy history');
    equal(
      selectedDates(after, 'readerStatistic', 'bookKey', bookKey),
      [],
      'Selected modern history'
    );
    equal(unrelated(after), unrelated(h.before), 'Unselected histories and bookmarks');
  });
  await run('caller mutation while the database opens cannot retarget deletion', async (h) => {
    let resolve;
    h.service.db = new Promise((ready) => {
      resolve = ready;
    });
    const titles = [title],
      keys = [bookKey];
    const pending = h.service.deleteStatisticEntries(titles, false, dates[1], dates[2], keys);
    titles[0] = 'Other';
    keys[0] = otherKey;
    resolve(h.db);
    await pending;
    const after = await h.snapshot();
    equal(unrelated(after), unrelated(h.before), 'Later caller choices must not be used');
    equal(
      selectedDates(after, 'readerStatistic', 'bookKey', bookKey),
      [dates[0], dates[3]],
      'Original target'
    );
  });
  await run('marker admission failure rolls back previously deleted rows', async (h) => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'lastModified')
        throw new DOMException('Injected clone failure', 'DataCloneError');
      return put.apply(this, args);
    };
    await rejects(
      () => h.service.deleteStatisticEntries([title], false, dates[1], dates[2], [bookKey]),
      'DataCloneError'
    );
    equal(await h.snapshot(), h.before, 'Rows and markers roll back together');
  });
  await run('native request failure is observed and rolls back deletion', async (h) => {
    await h.db.put('lastModified', {
      title: 'constraint',
      dataType: 'statistic',
      fixtureUnique: 'occupied'
    });
    const before = await h.snapshot();
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...rest) {
      return put.call(
        this,
        this.name === 'lastModified' ? { ...value, fixtureUnique: 'occupied' } : value,
        ...rest
      );
    };
    await rejects(
      () => h.service.deleteStatisticEntries([title], false, dates[1], dates[2], [bookKey]),
      'ConstraintError'
    );
    equal(await h.snapshot(), before, 'Native automatic abort');
  });
  await run('abort after successful marker request rejects and restores history', async (h) => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args);
      if (this.name === 'lastModified' && args[0].title === bookKey)
        request.addEventListener('success', () => this.transaction.abort(), { once: true });
      return request;
    };
    await rejects(
      () => h.service.deleteStatisticEntries([title], false, dates[1], dates[2], [bookKey]),
      'AbortError'
    );
    equal(await h.snapshot(), h.before, 'Successful request is not successful commit');
  });
  await run('a later writer on another connection retains its new day', async (h) => {
    const second = await openDB(h.databaseName, 1);
    const remove = IDBObjectStore.prototype.delete;
    let later;
    try {
      IDBObjectStore.prototype.delete = function (...args) {
        const request = remove.apply(this, args);
        if (this.name === 'readerStatistic' && !later)
          later = second.put('readerStatistic', {
            bookKey,
            title,
            dateKey: dates[1],
            readingTime: 777
          });
        return request;
      };
      await h.service.deleteStatisticEntries([], false, dates[1], dates[2], [bookKey]);
      assert(later, 'Concurrent write was scheduled');
      await later;
      equal(
        (await h.db.get('readerStatistic', [bookKey, dates[1]])).readingTime,
        777,
        'Later serialized writer'
      );
      equal(
        await h.db.get('readerStatistic', [bookKey, dates[2]]),
        undefined,
        'Other selected day stays deleted'
      );
    } finally {
      if (later) await later.catch(() => {});
      second.close();
    }
  });
  await run('stored dates skipped by a local calendar are still deleted', async (h) => {
    const selected = ['2011-12-29', '2011-12-30', '2011-12-31'];
    for (const dateKey of selected)
      await h.db.put('readerStatistic', { bookKey, title, dateKey, readingTime: 60 });
    await h.service.deleteStatisticEntries([], false, selected[0], selected[2], [bookKey]);
    equal(
      selectedDates(await h.snapshot(), 'readerStatistic', 'bookKey', bookKey),
      dates,
      'Stored calendar keys'
    );
  });
  await run('duplicate targets issue only one range delete per store', async (h) => {
    const remove = IDBObjectStore.prototype.delete;
    let calls = 0;
    IDBObjectStore.prototype.delete = function (...args) {
      if (['statistic', 'readerStatistic'].includes(this.name)) calls++;
      return remove.apply(this, args);
    };
    await h.service.deleteStatisticEntries([title, title], false, '2024-01-01', '2024-12-31', [
      bookKey,
      bookKey
    ]);
    equal(calls, 2, 'Two identities, not a request for each calendar day');
    equal(unrelated(await h.snapshot()), unrelated(h.before), 'Unrelated records');
  });
  await run(
    'identical key text in different stores does not share existence decisions',
    async (h) => {
      await h.db.put('statistic', { title: bookKey, dateKey: '2020-01-01', readingTime: 30 });
      const before = await h.snapshot();
      await h.service.deleteStatisticEntries([bookKey], true, dates[1], dates[2], [bookKey]);
      const after = await h.snapshot();
      equal(after.statistic, before.statistic, 'No matching legacy date');
      equal(
        selectedDates(after, 'readerStatistic', 'bookKey', bookKey),
        [dates[0], dates[3]],
        'Matching modern range'
      );
      assert(marker(after, bookKey) > 100, 'Modern deletion publishes its marker');
    }
  );
  return {
    results,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length
  };
}
