/** @license BSD-3-Clause; Copyright (c) 2026, ッツ Reader Authors. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const appRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://localhost.test/'
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  ShadowRoot: dom.window.ShadowRoot,
  IS_REACT_ACT_ENVIRONMENT: true
});
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.ResizeObserver = globalThis.ResizeObserver;
window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
window.cancelAnimationFrame = clearTimeout;

const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const output = mkdtempSync(join(tmpdir(), 'title-selection-row-'));
const outfile = join(output, 'row.cjs');
await build({
  stdin: {
    contents: `export { TitleSelectionRow } from './apps/web/src/shared-ui/TitleSelectionRow'; export { CheckboxField } from './apps/web/src/shared-ui/Fields';`,
    resolveDir: process.cwd()
  },
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
      name: 'actual-rnw-and-expo-ui',
      setup(b) {
        b.onResolve({ filter: /^react(?:\/.*)?$|^react-dom(?:\/.*)?$/ }, (args) => ({
          path: require.resolve(args.path),
          external: true
        }));
        b.onResolve({ filter: /^react-native$/ }, () => ({
          path: appRequire.resolve('react-native-web'),
          external: true
        }));
      }
    }
  ]
});
const { TitleSelectionRow, CheckboxField } = require(outfile);
const h = React.createElement;

test('title rows put padding on the actual Expo checkbox label and retain selected, disabled and focus semantics', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const changes = [];
  const render = (value, disabled = false) =>
    act(() =>
      root.render(
        h(
          TitleSelectionRow,
          { disabled },
          h(CheckboxField, {
            label: 'A very long book title',
            value,
            disabled,
            onValueChange: (next) => changes.push(next),
            style: { flex: 1 }
          })
        )
      )
    );
  try {
    render(false);
    const row = container.querySelector('[data-ui-title-selection-row]');
    const checkbox = row.querySelector('input[type="checkbox"]');
    const label = checkbox.labels[0];
    assert.ok(row.contains(label));
    assert.equal(row.style.padding, '');
    assert.equal(label.style.minHeight, '');
    assert.equal(label.style.height, '');
    assert.equal(window.getComputedStyle(label).padding, '12px');
    assert.equal(window.getComputedStyle(label).gap, '12px');
    assert.equal(window.getComputedStyle(label).boxSizing, 'border-box');
    assert.match(label.textContent, /A very long book title/);
    act(() => label.click());
    assert.deepEqual(changes, [true]);
    render(true);
    assert.equal(checkbox.checked, true);
    act(() => checkbox.focus());
    assert.equal(document.activeElement, checkbox);
    const css = [...document.querySelectorAll('style')].map((node) => node.textContent).join('\n');
    // JSDOM does not consistently honor selector specificity across React's
    // deduplicated style resources. Real geometry remains a browser gate.
    assert.match(
      css,
      /\[data-ui-title-selection-row\] \[data-ui-toggle='checkbox'\] label\s*\{\s*box-sizing: border-box; min-height: 52px; padding: 12px; gap: 12px;/
    );
    assert.match(css, /\[data-ui-title-selection-row\]:not\(\[data-disabled='true'\]\):hover/);
    assert.match(
      css,
      /\[data-ui-title-selection-row\]:focus-within\s*\{ background: var\(--muted\)/
    );
    render(true, true);
    assert.equal(row.dataset.disabled, 'true');
    assert.equal(checkbox.disabled, true);
    act(() => label.click());
    assert.deepEqual(changes, [true]);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test.after(() => {
  rmSync(output, { recursive: true, force: true });
  dom.window.close();
});
