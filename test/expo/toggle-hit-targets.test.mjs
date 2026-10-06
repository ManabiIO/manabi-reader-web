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
const { window } = dom;
const { document } = window;
Object.assign(globalThis, {
  window,
  document,
  HTMLElement: window.HTMLElement,
  Node: window.Node,
  ShadowRoot: window.ShadowRoot,
  IS_REACT_ACT_ENVIRONMENT: true
});
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
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
const output = mkdtempSync(join(tmpdir(), 'toggle-hit-targets-'));
const outfile = join(output, 'controls.cjs');
await build({
  stdin: {
    contents: `export { CheckboxField, SwitchField } from './apps/web/src/shared-ui/Fields'; export { TitleSelectionRow } from './apps/web/src/shared-ui/TitleSelectionRow';`,
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
const { CheckboxField, SwitchField, TitleSelectionRow } = require(outfile);
const h = React.createElement;

function styleRules() {
  return [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]);
}

for (const { kind, Control, titleRow } of [
  { kind: 'checkbox', Control: CheckboxField, titleRow: false },
  { kind: 'checkbox', Control: CheckboxField, titleRow: true },
  { kind: 'switch', Control: SwitchField, titleRow: false }
]) {
  test(`real Expo ${titleRow ? 'title-row ' : ''}${kind} input overrides RNW pointer priority and retains label, focus and disabled behavior`, () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const changes = [];
    function Fixture({ disabled = false }) {
      const [value, setValue] = React.useState(false);
      const control = h(Control, {
        label: 'Reading statistics control',
        value,
        disabled,
        onValueChange(next) {
          changes.push(next);
          setValue(next);
        }
      });
      return titleRow ? h(TitleSelectionRow, { disabled }, control) : control;
    }
    try {
      act(() => root.render(h(Fixture)));
      const input = container.querySelector('input[type="checkbox"]');
      const label = input.labels[0];
      const decoration = kind === 'checkbox' ? input.nextElementSibling : label.lastElementChild;
      assert.equal(container.querySelectorAll('input').length, 1);
      assert.equal(label.control, input);
      assert.equal(input.getAttribute('role'), kind === 'switch' ? 'switch' : null);
      assert.equal(input.tabIndex, 0);
      assert.match(label.textContent, /Reading statistics control/);

      // Programmatic .click() bypasses hit testing and JSDOM's cascade does not
      // reliably model !important. Inspect actual installed RNW and app CSSOM
      // priorities; the existing Chromium/WebKit gates still own real geometry.
      const rules = styleRules();
      const hiddenInputRule = rules.find(
        (rule) =>
          /^\.[\w-]+$/.test(rule.selectorText) &&
          input.matches(rule.selectorText) &&
          rule.style.getPropertyValue('pointer-events') === 'none'
      );
      assert.ok(hiddenInputRule, 'the mounted Expo input keeps its actual RNW hidden-input rule');
      assert.equal(hiddenInputRule.style.getPropertyPriority('pointer-events'), 'important');
      const inputRule = rules.find(
        (rule) => rule.selectorText === `[data-ui-toggle='${kind}'] input`
      );
      assert.ok(inputRule && input.matches(inputRule.selectorText));
      assert.equal(inputRule.style.getPropertyValue('pointer-events'), 'auto');
      assert.equal(inputRule.style.getPropertyPriority('pointer-events'), 'important');
      assert.equal(inputRule.style.getPropertyValue('z-index'), '1');
      assert.equal(
        inputRule.style.getPropertyValue('width'),
        kind === 'checkbox' ? '20px' : '36px'
      );
      assert.equal(
        inputRule.style.getPropertyValue('height'),
        kind === 'checkbox' ? '20px' : '22px'
      );
      assert.equal(inputRule.style.getPropertyValue('top'), '50%');
      assert.equal(inputRule.style.getPropertyValue('transform'), 'translateY(-50%)');
      if (titleRow) {
        const rowRule = rules.find(
          (rule) =>
            rule.selectorText === "[data-ui-title-selection-row] [data-ui-toggle='checkbox'] input"
        );
        assert.equal(rowRule.style.getPropertyValue('inset-inline-start'), '12px');
        assert.equal(window.getComputedStyle(label).padding, '12px');
      }

      act(() => label.click());
      assert.equal(input.checked, true);
      if (kind === 'checkbox') assert.ok(decoration.querySelector('svg'));
      act(() => input.click());
      assert.equal(input.checked, false);
      assert.deepEqual(changes, [true, false]);

      act(() => {
        window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab' }));
        input.focus();
      });
      assert.equal(document.activeElement, input);
      assert.match(window.getComputedStyle(decoration).boxShadow, /0 0 0 3px/);
      act(() => input.blur());
      assert.doesNotMatch(window.getComputedStyle(decoration).boxShadow, /0 0 0 3px/);

      act(() => root.render(h(Fixture, { disabled: true })));
      assert.equal(input.disabled, true);
      act(() => {
        label.click();
        input.click();
      });
      assert.equal(input.checked, false);
      assert.deepEqual(changes, [true, false]);
      act(() => root.render(h(Fixture)));
      act(() => label.click());
      assert.equal(input.checked, true);
      assert.deepEqual(changes, [true, false, true]);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
}

test.after(() => {
  rmSync(output, { recursive: true, force: true });
  dom.window.close();
});
