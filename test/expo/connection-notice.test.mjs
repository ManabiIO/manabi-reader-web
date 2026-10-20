/** @license BSD-3-Clause */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, renameSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const appRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://reader.test/' });
const { window } = dom;
Object.assign(globalThis, {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  Node: window.Node,
  ShadowRoot: window.ShadowRoot,
  Event: window.Event,
  IS_REACT_ACT_ENVIRONMENT: true
});
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
window.matchMedia = () => ({
  matches: false,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {}
});
window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
window.cancelAnimationFrame = clearTimeout;
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const output = mkdtempSync(join(tmpdir(), 'reader-connection-ui-'));
const outfile = join(output, 'notice.cjs');
after(() => {
  dom.window.close();
  const trash = join(homedir(), '.Trash');
  mkdirSync(trash, { recursive: true });
  renameSync(output, join(trash, `reader-connection-ui-${Date.now()}`));
});
await build({
  entryPoints: ['apps/web/src/shared-ui/ConnectionNotice.tsx'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  conditions: ['browser'],
  resolveExtensions: ['.web.tsx', '.tsx', '.web.ts', '.ts', '.web.js', '.js'],
  tsconfig: 'apps/web/tsconfig.json',
  logLevel: 'silent',
  plugins: [
    {
      name: 'actual-rnw',
      setup(b) {
        b.onResolve({ filter: /^react(?:\/.*)?$|^react-dom(?:\/.*)?$/ }, (args) => ({
          path: require.resolve(args.path),
          external: true
        }));
        b.onResolve({ filter: /^react-native$/ }, () => ({
          path: appRequire.resolve('react-native-web'),
          external: true
        }));
        // Router is outside this UI; the component never navigates or makes network calls.
        b.onResolve({ filter: /^expo-router$/ }, () => ({ path: 'router', namespace: 'router' }));
        b.onLoad({ filter: /.*/, namespace: 'router' }, () => ({
          contents: 'export const Link = () => null;',
          loader: 'js'
        }));
      }
    }
  ]
});
const { ConnectionNotice } = require(outfile);
function mount(online) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = (value) =>
    act(() => root.render(React.createElement(ConnectionNotice, { online: value })));
  render(online);
  return {
    container,
    render,
    cleanup() {
      act(() => root.unmount());
      container.remove();
    }
  };
}

test('online and unknown connectivity do not advertise sync success', () => {
  const f = mount(undefined);
  try {
    assert.equal(f.container.textContent, '');
    f.render(true);
    assert.equal(f.container.textContent, '');
    f.render(false);
    assert.match(f.container.textContent, /Offline · On this device/);
    assert.equal(f.container.querySelector('[role=alert]'), null);
    f.render(true);
    assert.equal(f.container.textContent, '');
  } finally {
    f.cleanup();
  }
});

test('offline explanation distinguishes local progress, linked sync, and backup; Escape returns focus', () => {
  const f = mount(false);
  try {
    const trigger = f.container.querySelector('[aria-haspopup="dialog"]');
    act(() => {
      trigger.focus();
      trigger.click();
    });
    const dialog = document.querySelector('dialog[open]');
    assert.ok(dialog);
    assert.match(dialog.textContent, /Reading progress is saved on this device/);
    assert.match(dialog.textContent, /doesn’t mean everything has synced/);
    assert.match(dialog.textContent, /backup/);
    assert.equal(dialog.getAttribute('aria-modal'), 'true');
    act(() =>
      dialog.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    );
    assert.equal(document.querySelector('dialog[open]'), null);
    assert.equal(document.activeElement, trigger);
  } finally {
    f.cleanup();
  }
});

test('reconnecting keeps the explanation open and returns focus before retiring the status', () => {
  const f = mount(false);
  try {
    const trigger = f.container.querySelector('[aria-haspopup="dialog"]');
    act(() => {
      trigger.focus();
      trigger.click();
    });
    f.render(true);
    assert.match(document.querySelector('dialog[open]').textContent, /Your device is connected/);
    act(() => document.querySelector('[aria-label="Close connection details"]').click());
    assert.equal(document.activeElement, trigger);
    const next = document.createElement('button');
    document.body.append(next);
    act(() => next.focus());
    assert.equal(f.container.textContent, '');
    next.remove();
  } finally {
    f.cleanup();
  }
});
