/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const React = require('react'),
  { act } = React;
const dom = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Event: dom.window.Event,
  IS_REACT_ACT_ENVIRONMENT: true
});
const { createRoot } = require('react-dom/client');
const output = mkdtempSync(join(tmpdir(), 'native-catalog-ui-'));
process.on('exit', () => rmSync(output, { recursive: true, force: true }));
const adapters = {
  native: `import React from 'react'; export const View=({children})=><div>{children}</div>; export const Text=({children,accessibilityRole})=><span role={accessibilityRole==='alert'?'alert':undefined}>{children}</span>; export const ScrollView=View; export const ActivityIndicator=({accessibilityLabel})=><div role="status">{accessibilityLabel}</div>; export const StyleSheet={create:x=>x}; export const AppState={addEventListener:(_event,callback)=>{globalThis.nativeCatalogUI.background=callback;return {remove(){globalThis.nativeCatalogUI.background=undefined}}}};`,
  safe: `import React from 'react'; export const SafeAreaView=({children})=><main>{children}</main>;`,
  action: `import React from 'react'; export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
  runtime: `export const useReaderRuntime=()=>({command:globalThis.nativeCatalogUI.command});`,
  router: `export const router={push:path=>globalThis.nativeCatalogUI.routes.push(path)};`
};
const outfile = join(output, 'ui.cjs');
await build({
  entryPoints: ['apps/web/src/native-library/catalog.tsx'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  jsx: 'automatic',
  tsconfig: 'apps/web/tsconfig.json',
  logLevel: 'silent',
  plugins: [
    {
      name: 'native-ui-adapters',
      setup(b) {
        b.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({
          path: require.resolve(path),
          external: true
        }));
        b.onResolve(
          {
            filter:
              /^(react-native|react-native-safe-area-context|expo-router)$|\/NativeScreens$|\/RuntimeProvider\.native$/
          },
          ({ path }) => ({
            path:
              path === 'react-native'
                ? 'native'
                : path === 'react-native-safe-area-context'
                  ? 'safe'
                  : path === 'expo-router'
                    ? 'router'
                    : path.endsWith('NativeScreens')
                      ? 'action'
                      : 'runtime',
            namespace: 'fixture'
          })
        );
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents: adapters[path],
          loader: 'tsx',
          resolveDir: process.cwd()
        }));
      }
    }
  ]
});
const { NativeEditorsPicks } = require(outfile);
const ready = {
  token: 'catalog_token',
  status: 'ready',
  items: [
    { key: 'item_token', title: 'A public book', author: 'A writer', summary: 'A plain summary' }
  ],
  total: 21,
  offset: 0,
  limit: 20
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function mount(t, override) {
  const calls = [],
    routes = [];
  let closed = 0;
  globalThis.nativeCatalogUI = {
    calls,
    routes,
    command: async (method, payload) => {
      calls.push([method, payload]);
      return override ? override(method, payload) : ready;
    }
  };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      React.createElement(NativeEditorsPicks, {
        close: () => {
          closed++;
        }
      })
    )
  );
  t.after(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete globalThis.nativeCatalogUI;
  });
  const button = (label) =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === label);
  return { calls, routes, container, button, closed: () => closed };
}

test('native catalog renders plain metadata, real Open/Cancel controls and one same-turn navigation', async (t) => {
  const wait = deferred();
  const f = await mount(t, (method) => (method === 'library.catalog.open' ? wait.promise : ready));
  assert.match(f.container.textContent, /Editor's Picks.*A public book.*A writer.*A plain summary/);
  assert.equal(f.container.querySelector('img,iframe,webview'), null);
  assert.equal(f.button('Previous').disabled, true);
  assert.equal(f.button('Next').disabled, false);
  await act(async () => {
    f.button('Open').click();
    f.button('Open')?.click();
  });
  assert.equal(f.calls.filter(([method]) => method === 'library.catalog.open').length, 1);
  assert.equal(f.button('Opening…').disabled, true);
  assert.ok(f.button('Cancel'));
  await act(async () => wait.resolve({ bookId: 7 }));
  assert.deepEqual(f.routes, [{ pathname: '/b', params: { id: '7' } }]);
  assert.equal(f.closed(), 1);
  assert.equal(f.calls.filter(([method]) => method === 'library.catalog.cancel').length, 0);
});

test('background and Cancel retire native catalog work and cannot navigate on late import acknowledgement', async (t) => {
  const wait = deferred();
  const f = await mount(t, (method) => (method === 'library.catalog.open' ? wait.promise : ready));
  await act(async () => f.button('Open').click());
  await act(async () => globalThis.nativeCatalogUI.background('background'));
  assert.deepEqual(f.calls.at(-1), ['library.catalog.cancel', { token: 'catalog_token' }]);
  await act(async () => wait.resolve({ bookId: 7 }));
  assert.deepEqual(f.routes, []);
  assert.ok(f.button('Try Again'));
  await act(async () => f.button('Close').click());
  assert.equal(f.closed(), 1);
});

test('catalog pagination uses bounded page request, error retry and native Back/route cleanup wiring', async (t) => {
  let starts = 0;
  const f = await mount(t, (method, payload) => {
    if (method === 'library.catalog.start')
      return ++starts === 1 ? { ...ready, status: 'error', items: [] } : ready;
    if (method === 'library.catalog.read') return { ...ready, offset: payload.offset };
    return null;
  });
  assert.ok(f.button('Try Again'));
  await act(async () => f.button('Try Again').click());
  await act(async () => f.button('Next').click());
  assert.deepEqual(f.calls.at(-1), [
    'library.catalog.read',
    { token: 'catalog_token', offset: 20 }
  ]);
  assert.equal(f.button('Next').disabled, true);
  assert.equal(f.button('Previous').disabled, false);
  const index = readFileSync('apps/web/src/native-library/index.tsx', 'utf8');
  assert.match(index, /catalogVisible && focused/);
  assert.match(index, /onRequestClose=\{closeCatalog\}/);
  assert.match(index, /if \(!focused\) \{[\s\S]*?setCatalogVisible\(false\)/);
});
