/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
const require = createRequire(import.meta.url);
const output = await build({
  stdin: {
    contents: `export {ScreenStatusBar} from './apps/web/src/shared-ui/ScreenStatusBar';
      export {contextualDestinations} from './apps/web/src/shared-ui/navigation-context';
      export {RouteContext,activate} from 'expo-router';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  plugins: [
    {
      name: 'system-chrome-leaves',
      setup(b) {
        b.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({
          path: require.resolve(path),
          external: true
        }));
        b.onResolve({ filter: /^expo-router$|^expo-status-bar$|^\.\/theme$/ }, ({ path }) => ({
          path,
          namespace: 'fixture'
        }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'expo-router'
              ? `import React from 'react';
          export const RouteContext=React.createContext('library');
          let active='library'; const listeners=new Set();
          export function activate(route){active=route;for(const listener of listeners)listener();}
          export function useFocusEffect(callback){const route=React.useContext(RouteContext);
            React.useEffect(()=>{let cleanup;const update=()=>{cleanup?.();cleanup=active===route?callback():undefined;};
              listeners.add(update);update();return()=>{listeners.delete(update);cleanup?.();};},[route,callback]);}`
              : path === 'expo-status-bar'
                ? `import React from 'react';export const StatusBar=({style})=><span data-status-bar={style}/>;`
                : `export const useUiTheme=()=>({mode:'light'});`,
          loader: 'jsx',
          resolveDir: process.cwd()
        }));
      }
    }
  ]
});
const module = { exports: {} };
vm.runInNewContext(output.outputFiles[0].text, { module, exports: module.exports, require });
const { ScreenStatusBar, RouteContext, activate, contextualDestinations } = module.exports;

test('native menus retain working destinations and omit placeholder integrations without changing web routes', () => {
  const paths = (route, platform) =>
    Array.from(contextualDestinations(route, platform), (item) => item.path);
  assert.deepEqual(paths('/manage', 'android'), [
    '/snippets',
    '/statistics',
    '/settings',
    '/connections'
  ]);
  assert.deepEqual(paths('/connections', 'android'), []);
  assert.deepEqual(paths('/settings', 'android'), ['/connections']);
  assert.deepEqual(paths('/connections', 'web'), ['/shared-library', '/import-ttu']);
  assert.deepEqual(paths('/shared-library', 'android'), ['/connections']);
});

test('focused appearance owns the status bar and retained screens release it on Back', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true
  });
  const { createRoot } = require('react-dom/client');
  const container = dom.window.document.createElement('div');
  dom.window.document.body.append(container);
  const root = createRoot(container);
  const h = React.createElement;
  const screens = (mode) =>
    h(
      React.Fragment,
      null,
      h(
        RouteContext.Provider,
        { value: 'library' },
        h(ScreenStatusBar, { theme: { mode: 'dark' } })
      ),
      h(RouteContext.Provider, { value: 'settings' }, h(ScreenStatusBar, { theme: { mode } }))
    );
  const style = () =>
    [...container.querySelectorAll('[data-status-bar]')].map((node) => node.dataset.statusBar);
  try {
    await act(async () => root.render(screens('light')));
    assert.deepEqual(style(), ['light'], 'saved dark Library needs light icons on a light OS');
    await act(async () => activate('settings'));
    assert.deepEqual(
      style(),
      ['dark'],
      'retained Library must not override the light pushed route'
    );
    await act(async () => root.render(screens('dark')));
    assert.deepEqual(
      style(),
      ['light'],
      'selected appearance updates the focused route immediately'
    );
    await act(async () => activate('library'));
    assert.deepEqual(style(), ['light'], 'Back restores the retained Library appearance');
    await act(async () => activate('reader'));
    assert.deepEqual(style(), [], 'other routes leave system chrome to the root or reader');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
