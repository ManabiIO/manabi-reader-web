/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../apps/web/', import.meta.url));
// Bundle the actual controller, ReaderController lifetime, statistics helpers,
// and RxJS subjects. Only persistence/preferences and logging are test doubles.
const { outputFiles } = await build({
  stdin: {
    contents: `
      export { createTracker } from './src/reader-react/tracker-controller';
      export { database } from '$lib/data/store';
      export { logger } from '$lib/data/logger';
      export { getDefaultStatistic } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
    `,
    resolveDir: root
  },
  tsconfig: root + 'tsconfig.json',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  write: false,
  plugins: [
    {
      name: 'reader-tracker-flush-fixture',
      setup(builder) {
        builder.onResolve({ filter: /^\$lib\/data\/(store|logger)$/ }, ({ path }) => ({
          path,
          namespace: 'reader-tracker-flush'
        }));
        builder.onLoad({ filter: /.*/, namespace: 'reader-tracker-flush' }, ({ path }) => ({
          resolveDir: root,
          contents: path.endsWith('/logger')
            ? 'export const logger = { error() {} };'
            : `
              import { BehaviorSubject } from 'rxjs';
              export const database = {};
              export const adjustStatisticsAfterIdleTime$ = new BehaviorSubject(false);
              export const readingGoal$ = new BehaviorSubject({ goalStartDate: '' });
              export const startDayHoursForTracker$ = new BehaviorSubject(0);
              export const trackerAutoPause$ = new BehaviorSubject('off');
              export const trackerBackwardSkipThreshold$ = new BehaviorSubject(0);
              export const trackerForwardSkipThreshold$ = new BehaviorSubject(0);
              export const trackerIdleTime$ = new BehaviorSubject(0);
              export const trackerPopupDetection$ = new BehaviorSubject(false);
              export const trackerSkipThresholdAction$ = new BehaviorSubject('ignore');
            `
        }));
      }
    }
  ]
});
const { createTracker, database, logger, getDefaultStatistic } = await import(
  'data:text/javascript;base64,' + Buffer.from(outputFiles[0].contents).toString('base64')
);

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture(t, props = {}, onEvent = () => {}) {
  const writes = [];
  const errors = [];
  const events = [];
  let activeWrites = 0;
  let maximumActiveWrites = 0;
  // The controller constructs these observers immediately; this fixture never
  // starts reading timers or mounts browser mutation subscriptions.
  const originalObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  database.storeStatistics = (title, rows, behavior, merge, modified, bookId) => {
    const pending = deferred();
    activeWrites += 1;
    maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
    writes.push({ title, rows, behavior, merge, modified, bookId, ...pending });
    return pending.promise.finally(() => {
      activeWrites -= 1;
    });
  };
  logger.error = (error) => errors.push(error);
  const tracker = createTracker(
    {
      bookTitle: 'Flush fixture',
      bookId: 73,
      wasTrackerPaused: true,
      exploredCharCount: 0,
      bookCharCount: 1000,
      sectionData: [],
      frozenPosition: -1,
      autoScroller: undefined,
      blockDataUpdates: false,
      ...props
    },
    (name) => {
      events.push(name);
      onEvent(name);
    }
  );
  t.after(() => {
    tracker.controller.destroy();
    if (originalObserver) Object.defineProperty(globalThis, 'MutationObserver', originalObserver);
    else delete globalThis.MutationObserver;
  });
  return { tracker, writes, errors, events, maximumActiveWrites: () => maximumActiveWrites };
}

