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
      import { Dom } from './apps/web/src/settings-react/primitives';
      import { SettingsScreen } from './apps/web/src/settings-react/settings-screen';
      import { goto, installRouter, beforeNavigate, afterNavigate } from './apps/web/src/runtime/navigation';
      import { page } from './apps/web/src/runtime/stores';
      import { get } from './apps/web/src/lib/state/store';
      const root = createRoot(document.getElementById('root'));
      function CheckboxFixture({ binding }) {
        const [checked, setChecked] = React.useState(false);
        React.useEffect(() => { window.checkboxMounted = true; }, []);
        const update = value => { window.changes.push(value); setChecked(value); };
        return <Dom as="input" type="checkbox" checked={checked}
          bindings={binding ? { checked: update } : {}}
          events={binding ? {} : { change: event => update(event.currentTarget.checked) }} />;
      }
      window.controls = {
        goto, installRouter, beforeNavigate, afterNavigate,
        location: () => get(page).url.href,
        render: strict => root.render(strict ? <React.StrictMode><SettingsScreen /></React.StrictMode> : <SettingsScreen />),
        renderCheckbox: binding => root.render(<React.StrictMode><CheckboxFixture binding={binding} /></React.StrictMode>),
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
  outdir: '/tmp/manabi-settings-browser-bundle',
  jsx: 'automatic',
  loader: { '.css': 'empty', '.wasm': 'file', '.onnx': 'file' },
  define: {
    'process.env.NODE_ENV': '"development"',
    'import.meta.url': '"https://reader.example/fixture.js"'
  },
  logLevel: 'warning'
});
const javascript = outputFiles.find((file) => file.path.endsWith('.js')).text;

