/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { outputFiles } = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { AppNav } from './apps/web/src/library-react/navigation';
      import { goto, installRouter, beforeNavigate } from './apps/web/src/runtime/navigation';
      const root = createRoot(document.getElementById('root'));
      window.controls = {
        goto, installRouter, beforeNavigate,
        render: (props = {}, strict = false) => root.render(strict
          ? <React.StrictMode><AppNav {...props} /></React.StrictMode>
          : <AppNav {...props} />),
        clear: () => root.render(null),
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
  jsx: 'automatic',
  loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'warning'
});
const javascript = outputFiles[0].text;
const styles = readFileSync(join(root, 'apps/web/src/library-react/navigation.css'), 'utf8');
const destinations = [
  ['Library', '/manage', 'Books and snippets across your connected storage'],
  ['Snippets', '/snippets', 'Read, edit, and collect short texts'],
  ['Statistics', '/statistics', 'Reading time, characters, and activity'],
  ['Settings', '/settings', 'Appearance, reading, data, and goals'],
  ['Accounts and libraries', '/connections', 'Manabi account, cloud drives, and local folders'],
  ['Shared libraries', '/shared-library', 'Manage shared local-folder libraries'],
  ['Import from Ttu Ebook Reader', '/import-ttu', 'Bring books, bookmarks, and reading data']
];

async function fixture(run) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', (error) => errors.push(error.message));
  console.on('error', (...parts) => errors.push(parts.map(String).join(' ')));
  const dom = new JSDOM(
    `<!doctype html><html><head><style>${styles}</style></head>
     <body><div id="root"></div></body></html>`,
    {
      url: 'https://reader.example/reader-web/settings#appearance',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      virtualConsole: console
    }
  );
  const { window } = dom;
  window.process = { env: {} };
  window.structuredClone = structuredClone;
  window.scrollTo = () => {};
  // JSDOM implements dialog elements, but not the browser's top-layer APIs.
  // Production rendering, state, links, routing, close handling and focus remain real.
  window.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  window.eval(javascript);
  const api = window.controls;
  const until = async (predicate, message) => {
    for (let attempt = 0; attempt < 40 && !predicate(); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(predicate(), message);
  };
  const trigger = () => window.document.querySelector('[data-navigation-trigger]');
  const open = async () => {
    trigger().focus();
    trigger().click();
    await until(() => window.document.querySelector('[role="menu"]'), 'the contextual menu opens');
    return window.document.querySelector('[role="menu"]');
  };
  try {
    await run({ window, api, until, trigger, open });
  } finally {
    api.unmount();
    window.close();
  }
  assert.deepEqual(errors, [], 'mounted navigation must not emit React or DOM errors');
}

test('pushed Settings exposes related actions without global tabs or a Settings self-link', async () => {
  for (const strict of [false, true])
    await fixture(async ({ window, api, until, trigger, open }) => {
      api.render({ compact: true }, strict);
      await until(trigger, 'overflow mounts');
      assert.equal(window.document.querySelector('[aria-label="Primary navigation"]'), null);
      assert.equal(trigger().getAttribute('aria-haspopup'), 'menu');
      assert.equal(trigger().getAttribute('aria-expanded'), 'false');
      const menu = await open();
      assert.equal(trigger().getAttribute('aria-expanded'), 'true');
      assert.equal(menu.getAttribute('aria-label'), 'Page actions');
      assert.deepEqual(
        [...menu.querySelectorAll('[role="menuitem"]')].map((x) => x.getAttribute('aria-label')),
        ['Accounts and libraries', 'User guide']
      );
      assert.equal(menu.querySelector('[aria-current="page"]'), null);
      const guide = menu.querySelector('[aria-label="User guide"]');
      assert.equal(guide.getAttribute('href'), '/Manabi-Web/Docs/');
      assert.equal(guide.getAttribute('target'), '_blank');
      assert.equal(guide.getAttribute('rel'), 'noopener noreferrer');
      assert.equal(guide.querySelector('svg').getAttribute('aria-hidden'), 'true');
    });
});

test('Escape, trigger and outside dismissal work repeatedly and preserve the route', async () => {
  for (const strict of [false, true])
    await fixture(async ({ window, api, until, trigger, open }) => {
      api.render({}, strict);
      await until(trigger, 'overflow mounts');
      for (const method of ['escape', 'trigger', 'outside', 'escape']) {
        const menu = await open();
        assert.equal(window.document.activeElement, menu.querySelector('[role="menuitem"]'));
        if (method === 'escape')
          menu.dispatchEvent(
            new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
          );
        if (method === 'trigger') trigger().click();
        if (method === 'outside')
          window.document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
        await until(() => !window.document.querySelector('[role="menu"]'), method + ' dismisses');
        if (method === 'escape') assert.equal(window.document.activeElement, trigger());
        assert.equal(trigger().getAttribute('aria-expanded'), 'false');
        assert.equal(window.location.href, 'https://reader.example/reader-web/settings#appearance');
      }
    });
});

