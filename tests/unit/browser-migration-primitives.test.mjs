/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { outputFiles } = await build({
  stdin: {
    contents: `
      import React, { act, useReducer, useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { Dom, useReaderBindings, Dialog as ReaderDialog, Sheet as ReaderSheet, Menu as ReaderMenu } from './reader-react/dom';
      import { HeaderView } from './library-react/header';
      import { ActionMenu, LibraryTabs } from './library-react/navigation';
      import { OrganizationView } from './library-react/organization';
      import { installRouter } from './runtime/navigation';
      import { Button, Menu } from './library-react/primitives';
      const root = createRoot(document.getElementById('root'));
      const routes = [];
      function ReaderModalFixture({sheet = false}) {
        const Modal = sheet ? ReaderSheet : ReaderDialog;
        return <Modal.Root open><Modal.Content><Modal.Title>Reader fixture</Modal.Title><Modal.Description>Reader description</Modal.Description></Modal.Content></Modal.Root>;
      }
      function ReaderDismissalFixture({preventOutside = false}) {
        const [open, setOpen] = useState(false);
        return <><button onClick={() => setOpen(true)}>Themes & Settings</button>
          <ReaderSheet.Root open={open} onOpenChange={setOpen}>
            <ReaderSheet.Content onInteractOutside={event => {
              window.outsideInteractions++;
              if (preventOutside) event.preventDefault();
            }}><ReaderSheet.Title>Themes & Settings</ReaderSheet.Title></ReaderSheet.Content>
          </ReaderSheet.Root></>;
      }
      installRouter({ push: path => routes.push(path), replace: path => routes.push(path) });
      function ReaderMenuFixture() {
        return <div className="react-reader-header"><header className="reader-toolbar">
          <ReaderMenu.Root><ReaderMenu.Trigger>Reading tools</ReaderMenu.Trigger>
            <ReaderMenu.Content><ReaderMenu.Item onSelect={() => window.selections++}>Browse Book</ReaderMenu.Item><ReaderMenu.Item>Save Reading Position</ReaderMenu.Item></ReaderMenu.Content>
          </ReaderMenu.Root>
        </header></div>;
      }
      function MenuFixture() {
        return <Menu.Root>
          <Menu.Trigger child={({ props }) => <Button {...props}>Library actions</Button>} />
          <Menu.Content><Menu.Item onSelect={() => window.selections++}>Select Books</Menu.Item></Menu.Content>
        </Menu.Root>;
      }
      function NestedMenuFixture() {
        return <Menu.Root>
          <Menu.Trigger>Library actions</Menu.Trigger>
          <Menu.Content>
            <Menu.Item data-test="plain">Select Books</Menu.Item>
            <Menu.Sub>
              <Menu.SubTrigger data-test="view">View Options</Menu.SubTrigger>
              <Menu.SubContent side="right">
                <Menu.RadioGroup value="grid" onValueChange={value => window.choices.push(value)}>
                  <Menu.RadioItem value="grid">Grid</Menu.RadioItem>
                  <Menu.RadioItem value="list">List</Menu.RadioItem>
                </Menu.RadioGroup>
                <Menu.Sub>
                  <Menu.SubTrigger data-test="sort">Sort by…</Menu.SubTrigger>
                  <Menu.SubContent side="right"><Menu.Item data-test="title">Title</Menu.Item></Menu.SubContent>
                </Menu.Sub>
              </Menu.SubContent>
            </Menu.Sub>
            <Menu.Sub>
              <Menu.SubTrigger data-test="add">Add Books</Menu.SubTrigger>
              <Menu.SubContent side="right"><Menu.Item data-test="import">Import File(s)</Menu.Item></Menu.SubContent>
            </Menu.Sub>
          </Menu.Content>
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
        routes,
        act: callback => { act(callback); },
        render: (kind, props = {}) => { act(() => root.render(<React.StrictMode>{kind === 'reader-dismissal' ? <ReaderDismissalFixture {...props} /> : kind === 'reader-menu' ? <ReaderMenuFixture /> : kind === 'reader-dialog' ? <ReaderModalFixture {...props} /> : kind === 'nested-menu' ? <NestedMenuFixture /> : kind === 'html' ? <Dom as="main" {...props} /> : kind === 'header' ? <HeaderView {...props} /> : kind === 'binding' ? <BindingFixture {...props} /> : kind === 'action-menu' ? <ActionMenu {...props}><Menu.Item>Batch action</Menu.Item></ActionMenu> : kind === 'organization' ? <OrganizationView {...props} /> : kind === 'tabs' ? <div className="library-react"><LibraryTabs /></div> : <MenuFixture />}</React.StrictMode>)); },
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
  window.outsideInteractions = 0;
  window.choices = [];
  window.scrollTo = () => {};
  window.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
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
    assert.match(menu.style.left, /clamp.*var\(--library-menu-left\).*100vw/);
    assert.match(menu.style.top, /clamp.*var\(--library-menu-top\).*100dvh/);
    assert.equal(menu.style.maxWidth, 'calc(100vw - 16px)');
    assert.equal(window.document.activeElement, menu.querySelector('[role=menuitem]'));
    await api.act(() => menu.querySelector('[role=menuitem]').click());
    assert.equal(window.selections, 1);
    assert.equal(window.document.querySelector('[role=menu]'), null);
    assert.equal(window.document.activeElement, trigger);
  });
});

test('Reader backdrop owns the complete touch activation and restores its trigger without click-through', async () => {
  await fixture(async ({ window, api }) => {
    await api.render('reader-dismissal');
    const trigger = window.document.querySelector('#root button');
    await api.act(() => {
      trigger.focus();
      trigger.click();
    });
    const backdrop = window.document.querySelector('.reader-modal-backdrop');
    assert.ok(backdrop);
    let escapedClicks = 0;
    window.addEventListener('click', () => escapedClicks++);
    let finishDismissal;
    window.requestAnimationFrame = (callback) => {
      finishDismissal = callback;
      return 1;
    };
    await api.act(() => {
      backdrop.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
      backdrop.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }));
    });
    assert.ok(backdrop.isConnected, 'the touch target survives until the click is dispatched');
    const click = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    await api.act(() => backdrop.dispatchEvent(click));
    assert.equal(click.defaultPrevented, true);
    assert.equal(escapedClicks, 0, 'reader/window handlers cannot reinterpret the dismissal');
    assert.equal(window.outsideInteractions, 1);
    await api.act(() => finishDismissal(0));
    assert.equal(window.document.querySelector('[role=dialog]'), null);
    assert.equal(window.document.activeElement, trigger);
  });
});

test('Reader outside-interaction cancellation keeps its modal open', async () => {
  await fixture(async ({ window, api }) => {
    await api.render('reader-dismissal', { preventOutside: true });
    await api.act(() => window.document.querySelector('#root button').click());
    const backdrop = window.document.querySelector('.reader-modal-backdrop');
    await api.act(() =>
      backdrop.dispatchEvent(
        new window.MouseEvent('pointerup', { bubbles: true, cancelable: true })
      )
    );
    assert.equal(window.outsideInteractions, 1);
    assert.ok(backdrop.isConnected);
  });
});

for (const sheet of [false, true])
  test(`mounted reader ${sheet ? 'sheet' : 'dialog'} preserves its title and description hooks and accessible associations`, async () => {
    await fixture(async ({ window, api }) => {
      await api.render('reader-dialog', { sheet });
      const modal = window.document.querySelector('[role=dialog]');
      const prefix = sheet ? 'sheet' : 'dialog';
      const title = modal.querySelector(`[data-slot="${prefix}-title"]`);
      const description = modal.querySelector(`[data-slot="${prefix}-description"]`);
      assert.ok(title);
      assert.ok(description);
      assert.equal(title.textContent, 'Reader fixture');
      assert.equal(description.textContent, 'Reader description');
      assert.equal(modal.getAttribute('aria-labelledby'), title.id);
      assert.equal(modal.getAttribute('aria-describedby'), description.id);
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
      assert.match(menu.style.left, /clamp.*var\(--library-menu-left\).*100vw/);
      assert.match(menu.style.top, /clamp.*var\(--library-menu-top\).*100dvh/);
      assert.equal(menu.style.maxWidth, 'calc(100vw - 16px)');
      assert.equal(menu.style.getPropertyValue('--library-menu-top'), '92px');
      assert.equal(
        menu.style.getPropertyValue('--library-menu-left'),
        '104px',
        'end alignment uses the actual captured trigger'
      );
      anchor = { ...anchor, left: 400, right: 444, bottom: 108 };
      await api.act(() => window.dispatchEvent(new window.Event('resize')));
      assert.equal(menu.style.getPropertyValue('--library-menu-top'), '112px');
      assert.equal(
        menu.style.getPropertyValue('--library-menu-left'),
        '204px',
        'resizing repositions from the live anchor'
      );
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

test('action menus retain their descriptive title as the accessible name', async () => {
  await fixture(async ({ window, api }) => {
    for (const [props, expected] of [
      [{ label: 'Actions', title: 'Selected book actions' }, 'Selected book actions'],
      [{ label: 'Add books' }, 'Add books'],
      [{ label: 'Actions', title: '', iconOnly: true }, 'Actions']
    ]) {
      await api.render('action-menu', props);
      const button = window.document.querySelector('button');
      assert.equal(button.getAttribute('aria-label'), expected);
      assert.equal(button.getAttribute('title'), expected);
      const icon = button.querySelector('svg');
      assert.equal(icon.getAttribute('aria-hidden'), 'true');
      if (props.iconOnly) {
        for (const token of ['size-[44px]', 'min-h-[44px]', 'rounded-full', 'p-0'])
          assert.ok(button.classList.contains(token), token);
        assert.equal(
          button.classList.contains('px-4'),
          false,
          'default padding cannot overflow a 44px grid column'
        );
        assert.ok(icon.classList.contains('size-[24px]'));
      } else {
        assert.ok(button.classList.contains('min-h-9'));
        assert.ok(icon.classList.contains('size-3.5'));
      }
      await api.act(() => button.click());
      assert.equal(window.document.querySelector('[role=menu]').style.position, 'fixed');
      await api.act(() => window.document.querySelector('[role=menuitem]').click());
    }
  });
});

test('metadata textarea labels stay exact when imported values become React text nodes', async () => {
  await fixture(async ({ window, api }) => {
    const c = {
      open: true,
      busy: false,
      mode: 'metadata',
      title: 'Imported book',
      authors: '著者\nSecond author',
      authorSort: 'Sort, Author',
      subjects: '日本語\nHistory',
      description: 'A plain description',
      language: 'ja',
      published: '2024-03-01',
      publisher: '出版社',
      seriesName: '',
      seriesIndex: '',
      coverBlur: false,
      seriesNames: [],
      error: ''
    };
    const expected = [
      'Authors (one per line)',
      'Author sort names (matching lines, optional)',
      'Tags (one per line)',
      'Description'
    ];
    for (const authors of ['著者\nSecond author', 'Changed author']) {
      c.authors = authors;
      await api.render('organization', { c });
      const fields = [...window.document.querySelectorAll('[data-slot="dialog-content"] textarea')];
      assert.equal(fields.length, 4);
      const labels = fields.map((field) => {
        const id = field.getAttribute('aria-labelledby');
        assert.ok(id, 'the imported value cannot become part of the field label');
        const label = window.document.getElementById(id);
        assert.ok(label);
        assert.equal(label.closest('label'), field.closest('label'));
        return label.textContent;
      });
      assert.deepEqual(labels, expected);
      assert.equal(new Set(fields.map((field) => field.getAttribute('aria-labelledby'))).size, 4);
      assert.equal(fields[0].value, authors);
    }
  });
});

test('Library section tabs preserve wrapping, text-zoom-safe spacing and subpath links', async () => {
  await fixture(async ({ window, api }) => {
    const css = readFileSync(path.join(root, 'apps/web/src/library-react/library.css'), 'utf8');
    const retainedRules = css.match(/\.library-react \.media-library-tabs[^{}]*\{[^{}]*\}/g);
    assert.equal(retainedRules?.length, 4);
    const style = window.document.createElement('style');
    style.textContent = retainedRules.join('\n');
    window.document.head.append(style);
    await api.render('tabs');
    const nav = window.document.querySelector('nav');
    assert.equal(nav.getAttribute('aria-label'), 'Library sections');
    const links = [...nav.querySelectorAll('a')];
    assert.deepEqual(
      links.map((link) => link.getAttribute('href')),
      ['/reader-web/manage', '/reader-web/videos']
    );
    for (const fontSize of ['100%', '200%']) {
      window.document.documentElement.style.fontSize = fontSize;
      const layout = window.getComputedStyle(nav);
      assert.equal(layout.flexWrap, 'wrap');
      assert.equal(layout.maxWidth, 'calc(100% - 48px)');
      assert.equal(layout.gap, '6px');
      assert.equal(layout.marginLeft, '24px');
      for (const link of links) {
        const style = window.getComputedStyle(link);
        assert.equal(style.minHeight, '44px');
        assert.equal(style.maxWidth, '100%');
        assert.equal(style.minWidth, '0');
        assert.equal(style.overflowWrap, 'anywhere');
      }
    }
    let result;
    window.document.addEventListener('click', (event) => {
      result = event.defaultPrevented;
      event.preventDefault();
    });
    await api.act(() =>
      links[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    );
    assert.equal(result, true);
    assert.deepEqual(Array.from(api.routes), ['/videos']);
    for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
      await api.act(() =>
        links[1].dispatchEvent(
          new window.MouseEvent('click', { bubbles: true, cancelable: true, [modifier]: true })
        )
      );
      assert.equal(result, false, modifier + ' retains native link behavior');
    }
    assert.equal(api.routes.length, 1);
  });
});

function pointer(window, node, pointerType = 'mouse') {
  const event = new window.MouseEvent('pointerover', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  node.dispatchEvent(event);
}

test('Library submenu hover opens one sibling, retains portals and closes the tree after selection', async () => {
  await fixture(async ({ window, api }) => {
    await api.render('nested-menu');
    const trigger = window.document.querySelector('#root button');
    await api.act(() => trigger.click());
    const viewTrigger = window.document.querySelector('[data-test=view]');
    viewTrigger.getBoundingClientRect = () => ({
      left: 200,
      right: 400,
      top: 80,
      bottom: 124,
      width: 200,
      height: 44
    });
    Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get() {
        return this.getAttribute('role') === 'menu' ? 160 : 44;
      }
    });
    await api.act(() => pointer(window, viewTrigger));
    assert.equal(window.document.querySelectorAll('[role=menu]').length, 2);
    const submenu = window.document.querySelectorAll('[role=menu]')[1];
    assert.equal(submenu.style.getPropertyValue('--library-menu-left'), '404px');
    assert.equal(submenu.style.getPropertyValue('--library-menu-top'), '80px');
    window.innerWidth = 500;
    await api.act(() => window.dispatchEvent(new window.Event('resize')));
    assert.equal(
      submenu.style.getPropertyValue('--library-menu-left'),
      '36px',
      'a right submenu flips before overflowing the viewport'
    );
    const item = [...window.document.querySelectorAll('[role=menuitemradio]')].find(
      (node) => node.textContent.trim() === 'List'
    );
    assert.ok(item);
    await api.act(() => pointer(window, item));
    assert.equal(
      window.document.querySelectorAll('[role=menu]').length,
      2,
      'entering a submenu portal keeps its parent'
    );
    await api.act(() => pointer(window, window.document.querySelector('[data-test=add]')));
    assert.equal(
      window.document.querySelectorAll('[role=menu]').length,
      2,
      'a sibling submenu replaces the prior one'
    );
    assert.equal(window.document.querySelectorAll('[role=menuitemradio]').length, 0);
    assert.ok(window.document.querySelector('[data-test=import]'));
    await api.act(() => window.document.querySelector('[data-test=add]').click());
    assert.ok(
      window.document.querySelector('[data-test=import]'),
      'a pointer click after hover opens the same submenu instead of toggling it closed'
    );
    await api.act(() => pointer(window, window.document.querySelector('[data-test=plain]')));
    assert.equal(window.document.querySelectorAll('[role=menu]').length, 1);
    await api.act(() => pointer(window, window.document.querySelector('[data-test=view]')));
    await api.act(() =>
      [...window.document.querySelectorAll('[role=menuitemradio]')]
        .find((node) => node.textContent.trim() === 'List')
        .click()
    );
    assert.deepEqual(Array.from(window.choices), ['list']);
    assert.equal(window.document.querySelectorAll('[role=menu]').length, 0);
    assert.equal(window.document.activeElement, trigger);
  });
});

test('Library nested keyboard navigation and touch activation preserve parent focus', async () => {
  await fixture(async ({ window, api }) => {
    await api.render('nested-menu');
    const trigger = window.document.querySelector('#root button');
    await api.act(() => trigger.click());
    let view = window.document.querySelector('[data-test=view]');
    await api.act(() => pointer(window, view, 'touch'));
    assert.equal(window.document.querySelectorAll('[role=menu]').length, 1);
    await api.act(() => view.click());
    assert.equal(window.document.querySelectorAll('[role=menu]').length, 2);
    const sort = window.document.querySelector('[data-test=sort]');
    await api.act(() => {
      sort.focus();
      sort.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
      );
    });
    assert.equal(window.document.querySelectorAll('[role=menu]').length, 3);
    const title = window.document.querySelector('[data-test=title]');
    assert.equal(window.document.activeElement, title);
    await api.act(() =>
      title.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
      )
    );
    assert.equal(
      window.document.querySelectorAll('[role=menu]').length,
      2,
      'ArrowLeft closes only the innermost portal'
    );
    assert.equal(window.document.activeElement, sort);
    await api.act(() =>
      sort.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
      )
    );
    assert.equal(window.document.querySelectorAll('[role=menu]').length, 1);
    view = window.document.querySelector('[data-test=view]');
    assert.equal(window.document.activeElement, view);
    await api.act(() =>
      window.document.body.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }))
    );
    assert.equal(window.document.querySelectorAll('[role=menu]').length, 0);
    assert.equal(window.choices.length, 0);
    await api.act(() => trigger.click());
    await api.act(() => window.document.querySelector('[data-test=view]').click());
    const submenuItem = window.document.querySelector('[data-test=sort]');
    await api.act(() =>
      submenuItem.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      )
    );
    assert.equal(window.document.querySelectorAll('[role=menu]').length, 0);
    assert.equal(window.document.activeElement, trigger);
  });
});

test('Reading tools uses its live trigger and the small visual viewport outside toolbar button constraints', async () => {
  await fixture(async ({ window, api }) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 320 });
    await api.render('reader-menu');
    const trigger = window.document.querySelector('button');
    let anchor = { left: 264, right: 308, top: 12, bottom: 56, width: 44, height: 44 };
    trigger.getBoundingClientRect = () => anchor;
    const dimensions = window.HTMLElement.prototype.getBoundingClientRect;
    window.HTMLElement.prototype.getBoundingClientRect = function () {
      return this.getAttribute('role') === 'menu'
        ? { left: 0, right: 304, top: 0, bottom: 720, width: 304, height: 720 }
        : dimensions.call(this);
    };
    await api.act(() => trigger.click());
    const menu = window.document.querySelector('[role=menu]');
    assert.equal(menu.parentElement, window.document.body);
    assert.equal(
      menu.closest('.reader-toolbar'),
      null,
      'toolbar icon sizing cannot constrain menu labels'
    );
    assert.equal(menu.style.left, '8px');
    assert.equal(menu.style.top, '64px');
    assert.equal(menu.style.maxWidth, '304px');
    assert.equal(menu.style.maxHeight, '248px');
    assert.equal(window.document.activeElement, menu.querySelector('[role=menuitem]'));
    anchor = { ...anchor, top: 264, bottom: 308 };
    await api.act(() => window.dispatchEvent(new window.Event('resize')));
    assert.equal(menu.style.top, '8px', 'a bottom trigger places tall content above');
    assert.equal(menu.style.maxHeight, '248px');
    await api.act(() =>
      menu.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    );
    assert.equal(window.document.querySelector('[role=menu]'), null);
    assert.equal(window.document.activeElement, trigger);
    await api.act(() => trigger.click());
    await api.act(() => window.document.querySelector('[role=menuitem]').click());
    assert.equal(window.selections, 1);
    assert.equal(window.document.querySelector('[role=menu]'), null);
    assert.equal(window.document.activeElement, trigger);
  });
});
