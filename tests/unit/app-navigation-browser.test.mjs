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
    await until(() => window.document.querySelector('dialog[open]'), 'the real sheet opens');
    return window.document.querySelector('dialog[open]');
  };
  try {
    await run({ window, api, until, trigger, open });
  } finally {
    api.unmount();
    window.close();
  }
  assert.deepEqual(errors, [], 'mounted navigation must not emit React or DOM errors');
}

test('AppNav restores primary navigation and the complete accessible destination sheet', async () => {
  for (const strict of [false, true])
    await fixture(async ({ window, api, until, trigger, open }) => {
      api.render({ compact: true }, strict);
      await until(trigger, 'Navigate mounts');
      const primary = window.document.querySelector('nav[aria-label="Primary navigation"]');
      assert.deepEqual(
        [...primary.querySelectorAll('a')].map((link) => [
          link.textContent,
          link.getAttribute('href')
        ]),
        destinations.slice(0, 4).map(([label, path]) => [label, '/reader-web' + path])
      );
      assert.equal(primary.querySelector('[aria-current="page"]').textContent, 'Settings');
      assert.equal(trigger().getAttribute('aria-label'), 'Navigate');
      assert.equal(trigger().getAttribute('aria-haspopup'), 'dialog');
      assert.equal(trigger().getAttribute('aria-expanded'), 'false');
      assert.ok(trigger().closest('.app-navigation-compact'));
      const panel = await open();
      assert.equal(trigger().getAttribute('aria-expanded'), 'true');
      assert.equal(trigger().getAttribute('aria-controls'), panel.id);
      assert.equal(panel.getAttribute('role'), 'dialog');
      assert.equal(panel.getAttribute('aria-modal'), 'true');
      assert.equal(panel.dataset.side, 'right');
      assert.equal(
        window.document.getElementById(panel.getAttribute('aria-labelledby')).textContent,
        'Manabi Reader'
      );
      assert.equal(
        window.document.getElementById(panel.getAttribute('aria-describedby')).textContent,
        'Your books. Your reading space.'
      );
      const navigation = panel.querySelector('nav[aria-label="Main navigation"]');
      assert.equal(navigation.querySelectorAll('a').length, 8);
      for (const [label, path, detail] of destinations) {
        const link = navigation.querySelector(`a[aria-label="${label}"]`);
        assert.equal(link.getAttribute('href'), '/reader-web' + path);
        assert.equal(link.querySelector('.app-navigation-label').textContent, label);
        assert.equal(link.querySelector('.app-navigation-detail').textContent, detail);
        assert.equal(link.querySelector('svg').getAttribute('aria-hidden'), 'true');
        assert.equal(link.getAttribute('aria-current'), path === '/settings' ? 'page' : null);
      }
      assert.ok(navigation.querySelector('[role="separator"]'));
      const guide = navigation.querySelector('[aria-label="User guide"]');
      assert.equal(guide.getAttribute('href'), '/Manabi-Web/Docs/');
      assert.equal(guide.getAttribute('target'), '_blank');
      assert.equal(guide.getAttribute('rel'), 'noopener noreferrer');
      assert.equal(
        guide.querySelector('.app-navigation-detail').textContent,
        'Reading, libraries, and data'
      );
    });
});

test('closing, canceling, and backdrop dismissal restore the trigger through repeated opens', async () => {
  for (const strict of [false, true])
    await fixture(async ({ window, api, until, trigger, open }) => {
      api.render({}, strict);
      await until(trigger, 'Navigate mounts');
      for (const method of ['close', 'cancel', 'backdrop', 'close']) {
        const panel = await open();
        const close = panel.querySelector('button[aria-label="Close"]');
        assert.equal(window.document.activeElement, close, 'focus starts on reachable dismissal');
        if (method === 'close') close.click();
        if (method === 'cancel') {
          const cancel = new window.Event('cancel', { bubbles: false, cancelable: true });
          panel.dispatchEvent(cancel);
          assert.equal(cancel.defaultPrevented, true);
        }
        if (method === 'backdrop')
          panel.dispatchEvent(
            new window.MouseEvent('click', { bubbles: true, clientX: -1, clientY: -1 })
          );
        await until(() => !window.document.querySelector('dialog'), method + ' dismisses');
        assert.equal(window.document.activeElement, trigger());
        assert.equal(trigger().getAttribute('aria-expanded'), 'false');
        assert.equal(window.location.href, 'https://reader.example/reader-web/settings#appearance');
      }
    });
});

test('iconOnly uses the left sheet and omits primary navigation without dropping destinations', async () => {
  await fixture(async ({ window, api, until, trigger, open }) => {
    api.render({ iconOnly: true, compact: true }, true);
    await until(trigger, 'Main menu mounts');
    assert.equal(trigger().getAttribute('aria-label'), 'Main menu');
    assert.equal(trigger().getAttribute('title'), 'Main menu');
    assert.equal(trigger().querySelector('.navigation-label'), null);
    assert.equal(window.document.querySelector('[aria-label="Primary navigation"]'), null);
    assert.equal(window.getComputedStyle(trigger()).width, '44px');
    assert.equal(window.getComputedStyle(trigger()).height, '44px');
    const panel = await open();
    assert.equal(panel.dataset.side, 'left');
    assert.equal(panel.querySelectorAll('nav a').length, 8);
  });
});

