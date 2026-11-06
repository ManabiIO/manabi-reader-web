/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { compileFunction } from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const appRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://reader.example/'
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
globalThis.ResizeObserver = window.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
window.cancelAnimationFrame = clearTimeout;
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const compiled = await build({
  stdin: {
    contents: `export {SettingsPageTurnEffect} from './apps/web/src/features/settings/SettingsPageTurnEffect';
      export {ChoiceField} from './apps/web/src/shared-ui/Fields';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  write: false,
  metafile: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  conditions: ['browser'],
  resolveExtensions: ['.web.tsx', '.tsx', '.web.ts', '.ts', '.web.js', '.js'],
  tsconfig: 'apps/web/tsconfig.json',
  plugins: [
    {
      name: 'actual-expo-and-rnw',
      setup(builder) {
        builder.onResolve({ filter: /^react(?:\/.*)?$|^react-dom(?:\/.*)?$/ }, (args) => ({
          path: require.resolve(args.path),
          external: true
        }));
        builder.onResolve({ filter: /^react-native$/ }, () => ({
          path: appRequire.resolve('react-native-web'),
          external: true
        }));
      }
    }
  ]
});
const module = { exports: {} };
compileFunction(compiled.outputFiles[0].text, ['require', 'module', 'exports'])(
  require,
  module,
  module.exports
);
const { SettingsPageTurnEffect, ChoiceField } = module.exports;
const h = React.createElement;

function fixture(run) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const changes = [];
  const render = (props = {}) =>
    act(() =>
      root.render(
        h(SettingsPageTurnEffect, {
          value: 'slide',
          onValueChange: (value) => changes.push(value),
          ...props
        })
      )
    );
  const change = (value) => {
    const select = container.querySelector('select');
    act(() => {
      select.value = value;
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
  };
  try {
    run({ container, render, change, changes });
  } finally {
    act(() => root.unmount());
    container.remove();
  }
}

test('page-turn uses the installed universal Picker with a named, described, keyboard-focusable select', () => {
  assert.ok(
    Object.keys(compiled.metafile.inputs).some((file) =>
      /\/universal\/Picker\/Picker\.(?:js|tsx)$/.test(file)
    )
  );
  fixture(({ container, render, changes }) => {
    render({ accessibilityDescribedBy: 'page-turn-help' });
    const select = container.querySelector('select');
    assert.equal(select.getAttribute('aria-label'), 'Page turn effect');
    assert.equal(select.getAttribute('aria-describedby'), 'page-turn-help');
    assert.equal(select.labels[0].textContent.includes('Page turn effect'), true);
    assert.equal(select.tabIndex, 0);
    assert.equal(select.value, 'slide');
    assert.deepEqual(
      [...select.options].map((option) => [option.value, option.textContent]),
      [
        ['slide', 'Slide'],
        ['none', 'None']
      ]
    );
    act(() => select.focus());
    render({ value: 'none', showLabel: false });
    assert.equal(container.querySelector('select'), select);
    assert.equal(document.activeElement, select);
    assert.equal(select.getAttribute('aria-describedby'), null);
    assert.equal(select.getAttribute('aria-label'), 'Page turn effect');
    assert.deepEqual(changes, [], 'Rendering saved values never writes a preference');
    const style = window.getComputedStyle(select);
    assert.equal(style.minHeight, '44px');
    assert.equal(style.minWidth, '0');
    assert.equal(style.width, '100%');
  });
});

test('page-turn selection stays controlled, ignores repeated values and blocks disabled changes', () => {
  fixture(({ container, render, change, changes }) => {
    render();
    change('none');
    assert.deepEqual(changes, ['none']);
    assert.equal(
      container.querySelector('select').value,
      'slide',
      'The owner confirms the saved value'
    );
    render({ value: 'none' });
    change('none');
    assert.deepEqual(changes, ['none']);
    render({ value: 'none', disabled: true });
    assert.equal(container.querySelector('select').disabled, true);
    change('slide');
    assert.deepEqual(changes, ['none']);
    render({ value: 'none' });
    change('slide');
    assert.deepEqual(changes, ['none', 'slide']);
  });
});

test('an unavailable saved value is shown without selecting or saving a replacement', () => {
  for (const value of ['future-effect', '']) {
    fixture(({ container, render, change, changes }) => {
      render({ value });
      const select = container.querySelector('select');
      assert.equal(select.value, value);
      assert.match(select.selectedOptions[0].textContent, /Unavailable saved option/);
      assert.deepEqual(changes, []);
      change(value);
      assert.deepEqual(changes, []);
      change('none');
      assert.deepEqual(changes, ['none']);
    });
  }
});

test('shared Picker names only its caption and updates or removes naming overrides', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = (props = {}) =>
    act(() =>
      root.render(
        h(ChoiceField, {
          label: 'Local copy',
          value: '',
          onValueChange() {},
          options: [
            { value: '', label: 'Choose a book on this device' },
            { value: '4', label: 'Book four' }
          ],
          ...props
        })
      )
    );
  try {
    render();
    const select = container.querySelector('select');
    const captionId = select.getAttribute('aria-labelledby');
    assert.ok(captionId);
    assert.equal(document.getElementById(captionId).textContent, 'Local copy');
    assert.equal(select.getAttribute('aria-label'), null);
    assert.equal(select.closest('label').style.alignItems, 'stretch');
    assert.equal(select.closest('label').style.margin, '0px');
    render({ label: 'Updated caption' });
    assert.equal(select.getAttribute('aria-labelledby'), captionId);
    assert.equal(document.getElementById(captionId).textContent, 'Updated caption');
    render({ accessibilityLabel: 'Explicit name' });
    assert.equal(select.getAttribute('aria-labelledby'), null);
    assert.equal(select.getAttribute('aria-label'), 'Explicit name');
    render({ label: undefined });
    assert.equal(select.getAttribute('aria-labelledby'), null);
    assert.equal(select.getAttribute('aria-label'), null);
    assert.equal(container.querySelector('select'), select);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test.after(() => window.close());
