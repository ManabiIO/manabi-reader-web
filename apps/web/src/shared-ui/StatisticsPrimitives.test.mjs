/** @license BSD-3-Clause; Copyright (c) 2026, ッツ Reader Authors. */
import test from 'node:test';
import process from 'node:process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://localhost.test/'
});
const { window } = dom;
const { document } = window;
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  ShadowRoot: dom.window.ShadowRoot,
  Event: dom.window.Event,
  IS_REACT_ACT_ENVIRONMENT: true
});
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
window.matchMedia = () => ({
  matches: false,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {}
});
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
const output = mkdtempSync(join(tmpdir(), 'shared-ui-actual-web-'));
const outfile = join(output, 'primitives.cjs');
await build({
  stdin: {
    contents: `export * from './apps/web/src/shared-ui/StatisticsPrimitives';`,
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
          path: require.resolve('react-native-web'),
          external: true
        }));
        // Navigation is outside this control test; RNW still owns the actual anchor.
        b.onResolve({ filter: /^expo-router$/ }, () => ({ path: 'router', namespace: 'router' }));
        b.onLoad({ filter: /.*/, namespace: 'router' }, () => ({
          contents: `import React from 'react'; export function Link({href,children}) { return React.cloneElement(children,{href}); }`,
          loader: 'jsx',
          resolveDir: process.cwd()
        }));
      }
    }
  ]
});
const ui = require(outfile);
const h = React.createElement;
const event = (key, extras = {}) =>
  new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extras });
function mount(element) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(element));
  return {
    container,
    root,
    cleanup() {
      act(() => root.unmount());
      container.remove();
    }
  };
}

