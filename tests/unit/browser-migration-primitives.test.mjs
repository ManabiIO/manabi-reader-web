/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { outputFiles } = await build({
  stdin: {
    contents: `
      import React, { act, useReducer } from 'react';
      import { createRoot } from 'react-dom/client';
      import { Dom, useReaderBindings } from './reader-react/dom';
      import { HeaderView } from './library-react/header';
      import { Button, Menu } from './library-react/primitives';
      const root = createRoot(document.getElementById('root'));
      function MenuFixture() {
        return <Menu.Root>
          <Menu.Trigger child={({ props }) => <Button {...props}>Library actions</Button>} />
          <Menu.Content><Menu.Item onSelect={() => window.selections++}>Select Books</Menu.Item></Menu.Content>
        </Menu.Root>;
      }
      function BindingFixture(props) {
        const [, redraw] = useReducer(n => n + 1, 0);
        useReaderBindings(props.controller, props);
        return <button onClick={() => {
          props.controller.value = props.editValue;
          redraw();
        }}>Edit bound value</button>;
      }
      window.controls = {
        act: callback => { act(callback); },
        render: (kind, props = {}) => { act(() => root.render(<React.StrictMode>{kind === 'html' ? <Dom as="main" {...props} /> : kind === 'header' ? <HeaderView {...props} /> : kind === 'binding' ? <BindingFixture {...props} /> : <MenuFixture />}</React.StrictMode>)); },
        unmount: () => { act(() => root.unmount()); }
      };
    `,
    resolveDir: path.join(root, 'apps/web/src'),
    loader: 'tsx'
  },
  tsconfig: path.join(root, 'apps/web/tsconfig.json'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
  jsx: 'automatic',
  loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
  // The view's unrelated external store inputs stay fixed; the actual Header,
  // Menu, ref callbacks, action handlers, and React lifecycle run unchanged.
  plugins: [
    {
      name: 'header-store-inputs',
      setup(b) {
        b.onResolve(
          { filter: /^\$lib\/(?:data\/(?:store|storage\/storage-view)|functions\/utils)$/ },
          (args) => ({ path: args.path, namespace: 'header-inputs' })
        );
        b.onLoad({ filter: /.*/, namespace: 'header-inputs' }, () => ({
          contents: `
        const store = value => ({ subscribe(fn) { fn(value); return () => {}; } });
        export const storageSource$ = store('browser'), isMobile$ = store(false),
          booklistSortOptions$ = store({ browser: { property: 'id', direction: 'desc' } }),
          fileCountData$ = store({}), isOnline$ = store(true);
      `,
          loader: 'js'
        }));
      }
    }
  ]
});

async function fixture(run) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', (error) => errors.push(error.message));
  console.on('error', (...parts) => errors.push(parts.map(String).join(' ')));
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'https://reader.example/reader-web/manage',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: console
  });
  const { window } = dom;
  window.IS_REACT_ACT_ENVIRONMENT = true;
  window.selections = 0;
  // Like both real browser engines, animation-frame APIs require a Window
  // receiver. JSDOM's permissive built-ins otherwise miss this integration bug.
  const frames = new Map();
  const cancelled = [];
  let nextFrame = 0;
  window.requestAnimationFrame = function (callback) {
    if (this !== window) throw new TypeError('requestAnimationFrame requires a Window receiver');
    frames.set(++nextFrame, callback);
    return nextFrame;
  };
  window.cancelAnimationFrame = function (frame) {
    if (this !== window) throw new TypeError('cancelAnimationFrame requires a Window receiver');
    cancelled.push(frame);
    frames.delete(frame);
  };
  window.eval(outputFiles[0].text);
  const api = window.controls;
  try {
    await run({ window, api, frames, cancelled });
  } finally {
    await api.unmount();
    window.close();
  }
  assert.deepEqual(errors, [], 'production primitives must not emit React or DOM errors');
}

test('mounted reader markup binds animation-frame APIs and retires every superseded owner', async () => {
  await fixture(async ({ window, api, frames, cancelled }) => {
    const loaded = [];
    const props = (htmlIdentity, html = '<p>Same chapter</p>') => ({
      html,
      htmlIdentity,
      onHtmlLoad: () => loaded.push(htmlIdentity)
    });
    await api.render('html', props('first'));
    assert.equal(window.document.querySelector('main').innerHTML, '<p>Same chapter</p>');
    assert.equal(frames.size, 1, 'Strict Mode leaves one current readiness frame');
    assert.equal(cancelled.length, 1, 'Strict Mode cancels its discarded mount');
    await api.render('html', props('second'));
    assert.equal(frames.size, 1, 'a new spine retires the old readiness frame');
    const callbacks = [...frames.values()];
    frames.clear();
    await api.act(() => callbacks.forEach((callback) => callback()));
    assert.deepEqual(loaded, ['second']);
    await api.render('html', props('second'));
    assert.equal(frames.size, 0, 'unchanged markup and spine publish once');
    await api.render('html', props('third', '<p>Later chapter</p>'));
    assert.equal(frames.size, 1);
    await api.unmount();
    assert.equal(frames.size, 0, 'unmount cancels pending readiness with the Window receiver');
  });
});

test('Library menu mounts as a fixed layered portal before accepting selection', async () => {
  await fixture(async ({ window, api }) => {
    await api.render('menu');
    const trigger = window.document.querySelector('button');
    await api.act(() => trigger.click());
    const menu = window.document.querySelector('[role=menu]');
    assert.ok(menu);
    assert.equal(menu.parentElement, window.document.body);
    assert.equal(menu.style.position, 'fixed');
    assert.equal(menu.style.zIndex, '70');
    assert.equal(window.document.activeElement, menu.querySelector('[role=menuitem]'));
    await api.act(() => menu.querySelector('[role=menuitem]').click());
    assert.equal(window.selections, 1);
    assert.equal(window.document.querySelector('[role=menu]'), null);
    assert.equal(window.document.activeElement, trigger);
  });
});