async function turn() {
  // Promise-only settling keeps the database boundary controlled by each test.
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

function watch(promise) {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  return () => settled;
}

function tick(tracker, characters = 5) {
  // Local noon avoids a test execution near midnight splitting across dates.
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  return tracker.processStatistics(characters, 1, date.getTime(), false);
}

test('a forced close joins an ongoing write even when its queue is empty', async (t) => {
  const h = fixture(t);
  await tick(h.tracker);
  const background = h.tracker.flushUpdates();
  await turn();
  assert.equal(h.writes.length, 1);
  assert.equal(h.tracker.statisticsToStore.size, 0);
  h.tracker.blockDataUpdates = true;
  const close = h.tracker.flushUpdates(true);
  assert.equal(close, background, 'close shares the persistence settlement');
  const closed = watch(close);
  await turn();
  assert.equal(closed(), false);
  assert.equal(h.tracker.actionInProgress, true);
  h.writes[0].resolve();
  assert.deepEqual(await close, [false, 1]);
  assert.equal(h.tracker.actionInProgress, false);
  assert.equal(h.tracker.hadError, false);
  assert.deepEqual(h.events, ['statisticsSaved']);
  assert.equal(h.writes[0].bookId, 73);
  assert.equal(h.writes[0].title, 'Flush fixture');
  assert.equal(h.writes[0].behavior, 'overwrite');
  assert.ok(h.writes[0].modified > 0);
  assert.ok(h.tracker.lastTrackerFlushTime > 0);
});

test('a failed pending write reaches every waiter and retains the latest rows for retry', async (t) => {
  const h = fixture(t);
  await tick(h.tracker);
  const background = h.tracker.flushUpdates();
  await turn();
  await tick(h.tracker, 7);
  h.tracker.blockDataUpdates = true;
  const close = h.tracker.flushUpdates(true);
  const repeatedClose = h.tracker.flushUpdates(true);
  h.writes[0].reject(new Error('disk full'));
  assert.deepEqual(await background, [true, 1]);
  assert.deepEqual(await close, [true, 1]);
  assert.deepEqual(await repeatedClose, [true, 1]);
  assert.equal(h.writes.length, 1, 'failure must not silently start an automatic retry');
  assert.equal(h.tracker.statisticsToStore.size, 1);
  assert.equal(h.tracker.hadError, true);
  assert.equal(h.tracker.actionInProgress, false);
  assert.equal(
    h.tracker.trackingHistory.every((item) => !item.saved),
    true
  );
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.errors, ['Error updating statistics: disk full']);

  assert.deepEqual(await h.tracker.flushUpdates(), [false, 0]);
  assert.equal(h.tracker.hadError, true, 'a blocked no-op does not erase a failed write');
  const retry = h.tracker.flushUpdates(true);
  await turn();
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[1].rows[0].charactersRead, 12);
  assert.equal(h.writes[1].rows[0].readingTime, 2);
  h.writes[1].resolve();
  assert.deepEqual(await retry, [false, 1]);
  assert.equal(h.tracker.statisticsToStore.size, 0);
  assert.equal(h.tracker.hadError, false);
  assert.equal(
    h.tracker.trackingHistory.every((item) => item.saved),
    true
  );
  assert.equal(h.maximumActiveWrites(), 1);
});

test('close drains updates during storage without mutating in-flight rows or saving new history early', async (t) => {
  const h = fixture(t);
  await tick(h.tracker);
  const firstHistory = h.tracker.trackingHistory[0];
  const today = h.tracker.statistics.get(h.tracker.todayKey);
  today.completedData = { charactersRead: 5, readingTime: 1 };
  const background = h.tracker.flushUpdates();
  await turn();
  const snapshot = globalThis.structuredClone(h.writes[0].rows);
  await tick(h.tracker, 8);
  const newHistory = h.tracker.trackingHistory[0];
  today.completedData.charactersRead = 13;
  const otherDate = '2001-01-01';
  const otherRow = getDefaultStatistic(h.tracker.bookTitle, otherDate);
  otherRow.charactersRead = 9;
  h.tracker.statistics.set(otherDate, otherRow);
  h.tracker.statisticsToStore.add(otherDate);
  assert.deepEqual(h.writes[0].rows, snapshot, 'the pending database payload is a deep snapshot');
  h.tracker.blockDataUpdates = true;
  const close = h.tracker.flushUpdates(true);
  const closed = watch(close);
  h.writes[0].resolve();
  await turn();
  assert.equal(h.writes.length, 2);
  assert.equal(closed(), false, 'close must also await the newly queued batch');
  assert.equal(h.tracker.actionInProgress, true);
  assert.equal(h.tracker.trackingHistory.find((item) => item.id === firstHistory.id).saved, true);
  assert.equal(h.tracker.trackingHistory.find((item) => item.id === newHistory.id).saved, false);
  assert.equal(
    h.writes[1].rows.find((row) => row.dateKey === h.tracker.todayKey).charactersRead,
    13
  );
  assert.equal(h.writes[1].rows.find((row) => row.dateKey === otherDate).charactersRead, 9);
  h.writes[1].resolve();
  assert.deepEqual(await close, [false, 3]);
  assert.deepEqual(await background, [false, 3]);
  assert.equal(
    h.tracker.trackingHistory.every((item) => item.saved),
    true
  );
  assert.equal(h.tracker.statisticsToStore.size, 0);
  assert.equal(h.maximumActiveWrites(), 1);
  assert.deepEqual(h.events, ['statisticsSaved', 'statisticsSaved']);
});

