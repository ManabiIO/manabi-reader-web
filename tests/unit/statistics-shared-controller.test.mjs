/** @license BSD-3-Clause Copyright (c) 2026, ッツ Reader Authors. All rights reserved. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { fixture, nativeFixture, settle } from './fixtures/statistics-controller.mjs';

// Both route renderers consume these production effects/state modules. The legacy
// aggregation and transaction scenarios above intentionally remain unchanged.
const sharedQuery = (patch = {}) => ({
  startDate: '2024-01-01',
  endDate: '2024-12-31',
  year: 2024,
  goalYear: 2024,
  weekStartsOn: 1,
  rangeTemplate: 'Custom',
  confirmDeletion: true,
  aggregation: 'none',
  sort: 'time',
  direction: 'desc',
  timeSource: 'readingTime',
  charactersSource: 'charactersRead',
  speedSource: 'lastReadingSpeed',
  page: 1,
  pageSize: 25,
  prefilteredBookKeys: [],
  heatmapAggregation: 'year',
  goalHeatmapAggregation: 'year',
  ...patch
});
function sharedSnapshot(query = sharedQuery(), id = 'shared-snapshot') {
  return {
    snapshotId: id,
    query,
    today: '2024-02-29',
    books: [],
    titles: [],
    rows: [],
    totalRows: 0,
    pages: 1,
    totals: { time: 0, characters: 0, speed: 0, days: 0 },
    days: [],
    goalDays: [],
    daysRead: '',
    currentStreak: 0,
    currentStreakDates: [],
    longestStreak: 0,
    longestStreakStartDate: null,
    longestStreakDates: [],
    allTime: null,
    notices: []
  };
}
function sharedControllerFixture(overrides = {}) {
  const f = fixture();
  const listeners = new Set(),
    calls = [];
  const yes = { available: true };
  const port = {
    ownerKey: 'account-a',
    capabilities: {
      goals: yes,
      clipboard: yes,
      ttuExport: yes,
      rawRecovery: yes,
      globalDelete: yes,
      createDay: yes
    },
    initialQuery: () => sharedQuery(),
    initialView: 'summary',
    load: async (query) => {
      calls.push(['load', query]);
      return sharedSnapshot(query);
    },
    mutate: async (action) => {
      calls.push(['mutate', action]);
    },
    export: async () => {},
    copy: async () => {},
    subscribeInvalidation: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setProgress: (value, lease) => calls.push(['progress', value, lease]),
    ...overrides
  };
  const controller = f.load('features/statistics/controller.ts').createStatisticsController(port);
  return {
    ...f,
    port,
    controller,
    calls,
    invalidate: () => {
      for (const listener of listeners) listener();
    }
  };
}

test('shared controller snapshots stay stable until change and StrictMode remount discards an old response', async () => {
  const pending = [];
  const f = sharedControllerFixture({
    load: (query) => new Promise((resolve) => pending.push({ query, resolve }))
  });
  const first = f.controller.getSnapshot();
  assert.equal(first, f.controller.getSnapshot());
  const unmount = f.controller.mount();
  unmount();
  const stop = f.controller.mount();
  pending[0].resolve(sharedSnapshot(pending[0].query, 'retired'));
  await settle();
  assert.equal(f.controller.getSnapshot().data, undefined);
  pending[1].resolve(sharedSnapshot(pending[1].query, 'current'));
  await settle();
  assert.equal(f.controller.getSnapshot().data.snapshotId, 'current');
  const stable = f.controller.getSnapshot();
  await settle();
  assert.equal(f.controller.getSnapshot(), stable);
  stop();
});

test('shared controller owns draft/confirmation, blocks duplicate mutation and discards account ABA', async () => {
  let finish;
  const f = sharedControllerFixture({
    mutate: async (action) => {
      f.calls.push(['mutate', action]);
      await new Promise((resolve) => {
        finish = resolve;
      });
    }
  });
  const stop = f.controller.mount();
  await settle();
  await f.controller.dispatch({ type: 'delete-selection' });
  assert.ok(f.controller.getSnapshot().confirmation);
  assert.equal(f.controller.getSnapshot().busy, false);
  await f.controller.dispatch({ type: 'query', patch: { startDate: '2024-02-01' } });
  assert.equal(f.controller.getSnapshot().query.startDate, '2024-01-01');
  const confirm = f.controller.dispatch({ type: 'confirm', accept: true });
  await settle();
  await f.controller.dispatch({ type: 'confirm', accept: true });
  assert.equal(f.calls.filter(([kind]) => kind === 'mutate').length, 1);
  f.port.ownerKey = 'account-b';
  f.invalidate();
  f.port.ownerKey = 'account-a';
  finish();
  await confirm;
  assert.equal(f.controller.getSnapshot().data, undefined);
  assert.equal(f.controller.getSnapshot().confirmation, undefined);
  assert.equal(f.controller.getSnapshot().busy, false);
  stop();
});

test('shared controller retains title drafts through search and visibility preferences, then applies atomically', async () => {
  const f = sharedControllerFixture({
    load: async (query) => ({
      ...sharedSnapshot(query),
      titles: [
        { title: 'One', selected: true, inDateRange: true },
        { title: 'Two', selected: false, inDateRange: false }
      ]
    })
  });
  const stop = f.controller.mount();
  await settle();
  await f.controller.dispatch({ type: 'title-filter', open: true });
  await f.controller.dispatch({ type: 'title-toggle', title: 'Two' });
  await f.controller.dispatch({ type: 'title-search', value: 'One' });
  await f.controller.dispatch({ type: 'filter-preferences', patch: { dateOnly: true } });
  assert.deepEqual([...f.controller.getSnapshot().titleDraft], ['One', 'Two']);
  await f.controller.dispatch({ type: 'title-all', selected: false, titles: ['One'] });
  await f.controller.dispatch({ type: 'title-apply' });
  assert.deepEqual([...f.controller.getSnapshot().query.selectedTitles], ['Two']);
  stop();
});

test('production web port retains all history, identity filters, ten metrics, goal heatmaps and stored preferences', async () => {
  const f = fixture();
  f.db.getAllStatistics = async () => [
    f.row('Same', '2024-02-28', 60, 'local:one'),
    f.row('Same', '2024-02-29', 120, 'local:two'),
    f.row('Other', '2024-02-29', 30, 'local:other')
  ];
  const port = f.load('features/statistics/ports.web.ts').createWebStatisticsPort();
  const stop = port.subscribeInvalidation(() => {});
  const data = await port.load(
    sharedQuery({ prefilteredBookKeys: ['local:one'] }),
    new AbortController().signal
  );
  assert.equal(data.totalRows, 1);
  assert.equal(data.rows[0].entry.bookKey, 'local:one');
  assert.equal(Object.keys(data.rows[0].measurements).length, 10);
  assert.equal(data.days.length, 366);
  assert.equal(data.goalDays.length, 0);
  assert.equal(data.goalStats, undefined);
  port.persistQuery(
    sharedQuery({
      weekStartsOn: 3,
      timeSource: 'averageWeightedReadingTime',
      confirmDeletion: false
    })
  );
  assert.equal(f.store.lastStartDayOfWeek$.value, 3);
  assert.equal(f.store.lastReadingTimeDataSource$.value, 'averageWeightedReadingTime');
  assert.equal(f.store.confirmStatisticsDeletion$.value, false);
  port.persistFilterPreferences({ dateOnly: true, selectedOnly: true });
  assert.equal(f.store.lastStatisticsFilterDateRangeOnly$.value, true);
  stop();
  port.release();
});

test('production web port preserves selected copy logs, scoped deletion, full TTU exports and ambiguity refusal', async () => {
  const f = fixture(),
    saved = [],
    downloads = [];
  const rows = [
    f.row('One', '2024-02-28', 120, 'local:one'),
    f.row('Two', '2024-02-29', 60, 'local:two')
  ];
  f.db.getAllStatistics = async () => rows;
  f.db.getLastModifiedForType = async () => 42;
  f.mock['$lib/data/storage/storage-handler-factory'] = {
    getStorageHandler: () => ({
      clearData() {},
      startContext(value) {
        saved.push(['context', value]);
      },
      async saveStatistics(value, modified) {
        saved.push(['rows', value, modified]);
      },
      async createExportZip() {
        downloads.push(true);
      }
    })
  };
  const port = f.load('features/statistics/ports.web.ts').createWebStatisticsPort(),
    signal = new AbortController().signal;
  const data = await port.load(sharedQuery({ selectedTitles: ['One'] }), signal);
  await port.copy('readingTime', data.snapshotId, signal);
  assert.match(f.copied[0], /\.log readtime 2 One/);
  assert.doesNotMatch(f.copied[0], /Two/);
  await port.export('ttu', 'selection', data.snapshotId, signal);
  assert.equal(saved.filter(([type]) => type === 'rows').length, 1);
  saved.length = 0;
  await port.export('ttu', 'all', data.snapshotId, signal);
  assert.equal(saved.filter(([type]) => type === 'rows').length, 2);
  assert.equal(downloads.length, 2);
  await port.mutate({ type: 'delete', snapshotId: data.snapshotId, scope: 'selection' }, signal);
  assert.deepEqual(Array.from(f.deleted[0][4]), ['local:one']);
  f.db.getAllStatistics = async () => [
    f.row('Same', '2024-02-28', 60, 'local:one'),
    f.row('Same', '2024-02-29', 60, 'local:two')
  ];
  const ambiguous = await port.load(sharedQuery(), signal);
  await assert.rejects(
    port.export('ttu', 'all', ambiguous.snapshotId, signal),
    /cannot safely identify/
  );
  port.release();
});

test('production web port clears retired account history and never downloads a late raw recovery', async () => {
  let resolve;
  const f = fixture();
  const port = f.load('features/statistics/ports.web.ts').createWebStatisticsPort();
  let invalidated = false;
  const stop = port.subscribeInvalidation(() => {
    invalidated = true;
  });
  f.db.getAllStatistics = () =>
    new Promise((r) => {
      resolve = r;
    });
  const pending = port.load(sharedQuery(), new AbortController().signal);
  f.scopeAbort.abort();
  resolve([f.row('Other account', '2024-02-28')]);
  await assert.rejects(pending, /account_changed/);
  assert.equal(invalidated, true);
  stop();
  port.release();
});

test('statistics transfer pages bound actual UTF-8 bytes, refuse duplicates, wrong query/owner, expiry and incomplete assembly', () => {
  const f = fixture(),
    module = f.load('features/statistics/transport.ts');
  let time = 0,
    token = 0;
  const transfers = new module.StatisticsTransfers(
    () => time,
    () => `cursor-${++token}`,
    100
  );
  const expected = { snapshotId: 'projection', text: '😀\n"\\日本語'.repeat(9000) };
  let reply = transfers.begin('projection', 'owner', 'query', expected);
  const assembly = new module.StatisticsTransferAssembly();
  const firstCursor = reply.nextCursor;
  assert.throws(() => transfers.next(firstCursor, 'other', 'query'), /changed|expired/);
  assert.throws(() => transfers.next(firstCursor, 'owner', 'other-query'), /changed|expired/);
  let result;
  while (true) {
    assert.ok(Buffer.byteLength(JSON.stringify(reply)) < module.STATISTICS_REPLY_MAX_BYTES);
    result = assembly.append(reply);
    if (reply.complete) break;
    const cursor = reply.nextCursor;
    reply = transfers.next(cursor, 'owner', 'query');
    assert.throws(() => transfers.next(cursor, 'owner', 'query'), /changed|expired/);
  }
  assert.equal(result.text, expected.text);
  assert.throws(() => assembly.append(reply), /Incomplete/);
  reply = transfers.begin('projection', 'owner', 'query', expected);
  time = 101;
  assert.throws(() => transfers.next(reply.nextCursor, 'owner', 'query'), /changed|expired/);
  const incomplete = new module.StatisticsTransferAssembly();
  assert.throws(() => incomplete.append({ ...reply, sequence: 1 }), /Incomplete/);
  assert.throws(
    () =>
      new module.StatisticsTransferAssembly().append({
        ...reply,
        complete: true,
        nextCursor: undefined
      }),
    /Incomplete/
  );
  const cursors = [1, 2, 3].map(
    (n) => transfers.begin('projection', `owner-${n}`, 'query', expected).nextCursor
  );
  assert.throws(() => transfers.next(cursors[0], 'owner-1', 'query'), /expired/);
});

test('production bridge port follows all cursor pages and rejects a late account/route response', async () => {
  const f = fixture(),
    { StatisticsTransfers } = f.load('features/statistics/transport.ts');
  const { createNativeStatisticsPort } = f.load('features/statistics/native-port.ts');
  const transfers = new StatisticsTransfers();
  let owner = 'account-a',
    requests = 0;
  const data = { ...sharedSnapshot(), notices: ['long'.repeat(10000)] };
  const port = createNativeStatisticsPort({
    ownerKey: () => owner,
    command: async (_method, payload) => {
      requests++;
      return payload.cursor
        ? transfers.next(payload.cursor, owner, JSON.stringify(payload.query))
        : transfers.begin(data.snapshotId, owner, JSON.stringify(payload.query), data);
    }
  });
  const loaded = await port.load(sharedQuery(), new AbortController().signal);
  assert.ok(requests > 1);
  assert.equal(loaded.notices[0].length, 40000);
  owner = 'account-b';
  await assert.rejects(port.load(sharedQuery(), new AbortController().signal), /access changed/);
  assert.equal(port.capabilities.goals.available, false);
  assert.equal(port.capabilities.rawRecovery.available, false);
});

test('shared DOM-owner projection transports more than 200 choices and 10000 rows without truncation', async () => {
  const f = await nativeFixture();
  const tx = f.nativeDb.transaction(['data', 'readerBookScope', 'readerStatistic'], 'readwrite');
  let first;
  for (let id = 1; id <= 205; id++) {
    const book = {
      id,
      title: `Book ${id}`,
      contentHash: id.toString(16).padStart(64, '0'),
      libraryOwner: 'me',
      elementHtml: '<p>x</p>'
    };
    if (id === 1) first = book;
    await tx.objectStore('data').put(book);
    await tx.objectStore('readerBookScope').put({ bookId: id, accountId: 'me' });
  }
  for (let day = 0; day < 10005; day++) {
    const date = new Date(Date.UTC(1990, 0, day + 1)).toISOString().slice(0, 10);
    await tx
      .objectStore('readerStatistic')
      .put(f.row(first.title, date, 60, `content:${first.contentHash}`));
  }
  await tx.done;
  const owner = f.load('features/statistics/native-owner.dom.ts');
  const { StatisticsTransferAssembly } = f.load('features/statistics/transport.ts');
  const query = sharedQuery({ startDate: '1990-01-01', endDate: '2024-12-31' });
  const controller = new AbortController();
  const authority = {
    key: 'shared-owner',
    signal: controller.signal,
    assertCurrent() {
      controller.signal.throwIfAborted();
    }
  };
  const assembly = new StatisticsTransferAssembly();
  let cursor,
    result,
    pages = 0;
  do {
    const reply = await owner.readSharedStatisticsRequest(
      { sharedVersion: 1, query, ...(cursor ? { cursor } : {}) },
      authority
    );
    assert.ok(Buffer.byteLength(JSON.stringify(reply)) < 65536);
    pages++;
    result = assembly.append(reply);
    cursor = reply.nextCursor;
  } while (cursor);
  assert.ok(pages > 1);
  assert.equal(result.books.length, 205);
  assert.equal(result.totalRows, 10005);
  assert.equal(result.totals.time, 10005 * 60);
  assert.equal(result.rows.length, 25);
  assert.equal(result.pages, Math.ceil(10005 / 25));
  assert.equal(result.notices.length, 0);
  assert.equal(result.goalDays.length, 0);
  controller.abort();
  f.nativeDb.close();
});

test('shared DOM-owner continuations reject source replacement and never rerun legacy migration', async () => {
  const f = await nativeFixture();
  const book = await f.book(1, 'One', 'a');
  await f.history(book, '2024-02-29');
  const owner = f.load('features/statistics/native-owner.dom.ts');
  const authority = {
    key: 'source-change',
    signal: new AbortController().signal,
    assertCurrent() {}
  };
  const query = sharedQuery();
  const first = await owner.readSharedStatisticsRequest({ sharedVersion: 1, query }, authority);
  assert.ok(first.nextCursor);
  const receiptBefore = await f.nativeDb.getAll('readerStatisticMigration');
  await f.nativeDb.put('readerStatistic', {
    ...f.row(book.title, '2024-02-29', 300, `content:${book.contentHash}`),
    lastStatisticModified: 99
  });
  let cursor = first.nextCursor;
  await assert.rejects(async () => {
    while (cursor) {
      const reply = await owner.readSharedStatisticsRequest(
        { sharedVersion: 1, query, cursor },
        authority
      );
      cursor = reply.nextCursor;
    }
  }, /history changed/);
  assert.deepEqual(await f.nativeDb.getAll('readerStatisticMigration'), receiptBefore);
  f.nativeDb.close();
});

test('web port owner identity is immutable across preference/data generations and unique after replacement', async () => {
  const f = fixture(),
    { createWebStatisticsPort } = f.load('features/statistics/ports.web.ts');
  const a = createWebStatisticsPort(),
    key = a.ownerKey;
  const stop = a.subscribeInvalidation(() => {});
  await a.load(sharedQuery(), new AbortController().signal);
  a.persistQuery(sharedQuery({ page: 2 }));
  assert.equal(a.ownerKey, key);
  f.scopeAbort.abort();
  assert.equal(a.ownerKey, key);
  stop();
  a.release();
  assert.equal(a.ownerKey, key);
  assert.notEqual(createWebStatisticsPort().ownerKey, key);
  assert.equal(a.initialTheme.appearance, 'system');
});

test('shared controller preserves raw seconds, reverses custom bounds, and resets unavailable sort keys', async () => {
  const f = sharedControllerFixture();
  const stop = f.controller.mount();
  await settle();
  await f.controller.dispatch({ type: 'query', patch: { startDate: '2025-01-10' } });
  assert.equal(f.controller.getSnapshot().query.startDate, '2024-12-31');
  assert.equal(f.controller.getSnapshot().query.endDate, '2025-01-10');
  await f.controller.dispatch({ type: 'query', patch: { aggregation: 'title', sort: 'date' } });
  assert.equal(f.controller.getSnapshot().query.sort, 'time');
  stop();
});

test('shared projection memory admission fails explicitly rather than truncating', () => {
  const f = fixture(),
    m = f.load('features/statistics/transport.ts');
  const transfer = new m.StatisticsTransfers();
  assert.throws(
    () =>
      transfer.begin('oversized', 'owner', 'query', {
        text: 'x'.repeat(m.STATISTICS_TRANSFER_MAX_CHARACTERS + 1)
      }),
    /memory limit/
  );
  assert.throws(
    () =>
      new m.StatisticsTransferAssembly().append({
        sharedVersion: 1,
        snapshotId: 'oversized',
        sequence: 0,
        chunk: '',
        totalCharacters: m.STATISTICS_TRANSFER_MAX_CHARACTERS + 1,
        complete: false,
        nextCursor: 'cursor'
      }),
    /Incomplete/
  );
});

test('shared owner cancels transfers by their own request identity and never admits an incomplete mutation', async () => {
  const f = await nativeFixture();
  const book = await f.book(1, 'One', 'a');
  await f.history(book, '2024-02-29');
  const owner = f.load('features/statistics/native-owner.dom.ts');
  const authority = {
    key: 'cancel-owner',
    signal: new AbortController().signal,
    assertCurrent() {}
  };
  const query = sharedQuery();
  const first = await owner.readSharedStatisticsRequest(
    { sharedVersion: 1, query, requestId: 'first-request' },
    authority
  );
  await assert.rejects(
    owner.dispatchSharedStatisticsAction(
      {
        sharedVersion: 1,
        mutation: { type: 'delete', scope: 'selection', snapshotId: first.snapshotId }
      },
      authority
    ),
    /expired/
  );
  await owner.readSharedStatisticsRequest(
    { sharedVersion: 1, cancel: true, requestId: 'unrelated-request' },
    authority
  );
  const next = await owner.readSharedStatisticsRequest(
    { sharedVersion: 1, query, cursor: first.nextCursor, requestId: 'first-request' },
    authority
  );
  assert.equal(next.snapshotId, first.snapshotId);
  await owner.readSharedStatisticsRequest(
    { sharedVersion: 1, cancel: true, requestId: 'first-request' },
    authority
  );
  await assert.rejects(
    owner.readSharedStatisticsRequest(
      { sharedVersion: 1, query, cursor: next.nextCursor, requestId: 'first-request' },
      authority
    ),
    /changed|expired|cancelled/
  );
  assert.equal((await f.nativeDb.getAll('readerStatistic')).length, 1);
  f.nativeDb.close();
});

test('production web raw recovery downloads the complete JSON and discards a late retired export', async () => {
  let blob,
    clicked = 0,
    filename,
    pending;
  const f = fixture({
    document: {
      activeElement: null,
      body: { append() {} },
      createElement() {
        return {
          set download(value) {
            filename = value;
          },
          click() {
            clicked++;
          },
          remove() {}
        };
      }
    },
    URL: {
      createObjectURL(value) {
        blob = value;
        return 'blob:recovery';
      },
      revokeObjectURL() {}
    },
    setTimeout: (callback) => {
      callback();
      return 0;
    }
  });
  let snapshot = {
    legacy: [{ title: 'Unresolved', dateKey: '2001-01-01' }],
    content: [{ bookKey: 'local:one' }],
    migrations: []
  };
  f.mock['$lib/data/database/books-db/reader-statistics'] = {
    readStatisticsRecoverySnapshot: async () => (pending ? await pending : snapshot),
    titlesWithMultipleStatisticIdentities: () => []
  };
  const port = f.load('features/statistics/ports.web.ts').createWebStatisticsPort();
  const stop = port.subscribeInvalidation(() => {});
  const data = await port.load(sharedQuery(), new AbortController().signal);
  await port.export('raw', 'all', data.snapshotId, new AbortController().signal);
  assert.equal(clicked, 1);
  assert.match(filename, /^manabi-reader-statistics-recovery-.*\.json$/);
  assert.deepEqual(JSON.parse(await blob.text()), snapshot);
  let finish;
  pending = new Promise((resolve) => {
    finish = resolve;
  });
  const late = port.export('raw', 'all', data.snapshotId, new AbortController().signal);
  await settle();
  f.scopeAbort.abort();
  finish(snapshot);
  await assert.rejects(late, /account_changed/);
  assert.equal(clicked, 1);
  stop();
  port.release();
});

test('shared all-time streak navigation prefers the displayed year and supports goal current/completed ranges', async () => {
  const f = sharedControllerFixture({
    load: async (query) => ({
      ...sharedSnapshot(query),
      longestStreaks: [
        { startDate: '2020-01-01', endDate: '2020-01-03', duration: 3 },
        { startDate: '2024-01-01', endDate: '2024-01-03', duration: 3 }
      ],
      goalStats: {
        completed: '2',
        currentStreak: 2,
        longestStreak: 2,
        longestStreakStartDate: '2023-02-01',
        longestStreakDates: [],
        currentStreakDates: [],
        completedDates: [],
        currentStreakRange: { startDate: '2023-02-01', endDate: '2023-02-02', duration: 2 },
        completedStreaks: [{ startDate: '2022-03-01', endDate: '2022-03-02', duration: 2 }]
      }
    })
  });
  const stop = f.controller.mount();
  await settle();
  await f.controller.dispatch({
    type: 'query',
    patch: { heatmapAggregation: 'all-time', goalHeatmapAggregation: 'all-time' }
  });
  await f.controller.dispatch({ type: 'highlight', kind: 'longest', goal: false });
  assert.equal(f.controller.getSnapshot().query.year, 2024);
  await f.controller.dispatch({ type: 'highlight', kind: 'current', goal: true });
  assert.equal(f.controller.getSnapshot().query.goalYear, 2023);
  assert.equal(f.controller.getSnapshot().query.year, 2024);
  assert.equal(f.controller.getSnapshot().highlight.kind, 'longest');
  await f.controller.dispatch({ type: 'highlight', kind: 'completed', goal: true });
  assert.equal(f.controller.getSnapshot().query.goalYear, 2022);
  assert.equal(f.controller.getSnapshot().query.year, 2024);
  stop();
});

test('production native port cannot widen a Library route by dropping its selection token', async () => {
  const f = fixture();
  let calls = 0;
  const port = f.load('features/statistics/native-port.ts').createNativeStatisticsPort({
    ownerKey: () => 'bound-owner',
    selectionToken: 'original-selection',
    command: async () => {
      calls++;
    }
  });
  await assert.rejects(
    port.load(sharedQuery(), new AbortController().signal),
    /original Library selection/
  );
  assert.equal(calls, 0);
});

test('production shared native mutations consume exact completed proofs and retain same-title siblings', async () => {
  const f = await nativeFixture();
  const one = await f.book(1, 'Same', 'a'),
    two = await f.book(2, 'Same', 'b');
  await f.history(one, '2024-02-29', 60);
  await f.history(two, '2024-02-29', 120);
  const authority = {
    key: 'mutation-owner',
    signal: new AbortController().signal,
    assertCurrent() {}
  };
  const library = await f.service.readStatisticsSnapshot({}, authority, {
    bookId: one.id,
    title: one.title,
    contentHash: one.contentHash,
    lastBookModified: one.lastBookModified,
    readerBookKey: `content:${one.contentHash}`
  });
  const owner = f.load('features/statistics/native-owner.dom.ts'),
    { StatisticsTransferAssembly } = f.load('features/statistics/transport.ts');
  const query = sharedQuery({ selectionToken: library.query.selectionToken });
  const load = async () => {
    const assembly = new StatisticsTransferAssembly();
    let cursor, result;
    do {
      const reply = await owner.readSharedStatisticsRequest(
        { sharedVersion: 1, query, ...(cursor ? { cursor } : {}) },
        authority
      );
      result = assembly.append(reply);
      cursor = reply.nextCursor;
    } while (cursor);
    return result;
  };
  let snapshot = await load();
  assert.equal(snapshot.rows.length, 1);
  const mutation = {
    type: 'save-day',
    snapshotId: snapshot.snapshotId,
    entry: snapshot.rows[0].entry,
    time: 210,
    characters: 500,
    resetMinMax: true,
    mode: 'edit'
  };
  await owner.dispatchSharedStatisticsAction({ sharedVersion: 1, mutation }, authority);
  assert.equal(
    (await f.nativeDb.get('readerStatistic', [`content:${one.contentHash}`, '2024-02-29']))
      .readingTime,
    210
  );
  assert.equal(
    (await f.nativeDb.get('readerStatistic', [`content:${two.contentHash}`, '2024-02-29']))
      .readingTime,
    120
  );
  await assert.rejects(
    owner.dispatchSharedStatisticsAction({ sharedVersion: 1, mutation }, authority),
    /expired/
  );
  snapshot = await load();
  await owner.dispatchSharedStatisticsAction(
    {
      sharedVersion: 1,
      mutation: { type: 'delete', scope: 'selection', snapshotId: snapshot.snapshotId }
    },
    authority
  );
  assert.equal(
    await f.nativeDb.get('readerStatistic', [`content:${one.contentHash}`, '2024-02-29']),
    undefined
  );
  assert.ok(await f.nativeDb.get('readerStatistic', [`content:${two.contentHash}`, '2024-02-29']));
  f.nativeDb.close();
});

test('shared native bulk delete refuses an identity-key subset instead of widening to secondary history', async () => {
  const f = await nativeFixture();
  const book = await f.book(1, 'One', 'a');
  await f.history(book, '2024-02-29');
  await f.nativeDb.put('readerLocalIdentity', { bookId: 1, uuid: 'secondary-local-identity' });
  await f.nativeDb.put(
    'readerStatistic',
    f.row(book.title, '2024-02-29', 90, 'local:secondary-local-identity')
  );
  const owner = f.load('features/statistics/native-owner.dom.ts'),
    { StatisticsTransferAssembly } = f.load('features/statistics/transport.ts');
  const authority = {
    key: 'subset-owner',
    signal: new AbortController().signal,
    assertCurrent() {}
  };
  const query = sharedQuery({
    prefilteredBookKeys: [`content:${book.contentHash}`],
    aggregation: 'title'
  });
  const assembly = new StatisticsTransferAssembly();
  let cursor, snapshot;
  do {
    const reply = await owner.readSharedStatisticsRequest(
      { sharedVersion: 1, query, ...(cursor ? { cursor } : {}) },
      authority
    );
    snapshot = assembly.append(reply);
    cursor = reply.nextCursor;
  } while (cursor);
  assert.equal(snapshot.totals.time, 60);
  await assert.rejects(
    owner.dispatchSharedStatisticsAction(
      {
        sharedVersion: 1,
        mutation: { type: 'delete', scope: 'selection', snapshotId: snapshot.snapshotId }
      },
      authority
    ),
    /identity-key subset/
  );
  assert.equal((await f.nativeDb.getAll('readerStatistic')).length, 2);
  f.nativeDb.close();
});

test('production web individual legacy-row deletion never treats missing identity as a same-title wildcard', async () => {
  const f = fixture();
  f.db.getAllStatistics = async () => [
    f.row('Same', '2024-02-29', 60),
    f.row('Same', '2024-02-29', 90, 'local:sibling')
  ];
  const port = f.load('features/statistics/ports.web.ts').createWebStatisticsPort();
  const signal = new AbortController().signal;
  const snapshot = await port.load(sharedQuery(), signal);
  const legacy = snapshot.rows.find((row) => row.entry.bookKey === undefined);
  await port.mutate(
    { type: 'delete', snapshotId: snapshot.snapshotId, scope: 'selection', row: legacy },
    signal
  );
  assert.deepEqual(Array.from(f.deleted[0][0]), ['Same']);
  assert.deepEqual(Array.from(f.deleted[0][4]), []);
  port.release();
});

test('shared Custom template preserves the previously selected date range', async () => {
  const f = sharedControllerFixture();
  const stop = f.controller.mount();
  await settle();
  await f.controller.dispatch({ type: 'template', value: 'This Month' });
  const range = f.controller.getSnapshot().query;
  await f.controller.dispatch({ type: 'template', value: 'Custom' });
  assert.equal(f.controller.getSnapshot().query.startDate, range.startDate);
  assert.equal(f.controller.getSnapshot().query.endDate, range.endDate);
  stop();
});

test('shared native owner honours cancel-before-begin and rejects coercible enum/cancel payloads', async () => {
  const f = await nativeFixture();
  const owner = f.load('features/statistics/native-owner.dom.ts');
  const authority = {
    key: 'cancel-first-owner',
    signal: new AbortController().signal,
    assertCurrent() {}
  };
  await owner.readSharedStatisticsRequest(
    { sharedVersion: 1, cancel: true, requestId: 'cancelled-first' },
    authority
  );
  await assert.rejects(
    owner.readSharedStatisticsRequest(
      { sharedVersion: 1, query: sharedQuery(), requestId: 'cancelled-first' },
      authority
    ),
    /cancelled/
  );
  for (const requestId of ['', 'space invalid', 'x'.repeat(97), ['array']])
    await assert.rejects(
      owner.readSharedStatisticsRequest({ sharedVersion: 1, cancel: true, requestId }, authority),
      /Invalid/
    );
  for (const [key, value] of [
    ['rangeTemplate', ['Today']],
    ['goalHeatmapAggregation', ['year']],
    ['aggregation', ['none']],
    ['direction', ['asc']]
  ])
    await assert.rejects(
      owner.readSharedStatisticsRequest(
        { sharedVersion: 1, query: sharedQuery({ [key]: value }) },
        authority
      ),
      /Invalid/
    );
  f.nativeDb.close();
});

test('bounded cancellation ledger fails closed on saturation and respects the transfer lifetime', () => {
  const f = fixture(),
    { StatisticsCancellationLedger } = f.load('features/statistics/transport.ts');
  let now = 0;
  const ledger = new StatisticsCancellationLedger(() => now, 100, 2);
  ledger.cancel('one', 'a');
  ledger.cancel('one', 'b');
  ledger.cancel('two', 'c');
  for (const [owner, id] of [
    ['one', 'a'],
    ['one', 'b'],
    ['two', 'c'],
    ['third', 'new']
  ])
    assert.throws(() => ledger.assertNotCancelled(owner, id), /cancelled/);
  now = 101;
  assert.doesNotThrow(() => ledger.assertNotCancelled('one', 'a'));
});

test('production web reading and goal calendars keep independent years and actual goal presence', async () => {
  const f = fixture();
  f.db.getAllStatistics = async () => [
    f.row('One', '2024-02-28', 60),
    f.row('One', '2024-02-29', 60)
  ];
  f.db.getReadingGoals = async () => [
    {
      goalStartDate: '2024-02-28',
      goalEndDate: '',
      goalOriginalEndDate: '',
      timeGoal: 60,
      characterGoal: 120,
      goalFrequency: f.trackers.ReadingGoalFrequency.DAILY,
      lastGoalModified: 1
    }
  ];
  const port = f.load('features/statistics/ports.web.ts').createWebStatisticsPort();
  const snapshot = await port.load(
    sharedQuery({ year: 2023, goalYear: 2024 }),
    new AbortController().signal
  );
  assert.equal(snapshot.days[0].date, '2023-01-01');
  assert.equal(snapshot.goalDays[0].date, '2024-01-01');
  assert.ok(snapshot.goalStats);
  port.release();
});

test('legacy mutation protocol cannot consume shared proofs before or after final verification', async () => {
  const f = await nativeFixture();
  const book = await f.book(1, 'One', 'a');
  await f.history(book, '2024-02-29');
  const owner = f.load('features/statistics/native-owner.dom.ts');
  const authority = {
      key: 'protocol-owner',
      signal: new AbortController().signal,
      assertCurrent() {}
    },
    query = sharedQuery();
  let reply = await owner.readSharedStatisticsRequest({ sharedVersion: 1, query }, authority);
  const action = {
    type: 'delete-range',
    snapshotId: reply.snapshotId,
    bookIds: [1],
    startDate: '2024-01-01',
    endDate: '2024-12-31'
  };
  await assert.rejects(
    f.service.dispatchStatisticsAction(action, authority),
    /completed projection admission/
  );
  await assert.rejects(
    f.service.dispatchStatisticsAction(action, authority, {}),
    /completed projection admission/
  );
  while (!reply.complete)
    reply = await owner.readSharedStatisticsRequest(
      { sharedVersion: 1, query, cursor: reply.nextCursor },
      authority
    );
  await assert.rejects(
    f.service.dispatchStatisticsAction(action, authority),
    /completed projection admission/
  );
  await assert.rejects(
    f.service.dispatchStatisticsAction(action, authority, {}),
    /completed projection admission/
  );
  assert.equal((await f.nativeDb.getAll('readerStatistic')).length, 1);
  await owner.dispatchSharedStatisticsAction(
    {
      sharedVersion: 1,
      mutation: { type: 'delete', scope: 'selection', snapshotId: reply.snapshotId }
    },
    authority
  );
  assert.equal((await f.nativeDb.getAll('readerStatistic')).length, 0);
  f.nativeDb.close();
});

test('native owner bootstrap uses tracker-day and saved week-start while explicit later queries remain unchanged', async () => {
  const f = await nativeFixture();
  f.store.lastStatisticsRangeTemplate$.next('Today');
  f.store.startDayHoursForTracker$.next(23);
  f.store.lastStartDayOfWeek$.next(1);
  const owner = f.load('features/statistics/native-owner.dom.ts'),
    { StatisticsTransferAssembly } = f.load('features/statistics/transport.ts');
  const authority = {
    key: 'bootstrap-owner',
    signal: new AbortController().signal,
    assertCurrent() {}
  };
  const load = async (query, initialize) => {
    const assembly = new StatisticsTransferAssembly();
    let cursor, result;
    do {
      const reply = await owner.readSharedStatisticsRequest(
        {
          sharedVersion: 1,
          query,
          ...(initialize ? { initialize: true } : {}),
          ...(cursor ? { cursor } : {})
        },
        authority
      );
      result = assembly.append(reply);
      cursor = reply.nextCursor;
    } while (cursor);
    return result;
  };
  const initial = await load(
    sharedQuery({
      rangeTemplate: 'Today',
      weekStartsOn: 0,
      startDate: '2099-01-01',
      endDate: '2099-01-01'
    }),
    true
  );
  assert.equal(initial.query.startDate, initial.today);
  assert.equal(initial.query.endDate, initial.today);
  assert.equal(initial.query.weekStartsOn, 1);
  const explicit = await load(
    sharedQuery({
      startDate: '2020-01-01',
      endDate: '2020-12-31',
      year: 2020,
      goalYear: 2022,
      weekStartsOn: 4
    }),
    false
  );
  assert.equal(explicit.query.startDate, '2020-01-01');
  assert.equal(explicit.query.year, 2020);
  assert.equal(explicit.query.goalYear, 2022);
  assert.equal(explicit.query.weekStartsOn, 4);
  f.nativeDb.close();
});

test('transfer assembly rejects non-progress chunks and oversized protocol identities', () => {
  const f = fixture(),
    { StatisticsTransferAssembly } = f.load('features/statistics/transport.ts');
  const frame = {
    sharedVersion: 1,
    snapshotId: 'valid',
    sequence: 0,
    chunk: 'x',
    totalCharacters: 2,
    complete: false,
    nextCursor: 'cursor'
  };
  for (const patch of [
    { chunk: '' },
    { snapshotId: 'x'.repeat(97) },
    { nextCursor: 'x'.repeat(65) }
  ])
    assert.throws(
      () => new StatisticsTransferAssembly().append({ ...frame, ...patch }),
      /Incomplete/
    );
});

test('shared native selection/date deletion retains zero-only siblings and zero-only secondary identities', async () => {
  for (const aggregation of ['title', 'date']) {
    const f = await nativeFixture();
    const one = await f.book(1, 'Same', 'a'),
      sibling = await f.book(2, 'Same', 'b'),
      other = await f.book(3, 'Zero only', 'c');
    await f.history(one, '2024-02-29', 60);
    await f.history(sibling, '2024-02-29', 0);
    await f.history(other, '2024-02-29', 0);
    await f.nativeDb.put('readerLocalIdentity', { bookId: 1, uuid: 'secondary-zero' });
    await f.nativeDb.put(
      'readerStatistic',
      f.row(one.title, '2024-02-29', 0, 'local:secondary-zero')
    );
    await f.nativeDb.put('readerStatisticMigration', {
      title: one.title,
      state: 'assigned',
      bookKey: `content:${one.contentHash}`
    });
    const owner = f.load('features/statistics/native-owner.dom.ts'),
      { StatisticsTransferAssembly } = f.load('features/statistics/transport.ts');
    const authority = {
        key: `zero-owner-${aggregation}`,
        signal: new AbortController().signal,
        assertCurrent() {}
      },
      query = sharedQuery({ aggregation });
    const assembly = new StatisticsTransferAssembly();
    let cursor, snapshot;
    do {
      const reply = await owner.readSharedStatisticsRequest(
        { sharedVersion: 1, query, ...(cursor ? { cursor } : {}) },
        authority
      );
      snapshot = assembly.append(reply);
      cursor = reply.nextCursor;
    } while (cursor);
    assert.equal(JSON.stringify(snapshot).includes('sharedMutationTargets'), false);
    assert.deepEqual([...snapshot.selectionTitles], ['Same']);
    await owner.dispatchSharedStatisticsAction(
      {
        sharedVersion: 1,
        mutation: {
          type: 'delete',
          scope: 'selection',
          snapshotId: snapshot.snapshotId,
          ...(aggregation === 'date' ? { row: snapshot.rows[0] } : {})
        }
      },
      authority
    );
    const left = await f.nativeDb.getAll('readerStatistic');
    assert.equal(left.length, 3);
    assert.ok(left.some((row) => row.bookKey === `content:${sibling.contentHash}`));
    assert.ok(left.some((row) => row.bookKey === `content:${other.contentHash}`));
    assert.ok(left.some((row) => row.bookKey === 'local:secondary-zero'));
    f.nativeDb.close();
  }
});

test('shared default title selection excludes a zero-only title from native all-time bounds', async () => {
  const f = await nativeFixture();
  const one = await f.book(1, 'Reading', 'a'),
    other = await f.book(2, 'Zero only', 'b');
  await f.history(one, '2024-02-29', 60);
  await f.history(other, '2000-01-01', 0);
  const result = await f.service.readStatisticsSnapshot(
    { startDate: '2024-01-01', endDate: '2024-12-31', year: 2024 },
    undefined,
    undefined,
    { complete: true, pageSize: 25 }
  );
  assert.equal(result.allTime.startDate, '2024-02-29');
  assert.equal(result.allTime.endDate, '2024-02-29');
  f.nativeDb.close();
});

test('web date-row confirmation metadata lists only titles on that exact day', async () => {
  const f = fixture();
  f.db.getAllStatistics = async () => [
    f.row('First', '2024-02-28', 60),
    f.row('Second', '2024-02-29', 60)
  ];
  const port = f.load('features/statistics/ports.web.ts').createWebStatisticsPort();
  const snapshot = await port.load(
    sharedQuery({ aggregation: 'date' }),
    new AbortController().signal
  );
  assert.deepEqual(
    [...snapshot.rows.find((row) => row.date === '2024-02-28').affectedTitles],
    ['First']
  );
  port.release();
});

test('accepted query changes persist immediately and newer reads supersede older responses', async () => {
  const pending = [];
  const saved = [];
  const f = sharedControllerFixture({
    load: (query, signal) => new Promise((resolve) => pending.push({ query, signal, resolve })),
    persistQuery: (query) => saved.push({ ...query })
  });
  const stop = f.controller.mount();
  try {
    assert.equal(saved.length, 0, 'owner bootstrap is not overwritten before its read');
    pending[0].resolve(sharedSnapshot(pending[0].query));
    await settle();
    const first = f.controller.dispatch({ type: 'query', patch: { weekStartsOn: 2 } });
    assert.equal(saved.at(-1).weekStartsOn, 2, 'accepted field writes before asynchronous read');
    const second = f.controller.dispatch({ type: 'query', patch: { weekStartsOn: 3 } });
    assert.equal(pending[1].signal.aborted, true);
    assert.equal(saved.at(-1).weekStartsOn, 3);
    pending[2].resolve(sharedSnapshot(pending[2].query, 'newer'));
    await second;
    pending[1].resolve(sharedSnapshot(pending[1].query, 'obsolete'));
    await first;
    assert.equal(f.controller.getSnapshot().data.snapshotId, 'newer');
    assert.equal(f.controller.getSnapshot().query.weekStartsOn, 3);
    assert.equal(saved.at(-1).weekStartsOn, 3);
    const invalid = f.controller.dispatch({ type: 'query', patch: { weekStartsOn: 9 } });
    await invalid;
    assert.equal(saved.at(-1).weekStartsOn, 3);
    assert.equal(pending.length, 3);
  } finally {
    stop();
  }
});