for (const compactLibrary of [false, true]) {
  test(`actual ${compactLibrary ? 'compact' : 'desktop'} Library header shares its menu anchor and focus-restoration ref`, async () => {
    await fixture(async ({ window, api }) => {
      let selected = 0;
      const c = {
        modernLibrary: true,
        compactLibrary,
        hasBooks: true,
        hydrated: true,
        compactMenus: { current: compactLibrary },
        filesChanged() {},
        backupChanged() {},
        setCountData() {},
        enterSelectionMode: () => selected++,
        libraryActionsButton: null,
        sources: []
      };
      await api.render('header', { c });
      const trigger = window.document.querySelector('[aria-label="Library actions"]');
      assert.ok(trigger);
      assert.equal(c.libraryActionsButton, trigger);
      let anchor = { left: 300, right: 344, top: 44, bottom: 88, width: 44, height: 44 };
      trigger.getBoundingClientRect = () => anchor;
      const dimensions = window.HTMLElement.prototype.getBoundingClientRect;
      window.HTMLElement.prototype.getBoundingClientRect = function () {
        return this.getAttribute('role') === 'menu'
          ? { left: 0, right: 240, top: 0, bottom: 200, width: 240, height: 200 }
          : dimensions.call(this);
      };
      Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', {
        configurable: true,
        get() {
          return this.getAttribute('role') === 'menu' ? 240 : 44;
        }
      });
      await api.act(() => trigger.click());
      const menu = window.document.querySelector('[role=menu]');
      assert.ok(menu);
      assert.equal(
        menu.style.position,
        'fixed',
        'menu must have its trigger before first placement'
      );
      assert.equal(menu.style.zIndex, '70');
      assert.equal(menu.style.top, '92px');
      assert.equal(menu.style.left, '104px', 'end alignment uses the actual captured trigger');
      anchor = { ...anchor, left: 400, right: 444, bottom: 108 };
      await api.act(() => window.dispatchEvent(new window.Event('resize')));
      assert.equal(menu.style.top, '112px');
      assert.equal(menu.style.left, '204px', 'resizing repositions from the live anchor');
      const select = [...menu.querySelectorAll('[role=menuitem]')].find(
        (item) => item.textContent === 'Select Books'
      );
      assert.equal(window.document.activeElement, select);
      await api.act(() => select.click());
      assert.equal(selected, 1);
      assert.equal(window.document.querySelector('[role=menu]'), null);
      assert.equal(window.document.activeElement, trigger);
      await api.act(() => trigger.click());
      await api.act(() =>
        window.document
          .querySelector('[role=menu]')
          .dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      );
      assert.equal(window.document.querySelector('[role=menu]'), null);
      assert.equal(window.document.activeElement, trigger);
      assert.equal(selected, 1, 'dismissal must not replay selection');
      await api.unmount();
      assert.equal(c.libraryActionsButton, null);
    });
  });
}

test('mounted two-way bindings do not persist unchanged defaults or echo new parent input', async () => {
  await fixture(async ({ window, api }) => {
    const writes = [];
    const controller = { value: 'YuKyokasho' };
    const bindings = {
      value(value) {
        writes.push(value);
        window.localStorage.setItem('fontFamilyGroupOne', value);
      }
    };
    let props = { controller, value: 'YuKyokasho', editValue: 'Klee One', bindings };
    await api.render('binding', props);
    assert.deepEqual(writes, [], 'reading the initial portable default is not a user edit');
    assert.equal(window.localStorage.getItem('fontFamilyGroupOne'), null);
    await api.act(() => window.document.querySelector('button').click());
    assert.deepEqual(writes, ['Klee One'], 'a real local edit publishes once');
    await api.render('binding', { ...props, value: 'Klee One' });
    assert.deepEqual(writes, ['Klee One'], 'parent acknowledgement does not echo');
    controller.value = 'A parent font';
    props = { ...props, value: 'A parent font' };
    await api.render('binding', props);
    assert.deepEqual(writes, ['Klee One'], 'an external parent-owned value does not write back');
    const replacement = { value: 'A parent font' };
    await api.render('binding', { ...props, controller: replacement });
    assert.deepEqual(writes, ['Klee One'], 'replacement controller gets its own input baseline');
    await api.act(() => window.document.querySelector('button').click());
    assert.deepEqual(writes, ['Klee One', 'Klee One']);
  });
});

test('mounted bindings still publish derived initial output and explicit undefined normalization', async () => {
  await fixture(async ({ api }) => {
    const writes = [];
    const refs = [];
    const bindings = { value: (value) => writes.push(value), this: (value) => refs.push(value) };
    const controller = { value: 'normalized' };
    await api.render('binding', { controller, value: ' raw ', bindings });
    assert.deepEqual(writes, ['normalized'], 'Strict Mode should not duplicate one initial output');
    assert.equal(refs.at(-1), controller);
    await api.render('binding', { controller, value: ' raw ', bindings });
    assert.deepEqual(writes, ['normalized']);
    const replacement = { value: undefined };
    await api.render('binding', { controller: replacement, value: 'invalid', bindings });
    assert.deepEqual(writes, ['normalized', undefined]);
    assert.equal(refs.at(-1), replacement);
    await api.unmount();
    assert.equal(refs.at(-1), undefined);
  });
});
