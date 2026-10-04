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
import {ActionButton as NativeMenuButton} from './apps/web/src/shared-ui/ActionButton';
export const View=({children,style,accessibilityLabel,testID,onLayout})=>{if(onLayout&&testID)globalThis.libraryStatisticsUI.layouts[testID]=onLayout;return <div data-label={accessibilityLabel} data-testid={testID} data-style={JSON.stringify(StyleSheet.flatten(style))}>{children}</div>}; export const ScrollView=View,SafeAreaView=View,Host=View;
export const Text=({children,style,accessibilityRole})=><span role={accessibilityRole==='header'?'heading':undefined} data-color={StyleSheet.flatten(style).color}>{children}</span>; export const StyleSheet={create:x=>x,flatten:x=>Object.assign({},...(Array.isArray(x)?x.flat(Infinity):[x]).filter(Boolean))};
export const Platform={OS:"android"}; export const useColorScheme=()=>"light"; export const useWindowDimensions=()=>globalThis.libraryStatisticsUI.dimensions;
export const ActivityIndicator=()=>null; export const Modal=({visible,children})=>visible?<section>{children}</section>:null;
export const Pressable=({children,onPress,disabled,accessibilityLabel,accessibilityState,role})=><button role={role} aria-label={accessibilityLabel} aria-selected={accessibilityState?.selected} disabled={disabled} onClick={onPress}>{typeof children==='function'?children({pressed:false}):children}</button>; export const UiIcon=()=>null;
export const FlatList=({data,renderItem,numColumns,ListEmptyComponent,ListHeaderComponent,onViewableItemsChanged,accessibilityLabel})=>{if(onViewableItemsChanged)globalThis.libraryStatisticsUI.viewports[accessibilityLabel||'books']=onViewableItemsChanged;return <div data-label={accessibilityLabel} data-columns={numColumns}>{ListHeaderComponent}{data.length?data.map((item,index)=><div key={item.key}>{renderItem({item,index})}</div>):ListEmptyComponent}</div>};
export const useNativeState=value=>useRef({value}).current; export const TextInput=({value,onChangeText,editable,maxLength,numberOfLines,placeholder})=><input value={value.value} onChange={event=>onChangeText?.(event.target.value)} disabled={editable===false} maxLength={maxLength} data-rows={numberOfLines} placeholder={placeholder}/>; export const Switch=({label,value,onValueChange,disabled})=><input type="checkbox" aria-label={label} checked={value} disabled={disabled} onChange={event=>onValueChange(event.target.checked)}/>;
export const Action=({label,onPress,disabled,theme,variant})=><button data-variant={variant} data-seed={theme?.seedColor} disabled={disabled} onClick={onPress}>{label}</button>;
export const MenuAction=({label,onPress,disabled})=><NativeMenuButton role="menuitem" variant="ghost" onPress={onPress} disabled={disabled}>{label}</NativeMenuButton>;
export const Screen=({actions,children,theme,menuActions})=><main data-mode={theme?.mode} data-background={theme?.colors.background}>{actions}{menuActions?.(()=>{})}{children}</main>;
export const Alert={alert:(...args)=>globalThis.libraryStatisticsUI.confirmations.push(args)};
export const useReaderRuntime=()=>globalThis.libraryStatisticsUI.runtime;
export const usePathname=()=>globalThis.libraryStatisticsUI.pathname;
export const Link=({children})=>children; export const router={push:path=>globalThis.libraryStatisticsUI.routes.push(path)};
export const NativeLibraryContentSearch=()=>null,NativeBookCover=()=>null,NativeEditorsPicks=()=>null;
export class NativeLibraryCoverController{activate(){}dispose(){}viewport(keys){globalThis.libraryStatisticsUI.coverViewports.push(keys)}setView(token,keys){globalThis.libraryStatisticsUI.coverViews.push({token,keys})}setActive(){}};`;
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
              /^(react-native|react-native-safe-area-context|@expo\/ui|expo-router)$|\/NativeScreens$|\/UiIcon$|\/ExpoToggle$|\/RuntimeProvider\.native$|^\.\/(cover|cover-controller|catalog|content-search)$/
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
  readingLabel: 'Unread',
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
async function mount(
  t,
  override,
  uiTheme,
  dimensions = { width: 390, height: 844, fontScale: 1 },
  recentBooks = []
) {
  const calls = [],
    routes = [],
    confirmations = [];
  let serial = 0;
  let sort = { property: 'author', direction: 'asc' };
  let layout = 'grid';
  const command = async (method, payload) => {
    calls.push({ method, payload });
    const changed = await override?.(method, payload);
    if (changed !== undefined) return changed;
    if (method === 'library.action' && payload.type === 'sort')
      sort = { property: payload.property, direction: payload.direction };
    if (method === 'library.action' && payload.type === 'layout') layout = payload.value;
    if (method === 'library.state')
      return {
        token: 'library-' + ++serial,
        sort,
        layout,
        uiTheme,
        coverToken: 'cover',
        recentBooks,
        items: ['finished', 'want-to-read'].includes(payload.collection) ? [] : [book],
        total: ['finished', 'want-to-read'].includes(payload.collection) ? 0 : 1,
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
    dimensions,
    layouts: {},
    viewports: {},
    coverViews: [],
    coverViewports: [],
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
  return {
    calls,
    routes,
    confirmations,
    container,
    render,
    async resize(dimensions, paneWidth) {
      globalThis.libraryStatisticsUI.dimensions = dimensions;
      await render();
      if (paneWidth !== undefined)
        await act(() =>
          globalThis.libraryStatisticsUI.layouts['library-content']({
            nativeEvent: { layout: { width: paneWidth } }
          })
        );
    }
  };
}
async function click(f, label) {
  const button = [...f.container.querySelectorAll('button')].find(
    (item) => item.textContent === label || item.getAttribute('aria-label') === label
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

test('mounted native Library applies saved appearance to its screen, native menu and Expo actions without settings writes', async (t) => {
  const uiTheme = { themeId: 'manabi-theme', appearance: 'dark', customThemes: {} };
  const f = await mount(t, undefined, uiTheme);
  const root = () => f.container.querySelector('main');
  assert.equal(root().dataset.mode, 'dark');
  const dark = root().dataset.background;
  const action = [...f.container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Refresh'
  );
  const expoAction = [...f.container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Add Books'
  );
  const darkSeed = expoAction.dataset.seed;
  assert.ok(darkSeed);
  const menuColor = () => action.querySelector('[data-color]').dataset.color;
  const darkMenuColor = menuColor();
  assert.ok(darkMenuColor);
  assert.match(f.container.textContent, /NEW/);
  uiTheme.appearance = 'light';
  await click(f, 'Refresh');
  assert.equal(root().dataset.mode, 'light');
  assert.notEqual(root().dataset.background, dark);
  assert.notEqual(expoAction.dataset.seed, darkSeed);
  assert.notEqual(menuColor(), darkMenuColor);
  assert.ok(f.calls.every((call) => call.method === 'library.state'));
});

test('native metadata uses the complete shared field limits and blocks editing during an admitted save', async (t) => {
  const gate = deferred();
  const f = await mount(t, (method) => (method === 'library.action' ? gate.promise : undefined));
  await click(f, 'Details: My book');
  const field = (placeholder) =>
    [...f.container.querySelectorAll('input')].find((input) => input.placeholder === placeholder);
  assert.equal(field('Authors (one per line)').maxLength, 16415);
  assert.equal(field('Author sort names (matching lines, optional)').maxLength, 16415);
  assert.equal(field('Tags (one per line)').maxLength, 15423);
  assert.equal(field('Description').dataset.rows, '5');
  assert.ok(field('For example, 2024-03-01'));
  await click(f, 'Save metadata');
  assert.equal(field('Title').disabled, true);
  assert.equal(field('Authors (one per line)').disabled, true);
  assert.equal(f.calls.filter((call) => call.method === 'library.action').length, 1);
  await act(async () => gate.resolve({ saved: true }));
});

test('Library restores saved sort controls, saves one choice and keeps filters open', async (t) => {
  const f = await mount(t);
  await click(f, 'Sort and filter');
  const button = (label) =>
    [...f.container.querySelectorAll('button')].find(
      (item) => item.textContent === label || item.getAttribute('aria-label') === label
    );
  assert.equal(button('Author').dataset.variant, 'filled');
  assert.equal(button('Ascending').dataset.variant, 'filled');
  await click(f, 'Title');
  const writes = f.calls.filter((call) => call.method === 'library.action');
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].payload, {
    token: 'library-1',
    type: 'sort',
    property: 'title',
    direction: 'asc'
  });
  assert.equal(button('Title').dataset.variant, 'filled');
  await click(f, 'Descending');
  assert.equal(button('Descending').dataset.variant, 'filled');
  await f.render('/manage', 2);
  await click(f, 'Sort and filter');
  assert.equal(button('Title').dataset.variant, 'filled');
  assert.equal(button('Descending').dataset.variant, 'filled');
});
test('pending sort saves reject duplicate activation and do not refresh a departed Library', async (t) => {
  const pending = deferred();
  const f = await mount(t, (method, payload) =>
    method === 'library.action' && payload.type === 'sort' ? pending.promise : undefined
  );
  await click(f, 'Sort and filter');
  const title = [...f.container.querySelectorAll('button')].find(
    (item) => item.textContent === 'Title'
  );
  await act(async () => {
    title.click();
    title.click();
  });
  assert.equal(f.calls.filter((call) => call.method === 'library.action').length, 1);
  assert.equal(title.disabled, true);
  await f.render('/settings');
  const reads = f.calls.filter((call) => call.method === 'library.state').length;
  await act(async () => pending.resolve({ saved: true }));
  assert.equal(f.calls.filter((call) => call.method === 'library.state').length, reads);
});

test('changing saved sorting returns to page one, reconciles errors and never replays the action', async (t) => {
  let serial = 0;
  const f = await mount(t, (method, payload) => {
    if (method === 'library.action')
      throw new Error('The sort acknowledgment was lost. Refresh to check it.');
    if (method === 'library.state')
      return {
        token: 'paged-' + ++serial,
        coverToken: 'cover',
        recentBooks: [],
        sort: { property: 'author', direction: 'asc' },
        items: [book],
        total: 121,
        totalBooks: 121,
        offset: payload.offset ?? 0,
        limit: 60,
        collections: [],
        sources: [],
        trail: [],
        counts: { finished: 0, wantToRead: 0 }
      };
  });
  await click(f, 'Next');
  assert.equal(f.calls.filter((call) => call.method === 'library.state').at(-1).payload.offset, 60);
  await click(f, 'Sort and filter');
  await click(f, 'Title');
  assert.equal(f.calls.filter((call) => call.method === 'library.action').length, 1);
  assert.equal(f.calls.filter((call) => call.method === 'library.state').at(-1).payload.offset, 0);
  assert.match(f.container.textContent, /acknowledgment was lost/);
  const author = [...f.container.querySelectorAll('button')].find(
    (item) => item.textContent === 'Author'
  );
  assert.equal(author.dataset.variant, 'filled', 'only the owner read confirms the saved choice');
});

test('account replacement permanently retires an old sort reply without refreshing the new Library', async (t) => {
  const pending = deferred();
  let writes = 0;
  const f = await mount(t, (method, payload) =>
    method === 'library.action' && payload.type === 'sort' && ++writes === 1
      ? pending.promise
      : undefined
  );
  await click(f, 'Sort and filter');
  await act(async () =>
    [...f.container.querySelectorAll('button')].find((item) => item.textContent === 'Title').click()
  );
  await f.render('/manage', 2);
  const reads = f.calls.filter((call) => call.method === 'library.state').length;
  await act(async () => pending.reject(new Error('Old account sort failed')));
  assert.equal(f.calls.filter((call) => call.method === 'library.state').length, reads);
  assert.ok(!f.container.textContent.includes('Old account sort failed'));
  await click(f, 'Sort and filter');
  await click(f, 'Descending');
  assert.equal(
    f.calls.filter((call) => call.method === 'library.action').length,
    2,
    'new account remains usable'
  );
  assert.equal(
    [...f.container.querySelectorAll('button')].find((item) => item.textContent === 'Descending')
      .dataset.variant,
    'filled'
  );
});

test('saved layout controls restore after remount and change the actual list column count', async (t) => {
  const f = await mount(t);
  await click(f, 'Sort and filter');
  const toggle = () => f.container.querySelector('[aria-label="Grid layout"]');
  assert.equal(toggle().checked, true);
  assert.equal(f.container.querySelector('[data-columns]').dataset.columns, '2');
  await act(async () => toggle().click());
  assert.equal(toggle().checked, false);
  assert.equal(f.container.querySelector('[data-columns]').dataset.columns, '1');
  assert.deepEqual(f.calls.filter((call) => call.method === 'library.action').at(-1).payload, {
    token: 'library-1',
    type: 'layout',
    value: 'list'
  });
  await f.render('/manage', 2);
  await click(f, 'Sort and filter');
  assert.equal(toggle().checked, false);
  assert.equal(f.container.querySelector('[data-columns]').dataset.columns, '1');
});

test('layout saves retain the current page and selection and reconcile a lost acknowledgment without replay', async (t) => {
  let serial = 0,
    layout = 'grid';
  const f = await mount(t, (method, payload) => {
    if (method === 'library.action' && payload.type === 'layout') {
      layout = payload.value;
      throw new Error('Layout acknowledgment lost');
    }
    if (method === 'library.state')
      return {
        token: 'paged-' + ++serial,
        coverToken: 'cover',
        recentBooks: [],
        layout,
        sort: { property: 'title', direction: 'asc' },
        items: [book],
        total: 121,
        totalBooks: 121,
        offset: payload.offset ?? 0,
        limit: 60,
        collections: [],
        sources: [],
        trail: [],
        counts: { finished: 0, wantToRead: 0 }
      };
  });
  await click(f, 'Next');
  await click(f, 'Select');
  await click(f, 'Select page');
  await click(f, 'Sort and filter');
  await act(async () => f.container.querySelector('[aria-label="Grid layout"]').click());
  assert.equal(f.calls.filter((call) => call.method === 'library.action').length, 1);
  assert.equal(f.calls.filter((call) => call.method === 'library.state').at(-1).payload.offset, 60);
  assert.equal(f.container.querySelector('[aria-label="Grid layout"]').checked, false);
  assert.match(f.container.textContent, /Layout acknowledgment lost/);
  assert.match(f.container.textContent, /1 selected on this page/);
});

test('pending layout saves disable the switch and retire replies on route or account departure', async (t) => {
  for (const [path, epoch] of [
    ['/settings', 1],
    ['/manage', 2]
  ]) {
    const pending = deferred();
    const f = await mount(t, (method, payload) =>
      method === 'library.action' && payload.type === 'layout' ? pending.promise : undefined
    );
    await click(f, 'Sort and filter');
    const toggle = f.container.querySelector('[aria-label="Grid layout"]');
    await act(async () => {
      toggle.click();
      toggle.click();
    });
    assert.equal(f.calls.filter((call) => call.method === 'library.action').length, 1);
    assert.equal(toggle.disabled, true);
    await f.render(path, epoch);
    const reads = f.calls.filter((call) => call.method === 'library.state').length;
    await act(async () => pending.reject(new Error('Departed layout failure')));
    assert.equal(f.calls.filter((call) => call.method === 'library.state').length, reads);
    assert.ok(!f.container.textContent.includes('Departed layout failure'));
  }
});

test('wide native Library shelves navigate locally and size the grid to the measured content pane', async (t) => {
  const f = await mount(t, undefined, undefined, { width: 1200, height: 900, fontScale: 1 });
  assert.ok(f.container.querySelector('[data-label="Library shelves"]'));
  assert.equal(f.container.querySelector('[data-columns]').dataset.columns, '6');
  assert.equal(
    f.container.querySelector('[aria-label="Books (1)"]').getAttribute('aria-selected'),
    'true'
  );
  assert.ok(
    !f.container.textContent.includes('All Books (1)'),
    'wide layout has one shelf navigation'
  );
  await f.resize({ width: 1200, height: 900, fontScale: 1 }, 870);
  assert.equal(
    f.container.querySelector('[data-columns]').dataset.columns,
    '5',
    'safe-area/pane measurement controls columns'
  );
  await click(f, 'Finished (0)');
  assert.equal(
    f.calls.filter((call) => call.method === 'library.state').at(-1).payload.collection,
    'finished'
  );
  assert.equal(
    f.container.querySelector('[aria-label="Finished (0)"]').getAttribute('aria-selected'),
    'true'
  );
  assert.deepEqual(f.routes, []);
  assert.match(f.container.textContent, /No finished books yet/);
  assert.ok(!f.container.textContent.includes('Import an EPUB'));
  const reads = f.calls.filter((call) => call.method === 'library.state').length;
  await f.resize({ width: 390, height: 844, fontScale: 1 }, 390);
  assert.equal(f.container.querySelector('[data-label="Library shelves"]'), null);
  assert.match(f.container.textContent, /All Books \(1\)/);
  assert.equal(
    f.calls.filter((call) => call.method === 'library.state').length,
    reads,
    'resize preserves the admitted shelf'
  );
  await f.resize({ width: 1200, height: 900, fontScale: 1 }, 960);
  assert.equal(
    f.container.querySelector('[aria-label="Finished (0)"]').getAttribute('aria-selected'),
    'true'
  );
  await click(f, 'Snippets');
  assert.deepEqual(f.routes, ['/snippets']);
  await click(f, 'Manage collections');
  assert.match(f.container.textContent, /Manage collections/);
});

test('enlarged text and compact landscape keep the native Library free of a sidebar drawer', async (t) => {
  const f = await mount(t, undefined, undefined, { width: 1200, height: 900, fontScale: 2 });
  assert.equal(f.container.querySelector('[data-label="Library shelves"]'), null);
  assert.match(f.container.textContent, /All Books \(1\)/);
  await f.resize({ width: 844, height: 390, fontScale: 1 }, 844);
  assert.equal(f.container.querySelector('[data-label="Library shelves"]'), null);
  assert.equal(f.container.querySelector('[data-columns]').dataset.columns, '5');
});

test('empty compact shelves explain their collection without asking to reimport existing books', async (t) => {
  const f = await mount(t);
  await click(f, 'Finished (0)');
  assert.match(f.container.textContent, /No finished books yet/);
  assert.ok(!f.container.textContent.includes('Import an EPUB'));
  await f.resize({ width: 1200, height: 900, fontScale: 1 });
  await click(f, 'Want to Read (0)');
  assert.match(f.container.textContent, /No books marked Want to Read yet/);
  assert.ok(!f.container.textContent.includes('Import an EPUB'));
  await f.render('/settings');
  assert.equal(f.container.querySelector('[aria-label="Books (1)"]').disabled, true);
});

test('Continue uses the shared Library token for opening/details and merges both thumbnail viewports', async (t) => {
  const recent = {
    ...book,
    key: 'recent-key',
    bookId: 2,
    title: 'Recent book',
    hasCover: true,
    readingLabel: '42%'
  };
  const f = await mount(t, undefined, undefined, undefined, [recent]);
  const shelf = () => f.container.querySelector('[data-label="Continue reading"]');
  assert.ok(shelf());
  assert.match(shelf().textContent, /Recent bookAuthor42%/);
  assert.ok(globalThis.libraryStatisticsUI.coverViews.some((v) => v.keys?.includes('recent-key')));
  await act(() => {
    globalThis.libraryStatisticsUI.viewports['Continue reading']({
      viewableItems: [{ item: recent }]
    });
    globalThis.libraryStatisticsUI.viewports.books({
      viewableItems: [{ item: { ...book, hasCover: true } }]
    });
  });
  assert.deepEqual(globalThis.libraryStatisticsUI.coverViewports.at(-1), [
    'recent-key',
    'book-key'
  ]);
  await click(f, 'Select');
  assert.equal(shelf(), null);
  assert.deepEqual(globalThis.libraryStatisticsUI.coverViewports.at(-1), ['book-key']);
  await click(f, 'Cancel selection');
  assert.ok(shelf());
  await click(f, 'Details: Recent book in Continue');
  assert.equal(
    f.calls.filter((c) => c.method === 'library.state').at(-1).payload.detail,
    'recent-key'
  );
  await click(f, 'Close');
  await click(f, 'Continue Recent book');
  const opened = f.calls.find((c) => c.method === 'open');
  assert.equal(opened.payload.bookId, 2);
  assert.deepEqual(opened.payload.libraryKeys, ['recent-key']);
  assert.match(opened.payload.libraryToken, /^library-/);
  assert.deepEqual(f.routes, [{ pathname: '/b', params: { id: 2 } }]);
});

test('Continue hides for scoped shelves and retired routes cannot navigate after a pending open', async (t) => {
  const pending = deferred();
  const recent = { ...book, key: 'recent-key', bookId: 2, title: 'Recent book' };
  const f = await mount(
    t,
    (method) => (method === 'open' ? pending.promise : undefined),
    undefined,
    undefined,
    [recent]
  );
  await click(f, 'Finished (0)');
  assert.equal(f.container.querySelector('[data-label="Continue reading"]'), null);
  await click(f, 'All Books (1)');
  const open = f.container.querySelector('[aria-label="Continue Recent book"]');
  await act(() => open.click());
  assert.equal(open.disabled, true);
  await act(() => open.click());
  assert.equal(f.calls.filter((c) => c.method === 'open').length, 1);
  await f.render('/settings');
  await act(() => pending.resolve({ opened: true }));
  assert.deepEqual(f.routes, []);
});

test('Continue open failures remain visible and permit an explicit retry', async (t) => {
  let tries = 0;
  const f = await mount(
    t,
    (method) => {
      if (method === 'open' && ++tries === 1) throw new Error('Saved copy changed');
    },
    undefined,
    undefined,
    [{ ...book, title: 'Recent book' }]
  );
  await click(f, 'Continue Recent book');
  assert.match(f.container.textContent, /Saved copy changed/);
  assert.deepEqual(f.routes, []);
  assert.equal(
    f.calls.filter((c) => c.method === 'open').length,
    1,
    'failure never replays an open'
  );
  await click(f, 'Continue Recent book');
  const opens = f.calls.filter((c) => c.method === 'open');
  assert.notEqual(
    opens[0].payload.libraryToken,
    opens[1].payload.libraryToken,
    'explicit retry receives a fresh access admission'
  );
  assert.deepEqual(f.routes, [{ pathname: '/b', params: { id: 1 } }]);
});

async function finishedFixture(t, change) {
  let order = 'desc',
    layout = 'list',
    serial = 0;
  const books = [
    {
      ...book,
      key: 'old',
      bookId: 2,
      title: 'Older book',
      readingLabel: 'Finished',
      finished: true,
      finishedOn: '2026-10-01'
    },
    {
      ...book,
      key: 'new',
      bookId: 3,
      title: 'Newer book',
      readingLabel: 'Finished',
      finished: true,
      finishedOn: '2026-10-03'
    },
    {
      ...book,
      key: 'unknown',
      bookId: 4,
      title: 'Undated book',
      readingLabel: 'Finished',
      finished: true
    }
  ];
  return mount(t, async (method, payload) => {
    if (method === 'library.action') {
      await change?.(payload);
      if (payload.type === 'finished.order') order = payload.value;
      if (payload.type === 'layout') layout = payload.value;
    }
    if (method === 'library.state')
      return {
        token: 'finished-' + ++serial,
        coverToken: 'finished-cover',
        sort: { property: 'title', direction: 'asc' },
        finishedOrder: order,
        layout: payload.collection === 'finished' ? layout : 'grid',
        recentBooks: [],
        items:
          payload.collection === 'finished'
            ? order === 'desc'
              ? [books[1], books[0], books[2]]
              : books
            : books,
        total: 3,
        totalBooks: 3,
        offset: 0,
        limit: 60,
        collections: [],
        sources: [],
        trail: [],
        counts: { finished: 3, wantToRead: 0 },
        ...(payload.detail
          ? {
              detail: {
                ...books.find((b) => b.key === payload.detail),
                metadata: {},
                direction: 'unknown'
              }
            }
          : {})
      };
  });
}

test('Finished timeline renders calendar-day headers, restores layout/order and keeps contextual controls', async (t) => {
  const f = await finishedFixture(t);
  await click(f, 'Sort and filter');
  await act(() => f.container.querySelector('[aria-label="Unfinished books only"]').click());
  await click(f, 'Close');
  await click(f, 'Finished (3)');
  assert.equal(
    f.calls.filter((c) => c.method === 'library.state').at(-1).payload.unfinished,
    false
  );
  const headings = () =>
    [...f.container.querySelectorAll('[role="heading"]')].map((h) => h.textContent);
  assert.deepEqual(headings(), ['Oct 3, 2026', 'Oct 1, 2026', 'Date not set']);
  assert.equal(f.container.querySelector('[data-columns]').dataset.columns, '1');
  assert.match(f.container.textContent, /Finished · Oct 3, 2026/);
  await click(f, 'Sort and filter');
  assert.ok(![...f.container.querySelectorAll('button')].some((b) => b.textContent === 'Author'));
  assert.equal(f.container.querySelector('[aria-label="Unfinished books only"]'), null);
  await click(f, 'Oldest first');
  assert.deepEqual(
    headings().filter((h) => h !== 'Sort and filter'),
    ['Oct 1, 2026', 'Oct 3, 2026', 'Date not set']
  );
  assert.deepEqual(
    f.calls.filter((c) => c.method === 'library.action').map((c) => c.payload.type),
    ['finished.order']
  );
  const grid = f.container.querySelector('[aria-label="Grid layout (off uses timeline)"]');
  await act(() => grid.click());
  assert.equal(f.container.querySelector('[data-columns]').dataset.columns, '2');
  assert.deepEqual(
    headings().filter((h) => h !== 'Sort and filter'),
    []
  );
  await f.render('/manage', 2);
  await click(f, 'Finished (3)');
  assert.equal(
    f.container.querySelector('[data-columns]').dataset.columns,
    '2',
    'Finished grid persists independently after remount'
  );
  await click(f, 'Sort and filter');
  const restored = f.container.querySelector('[aria-label="Grid layout (off uses timeline)"]');
  await act(() => restored.click());
  await click(f, 'Close');
  assert.deepEqual(headings(), ['Oct 1, 2026', 'Oct 3, 2026', 'Date not set']);
  await click(f, 'Select');
  await click(f, 'Select page');
  assert.match(f.container.textContent, /3 selected on this page/);
  assert.deepEqual(headings(), ['Oct 1, 2026', 'Oct 3, 2026', 'Date not set']);
});

test('pending Finished order saves fence duplicate activation and retire on route departure', async (t) => {
  const pending = deferred();
  const f = await finishedFixture(t, (payload) =>
    payload.type === 'finished.order' ? pending.promise : undefined
  );
  await click(f, 'Finished (3)');
  await click(f, 'Sort and filter');
  const oldest = [...f.container.querySelectorAll('button')].find(
    (b) => b.textContent === 'Oldest first'
  );
  await act(() => oldest.click());
  assert.equal(oldest.disabled, true);
  await act(() => oldest.click());
  assert.equal(f.calls.filter((c) => c.method === 'library.action').length, 1);
  const reads = f.calls.filter((c) => c.method === 'library.state').length;
  await f.render('/settings');
  await act(() => pending.resolve());
  assert.equal(f.calls.filter((c) => c.method === 'library.state').length, reads);
});
