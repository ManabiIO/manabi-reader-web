/** @license BSD-3-Clause Copyright (c) 2026, ッツ Reader Authors. All rights reserved. */
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
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://localhost.test'
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true
});
const { createRoot } = require('react-dom/client');
const output = mkdtempSync(join(tmpdir(), 'statistics-port-lifecycle-'));
const fixture = join(output, 'fixture.ts');
writeFileSync(
  fixture,
  `let runtime; let params={}; export function setRuntime(value){runtime=value;} export function setParams(value){params=value;} export function useReaderRuntime(){return runtime;} export function useLocalSearchParams(){return params;} export function usePathname(){return '/statistics';}`
);
const outfile = join(output, 'ports.cjs');
await build({
  stdin: {
    contents: `export * from './apps/web/src/features/statistics/ports.native';export * from './apps/web/src/features/statistics/use-statistics';export * from 'statistics-runtime-fixture';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  tsconfig: 'apps/web/tsconfig.json',
  logLevel: 'silent',
  plugins: [
    {
      name: 'runtime-only',
      setup(b) {
        b.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({
          path: require.resolve(args.path),
          external: true
        }));
        b.onResolve(
          { filter: /^expo-router$|^statistics-runtime-fixture$|\/RuntimeProvider.native$/ },
          () => ({ path: fixture })
        );
      }
    }
  ]
});
const module = require(outfile);
function data(query, id) {
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
    notices: [],
    uiTheme: { themeId: 'manabi-theme', appearance: 'dark', customThemes: {} }
  };
}
function reply(query, id) {
  const chunk = JSON.stringify(data(query, id));
  return {
    sharedVersion: 1,
    snapshotId: id,
    sequence: 0,
    chunk,
    totalCharacters: chunk.length,
    complete: true
  };
}
const settle = async () => {
  for (let n = 0; n < 12; n++) await Promise.resolve();
};
function mount(command, strict = false) {
  let latest, port;
  function Harness() {
    port = module.useStatisticsPort();
    latest = module.useStatisticsController(port);
    return React.createElement(
      'div',
      { 'data-testid': 'state' },
      latest.state.data?.snapshotId ?? latest.state.error ?? ''
    );
  }
  let runtime = {
    snapshot: { session: 'session-owner', epoch: 1, revision: 1, settings: [] },
    command
  };
  module.setParams({});
  module.setRuntime(runtime);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = () =>
    root.render(
      strict
        ? React.createElement(React.StrictMode, null, React.createElement(Harness))
        : React.createElement(Harness)
    );
  return {
    root,
    container,
    get state() {
      return latest.state;
    },
    get port() {
      return port;
    },
    async start() {
      await React.act(async () => {
        render();
        await settle();
      });
    },
    async update(patch) {
      runtime = { ...runtime, snapshot: { ...runtime.snapshot, ...patch } };
      module.setRuntime(runtime);
      await React.act(async () => {
        render();
        await settle();
      });
    },
    async unmount() {
      await React.act(async () => root.unmount());
      container.remove();
    }
  };
}

test('production native port and shared controller do not loop on runtime reply revisions', async () => {
  let reads = 0;
  const command = async (_method, payload) =>
    payload.cancel ? { cancelled: true } : reply(payload.query, `read-${++reads}`);
  const f = mount(command);
  await f.start();
  assert.equal(reads, 1);
  const original = f.port,
    snapshot = f.state;
  for (let revision = 2; revision <= 6; revision++) await f.update({ revision });
  assert.equal(reads, 1);
  assert.equal(f.port, original);
  assert.equal(f.state, snapshot);
  await f.update({ epoch: 2 });
  assert.equal(reads, 2);
  assert.notEqual(f.port, original);
  await f.unmount();
});

test('production native StrictMode remount accepts only the fresh projection and cancels its own old read', async () => {
  const pending = [],
    cancelled = [];
  const command = async (_method, payload) => {
    if (payload.cancel) {
      cancelled.push(payload.requestId);
      return { cancelled: true };
    }
    return new Promise((resolve) => pending.push({ payload, resolve }));
  };
  const f = mount(command, true);
  await f.start();
  assert.equal(pending.length, 2);
  assert.ok(cancelled.includes(pending[0].payload.requestId));
  await React.act(async () => {
    pending[0].resolve(reply(pending[0].payload.query, 'old'));
    await settle();
  });
  assert.equal(f.state.data, undefined);
  await React.act(async () => {
    pending[1].resolve(reply(pending[1].payload.query, 'fresh'));
    await settle();
  });
  assert.equal(f.state.data.snapshotId, 'fresh');
  await f.unmount();
});

test('production native route/account replacement ignores late success and errors', async () => {
  const pending = [];
  const command = async (_method, payload) =>
    payload.cancel
      ? { cancelled: true }
      : new Promise((resolve, reject) => pending.push({ payload, resolve, reject }));
  const f = mount(command);
  await f.start();
  await f.update({ epoch: 2 });
  await React.act(async () => {
    pending[0].reject(new Error('private old account failure'));
    pending[1].resolve(reply(pending[1].payload.query, 'new-account'));
    await settle();
  });
  assert.equal(f.state.data.snapshotId, 'new-account');
  assert.equal(f.state.error, '');
  await f.unmount();
});

test.after(() => {
  rmSync(output, { recursive: true, force: true });
  dom.window.close();
});