async function fixture(run) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', (error) => errors.push(error.message));
  console.on('error', (...parts) => errors.push(parts.map(String).join(' ')));
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
    {
      url: 'https://reader.example/reader-web/settings',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      virtualConsole: console
    }
  );
  const { window } = dom;
  Object.assign(window, {
    ...fakeIndexedDB,
    changes: [],
    process: { env: {} },
    TextEncoder,
    TextDecoder,
    structuredClone,
    Response,
    Request,
    Headers,
    fetch: async () => new Response('', { status: 503 }),
    CSS: {
      escape: (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => '\\' + character)
    },
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
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
  window.eval(javascript);
  const api = window.controls;
  const until = async (predicate, message) => {
    for (let attempt = 0; attempt < 40 && !predicate(); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(predicate(), message);
  };
  try {
    await run({ window, api, until });
  } finally {
    await api.unmount();
    window.close();
  }
  assert.deepEqual(errors, [], 'mounted Settings must not emit React or DOM errors');
}

test('Settings category links keep one mounted screen and synchronize browser Back and Forward', async () => {
  for (const strict of [false, true])
    await fixture(async ({ window, api, until }) => {
      const calls = [];
      const stop = api.installRouter({
        sameDocumentHistory: true,
        push: (path) => calls.push(['push', path]),
        replace: (path) => calls.push(['replace', path])
      });
      await api.render(strict);
      const document = window.document;
      await until(() => document.querySelector('button[title="manabi-theme"]'), 'themes mount');
      assert.equal(
        window.localStorage.getItem('fontFamilyGroupOne'),
        null,
        'opening Settings must not persist the device-effective default font'
      );
      const heading = () => document.querySelector('#settings-content h1')?.textContent;
      assert.equal(heading(), 'Appearance');
      const clickCategory = async (category) => {
        const link = document.querySelector(`[data-section-link][href="#${category}"]`);
        assert.ok(link, category);
        link.click();
      };
      for (const [category, label] of [
        ['typography', 'Fonts & text'],
        ['layout', 'Page layout'],
        ['all', 'All settings']
      ]) {
        await clickCategory(category);
        await until(() => heading() === label, `${category} becomes selected`);
        assert.equal(calls.length, 0, 'a fragment change must not push another Expo screen');
        assert.equal(window.location.hash, '#' + category);
        assert.equal(api.location(), window.location.href);
        assert.equal(document.querySelectorAll('#settings-content').length, 1);
        for (const theme of [
          'manabi-theme',
          'light-theme',
          'ecru-theme',
          'water-theme',
          'gray-theme',
          'dark-theme',
          'black-theme'
        ])
          assert.equal(document.querySelectorAll(`button[title="${theme}"]`).length, 1, theme);
      }
      window.history.back();
      await until(() => heading() === 'Page layout', 'Back restores the prior category');
      assert.equal(api.location(), window.location.href);
      window.history.forward();
      await until(() => heading() === 'All settings', 'Forward restores the later category');
      assert.equal(api.location(), window.location.href);
      assert.equal(window.localStorage.getItem('fontFamilyGroupOne'), null);
      stop();
    });
});

test('browser fragment handling preserves router state, navigation guards and native route delegation', async () => {
  await fixture(async ({ window, api }) => {
    const calls = [];
    const router = {
      push: (path) => calls.push(['push', path]),
      replace: (path) => calls.push(['replace', path])
    };
    let stop = api.installRouter({ ...router, sameDocumentHistory: true });
    const historyState = { __NA: true, routeKey: 'settings-visit', index: 3 };
    window.history.replaceState(historyState, '', window.location.href);
    const after = [];
    const stopAfter = api.afterNavigate((event) => after.push(event.to.url.href));
    await api.goto('/reader-web/settings#layout', {
      noScroll: true,
      state: { category: 'layout' }
    });
    assert.equal(window.location.hash, '#layout');
    assert.deepEqual({ ...window.history.state }, { ...historyState, category: 'layout' });
    assert.equal(api.location(), window.location.href);
    assert.deepEqual(calls, []);
    assert.deepEqual(after, [window.location.href]);
    const length = window.history.length;
    await api.goto('/reader-web/settings#reading', { replaceState: true, noScroll: true });
    assert.equal(window.history.length, length);
    assert.equal(window.location.hash, '#reading');
    await api.goto('/reader-web/settings', { noScroll: true });
    assert.equal(window.location.hash, '');
    assert.deepEqual(calls, []);
    const stopGuard = api.beforeNavigate((event) => event.cancel());
    const prior = window.location.href;
    const priorAfter = after.length;
    for (const href of [
      '/reader-web/settings#tracking',
      '/reader-web/manage',
      'https://outside.example/settings#layout'
    ])
      await api.goto(href);
    assert.equal(window.location.href, prior);
    assert.equal(after.length, priorAfter);
    assert.deepEqual(calls, []);
    stopGuard();
    await api.goto('/reader-web/settings?view=other#layout', { noScroll: true });
    await api.goto('/reader-web/manage#library', { noScroll: true, replaceState: true });
    assert.deepEqual(calls, [
      ['push', '/settings?view=other#layout'],
      ['replace', '/manage#library']
    ]);
    assert.equal(
      window.location.href,
      prior,
      'router-owned transitions do not mutate browser history early'
    );
    stop();
    stop = api.installRouter(router);
    await api.goto('/reader-web/settings#typography', { noScroll: true });
    assert.deepEqual(
      calls.at(-1),
      ['push', '/settings#typography'],
      'embedded native routers receive same-path route intents'
    );
    assert.equal(window.location.href, prior);
    stop();
    stopAfter();
  });
});

test('native checkbox events and bindings receive the user choice before React restores controlled state', async () => {
  for (const binding of [false, true])
    await fixture(async ({ window, api, until }) => {
      api.renderCheckbox(binding);
      await until(() => window.document.querySelector('input'), 'controlled checkbox mounts');
      await until(() => window.checkboxMounted, 'checkbox event effects are attached');
      const input = window.document.querySelector('input');
      assert.equal(input.checked, false);
      input.click();
      await until(() => window.changes.length === 1, 'first checkbox change is received');
      assert.deepEqual(Array.from(window.changes), [true]);
      await until(() => input.checked, 'the user can enable the controlled checkbox');
      input.click();
      await until(() => window.changes.length === 2, 'second checkbox change is received');
      assert.deepEqual(Array.from(window.changes), [true, false]);
      await until(() => !input.checked, 'the user can disable the controlled checkbox');
    });
});