test('iconOnly is a 44px contextual overflow, without a compact global sidebar', async () => {
  await fixture(async ({ window, api, until, trigger, open }) => {
    api.render({ iconOnly: true, compact: true }, true);
    await until(trigger, 'overflow mounts');
    assert.equal(trigger().getAttribute('aria-label'), 'Main menu');
    assert.equal(trigger().querySelector('.navigation-label'), null);
    assert.equal(window.document.querySelector('[aria-label="Primary navigation"]'), null);
    assert.equal(window.getComputedStyle(trigger()).width, '44px');
    assert.equal(window.getComputedStyle(trigger()).height, '44px');
    const menu = await open();
    assert.equal(window.document.querySelector('dialog'), null);
    assert.equal(menu.querySelectorAll('[role="menuitem"]').length, 2);
  });
});

test('navigation uses the actual adapter and contextual choices follow Back and Forward', async () => {
  await fixture(async ({ window, api, until, trigger, open }) => {
    api.render();
    await until(trigger, 'overflow mounts');
    (await open()).querySelector('[aria-label="Accounts and libraries"]').click();
    await until(
      () => window.location.pathname.endsWith('/connections'),
      'Accounts routes through goto'
    );
    assert.equal(window.document.querySelector('[role="menu"]'), null);
    let menu = await open();
    assert.equal(menu.querySelector('[aria-label="Accounts and libraries"]'), null);
    menu.querySelector('[aria-label="Import from Ttu Ebook Reader"]').click();
    await until(
      () => window.location.pathname.endsWith('/import-ttu'),
      'Import routes through goto'
    );
    menu = await open();
    assert.equal(menu.querySelector('[aria-label="Import from Ttu Ebook Reader"]'), null);
    trigger().click();
    window.history.back();
    await until(
      () => window.location.pathname.endsWith('/connections'),
      'browser Back restores Accounts'
    );
    assert.ok((await open()).querySelector('[aria-label="Import from Ttu Ebook Reader"]'));
    trigger().click();
    await until(
      () => !window.document.querySelector('[role="menu"]'),
      'menu closes before Forward'
    );
    window.history.forward();
    await until(
      () => window.location.pathname.endsWith('/import-ttu'),
      'browser Forward restores Import'
    );
    assert.equal((await open()).querySelector('[aria-label="Import from Ttu Ebook Reader"]'), null);
    trigger().click();
    await until(
      () => !window.document.querySelector('[role="menu"]'),
      'menu closes before adapter'
    );
    const calls = [];
    const stopRouter = api.installRouter({ push: (path) => calls.push(path), replace() {} });
    try {
      (await open()).querySelector('[aria-label="Accounts and libraries"]').click();
      await until(() => calls.length === 1, 'Expo receives the related route');
      assert.deepEqual(calls, ['/connections']);
    } finally {
      stopRouter();
    }
  });
});

test('navigation guards and modified links preserve their original behavior', async () => {
  await fixture(async ({ window, api, until, trigger, open }) => {
    api.render();
    await until(trigger, 'overflow mounts');
    const stopGuard = api.beforeNavigate((event) => event.cancel());
    (await open()).querySelector('[aria-label="Accounts and libraries"]').click();
    await until(() => !window.document.querySelector('[role="menu"]'), 'guarded menu closes');
    assert.equal(window.location.pathname, '/reader-web/settings');
    stopGuard();
    for (const modifiers of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true }
    ]) {
      const menu = await open();
      let intercepted;
      window.addEventListener(
        'click',
        (event) => {
          intercepted = event.defaultPrevented;
          event.preventDefault();
        },
        { once: true }
      );
      menu
        .querySelector('[aria-label="Accounts and libraries"]')
        .dispatchEvent(
          new window.MouseEvent('click', { bubbles: true, cancelable: true, ...modifiers })
        );
      await until(
        () => !window.document.querySelector('[role="menu"]'),
        'modified link closes menu'
      );
      assert.equal(intercepted, false);
      assert.equal(window.location.pathname, '/reader-web/settings');
    }
    const menu = await open();
    let intercepted;
    window.addEventListener(
      'click',
      (event) => {
        intercepted = event.defaultPrevented;
        event.preventDefault();
      },
      { once: true }
    );
    menu.querySelector('[aria-label="User guide"]').click();
    await until(() => !window.document.querySelector('[role="menu"]'), 'guide closes menu');
    assert.equal(intercepted, false);
    assert.equal(window.location.pathname, '/reader-web/settings');
  });
});

test('Library retains global destinations while every pushed route excludes itself', async () => {
  await fixture(async ({ window, api, until, trigger, open }) => {
    api.render();
    await until(trigger, 'overflow mounts');
    for (const [label, path] of destinations) {
      await api.goto('/reader-web' + path);
      const menu = await open();
      assert.equal(menu.querySelector(`[aria-label="${label}"]`), null);
      assert.equal(window.document.querySelector('[aria-label="Primary navigation"]'), null);
      if (path === '/manage') {
        for (const [next, destination] of destinations.slice(1))
          assert.equal(
            menu.querySelector(`[aria-label="${next}"]`).getAttribute('href'),
            '/reader-web' + destination
          );
      }
      menu.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await until(() => !window.document.querySelector('[role="menu"]'), 'menu closes');
    }
    api.clear();
    await until(() => !trigger(), 'unmount removes the menu and trigger');
  });
});
