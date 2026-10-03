/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as fakeIndexedDB from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { outputFiles } = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { SettingsScreen } from './apps/web/src/settings-react/settings-screen';
      import { DialogHost, StorageUnlock } from './apps/web/src/ui/dialogs';
      import { dialogManager } from './apps/web/src/lib/data/dialog-manager';
      import { yuKyokashoAvailable$ } from './apps/web/src/lib/data/store';
      yuKyokashoAvailable$.next(false);
      const root = createRoot(document.getElementById('root'));
      window.controls = {
        render: strict => root.render(strict
          ? <React.StrictMode><SettingsScreen /><DialogHost /></React.StrictMode>
          : <><SettingsScreen /><DialogHost /></>),
        showUnlock: () => dialogManager.dialogs$.next([{component: StorageUnlock, props: {
          description: 'Synthetic encrypted source', action: 'Enter the password',
          requiresSecret: true, resolver: () => {}
        }}]),
        unmount: () => root.unmount()
      };
    `,
    resolveDir: root,
    loader: 'tsx'
  },
  tsconfig: join(root, 'apps/web/tsconfig.json'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
  outdir: '/tmp/manabi-settings-overlay-bundle',
  jsx: 'automatic',
  loader: { '.css': 'empty', '.wasm': 'file', '.onnx': 'file' },
  define: {
    'process.env.NODE_ENV': '"development"',
    'import.meta.url': '"https://reader.example/fixture.js"'
  },
  logLevel: 'warning'
});
const javascript = outputFiles.find((file) => file.path.endsWith('.js')).text;

async function fixture(run, hash = 'typography') {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', (error) => errors.push(error.message));
  console.on('error', (...parts) => errors.push(parts.map(String).join(' ')));
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
    {
      url: 'https://reader.example/reader-web/settings#' + hash,
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      virtualConsole: console
    }
  );
  const { window } = dom;
  const observers = new Set();
  const storedFonts = new Map();
  const fontCache = {
    keys: async () =>
      [...storedFonts.keys()].map((path) => new Request(new URL(path, window.location.href))),
    match: async (path) => storedFonts.get(String(path))?.clone(),
    put: async (path, response) => {
      storedFonts.set(String(path), response.clone());
    },
    delete: async (path) => storedFonts.delete(String(path))
  };
  Object.assign(window, {
    ...fakeIndexedDB,
    indexedDB: new fakeIndexedDB.IDBFactory(),
    changes: [],
    process: { env: {} },
    TextEncoder,
    TextDecoder,
    structuredClone,
    Response,
    Request,
    Headers,
    fetch: async () => new Response('', { status: 503 }),
    caches: { open: async () => fontCache },
    CSS: {
      escape: (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => '\\' + character)
    },
    ResizeObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.targets = new Set();
        observers.add(this);
      }
      observe(target) {
        this.targets.add(target);
      }
      unobserve(target) {
        this.targets.delete(target);
      }
      disconnect() {
        this.targets.clear();
        observers.delete(this);
      }
    },
    IntersectionObserver: class {
      observe() {}
      disconnect() {}
    },
    BroadcastChannel: class {
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
  });
  Object.defineProperty(window, 'crypto', { value: webcrypto });
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {}
  });
  Object.defineProperty(window.document, 'fonts', {
    value: {
      ready: Promise.resolve(),
      check: () => true,
      forEach() {},
      status: 'loaded',
      addEventListener() {},
      removeEventListener() {}
    }
  });
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.URL.createObjectURL = () => 'blob:https://reader.example/fixture';
  window.URL.revokeObjectURL = () => {};
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  if (hash === 'layout') window.localStorage.setItem('writingMode', 'horizontal-tb');
  window.eval(javascript);
  const api = window.controls;
  const until = async (predicate, message) => {
    for (let attempt = 0; attempt < 40 && !predicate(); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(predicate(), message);
  };
  try {
    await run({ window, api, until, observers, storedFonts });
  } finally {
    await api.unmount();
    window.close();
  }
  assert.deepEqual(errors, [], 'mounted Settings must not emit React or DOM errors');
}

const button = (root, name) =>
  [...root.querySelectorAll('button')].find(
    (node) => (node.getAttribute('aria-label') ?? node.textContent.trim()) === name
  );

test('Custom fonts retains the active dialog content, accessible title, scrolling form and dismiss lifecycle', async () => {
  for (const strict of [false, true])
    await fixture(async ({ window, api, until }) => {
      api.render(strict);
      const { document } = window;
      const trigger = () =>
        button(document.querySelector('[data-setting="primary-font-input"]'), 'Custom fonts');
      await until(
        () => document.querySelector('[data-setting="primary-font-input"]') && trigger(),
        'primary font controls mount'
      );
      assert.equal(document.querySelector('[data-slot="dialog-content"]'), null);
      for (const dismiss of ['Done', 'cancel', 'Close']) {
        trigger().focus();
        trigger().click();
        await until(
          () => document.querySelector('dialog[open] h2')?.textContent === 'Custom fonts',
          'font manager opens'
        );
        const panel = document.querySelector('[data-slot="dialog-content"]');
        assert.ok(panel, 'an open native dialog retains the existing dialog-content contract');
        assert.equal(panel.tagName, 'DIALOG');
        assert.equal(panel.getAttribute('role'), 'dialog');
        assert.equal(panel.getAttribute('aria-modal'), 'true');
        assert.equal(
          document.getElementById(panel.getAttribute('aria-labelledby')).textContent,
          'Custom fonts'
        );
        await until(
          () => button(panel, 'Add font') && !button(panel, 'Add font').disabled,
          'font cache finishes loading'
        );
        button(panel, 'Add font').click();
        await until(() => panel.querySelector('input[type="file"]'), 'add-font form mounts');
        assert.ok(
          panel.querySelector('[data-dialog-scroll] input[type="file"]'),
          'long font forms have their own bounded scroll region'
        );
        assert.ok(button(panel, 'Save font'));
        const done = button(panel, 'Done');
        assert.ok(done.closest('footer'));
        assert.equal(
          done.closest('[data-dialog-scroll]'),
          null,
          'dismissal remains outside the long form'
        );
        if (dismiss === 'cancel')
          panel.dispatchEvent(new window.Event('cancel', { cancelable: true }));
        else button(panel, dismiss).click();
        await until(() => !document.querySelector('dialog[open]'), 'native modal closes');
        assert.equal(
          document.querySelector('[data-slot="dialog-content"]'),
          null,
          'closed host is not an active dialog'
        );
        assert.equal(document.querySelector('[role="dialog"][aria-modal="true"]'), null);
        await until(
          () => document.activeElement === trigger(),
          'focus returns to the same font control'
        );
        assert.equal(
          window.localStorage.getItem('userfonts'),
          null,
          'inspection and cancellation do not save fonts'
        );
      }
    });
});

test('Custom theme dialog owns every forward and reverse Tab and returns focus without saving', async () => {
  await fixture(async ({ window, api, until }) => {
    api.render(true);
    const { document } = window;
    await until(() => button(document, 'Add custom theme'), 'theme editor trigger mounts');
    const trigger = button(document, 'Add custom theme');
    trigger.focus();
    trigger.click();
    await until(() => document.querySelector('dialog[open] input'), 'theme dialog mounts');
    const dialog = document.querySelector('dialog[open]');
    // JSDOM has no layout. Supply visible client rects only for this mounted
    // dialog while the production candidate filtering and keyboard cycle run.
    const rects = window.HTMLElement.prototype.getClientRects;
    window.HTMLElement.prototype.getClientRects = function () {
      return dialog.contains(this) ? [{ width: 44, height: 44 }] : rects.call(this);
    };
    const input = dialog.querySelector('input');
    input.focus();
    for (const shiftKey of [false, true]) {
      for (let index = 0; index < 24; index++) {
        const event = new window.KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey,
          bubbles: true,
          cancelable: true
        });
        document.activeElement.dispatchEvent(event);
        assert.equal(
          event.defaultPrevented,
          true,
          'native keyboard preferences cannot skip the cycle'
        );
        assert.notEqual(document.activeElement, dialog);
        assert.ok(dialog.contains(document.activeElement));
      }
    }
    dialog.dispatchEvent(new window.Event('cancel', { cancelable: true }));
    await until(() => !document.querySelector('dialog[open]'), 'theme dialog closes');
    await until(() => document.activeElement === trigger, 'same theme trigger regains focus');
    assert.equal(window.localStorage.getItem('customThemes'), null);
  }, 'appearance');
});

test('size presets reposition when controller content mounts or grows without a viewport event', async () => {
  await fixture(async ({ window, api, until, observers }) => {
    Object.defineProperties(window, {
      innerWidth: { value: 900, writable: true },
      innerHeight: { value: 600, writable: true }
    });
    const bounds = {
      x: 100,
      y: 540,
      left: 100,
      top: 540,
      right: 144,
      bottom: 584,
      width: 44,
      height: 44,
      toJSON() {}
    };
    window.HTMLElement.prototype.getBoundingClientRect = function () {
      return bounds;
    };
    let height = 220;
    Object.defineProperties(window.HTMLElement.prototype, {
      offsetHeight: {
        configurable: true,
        get() {
          return this.matches('.settings-popover')
            ? this.querySelector('.dimension-presets')
              ? height
              : 16
            : 44;
        }
      },
      offsetWidth: {
        configurable: true,
        get() {
          return this.matches('.settings-popover') ? 320 : 44;
        }
      }
    });
    api.render(true);
    const { document } = window;
    const trigger = () => button(document, 'Size presets for maximum page width');
    await until(trigger, 'page layout controls mount');
    const before = window.localStorage.getItem('secondDimensionMaxValue');
    trigger().focus();
    trigger().click();
    const panel = () =>
      document.querySelector('[role="dialog"][aria-label="Size presets for maximum page width"]');
    await until(
      () => panel()?.querySelector('.dimension-presets'),
      'preset controller content mounts'
    );
    const notifyContentResize = async () => {
      const observing = [...observers].filter((observer) => observer.targets.has(panel()));
      assert.equal(observing.length, 1, 'the panel observes its delayed content size');
      observing[0].callback([{ target: panel() }]);
      await until(
        () => Number.parseFloat(panel().style.top) + height <= window.innerHeight - 8,
        'preset choices fit after content grows'
      );
    };
    await notifyContentResize();
    assert.equal(panel().style.top, '372px');
    height = 360;
    await notifyContentResize();
    assert.equal(panel().style.top, '232px');
    assert.equal(
      window.localStorage.getItem('secondDimensionMaxValue'),
      before,
      'repositioning never commits a preset'
    );
    button(panel(), '50%').click();
    await until(
      () => window.localStorage.getItem('secondDimensionMaxValue') === '450',
      'a chosen preset still commits current-axis pixels'
    );
    button(panel(), 'Automatic').click();
    await until(
      () => window.localStorage.getItem('secondDimensionMaxValue') === '0',
      'Automatic still resets the maximum'
    );
    panel()
      .querySelector('input')
      .dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await until(() => !panel(), 'Escape dismisses the resized panel');
    assert.equal(document.activeElement, trigger());
    assert.equal(
      [...observers].some((observer) =>
        [...observer.targets].some((node) => node.matches('.settings-popover'))
      ),
      false,
      'closed popover releases resize observation'
    );
  }, 'layout');
});

test('font menus keep their descriptive accessible names and device-effective selection without saving on open', async () => {
  await fixture(async ({ window, api, until }) => {
    api.render(true);
    const { document } = window;
    const name = 'Show available primary / serif fonts';
    await until(() => button(document, name), 'primary font menu has the original accessible name');
    button(document, name).click();
    await until(() => document.querySelector('[role="menuitemradio"]'), 'font menu opens');
    assert.equal(
      document.querySelectorAll('[role="menuitemradio"][aria-checked="true"]').length,
      1
    );
    assert.equal(window.localStorage.getItem('fontFamilyGroupOne'), null);
    document
      .querySelector('[role="menu"]')
      .dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await until(() => !document.querySelector('[role="menuitemradio"]'), 'font menu closes');
    assert.equal(window.localStorage.getItem('fontFamilyGroupOne'), null);
  });
});

test('dialog gutters and intrinsic password widths stay bounded when the document text is enlarged', async () => {
  await fixture(async ({ window, api, until }) => {
    api.render(true);
    await until(
      () => window.document.querySelector('[data-setting="primary-font-input"]'),
      'settings runtime mounts'
    );
    api.showUnlock();
    await until(
      () => window.document.querySelector('dialog[open] input[type="password"]'),
      'unlock dialog opens'
    );
    const panel = window.document.querySelector('dialog[open]');
    const password = panel.querySelector('input[type="password"]');
    // Mounted structure/style contracts only: real viewport geometry is checked
    // by the unchanged Chromium/WebKit settings-editor acceptance suite.
    assert.ok(
      panel.classList.contains('max-w-[calc(100vw-16px)]'),
      'override the UA em-based dialog max width'
    );
    assert.ok(
      panel.classList.contains('pt-[60px]'),
      'reserve a fixed reachable close target without scaling its gutter'
    );
    assert.ok(password.classList.contains('w-full'));
    assert.ok(
      password.classList.contains('min-w-0'),
      'do not retain the default twenty-character intrinsic input width'
    );
    assert.ok(password.closest('label').classList.contains('min-w-0'));
    const scroll = panel.querySelector('[data-dialog-scroll]');
    assert.ok(scroll.classList.contains('min-w-0'));
    assert.ok(scroll.parentElement.classList.contains('max-h-[calc(90dvh-60px)]'));
    assert.equal(button(panel, 'Cancel').closest('[data-dialog-scroll]'), null);
    button(panel, 'Cancel').click();
    await until(() => !window.document.querySelector('dialog[open]'), 'unlock cancellation closes');
  });
});