test('a failed later batch is reported after a successful first write and retries only queued dates', async (t) => {
  const h = fixture(t);
  await tick(h.tracker);
  const pending = h.tracker.flushUpdates(true);
  await turn();
  await tick(h.tracker, 10);
  h.writes[0].resolve();
  await turn();
  assert.equal(h.writes.length, 2);
  h.writes[1].reject(new Error('second batch failed'));
  assert.deepEqual(await pending, [true, 2]);
  assert.equal(h.tracker.hadError, true);
  assert.equal(h.tracker.statisticsToStore.size, 1);
  assert.equal(h.tracker.trackingHistory.filter((item) => item.saved).length, 1);
  const retry = h.tracker.flushUpdates(true);
  await turn();
  assert.equal(h.writes[2].rows[0].charactersRead, 15);
  h.writes[2].resolve();
  assert.deepEqual(await retry, [false, 1]);
  assert.equal(h.tracker.statisticsToStore.size, 0);
  assert.equal(h.maximumActiveWrites(), 1);
});

test('ordinary flushes remain blocked while forced flushes can drain queued statistics', async (t) => {
  const h = fixture(t, { blockDataUpdates: true });
  assert.deepEqual(await h.tracker.flushUpdates(true), [false, 0]);
  assert.equal(h.tracker.actionInProgress, false);
  await tick(h.tracker);
  assert.deepEqual(await h.tracker.flushUpdates(), [false, 0]);
  assert.equal(h.writes.length, 0);
  assert.equal(h.tracker.statisticsToStore.size, 1);
  const forced = h.tracker.flushUpdates(true);
  await turn();
  h.writes[0].resolve();
  assert.deepEqual(await forced, [false, 1]);
  assert.deepEqual(await h.tracker.flushUpdates(true), [false, 0]);
});

test('a newly blocked background drain retains pending rows until a subsequent forced flush', async (t) => {
  const h = fixture(t);
  await tick(h.tracker);
  const background = h.tracker.flushUpdates();
  await turn();
  await tick(h.tracker, 4);
  h.tracker.blockDataUpdates = true;
  const concurrent = h.tracker.flushUpdates();
  assert.equal(concurrent, background);
  h.writes[0].resolve();
  assert.deepEqual(await background, [false, 1]);
  assert.equal(h.writes.length, 1);
  assert.equal(h.tracker.statisticsToStore.size, 1);
  const close = h.tracker.flushUpdates(true);
  await turn();
  assert.equal(h.writes[1].rows[0].charactersRead, 9);
  h.writes[1].resolve();
  assert.deepEqual(await close, [false, 1]);
  assert.equal(h.maximumActiveWrites(), 1);
});

test('history reverted during a pending write stays unsaved until the revised row is written', async (t) => {
  const h = fixture(t);
  await tick(h.tracker);
  const original = h.tracker.trackingHistory[0];
  const pending = h.tracker.flushUpdates();
  await turn();
  h.tracker.revertTrackerHistory({ detail: original });
  const reverted = h.tracker.trackingHistory[0];
  assert.equal(reverted.id, original.id, 'revert preserves the history identifier');
  assert.notEqual(reverted, original, 'revert replaces the history entry');
  h.writes[0].resolve();
  await turn();
  assert.equal(h.writes.length, 2);
  assert.equal(h.tracker.trackingHistory[0].saved, false);
  assert.equal(h.writes[1].rows[0].charactersRead, 0);
  h.writes[1].resolve();
  assert.deepEqual(await pending, [false, 2]);
  assert.equal(h.tracker.trackingHistory[0].saved, true);
});

test('a close at the previous drain settlement boundary still persists newly queued statistics', async (t) => {
  let close;
  const h = fixture(t, {}, (name) => {
    if (name === 'statisticsSaved' && h.events.length === 1) {
      globalThis.queueMicrotask(() => {
        void tick(h.tracker, 6);
        close = h.tracker.flushUpdates(true);
      });
    }
  });
  await tick(h.tracker);
  const background = h.tracker.flushUpdates();
  await turn();
  h.writes[0].resolve();
  await turn();
  assert.ok(close);
  assert.equal(h.writes.length, 2, 'a completed drain cannot absorb a new close without writing');
  const closed = watch(close);
  await turn();
  assert.equal(closed(), false);
  assert.equal(h.writes[1].rows[0].charactersRead, 11);
  h.writes[1].resolve();
  assert.deepEqual(await background, [false, 1]);
  assert.deepEqual(await close, [false, 1]);
  assert.equal(h.tracker.statisticsToStore.size, 0);
  assert.equal(h.maximumActiveWrites(), 1);
});
