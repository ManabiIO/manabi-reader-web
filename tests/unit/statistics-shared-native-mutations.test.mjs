/** @license BSD-3-Clause Copyright (c) 2026, ッツ Reader Authors. All rights reserved. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeFixture, runtimeAuthority } from './fixtures/statistics-controller.mjs';

const query = {
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
  goalHeatmapAggregation: 'year'
};
async function sharedFixture(t, title = 'Fractional day') {
  const f = await nativeFixture();
  t.after(() => f.nativeDb.close());
  const book = await f.book(1, title, 'a');
  const original = await f.history(book, '2024-02-29', 60.125);
  const authority = runtimeAuthority('shared-native-edit-owner');
  const owner = f.load('features/statistics/native-owner.dom.ts');
  const { StatisticsTransferAssembly } = f.load('features/statistics/transport.ts');
  return {
    ...f,
    seededBook: book,
    original,
    owner,
    authority,
    stored: () => f.nativeDb.get('readerStatistic', [original.bookKey, original.dateKey]),
    async readSnapshot() {
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
      return snapshot;
    },
    save(snapshot, patch = {}) {
      const row = snapshot.rows.find((row) => row.entry?.bookId === book.id);
      assert.ok(row?.entry, 'seeded reading day must be editable in the snapshot');
      return owner.dispatchSharedStatisticsAction(
        {
          sharedVersion: 1,
          mutation: {
            type: 'save-day',
            snapshotId: snapshot.snapshotId,
            entry: row.entry,
            time: row.time,
            characters: row.characters,
            mode: 'edit',
            resetMinMax: false,
            ...patch
          }
        },
        authority
      );
    }
  };
}

async function mountSharedController(t, f) {
  const commands = [];
  const { createNativeStatisticsPort } = f.load('features/statistics/native-port.ts');
  const port = createNativeStatisticsPort({
    ownerKey: () => f.authority.key,
    command(method, payload) {
      commands.push({ method, payload });
      return method === 'statistics.read'
        ? f.owner.readSharedStatisticsRequest(payload, f.authority)
        : f.owner.dispatchSharedStatisticsAction(payload, f.authority);
    }
  });
  const controller = f.load('features/statistics/controller.ts').createStatisticsController(port);
  const loaded = new Promise((resolve) => {
    const unsubscribe = controller.subscribe(() => {
      const state = controller.getSnapshot();
      if (!state.busy && (state.data || state.error)) {
        unsubscribe();
        resolve(state);
      }
    });
  });
  t.after(controller.mount());
  const initial = await loaded;
  assert.equal(initial.error, '');
  assert.ok(initial.data);
  return {
    controller,
    initial,
    commands,
    mutations: () => commands.filter(({ method }) => method === 'statistics.action')
  };
}

test('production shared controller and native port preserve fractional seconds when only characters change', async (t) => {
  const f = await sharedFixture(t);
  const { controller, initial, mutations, commands } = await mountSharedController(t, f);
  await controller.dispatch({ type: 'edit', row: initial.data.rows[0] });
  assert.equal(controller.getSnapshot().editor.time, '60.125');
  await controller.dispatch({ type: 'editor', patch: { characters: '451.75' } });
  await controller.dispatch({ type: 'save-editor' });
  assert.ok(controller.getSnapshot().confirmation);
  await controller.dispatch({ type: 'confirm', accept: true });
  assert.equal(controller.getSnapshot().error, '');
  const saved = await f.stored();
  assert.equal(saved.readingTime, 60.125);
  assert.equal(saved.charactersRead, 451.75);
  assert.equal(saved.lastReadingSpeed, Math.ceil((451.75 * 3600) / 60.125));
  assert.equal(mutations().length, 1);
  assert.equal(mutations()[0].payload.mutation.time, 60.125);
  assert.equal(mutations()[0].payload.mutation.characters, 451.75);
  assert.equal(controller.getSnapshot().busy, false);
  assert.equal(controller.getSnapshot().editor, undefined);
  assert.notEqual(controller.getSnapshot().data.snapshotId, initial.data.snapshotId);
  assert.equal(controller.getSnapshot().data.rows[0].characters, 451.75);
  const reads = commands.filter(
    ({ method, payload }) => method === 'statistics.read' && !payload.cancel
  );
  assert.ok(reads.some(({ payload }) => payload.initialize === true));
  assert.ok(reads.some(({ payload }) => payload.initialize === undefined));
});

test('production shared controller cancellation does not mutate and a fresh confirmation saves exact values', async (t) => {
  const f = await sharedFixture(t);
  const { controller, initial, mutations } = await mountSharedController(t, f);
  await controller.dispatch({ type: 'edit', row: initial.data.rows[0] });
  await controller.dispatch({
    type: 'editor',
    patch: { time: '86400.5', characters: '100000000.25', resetMinMax: true }
  });
  await controller.dispatch({ type: 'save-editor' });
  assert.ok(controller.getSnapshot().confirmation);
  assert.equal(mutations().length, 0);
  assert.deepEqual(await f.stored(), f.original);
  await controller.dispatch({ type: 'confirm', accept: false });
  assert.equal(controller.getSnapshot().confirmation, undefined);
  assert.equal(controller.getSnapshot().busy, false);
  assert.ok(controller.getSnapshot().editor);
  assert.equal(mutations().length, 0);
  assert.equal((await f.nativeDb.getAll('lastModified')).length, 0);
  await controller.dispatch({ type: 'save-editor' });
  assert.ok(controller.getSnapshot().confirmation, 'cancel must release the global action lease');
  await controller.dispatch({ type: 'confirm', accept: true });
  assert.equal(controller.getSnapshot().error, '');
  assert.equal(controller.getSnapshot().editor, undefined);
  assert.equal(mutations().length, 1);
  const saved = await f.stored();
  assert.equal(saved.readingTime, 86400.5);
  assert.equal(saved.charactersRead, 100000000.25);
  const speed = Math.ceil((100000000.25 * 3600) / 86400.5);
  for (const key of [
    'lastReadingSpeed',
    'minReadingSpeed',
    'altMinReadingSpeed',
    'maxReadingSpeed'
  ])
    assert.equal(saved[key], speed);
  assert.equal(controller.getSnapshot().data.rows[0].time, saved.readingTime);
  assert.equal(controller.getSnapshot().data.rows[0].characters, saved.charactersRead);
});

test('production shared controller surfaces native validation failures atomically and can retry after refresh', async (t) => {
  const f = await sharedFixture(t);
  const { controller, initial, mutations } = await mountSharedController(t, f);
  await controller.dispatch({ type: 'edit', row: initial.data.rows[0] });
  for (const patch of [
    { time: '' },
    { time: '-1' },
    { characters: 'not a number' },
    { date: '2024-02-30' }
  ]) {
    await controller.dispatch({
      type: 'editor',
      patch: { time: '60.125', characters: '120.25', date: '2024-02-29', ...patch }
    });
    await controller.dispatch({ type: 'save-editor' });
    assert.ok(controller.getSnapshot().error);
    assert.equal(controller.getSnapshot().confirmation, undefined);
    assert.equal(mutations().length, 0);
  }
  await controller.dispatch({
    type: 'editor',
    patch: { time: '0.000001', characters: '100000000', date: '2024-02-29' }
  });
  await controller.dispatch({ type: 'save-editor' });
  assert.ok(controller.getSnapshot().confirmation);
  await controller.dispatch({ type: 'confirm', accept: true });
  assert.match(controller.getSnapshot().error, /Invalid statistics action/);
  assert.equal(controller.getSnapshot().busy, false);
  assert.equal(controller.getSnapshot().confirmation, undefined);
  assert.equal(mutations().length, 1);
  assert.deepEqual(await f.stored(), f.original);
  assert.equal((await f.nativeDb.getAll('lastModified')).length, 0);
  await controller.dispatch({ type: 'refresh' });
  assert.equal(controller.getSnapshot().error, '');
  await controller.dispatch({ type: 'edit', row: controller.getSnapshot().data.rows[0] });
  await controller.dispatch({ type: 'editor', patch: { time: '1.5', characters: '2.25' } });
  await controller.dispatch({ type: 'save-editor' });
  assert.ok(controller.getSnapshot().confirmation, 'failed saves must release the action lease');
  await controller.dispatch({ type: 'confirm', accept: true });
  assert.equal(controller.getSnapshot().error, '');
  assert.equal(mutations().length, 2);
  assert.equal((await f.stored()).readingTime, 1.5);
  assert.equal((await f.stored()).charactersRead, 2.25);
});

test('production shared controller creates and deletes a fractional long-title day without changing its sibling', async (t) => {
  const f = await sharedFixture(t, '題📚'.repeat(300));
  const sibling = await f.book(2, f.seededBook.title, 'b');
  const siblingRow = await f.history(sibling, '2024-03-01', 120.25);
  f.store.confirmStatisticsDeletion$.next(true);
  const { controller, initial, mutations } = await mountSharedController(t, f);
  const book = initial.data.books.find((book) => book.id === f.seededBook.id);
  assert.equal(book.title, f.seededBook.title);
  assert.equal(book.deletable, true);
  await controller.dispatch({ type: 'create-day', book });
  assert.equal(controller.getSnapshot().editor.mode, 'create');
  await controller.dispatch({
    type: 'editor',
    patch: { date: '2024-03-01', time: '90000.5', characters: '100000000.5', resetMinMax: true }
  });
  await controller.dispatch({ type: 'save-editor' });
  assert.ok(controller.getSnapshot().confirmation);
  await controller.dispatch({ type: 'confirm', accept: true });
  assert.equal(controller.getSnapshot().error, '');
  const createdKey = [f.original.bookKey, '2024-03-01'];
  const created = await f.nativeDb.get('readerStatistic', createdKey);
  assert.equal(created.title, f.seededBook.title);
  assert.equal(created.readingTime, 90000.5);
  assert.equal(created.charactersRead, 100000000.5);
  const row = controller
    .getSnapshot()
    .data.rows.find((row) => row.entry?.bookId === f.seededBook.id && row.date === '2024-03-01');
  assert.ok(row?.entry);
  await controller.dispatch({ type: 'delete-row', row });
  assert.ok(controller.getSnapshot().confirmation);
  assert.deepEqual(await f.nativeDb.get('readerStatistic', createdKey), created);
  await controller.dispatch({ type: 'confirm', accept: false });
  assert.equal(mutations().length, 1);
  await controller.dispatch({ type: 'delete-row', row });
  assert.ok(controller.getSnapshot().confirmation);
  await controller.dispatch({ type: 'confirm', accept: true });
  assert.equal(controller.getSnapshot().error, '');
  assert.equal(await f.nativeDb.get('readerStatistic', createdKey), undefined);
  assert.deepEqual(await f.stored(), f.original);
  assert.deepEqual(
    await f.nativeDb.get('readerStatistic', [siblingRow.bookKey, siblingRow.dateKey]),
    siblingRow
  );
  assert.deepEqual(
    mutations().map(({ payload }) => payload.mutation.type),
    ['save-day', 'delete']
  );
  assert.equal(controller.getSnapshot().data.rows.length, 2);
});

test('shared native edits accept fractional values, former product limits, and safe numeric boundaries', async (t) => {
  for (const [time, characters] of [
    [1.5, 2.25],
    [86400.5, 100000000.25],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    [0, Number.MAX_SAFE_INTEGER],
    [Number.MIN_VALUE, 0]
  ]) {
    await t.test(`time=${time}, characters=${characters}`, async (t) => {
      // Zero-time days are intentionally omitted from the shared Svelte-compatible
      // projection, so every independent boundary starts from a fresh visible row.
      const f = await sharedFixture(t);
      await f.save(await f.readSnapshot(), { time, characters, resetMinMax: true });
      const saved = await f.stored();
      assert.equal(saved.readingTime, time);
      assert.equal(saved.charactersRead, characters);
      const speed = time ? Math.ceil((characters * 3600) / time) : 0;
      for (const key of [
        'lastReadingSpeed',
        'minReadingSpeed',
        'altMinReadingSpeed',
        'maxReadingSpeed'
      ])
        assert.equal(saved[key], speed);
      assert.equal(
        (await f.nativeDb.get('lastModified', [saved.bookKey, 'statistic'])).lastModifiedValue,
        saved.lastStatisticModified
      );
      const reloaded = await f.readSnapshot();
      assert.equal(reloaded.rows.length, time > 0 ? 1 : 0);
      if (time > 0) {
        assert.equal(reloaded.rows[0].time, time);
        assert.equal(reloaded.rows[0].characters, characters);
      }
    });
  }
});

test('shared native rejects negative, nonnumeric, nonfinite, unsafe, and unsafe derived-speed edits atomically', async (t) => {
  const f = await sharedFixture(t);
  for (const patch of [
    ...[-1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '60', null].flatMap((value) => [
      { time: value },
      { characters: value }
    ]),
    { time: Number.MIN_VALUE, characters: 1 },
    { time: 1, characters: Number.MAX_SAFE_INTEGER },
    { time: 0.000001, characters: 100000000 },
    { date: '2024-02-30' }
  ]) {
    const snapshot = await f.readSnapshot();
    const values = Object.hasOwn(patch, 'date')
      ? { entry: { ...snapshot.rows[0].entry, date: patch.date } }
      : patch;
    await assert.rejects(
      f.save(snapshot, values),
      /Invalid statistics action|captured reading day/
    );
    assert.deepEqual(await f.stored(), f.original);
    assert.equal((await f.nativeDb.getAll('lastModified')).length, 0);
  }
});

test('shared native long-title edit and individual deletion use captured metadata and isolate same-title siblings', async (t) => {
  const title = '長い題名📚'.repeat(160);
  const f = await sharedFixture(t, title);
  const sibling = await f.book(2, title, 'b');
  const siblingRow = await f.history(sibling, '2024-02-29', 120.25);
  const originalDispatch = f.service.dispatchStatisticsAction;
  const dispatched = [];
  f.service.dispatchStatisticsAction = (input, ...args) => {
    dispatched.push(input);
    assert.equal(Object.hasOwn(input, 'title'), false, 'shared title stays in the admitted proof');
    return originalDispatch(input, ...args);
  };
  let snapshot = await f.readSnapshot();
  assert.equal(snapshot.books[0].title, title);
  assert.equal(snapshot.books[0].deletable, true);
  assert.ok(snapshot.rows.find((row) => row.entry?.bookId === 1));
  await f.save(snapshot, { characters: 999.5 });
  assert.equal((await f.stored()).title, title);
  assert.equal((await f.stored()).charactersRead, 999.5);
  assert.deepEqual(
    await f.nativeDb.get('readerStatistic', [siblingRow.bookKey, siblingRow.dateKey]),
    siblingRow
  );
  snapshot = await f.readSnapshot();
  const row = snapshot.rows.find((row) => row.entry?.bookId === 1);
  await f.owner.dispatchSharedStatisticsAction(
    {
      sharedVersion: 1,
      mutation: { type: 'delete', scope: 'selection', snapshotId: snapshot.snapshotId, row }
    },
    f.authority
  );
  assert.equal(await f.stored(), undefined);
  assert.deepEqual(
    await f.nativeDb.get('readerStatistic', [siblingRow.bookKey, siblingRow.dateKey]),
    siblingRow
  );
  assert.deepEqual(
    dispatched.map((action) => action.type),
    ['save-day', 'delete-day']
  );
});

test('shared native create accepts a fractional day for a long-title proven book', async (t) => {
  const f = await sharedFixture(t, '題'.repeat(600));
  const snapshot = await f.readSnapshot();
  await f.save(snapshot, {
    mode: 'create',
    entry: { ...snapshot.rows[0].entry, date: '2024-03-01' },
    time: 90000.5,
    characters: 100000000.5
  });
  const created = await f.nativeDb.get('readerStatistic', [f.original.bookKey, '2024-03-01']);
  assert.equal(created.title, f.seededBook.title);
  assert.equal(created.readingTime, 90000.5);
  assert.equal(created.charactersRead, 100000000.5);
  assert.deepEqual(await f.stored(), f.original);
});

test('shared numeric relaxation cannot be selected with missing, fake, incomplete, or wrong-proof admission', async (t) => {
  const f = await sharedFixture(t);
  const first = await f.owner.readSharedStatisticsRequest({ sharedVersion: 1, query }, f.authority);
  assert.equal(first.complete, false);
  const action = {
    type: 'save-day',
    snapshotId: first.snapshotId,
    bookId: 1,
    bookKey: f.original.bookKey,
    title: f.seededBook.title,
    date: f.original.dateKey,
    time: 1.5,
    characters: 2.25,
    mode: 'edit',
    resetMinMax: true
  };
  for (const admission of [undefined, {}])
    await assert.rejects(
      f.service.dispatchStatisticsAction(action, f.authority, admission),
      /completed projection admission/
    );
  assert.throws(
    () => f.service.admitSharedStatisticsMutation(first.snapshotId, f.authority),
    /not complete/
  );
  await assert.rejects(
    f.owner.dispatchSharedStatisticsAction(
      { sharedVersion: 1, mutation: { ...action, entry: { ...action } } },
      f.authority
    ),
    /expired/
  );
  const complete = await f.readSnapshot();
  for (const admission of [undefined, {}])
    await assert.rejects(
      f.service.dispatchStatisticsAction(
        { ...action, snapshotId: complete.snapshotId },
        f.authority,
        admission
      ),
      /completed projection admission/
    );
  const oldAdmission = f.service.admitSharedStatisticsMutation(complete.snapshotId, f.authority);
  const next = await f.readSnapshot();
  await assert.rejects(
    f.service.dispatchStatisticsAction(
      { ...action, snapshotId: next.snapshotId },
      f.authority,
      oldAdmission
    ),
    /completed projection admission/
  );
  assert.deepEqual(await f.stored(), f.original);
  await f.save(next, { time: 1.5, characters: 2.25 });
  assert.equal((await f.stored()).readingTime, 1.5);
});

test('shared native relaxed edits still refuse title, identity, owner, and row replacement', async (t) => {
  for (const change of ['title', 'identity', 'owner', 'row', 'authority']) {
    await t.test(change, async (t) => {
      const f = await sharedFixture(t, '題'.repeat(600));
      const snapshot = await f.readSnapshot();
      if (change === 'title') await f.nativeDb.put('data', { ...f.seededBook, title: 'Renamed' });
      if (change === 'identity')
        await f.nativeDb.put('data', { ...f.seededBook, contentHash: 'b'.repeat(64) });
      if (change === 'owner')
        await f.nativeDb.put('readerBookScope', { bookId: 1, accountId: 'other' });
      const expected = change === 'row' ? { ...f.original, completedBook: 1 } : f.original;
      if (change === 'row') await f.nativeDb.put('readerStatistic', expected);
      if (change === 'authority') f.authority.controller.abort();
      await assert.rejects(f.save(snapshot, { time: 86400.5, characters: 100000000.25 }));
      assert.deepEqual(await f.stored(), expected);
      assert.equal((await f.nativeDb.getAll('lastModified')).length, 0);
    });
  }
});

test('legacy native actions keep integer, product, and title bounds without shared admission', async (t) => {
  const f = await sharedFixture(t);
  const snapshot = await f.service.readStatisticsSnapshot(
    { aggregation: 'none', year: 2024 },
    f.authority
  );
  const action = {
    type: 'save-day',
    snapshotId: snapshot.snapshotId,
    bookId: 1,
    bookKey: f.original.bookKey,
    title: f.seededBook.title,
    date: f.original.dateKey,
    time: 60,
    characters: 120,
    mode: 'edit',
    resetMinMax: false
  };
  for (const patch of [
    { time: 1.5 },
    { characters: 1.5 },
    { time: 86401 },
    { characters: 100000001 },
    { title: '題'.repeat(513) }
  ])
    await assert.rejects(
      f.service.dispatchStatisticsAction({ ...action, ...patch }, f.authority),
      /Invalid statistics action/
    );
  assert.deepEqual(await f.stored(), f.original);
  const longBook = await f.book(2, '題'.repeat(600), 'b');
  await f.history(longBook, '2024-02-29');
  const legacy = await f.service.readStatisticsSnapshot({ aggregation: 'none' }, f.authority);
  assert.equal(legacy.books.find((book) => book.id === 2).title.length, 512);
  assert.equal(legacy.books.find((book) => book.id === 2).deletable, false);
  assert.equal(legacy.rows.find((row) => row.title === '題'.repeat(512)).entry, undefined);
});
