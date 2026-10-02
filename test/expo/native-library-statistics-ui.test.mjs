/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require = createRequire(import.meta.url),
  React = require('react'),
  { act } = React;
const { JSDOM } = require('jsdom'),
  dom = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Event: dom.window.Event,
  IS_REACT_ACT_ENVIRONMENT: true
});
const { createRoot } = require('react-dom/client');
const output = mkdtempSync(join(tmpdir(), 'library-statistics-ui-'));
process.on('exit', () => rmSync(output, { recursive: true, force: true }));
const fixture = `import React,{useRef} from 'react';
export const View=({children})=><div>{children}</div>; export const ScrollView=View,SafeAreaView=View,Host=View;
export const Text=({children})=><span>{children}</span>; export const StyleSheet={create:x=>x};
export const ActivityIndicator=()=>null; export const Modal=({visible,children})=>visible?<section>{children}</section>:null;
export const Pressable=({children,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{children}</button>;
export const FlatList=({data,renderItem})=><div>{data.map(item=><div key={item.key}>{renderItem({item})}</div>)}</div>;
export const useNativeState=value=>useRef({value}).current; export const TextInput=()=>null; export const Switch=()=>null;
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const Screen=({actions,children})=><main>{actions}{children}</main>;
export const Alert={alert:(...args)=>globalThis.libraryStatisticsUI.confirmations.push(args)};
export const useReaderRuntime=()=>globalThis.libraryStatisticsUI.runtime;
export const usePathname=()=>globalThis.libraryStatisticsUI.pathname;
export const router={push:path=>globalThis.libraryStatisticsUI.routes.push(path)};
export const NativeLibraryContentSearch=()=>null,NativeBookCover=()=>null,NativeEditorsPicks=()=>null;
export class NativeLibraryCoverController{activate(){}dispose(){}viewport(){}setView(){}setActive(){}};`;
const outfile = join(output, 'library.cjs');
await build({
  entryPoints: ['apps/web/src/native-library/index.tsx'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  jsx: 'automatic',
  tsconfig: 'apps/web/tsconfig.json',
  logLevel: 'silent',
  plugins: [
    {
      name: 'ui',
      setup(b) {
        b.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({
          path: require.resolve(path),
          external: true
        }));
        b.onResolve(
          {
            filter:
              /^(react-native|react-native-safe-area-context|@expo\/ui|expo-router)$|\/NativeScreens$|\/RuntimeProvider\.native$|^\.\/(cover|cover-controller|catalog|content-search)$/
          },
          () => ({ path: 'fixture', namespace: 'fixture' })
        );
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: fixture,
          loader: 'tsx',
          resolveDir: process.cwd()
        }));
      }
    }
  ]
});
const { NativeLibraryScreen } = require(outfile);
const book = {
  kind: 'book',
  key: 'book-key',
  title: 'My book',
  creators: 'Author',
  bookId: 1,
  characters: 100,
  progress: 0,
  finished: false,
  wantToRead: false,
  coverBlur: false,
  hasCover: false,
  canChangeCover: true,
  source: 'Local',
  available: true
};
const statisticsProof = () => ({
  snapshotId: 'statistics-snapshot',
  query: { selectionToken: 'statistics-selection', bookSelection: 'selected', bookIds: [1] },
  books: [{ id: 1, title: 'My book', bookKey: 'content:' + 'a'.repeat(64), deletable: true }]
});
const statisticsAdmission = () => ({
  admissionVersion: 1,
  selectionToken: 'statistics-selection',
  bookId: 1
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
async function mount(t, override) {
  const calls = [],
    routes = [],
    confirmations = [];
  let serial = 0;
  const command = async (method, payload) => {
    calls.push({ method, payload });
    const changed = await override?.(method, payload);
    if (changed !== undefined) return changed;
    if (method === 'library.state')
      return {
        token: 'library-' + ++serial,
        coverToken: 'cover',
        items: [book],
        total: 1,
        totalBooks: 1,
        offset: 0,
        limit: 60,
        collections: [],
        sources: [],
        trail: [],
        counts: { finished: 0, wantToRead: 0 },
        ...(payload.detail ? { detail: { ...book, metadata: {}, direction: 'unknown' } } : {})
      };
    if (method === 'statistics.read')
      return payload.admissionVersion === 1 ? statisticsAdmission() : statisticsProof();
    return { deleted: true };
  };
  globalThis.libraryStatisticsUI = {
    runtime: { command, snapshot: { session: 'session', epoch: 1 }, busy: false },
    pathname: '/manage',
    routes,
    confirmations
  };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = async (pathname = '/manage', epoch = 1) => {
    globalThis.libraryStatisticsUI.pathname = pathname;
    globalThis.libraryStatisticsUI.runtime.snapshot.epoch = epoch;
    await act(async () => root.render(React.createElement(NativeLibraryScreen)));
  };
  await render();
  t.after(async () => {
    await act(() => root.unmount());
    container.remove();
  });
  return { calls, routes, confirmations, container, render };
}
async function click(f, label) {
  const button = [...f.container.querySelectorAll('button')].find(
    (item) => item.textContent === label
  );
  assert.ok(button, label);
  assert.equal(button.disabled, false, label);
  await act(async () => button.click());
}
const confirm = (f) =>
  f.confirmations.at(-1)[2].find((button) => button.style === 'destructive').onPress;

test('Library details opens Statistics using one bounded hint admission, never a snapshot or numeric-ID route', async (t) => {
  const f = await mount(t);
  await click(f, 'Details: My book');
  await click(f, 'Book Statistics');
  const reads = f.calls.filter((call) => call.method === 'statistics.read');
  assert.equal(reads.length, 1);
  assert.deepEqual(reads[0].payload, {
    admissionVersion: 1,
    librarySelection: { token: 'library-2', key: 'book-key' }
  });
  assert.deepEqual(f.routes, [
    { pathname: '/statistics', params: { selection: 'statistics-selection' } }
  ]);
  assert.equal(f.calls.filter((call) => call.method === 'statistics.action').length, 0);
});

test('Library history deletion confirms the exact snapshot and fences duplicate activation', async (t) => {
  const gate = deferred();
  const f = await mount(t, (method) => (method === 'statistics.action' ? gate.promise : undefined));
  await click(f, 'Details: My book');
  await click(f, 'Delete reading history');
  assert.deepEqual(f.calls.filter((call) => call.method === 'statistics.read').at(-1).payload, {
    librarySelection: { token: 'library-2', key: 'book-key' }
  });
  assert.match(
    f.confirmations[0][1],
    /all dates.*completion records.*book itself will remain.*cannot be undone/i
  );
  assert.equal(f.calls.filter((call) => call.method === 'statistics.action').length, 0);
  const action = confirm(f);
  await act(async () => {
    action();
    action();
  });
  assert.deepEqual(
    f.calls.filter((call) => call.method === 'statistics.action').map((call) => call.payload),
    [
      {
        type: 'delete-book-history',
        snapshotId: 'statistics-snapshot',
        bookId: 1,
        bookKey: 'content:' + 'a'.repeat(64),
        title: 'My book'
      }
    ]
  );
  await act(async () => gate.resolve({ deleted: true }));
  assert.equal(f.routes.length, 0);
});

test('Cancel and native alert dismissal retire Library history confirmation without writes', async (t) => {
  const f = await mount(t);
  await click(f, 'Details: My book');
  await click(f, 'Delete reading history');
  const stale = confirm(f);
  await act(async () => f.confirmations.at(-1)[2][0].onPress());
  await act(async () => stale());
  assert.equal(f.calls.filter((call) => call.method === 'statistics.action').length, 0);
  await click(f, 'Delete reading history');
  const dismissed = confirm(f);
  await act(async () => f.confirmations.at(-1)[3].onDismiss());
  await act(async () => dismissed());
  assert.equal(f.calls.filter((call) => call.method === 'statistics.action').length, 0);
});

test('Library route departure and account ABA retire pending destructive confirmations', async (t) => {
  const f = await mount(t);
  await click(f, 'Details: My book');
  await click(f, 'Delete reading history');
  const stale = confirm(f);
  await f.render('/statistics');
  await act(async () => stale());
  assert.equal(f.calls.filter((call) => call.method === 'statistics.action').length, 0);
  await f.render('/manage');
  await click(f, 'Details: My book');
  await click(f, 'Delete reading history');
  const old = confirm(f);
  await f.render('/manage', 3);
  await act(async () => old());
  assert.equal(f.calls.filter((call) => call.method === 'statistics.action').length, 0);
});

test('Library Close cancels an in-flight Statistics read and ignores its late navigation', async (t) => {
  const gate = deferred();
  const f = await mount(t, (method) => (method === 'statistics.read' ? gate.promise : undefined));
  await click(f, 'Details: My book');
  await click(f, 'Book Statistics');
  await click(f, 'Close');
  await act(async () => gate.resolve(statisticsAdmission()));
  assert.equal(f.routes.length, 0);
  assert.equal(f.container.querySelector('section'), null);
});

test('lost or substituted Library Statistics proof shows a recoverable error and never navigates or deletes', async (t) => {
  const f = await mount(t, (method, payload) =>
    method === 'statistics.read'
      ? payload.admissionVersion === 1
        ? { ...statisticsAdmission(), bookId: 2 }
        : { ...statisticsProof(), books: [{ ...statisticsProof().books[0], id: 2 }] }
      : undefined
  );
  await click(f, 'Details: My book');
  await click(f, 'Book Statistics');
  assert.match(f.container.textContent, /selection changed/);
  assert.equal(f.routes.length, 0);
  await click(f, 'Delete reading history');
  assert.equal(f.confirmations.length, 0);
  assert.equal(f.calls.filter((call) => call.method === 'statistics.action').length, 0);
});

test('changing the Library sheet retires a pending Statistics intent', async (t) => {
  const gate = deferred();
  const f = await mount(t, (method) => (method === 'statistics.read' ? gate.promise : undefined));
  await click(f, 'Details: My book');
  await click(f, 'Book Statistics');
  await click(f, 'Sort and filter');
  await act(async () => gate.resolve(statisticsAdmission()));
  assert.equal(f.routes.length, 0);
  assert.match(f.container.textContent, /Sources/);
});

test('an unconfirmed Library history mutation reports its error without replaying', async (t) => {
  const f = await mount(t, (method) => {
    if (method === 'statistics.action')
      throw new Error('History changed. Refresh before trying again.');
  });
  await click(f, 'Details: My book');
  await click(f, 'Delete reading history');
  const stale = confirm(f);
  await act(async () => stale());
  await act(async () => stale());
  assert.equal(f.calls.filter((call) => call.method === 'statistics.action').length, 1);
  assert.match(f.container.textContent, /History changed/);
});

test('Library Open refuses malformed or legacy admission replies without navigation or mutation', async (t) => {
  for (const reply of [
    null,
    statisticsProof(),
    { ...statisticsAdmission(), admissionVersion: 2 },
    { ...statisticsAdmission(), selectionToken: ['statistics-selection'] },
    { ...statisticsAdmission(), selectionToken: '../other-route' }
  ]) {
    const f = await mount(t, (method) => (method === 'statistics.read' ? reply : undefined));
    await click(f, 'Details: My book');
    await click(f, 'Book Statistics');
    assert.match(f.container.textContent, /selection changed/);
    assert.equal(f.routes.length, 0);
    assert.equal(f.confirmations.length, 0);
    assert.equal(f.calls.filter((call) => call.method === 'statistics.action').length, 0);
  }
});

test('Library account ABA permanently retires an in-flight navigation-only admission', async (t) => {
  const gate = deferred();
  const f = await mount(t, (method) => (method === 'statistics.read' ? gate.promise : undefined));
  await click(f, 'Details: My book');
  await click(f, 'Book Statistics');
  await f.render('/manage', 2);
  await f.render('/manage', 1);
  await act(async () => gate.resolve(statisticsAdmission()));
  assert.equal(f.routes.length, 0);
  assert.equal(f.confirmations.length, 0);
  assert.equal(f.calls.filter((call) => call.method === 'statistics.action').length, 0);
});
