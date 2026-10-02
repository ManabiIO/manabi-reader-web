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
export const confirmations=[]; export const Alert={alert(...args){confirmations.push(args)}};
export const View=({children})=><div>{children}</div>;export const ScrollView=View;
export const Text=({children})=><span>{children}</span>;
export const Pressable=({children,disabled,onPress,accessibilityLabel})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;
export const TextInput=({value,onChangeText,editable,accessibilityLabel})=><textarea aria-label={accessibilityLabel} disabled={editable===false} value={value} onChange={e=>onChangeText(e.target.value)}/>;
export const Modal=({visible,children})=>visible?<section>{children}</section>:null;
export const ActivityIndicator=()=> <div>Loading statistics</div>;export const StyleSheet={create:x=>x};
export const Action=({label,disabled,onPress})=><button disabled={disabled} onClick={onPress}>{label}</button>;
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
              /^react-native$|^native-statistics-fixture$|\/NativeScreens$|\/RuntimeProvider.native$/
          },
          () => ({ path: fixture })
        );
      }
    }
  ]
});
const { NativeStatisticsScreen, setRuntime, confirmations } = require(outfile);
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
      direction: 'desc'
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
    return method === 'statistics.read' ? snapshot('snapshot-' + ++serial) : { saved: true };
  };
  confirmations.length = 0;
  return {
    container,
    calls,
    async render(epoch = 1) {
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

test.after(() => {
  rmSync(output, { recursive: true, force: true });
  dom.window.close();
});