test('real Expo UI checkbox, switch and picker preserve values, HTML labels, semantic colors, and disabled behavior', () => {
  const changes = [];
  const fixture = mount(
    h(
      ui.UiThemeProvider,
      null,
      h(ui.CheckboxField, {
        label: 'A book',
        value: false,
        onValueChange: (v) => changes.push(['book', v]),
        testID: 'book'
      }),
      h(ui.SwitchField, {
        label: 'Compare periods',
        value: false,
        onValueChange: (v) => changes.push(['switch', v]),
        testID: 'compare'
      }),
      h(ui.ChoiceField, {
        label: 'Start of week',
        value: 1,
        onValueChange: (v) => changes.push(['week', v]),
        options: [
          { value: 0, label: 'Sunday' },
          { value: 1, label: 'Monday' }
        ],
        testID: 'week'
      }),
      h(ui.TextField, {
        type: 'search',
        label: 'Filter book titles',
        value: '',
        onChangeText: (v) => changes.push(['search', v]),
        testID: 'search'
      })
    )
  );
  try {
    const checkbox = fixture.container.querySelector('[data-testid="book"]');
    assert.equal(checkbox.tagName, 'INPUT');
    assert.equal(checkbox.type, 'checkbox');
    assert.match(checkbox.labels[0].textContent, /A book/);
    act(() => checkbox.click());
    act(() => fixture.container.querySelector('[data-testid="compare"]').click());
    const picker = fixture.container.querySelector('select');
    assert.equal(picker.dataset.testid, 'week');
    assert.equal(fixture.container.querySelectorAll('[data-testid="week"]').length, 1);
    assert.equal(picker.value, '1');
    assert.match(picker.labels[0].textContent, /Start of week/);
    act(() => {
      picker.value = '0';
      picker.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    assert.deepEqual(changes, [
      ['book', true],
      ['switch', true],
      ['week', 0]
    ]);
    assert.equal(fixture.container.querySelector('[data-testid="search"]').type, 'search');
    assert.equal(fixture.container.querySelector('[data-testid="search"]').style.minHeight, '44px');
    const host = fixture.container.querySelector('[data-ui-toggle="checkbox"] > div');
    assert.equal(host.style.getPropertyValue('--expo-ui-primary-500'), 'var(--primary)');
    act(() =>
      fixture.root.render(
        h(ui.ChoiceField, {
          label: 'Range',
          value: 'all',
          onValueChange() {},
          options: [{ value: 'all', label: 'All time' }],
          disabled: true
        })
      )
    );
    assert.equal(fixture.container.querySelector('select').disabled, true);
  } finally {
    fixture.cleanup();
  }
});

test('real Expo Picker receives distinct names and descriptions across updates, removal and remount', () => {
  const content = (props, key = 'original') =>
    h(
      React.Fragment,
      null,
      h('p', { id: 'book-help' }, 'Choose a book for the reading day.'),
      h('p', { id: 'other-help' }, 'Only available books are listed.'),
      h(ui.ChoiceField, {
        key,
        label: 'Book',
        value: 'one',
        options: [{ value: 'one', label: 'First book' }],
        onValueChange() {},
        ...props
      })
    );
  const fixture = mount(
    content({
      accessibilityLabel: 'Book for reading day',
      accessibilityDescribedBy: 'book-help'
    })
  );
  try {
    const picker = fixture.container.querySelector('select');
    assert.equal(picker.getAttribute('aria-label'), 'Book for reading day');
    assert.equal(picker.getAttribute('aria-describedby'), 'book-help');
    assert.equal(picker.labels[0].control, picker);
    assert.equal(picker.labels[0].querySelector('span').textContent, 'Book');
    assert.equal(picker.labels[0].hasAttribute('aria-label'), false);
    act(() =>
      fixture.root.render(
        content({
          accessibilityLabel: 'Choose a different book',
          accessibilityDescribedBy: 'book-help other-help',
          disabled: true
        })
      )
    );
    assert.equal(fixture.container.querySelector('select'), picker);
    assert.equal(picker.getAttribute('aria-label'), 'Choose a different book');
    assert.equal(picker.getAttribute('aria-describedby'), 'book-help other-help');
    assert.equal(picker.disabled, true);
    for (const id of picker.getAttribute('aria-describedby').split(' '))
      assert.ok(document.getElementById(id));
    act(() => fixture.root.render(content({ label: 'Visible fallback' })));
    assert.equal(picker.hasAttribute('aria-label'), false);
    assert.equal(picker.hasAttribute('aria-describedby'), false);
    assert.equal(picker.labels[0].querySelector('span').textContent, 'Visible fallback');
    act(() =>
      fixture.root.render(
        content(
          { accessibilityLabel: 'Remounted book picker', accessibilityDescribedBy: 'other-help' },
          'replacement'
        )
      )
    );
    const replacement = fixture.container.querySelector('select');
    assert.notEqual(replacement, picker);
    assert.equal(picker.isConnected, false);
    assert.equal(replacement.getAttribute('aria-label'), 'Remounted book picker');
    assert.equal(replacement.getAttribute('aria-describedby'), 'other-help');
  } finally {
    fixture.cleanup();
  }
});

test('field frames preserve direct TextField accessible names while labeling Expo selects', () => {
  const fixture = mount(
    h(ui.TextField, {
      label: 'Book',
      accessibilityLabel: 'Find a book by title',
      value: '',
      onChangeText() {}
    })
  );
  try {
    assert.equal(
      fixture.container.querySelector('input').getAttribute('aria-label'),
      'Find a book by title'
    );
  } finally {
    fixture.cleanup();
  }
});

test('branded RNW actions retain title, aria state, focus refs, keyboard hooks, and anchor semantics', () => {
  const ref = React.createRef();
  const keys = [];
  const fixture = mount(
    h(
      React.Fragment,
      null,
      h(
        ui.ActionButton,
        {
          ref,
          title: 'Statistics options',
          accessibilityLabel: 'Statistics options',
          'aria-pressed': true,
          'aria-expanded': true,
          dataSet: { sectionLink: '' },
          onKeyDown: (e) => keys.push(e.key),
          shape: 'circle',
          size: 'icon-lg'
        },
        '⋮'
      ),
      h(ui.NavLink, { href: '/manage', variant: 'link' }, 'Library')
    )
  );
  try {
    const button = fixture.container.querySelector('[role="button"]');
    assert.equal(button.title, 'Statistics options');
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.equal(button.getAttribute('data-shape'), 'circle');
    assert.equal(button.style.minHeight, '44px');
    act(() => {
      ref.current.focus();
      button.dispatchEvent(event('ArrowDown'));
    });
    assert.equal(document.activeElement, button);
    assert.deepEqual(keys, ['ArrowDown']);
    assert.equal(fixture.container.querySelector('a').getAttribute('href'), '/manage');
  } finally {
    fixture.cleanup();
  }
});

test('secondary actions retain the original semantic foreground and rendered web hover rules', () => {
  const fixture = mount(h(ui.ActionButton, { variant: 'secondary' }, 'Options'));
  try {
    const button = fixture.container.querySelector('[role="button"]');
    assert.equal(button.dataset.variant, 'secondary');
    const label = [...button.querySelectorAll('*')].find((node) => node.textContent === 'Options');
    assert.equal(label.style.color, 'var(--secondary-foreground)');
    const css = [...document.querySelectorAll('style')].map((node) => node.textContent).join('\n');
    assert.match(css, /color-mix\(in srgb, var\(--primary\), var\(--primary-foreground\) 8%\)/);
    assert.match(css, /color-mix\(in oklch, var\(--secondary\), var\(--foreground\) 5%\)/);
    assert.match(css, /\[aria-expanded='true'\].*background-color: var\(--secondary\)/);
    act(() =>
      fixture.root.render(
        h(ui.ActionButton, { variant: 'outline', 'aria-expanded': true }, 'Open menu')
      )
    );
    const expanded = fixture.container.querySelector('[role="button"]');
    assert.equal(expanded.style.backgroundColor, 'var(--primary)');
    const expandedLabel = [...expanded.querySelectorAll('*')].find(
      (node) => node.textContent === 'Open menu'
    );
    assert.equal(expandedLabel.style.color, 'var(--primary-foreground)');
  } finally {
    fixture.cleanup();
  }
});

test('sheet closes on Escape, traps focus, restores trigger, and honors transaction close lock', () => {
  const trigger = document.createElement('button');
  trigger.textContent = 'Open';
  document.body.append(trigger);
  trigger.focus();
  let closeCount = 0;
  const props = {
    visible: true,
    title: 'Statistics options',
    closeLabel: 'Close statistics options',
    onClose: () => closeCount++
  };
  const fixture = mount(
    h(ui.Sheet, props, h(ui.ActionButton, { variant: 'secondary' }, 'Apply Filter'))
  );
  try {
    const dialog = document.querySelector('dialog');
    assert.ok(dialog.open);
    assert.equal(dialog.getAttribute('data-slot'), 'sheet-content');
    const close = dialog.querySelector('[data-modal-dismiss]');
    assert.equal(close.getAttribute('data-shape'), 'circle');
    const buttons = dialog.querySelectorAll('[role="button"]');
    act(() => {
      buttons[buttons.length - 1].focus();
      buttons[buttons.length - 1].dispatchEvent(event('Tab'));
    });
    assert.equal(document.activeElement, close);
    act(() => dialog.dispatchEvent(event('Escape')));
    assert.equal(closeCount, 1);
    act(() =>
      fixture.root.render(
        h(ui.Sheet, { ...props, closeDisabled: true }, h(ui.ActionButton, null, 'Still working'))
      )
    );
    act(() => dialog.dispatchEvent(event('Escape')));
    assert.equal(closeCount, 1);
    act(() => fixture.root.render(h(ui.Sheet, { ...props, visible: false }, null)));
    assert.equal(document.activeElement, trigger);
  } finally {
    fixture.cleanup();
    trigger.remove();
  }
});

test('nonmodal menu supports keyboard navigation and outside dismissal without stealing external focus', () => {
  let closes = 0;
  let activations = 0;
  const trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  const fixture = mount(
    h(
      ui.Menu,
      { visible: true, label: 'Statistics options', onClose: () => closes++ },
      h(ui.ActionButton, { role: 'menuitem', variant: 'ghost' }, 'Statistics Settings'),
      h(
        ui.ActionButton,
        { role: 'menuitem', variant: 'ghost', onPress: () => activations++ },
        'Copy log'
      )
    )
  );
  try {
    const items = fixture.container.querySelectorAll('[role="menuitem"]');
    assert.equal(document.activeElement, items[0]);
    act(() => items[0].dispatchEvent(event('ArrowDown')));
    assert.equal(document.activeElement, items[1]);
    act(() => items[1].dispatchEvent(event(' ')));
    assert.equal(activations, 1);
    act(() => items[1].dispatchEvent(event('Escape')));
    assert.equal(closes, 1);
    act(() => trigger.focus());
    act(() => trigger.dispatchEvent(new window.Event('pointerdown', { bubbles: true })));
    assert.equal(closes, 2);
    fixture.cleanup();
    assert.equal(document.activeElement, trigger);
  } finally {
    if (fixture.container.isConnected) fixture.cleanup();
    trigger.remove();
  }
});
test('sheet chrome becomes flow layout when measured header and footer consume a short viewport', () => {
  const fixture = mount(
    h(
      ui.Sheet,
      {
        visible: true,
        onClose() {},
        title: 'Filter books',
        panelClassName: 'filter-panel',
        stickyChrome: true,
        footer: h(ui.ActionButton, null, 'Apply Filter')
      },
      h(ui.CheckboxField, { label: 'A book', value: false, onValueChange() {} })
    )
  );
  try {
    const dialog = document.querySelector('dialog');
    const header = dialog.querySelector('[data-sticky-header]');
    const footer = dialog.querySelector('[data-sticky-footer]');
    const panel = dialog.querySelector('.filter-panel');
    header.getBoundingClientRect = () => ({ height: 100 });
    footer.getBoundingClientRect = () => ({ height: 100 });
    Object.defineProperty(dialog, 'clientHeight', { configurable: true, value: 844 });
    act(() => window.dispatchEvent(new window.Event('resize')));
    assert.equal(panel.dataset.stickyChrome, 'true');
    assert.equal(header.style.position, 'sticky');
    assert.equal(footer.style.position, 'sticky');
    Object.defineProperty(dialog, 'clientHeight', { configurable: true, value: 320 });
    act(() => window.dispatchEvent(new window.Event('resize')));
    assert.equal(panel.dataset.stickyChrome, 'false');
    assert.equal(header.style.position, 'static');
    assert.equal(footer.style.position, 'static');
  } finally {
    fixture.cleanup();
  }
});
test.after(() => {
  rmSync(output, { recursive: true, force: true });
  dom.window.close();
});