test('ordinary navigation uses the real route adapter and current-page markers follow history', async () => {
  await fixture(async ({ window, api, until, trigger, open }) => {
    api.render();
    await until(trigger, 'Navigate mounts');
    const panel = await open();
    panel.querySelector('[aria-label="Import from Ttu Ebook Reader"]').click();
    await until(
      () => window.location.pathname.endsWith('/import-ttu'),
      'Import routes through goto'
    );
    assert.equal(window.document.querySelector('dialog'), null);
    const reopened = await open();
    assert.equal(
      reopened.querySelector('[aria-current="page"]').getAttribute('aria-label'),
      'Import from Ttu Ebook Reader'
    );
    reopened.querySelector('[aria-label="Close"]').click();
    await until(() => !window.document.querySelector('dialog'), 'sheet closes');
    const primary = window.document.querySelector('[aria-label="Primary navigation"]');
    primary.querySelector('a[href$="/snippets"]').click();
    await until(
      () => window.location.pathname.endsWith('/snippets'),
      'primary link routes through goto'
    );
    assert.equal(primary.querySelector('[aria-current="page"]').textContent, 'Snippets');
    window.history.back();
    await until(
      () => window.location.pathname.endsWith('/import-ttu'),
      'browser Back updates the route'
    );
    assert.equal(primary.querySelector('[aria-current="page"]'), null);
    window.history.forward();
    await until(
      () => primary.querySelector('[aria-current="page"]')?.textContent === 'Snippets',
      'browser Forward restores current-page marker'
    );
    const calls = [];
    const stopRouter = api.installRouter({
      push: (path) => calls.push(path),
      replace() {}
    });
    try {
      const adapted = await open();
      adapted.querySelector('[aria-label="Accounts and libraries"]').click();
      await until(() => calls.length === 1, 'Expo adapter receives navigation');
      assert.deepEqual(calls, ['/connections']);
    } finally {
      stopRouter();
    }
  });
});

test('navigation guards are honored and modified links retain browser gestures', async () => {
  await fixture(async ({ window, api, until, trigger, open }) => {
    api.render();
    await until(trigger, 'Navigate mounts');
    const stopGuard = api.beforeNavigate((event) => event.cancel());
    const panel = await open();
    panel.querySelector('[aria-label="Library"]').click();
    await until(() => !window.document.querySelector('dialog'), 'guarded sheet closes');
    assert.equal(window.location.pathname, '/reader-web/settings');
    stopGuard();
    for (const modifiers of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true }
    ]) {
      const menu = await open();
      const link = menu.querySelector('[aria-label="Library"]');
      let intercepted;
      // Observe React's result, then suppress JSDOM's unsupported new-document navigation.
      window.addEventListener(
        'click',
        (event) => {
          intercepted = event.defaultPrevented;
          event.preventDefault();
        },
        { once: true }
      );
      link.dispatchEvent(
        new window.MouseEvent('click', { bubbles: true, cancelable: true, ...modifiers })
      );
      await until(() => !window.document.querySelector('dialog'), 'modified link closes the sheet');
      assert.equal(intercepted, false, 'the app must not cancel native modified-click handling');
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
    await until(() => !window.document.querySelector('dialog'), 'the guide closes the sheet');
    assert.equal(intercepted, false, 'guide remains a native external-document link');
    assert.equal(window.location.pathname, '/reader-web/settings');
  });
});

test('the real sheet owns explicit geometry and scrolling independently of its 44px Close control', async () => {
  await fixture(async ({ window, api, until, trigger, open }) => {
    api.render({ compact: true });
    await until(trigger, 'Navigate mounts');
    const panel = await open();
    const style = window.getComputedStyle(panel);
    assert.equal(style.display, 'flex');
    assert.equal(style.flexDirection, 'column');
    assert.equal(style.padding, '0px');
    assert.equal(style.margin, '0px');
    assert.equal(style.overflow, 'hidden');
    assert.equal(style.height, '100dvh');
    assert.equal(style.maxHeight, '100dvh');
    assert.equal(style.maxWidth, 'min(24rem, calc(100vw - 1rem))');
    const navigation = panel.querySelector('nav');
    const scroll = window.getComputedStyle(navigation);
    assert.equal(scroll.minHeight, '0');
    assert.equal(scroll.overflowY, 'auto');
    assert.equal(scroll.overscrollBehavior, 'contain');
    assert.equal(window.getComputedStyle(panel.querySelector('header')).flexShrink, '0');
    const close = panel.querySelector('[aria-label="Close"]');
    assert.equal(
      navigation.contains(close),
      false,
      'Close is outside the scrolling destination list'
    );
    const closeStyle = window.getComputedStyle(close);
    assert.equal(closeStyle.position, 'absolute');
    assert.equal(closeStyle.width, '44px');
    assert.equal(closeStyle.height, '44px');
    api.clear();
    await until(() => !window.document.querySelector('dialog'), 'unmount removes the portal');
  });
});
