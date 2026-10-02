/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const React = require('react');
const { act } = React;
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://localhost.test'
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Event: dom.window.Event,
  IS_REACT_ACT_ENVIRONMENT: true
});
const { createRoot } = require('react-dom/client');
const output = mkdtempSync(join(tmpdir(), 'native-statistics-ui-'));
const fixture = join(output, 'fixture.tsx');
writeFileSync(
  fixture,
  `import React from 'react';
let runtime; export function setRuntime(value) { runtime=value; } export function useReaderRuntime(){ return runtime; }
let params={}, pathname='/statistics'; export function setRoute(value={}, path='/statistics'){params=value;pathname=path;} export function useLocalSearchParams(){return params;} export function usePathname(){return pathname;} export const router={replace(){}};
export const confirmations=[]; export const Alert={alert(...args){confirmations.push(args)}};
export const View=({children})=><div>{children}</div>;export const ScrollView=View;
export const Text=({children})=><span>{children}</span>;
export const Pressable=({children,disabled,onPress,accessibilityLabel})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;
export const TextInput=({value,onChangeText,editable,accessibilityLabel})=><textarea aria-label={accessibilityLabel} disabled={editable===false} value={value} onChange={e=>onChangeText(e.target.value)}/>;
export const Modal=({visible,children})=>visible?<section>{children}</section>:null;
export const ActivityIndicator=()=> <div>Loading statistics</div>;export const StyleSheet={create:x=>x};
export const Action=({label,disabled,onPress,variant})=><button data-variant={variant} disabled={disabled} onClick={onPress}>{label}</button>;
export const Screen=({children,actions})=><main>{actions}{children}</main>;`
);
const outfile = join(output, 'screen.cjs');
await build({
  stdin: {
    contents: `export * from './apps/web/src/statistics-react/native-screen';export * from 'native-statistics-fixture';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  tsconfig: 'apps/web/tsconfig.json',
  jsx: 'automatic',
  logLevel: 'silent',
  plugins: [
    {
      name: 'native-statistics-controls',
      setup(b) {
        b.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({
          path: require.resolve(args.path),
          external: true
        }));
        b.onResolve(
          {
            filter:
              /^expo-router$|^react-native$|^native-statistics-fixture$|\/NativeScreens$|\/RuntimeProvider.native$/
          },
          () => ({ path: fixture })
        );
      }
    }
  ]
});
const { NativeStatisticsScreen, setRuntime, setRoute, confirmations } = require(outfile);
function snapshot(id = 'snapshot-1') {
  return {
    snapshotId: id,
    query: {
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      year: 2024,
      page: 1,
      bookIds: [],
      bookSelection: 'all',
      aggregation: 'none',
      sort: 'time',
      direction: 'desc',
      timeSource: 'readingTime',
      charactersSource: 'charactersRead',
      speedSource: 'lastReadingSpeed',
      heatmapAggregation: 'year'
    },
    today: '2024-02-28',
    weekStartsOn: 1,
    books: [{ id: 1, title: 'My book', bookKey: 'content:' + 'a'.repeat(64), deletable: true }],
    rows: [
      {
        id: 'one',
        title: 'My book',
        date: '2024-02-28',
        time: 60,
        characters: 100,
        speed: 6000,
        measurements: {
          readingTime: 60,
          averageReadingTime: 30,
          averageWeightedReadingTime: 45,
          charactersRead: 100,
          averageCharactersRead: 50,
          averageWeightedCharactersRead: 75,
          lastReadingSpeed: 6000,
          minReadingSpeed: 1500,
          altMinReadingSpeed: 3000,
          maxReadingSpeed: 9000
        },
        entry: { bookId: 1, bookKey: 'content:' + 'a'.repeat(64), date: '2024-02-28' }
      }
    ],
    totals: { time: 60, characters: 100, speed: 6000, days: 1 },
    pages: 1,
    totalRows: 1,
    days: [],
    daysRead: '',
    currentStreak: 1,
    longestStreak: 1,
    longestStreakStartDate: '2024-02-28',
    longestStreakDates: [],
    allTime: { startDate: '2024-02-28', endDate: '2024-02-28' },
    goals: { available: false, reason: 'Goals have no account owner.' },
    notices: []
  };
}
function setup(override) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container),
    calls = [];
  let serial = 0;
  const command = async (method, payload) => {
    calls.push({ method, payload });
    const value = await override?.(method, payload);
    if (value !== undefined) return value;
    if (method !== 'statistics.read') return { saved: true };
    const next = snapshot('snapshot-' + ++serial);
    next.query = { ...next.query, ...payload };
    return next;
  };
  confirmations.length = 0;
  return {
    container,
    calls,
    async render(epoch = 1, params = {}, pathname = '/statistics') {
      setRoute(params, pathname);
      setRuntime({ command, snapshot: { session: 'session-a', epoch } });
      await act(async () => {
        root.render(React.createElement(NativeStatisticsScreen));
      });
    },
    async dispose() {
      await act(() => root.unmount());
      container.remove();
    }
  };
}
async function click(f, label) {
  const button = [...f.container.querySelectorAll('button')].find(
    (item) => item.textContent === label || item.getAttribute('aria-label') === label
  );
  assert.ok(button, label);
  await act(async () => button.click());
}
function confirm() {
  return confirmations.at(-1)[2].find((button) => button.style !== 'cancel').onPress;
}

test('native statistics private book selection can be canceled or explicitly applied empty', async () => {
  const f = setup();
  await f.render();
  const initialReads = f.calls.length;
  await click(f, 'Filter books');
  await click(f, 'Clear book selection');
  await click(f, 'Cancel book filters');
  assert.equal(f.calls.length, initialReads);
  await click(f, 'Filter books');
  await click(f, 'Clear book selection');
  await click(f, 'Apply book filters');
  assert.equal(f.calls.at(-1).payload.bookSelection, 'selected');
  assert.deepEqual(f.calls.at(-1).payload.bookIds, []);
  await f.dispose();
});

test('native statistics manual entry uses native confirmation and fences duplicate submissions', async () => {
  let release;
  const f = setup((method) =>
    method === 'statistics.action'
      ? new Promise((resolve) => {
          release = resolve;
        })
      : undefined
  );
  await f.render();
  await click(f, 'Filter books');
  await click(f, 'Add reading day for My book');
  assert.ok(f.container.querySelector('section'));
  await click(f, 'Save reading day');
  const save = confirm();
  await act(async () => {
    save();
    save();
  });
  const actions = f.calls.filter((call) => call.method === 'statistics.action');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].payload.mode, 'create');
  assert.equal(actions[0].payload.snapshotId, 'snapshot-1');
  await act(async () => release({ saved: true }));
  assert.equal(f.container.querySelector('section'), null);
  await f.dispose();
});

test('native statistics discards old-account confirmations and closes an editor on epoch replacement', async () => {
  const f = setup();
  await f.render();
  await click(f, 'Edit My book on 2024-02-28');
  await click(f, 'Save reading day');
  const stale = confirm();
  await f.render(3);
  await act(async () => stale());
  assert.equal(f.calls.filter((call) => call.method === 'statistics.action').length, 0);
  assert.equal(f.container.querySelector('section'), null);
  await f.dispose();
});

test('native statistics unmount and a newer refresh retire pending destructive confirmations', async () => {
  const f = setup();
  await f.render();
  await click(f, 'Delete My book on 2024-02-28');
  const stale = confirm();
  await click(f, 'Refresh');
  await act(async () => stale());
  assert.equal(f.calls.filter((call) => call.method === 'statistics.action').length, 0);
  await click(f, 'Delete My book on 2024-02-28');
  const unmounted = confirm();
  await f.dispose();
  await act(async () => unmounted());
  assert.equal(f.calls.filter((call) => call.method === 'statistics.action').length, 0);
});

test('native statistics ignores a late read from a previous account epoch', async () => {
  let release,
    reads = 0;
  const f = setup((method) =>
    method === 'statistics.read' && ++reads === 1
      ? new Promise((resolve) => {
          release = resolve;
        })
      : undefined
  );
  await f.render();
  await f.render(2);
  const old = snapshot('stale');
  old.rows[0].title = 'Old account title';
  await act(async () => release(old));
  assert.equal(f.container.textContent.includes('Old account title'), false);
  await f.dispose();
});

test('native measurement controls render the projected values and sort by the chosen source', async () => {
  const f = setup();
  await f.render();
  for (const [label, field, source, sort, expected] of [
    ['Average Time', 'timeSource', 'averageReadingTime', 'time', /Average Time: 0.5 min/],
    [
      'Weighted Time',
      'timeSource',
      'averageWeightedReadingTime',
      'time',
      /Weighted Time: 0.75 min/
    ],
    [
      'Average Characters',
      'charactersSource',
      'averageCharactersRead',
      'characters',
      /Average Characters: 50 characters/
    ],
    [
      'Weighted Characters',
      'charactersSource',
      'averageWeightedCharactersRead',
      'characters',
      /Weighted Characters: 75 characters/
    ],
    ['Min Speed', 'speedSource', 'minReadingSpeed', 'speed', /Min Speed: 1,500 characters\/hour/],
    [
      'Alt Min Speed',
      'speedSource',
      'altMinReadingSpeed',
      'speed',
      /Alt Min Speed: 3,000 characters\/hour/
    ],
    ['Max Speed', 'speedSource', 'maxReadingSpeed', 'speed', /Max Speed: 9,000 characters\/hour/]
  ]) {
    await click(f, `Show ${label}`);
    assert.equal(f.calls.at(-1).payload[field], source);
    assert.equal(f.calls.at(-1).payload.sort, sort);
    assert.equal(f.calls.at(-1).payload.page, 1);
    assert.match(f.container.textContent, expected);
    assert.match(f.container.textContent, new RegExp(`Sorting by ${label}, descending`));
    const control = [...f.container.querySelectorAll('button')].find(
      (button) => button.textContent === `Show ${label}`
    );
    assert.equal(control.dataset.variant, 'filled');
  }
  await click(f, 'Sort by speed');
  assert.equal(f.calls.at(-1).payload.speedSource, 'maxReadingSpeed');
  assert.equal(f.calls.at(-1).payload.direction, 'asc');
  assert.match(f.container.textContent, /Sorting by Max Speed, ascending/);
  await click(f, 'Sort by speed');
  assert.equal(f.calls.at(-1).payload.direction, 'desc');
  await f.dispose();
});

test('native display measurement changes leave editable raw totals intact and retire old confirmations', async () => {
  const f = setup();
  await f.render();
  await click(f, 'Edit My book on 2024-02-28');
  await click(f, 'Save reading day');
  const stale = confirm();
  await click(f, 'Show Weighted Time');
  await act(async () => stale());
  assert.equal(f.calls.filter((call) => call.method === 'statistics.action').length, 0);
  await click(f, 'Edit My book on 2024-02-28');
  await click(f, 'Save reading day');
  await act(async () => confirm()());
  const action = f.calls.find((call) => call.method === 'statistics.action');
  assert.equal(action.payload.time, 60);
  assert.equal(action.payload.characters, 100);
  await f.dispose();
});

test('native measurement choices disable during reads and reset across account generations', async () => {
  let release;
  const f = setup((method, payload) =>
    method === 'statistics.read' && payload.timeSource === 'averageReadingTime'
      ? new Promise((resolve) => {
          release = resolve;
        })
      : undefined
  );
  await f.render();
  await click(f, 'Show Average Time');
  const button = [...f.container.querySelectorAll('button')].find(
    (item) => item.textContent === 'Show Max Speed'
  );
  assert.equal(button.disabled, true);
  const before = f.calls.length;
  await click(f, 'Show Max Speed');
  assert.equal(f.calls.length, before);
  await f.render(2);
  const stale = snapshot('stale-measurement');
  stale.query.timeSource = 'averageReadingTime';
  stale.rows[0].title = 'Old account measurements';
  await act(async () => release(stale));
  assert.equal(f.container.textContent.includes('Old account measurements'), false);
  assert.match(f.container.textContent, /Total Time: 1 min/);
  assert.equal(f.calls.at(-1).payload.timeSource, undefined);
  await f.dispose();
});

test('native all-time heatmap stays year-paged and communicates the selected aggregation', async () => {
  const f = setup();
  await f.render();
  await click(f, 'Heatmap');
  await click(f, 'All-time heatmap statistics');
  assert.equal(f.calls.at(-1).payload.heatmapAggregation, 'all-time');
  assert.match(
    f.container.textContent,
    /All-time reading days, streaks, and color scale. Showing calendar year 2024/
  );
  await click(f, 'Previous year');
  assert.equal(f.calls.at(-1).payload.year, 2023);
  assert.equal(f.calls.at(-1).payload.heatmapAggregation, 'all-time');
  assert.match(f.container.textContent, /Showing calendar year 2023/);
  await click(f, 'Yearly heatmap statistics');
  assert.equal(f.calls.at(-1).payload.heatmapAggregation, 'year');
  assert.match(f.container.textContent, /Reading days, streaks, and color scale for 2023/);
  await f.dispose();
});

test('native all-time longest-streak highlight loads the owning year without an unbounded calendar', async () => {
  const f = setup((method, payload) => {
    if (method !== 'statistics.read') return undefined;
    const next = snapshot('all-time-streak');
    next.query = { ...next.query, ...payload };
    next.longestStreak = 3;
    next.longestStreakStartDate = '2023-12-30';
    return next;
  });
  await f.render();
  await click(f, 'Heatmap');
  await click(f, 'All-time heatmap statistics');
  await click(f, 'Highlight longest streak: 3 days');
  assert.equal(f.calls.at(-1).payload.year, 2023);
  assert.equal(f.calls.at(-1).payload.heatmapAggregation, 'all-time');
  assert.match(f.container.textContent, /Showing calendar year 2023/);
  const reads = f.calls.length;
  await click(f, 'Highlight longest streak: 3 days');
  assert.equal(f.calls.length, reads, 'toggling off does not load another year');
  await f.dispose();
});

test('native zero measurements stay finite and leave individual zero-day editing available', async () => {
  const f = setup((method, payload) => {
    if (method !== 'statistics.read') return undefined;
    const next = snapshot('zero-day');
    next.query = { ...next.query, ...payload };
    Object.assign(next.rows[0], { time: 0, characters: 0, speed: 0 });
    next.rows[0].measurements = Object.fromEntries(
      Object.keys(next.rows[0].measurements).map((key) => [key, 0])
    );
    next.totals = { time: 0, characters: 0, speed: 0, days: 0 };
    return next;
  });
  await f.render();
  await click(f, 'Show Weighted Time');
  await click(f, 'Show Weighted Characters');
  await click(f, 'Show Min Speed');
  assert.match(f.container.textContent, /Weighted Time: 0 min/);
  assert.match(f.container.textContent, /Weighted Characters: 0 characters/);
  assert.match(f.container.textContent, /Min Speed: 0 characters\/hour/);
  assert.doesNotMatch(f.container.textContent, /NaN|Infinity/);
  await click(f, 'Edit My book on 2024-02-28');
  await click(f, 'Save reading day');
  await act(async () => confirm()());
  const action = f.calls.find((call) => call.method === 'statistics.action');
  assert.equal(action.payload.time, 0);
  assert.equal(action.payload.characters, 0);
  await f.dispose();
});

test('native measurement reload retires an old confirmation before its replacement read finishes', async () => {
  let release;
  const f = setup((method, payload) =>
    method === 'statistics.read' && payload.timeSource === 'averageReadingTime'
      ? new Promise((resolve) => {
          release = resolve;
        })
      : undefined
  );
  await f.render();
  await click(f, 'Edit My book on 2024-02-28');
  await click(f, 'Save reading day');
  const stale = confirm();
  await click(f, 'Show Average Time');
  await act(async () => stale());
  assert.equal(f.calls.filter((call) => call.method === 'statistics.action').length, 0);
  const next = snapshot('replacement-measurement');
  next.query.timeSource = 'averageReadingTime';
  await act(async () => release(next));
  await click(f, 'Edit My book on 2024-02-28');
  await click(f, 'Save reading day');
  await act(async () => confirm()());
  assert.equal(f.calls.filter((call) => call.method === 'statistics.action').length, 1);
  await f.dispose();
});

test.after(() => {
  rmSync(output, { recursive: true, force: true });
  dom.window.close();
});

test('Statistics route accepts only an opaque selection and never falls back from invalid ID hints', async () => {
  for (const params of [
    { bookId: '1' },
    { selection: ['first', 'second'] },
    { selection: '' },
    { selection: 'ok', bookIds: '1' }
  ]) {
    const f = setup();
    await f.render(1, params);
    assert.equal(f.calls.length, 0);
    assert.match(f.container.textContent, /invalid or expired/);
    assert.match(f.container.textContent, /Return to Library/);
    await f.dispose();
  }
  const f = setup();
  await f.render(1, { selection: 'opaque-selection' });
  assert.deepEqual(f.calls[0].payload, { selectionToken: 'opaque-selection' });
  await click(f, 'Today');
  assert.equal(f.calls.at(-1).payload.selectionToken, 'opaque-selection');
  await f.dispose();
});

test('Statistics route changes and departure retire stale confirmations and late reads', async () => {
  let release;
  const f = setup((method, payload) =>
    method === 'statistics.read' && payload.selectionToken === 'slow-selection'
      ? new Promise((resolve) => {
          release = resolve;
        })
      : undefined
  );
  await f.render(1, { selection: 'old-selection' });
  await click(f, 'Delete My book on 2024-02-28');
  const old = confirm();
  await f.render(1, { selection: 'slow-selection' });
  await act(async () => old());
  assert.equal(f.calls.filter((call) => call.method === 'statistics.action').length, 0);
  await f.render(1, { selection: 'new-selection' });
  await act(async () => {
    const stale = snapshot('old');
    stale.query.selectionToken = 'slow-selection';
    stale.rows[0].title = 'Stale route book';
    release(stale);
  });
  assert.doesNotMatch(f.container.textContent, /Stale route book/);
  await click(f, 'Delete My book on 2024-02-28');
  const departed = confirm();
  await f.render(1, { selection: 'new-selection' }, '/manage');
  await act(async () => departed());
  assert.equal(f.calls.filter((call) => call.method === 'statistics.action').length, 0);
  assert.equal(f.container.textContent, '');
  await f.dispose();
});

test('Statistics rejects a lost selection proof and clears stale data on a failed refresh', async () => {
  let fail = false;
  const f = setup((method) => {
    if (method === 'statistics.read' && fail)
      throw new Error('Selection expired; return to Library.');
  });
  await f.render(1, { selection: 'selection' });
  fail = true;
  await click(f, 'Refresh');
  assert.match(f.container.textContent, /Selection expired/);
  assert.doesNotMatch(f.container.textContent, /Reading totals/);
  await f.dispose();
  const wrong = setup((method) => (method === 'statistics.read' ? snapshot() : undefined));
  await wrong.render(1, { selection: 'requested-selection' });
  assert.match(wrong.container.textContent, /invalid or expired/);
  assert.doesNotMatch(wrong.container.textContent, /Reading totals/);
  await wrong.dispose();
});

test('closing a reading editor retires its already-open Save confirmation', async () => {
  const f = setup();
  await f.render();
  await click(f, 'Edit My book on 2024-02-28');
  await click(f, 'Save reading day');
  const old = confirm();
  await click(f, 'Cancel edit');
  await act(async () => old());
  assert.equal(f.calls.filter((call) => call.method === 'statistics.action').length, 0);
  await f.dispose();
});
