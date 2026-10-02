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
      import SettingsRoute from './apps/web/src/screens/routes/settings.web';
      import { ConnectionsScreen } from './apps/web/src/settings-react/connections-screen';
      import { startPreferenceSync, preferenceStatus } from './apps/web/src/lib/manabi/preferences';
      import { integrationDB } from './apps/web/src/lib/manabi/persistence';
      import { refreshAccount } from './apps/web/src/lib/manabi/client';
      import { goto, installRouter, beforeNavigate, afterNavigate } from './apps/web/src/runtime/navigation';
      import { page } from './apps/web/src/runtime/stores';
      import { get } from './apps/web/src/lib/state/store';
      const root = createRoot(document.getElementById('root'));
      let stopPreferences;
      function CheckboxFixture({ binding }) {
        const [checked, setChecked] = React.useState(false);
        React.useEffect(() => { window.checkboxMounted = true; }, []);
        const update = value => { window.changes.push(value); setChecked(value); };
        return <Dom as="input" type="checkbox" checked={checked}
          bindings={binding ? { checked: update } : {}}
          events={binding ? {} : { change: event => update(event.currentTarget.checked) }} />;
      }
      window.controls = {
        goto, installRouter, beforeNavigate, afterNavigate, refreshAccount,
        location: () => get(page).url.href,
        renderRoute: (strict = true) => root.render(strict ? <React.StrictMode><SettingsRoute /></React.StrictMode> : <SettingsRoute />),
        renderPrevious: previousPage => root.render(<SettingsScreen previousPage={previousPage} />),
        render: strict => root.render(strict ? <React.StrictMode><SettingsScreen /></React.StrictMode> : <SettingsScreen />),
        renderCheckbox: binding => root.render(<React.StrictMode><CheckboxFixture binding={binding} /></React.StrictMode>),
        renderConnections: strict => {
          stopPreferences ??= startPreferenceSync();
          root.render(strict ? <React.StrictMode><ConnectionsScreen /></React.StrictMode> : <ConnectionsScreen />);
        },
        preferenceStatus: () => get(preferenceStatus),
        savedPreferences: async (user = '42') => (await integrationDB()).get('metadata', 'preferences/' + user),
        clear: () => root.render(null),
        unmount: () => { root.unmount(); stopPreferences?.(); }
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
  logLevel: 'warning',
  plugins: [
    {
      name: 'route-local-settings-context',
      setup(builder) {
        builder.onResolve({ filter: /^expo-router$/ }, () => ({
          path: 'settings-route',
          namespace: 'settings-route'
        }));
        builder.onLoad({ filter: /.*/, namespace: 'settings-route' }, () => ({
          contents: `
      export const useLocalSearchParams = () => window.routeParams ?? {};
      export const useRoute = () => ({ key: window.routeKey ?? 'settings-visit-1' });
    `,
          loader: 'js'
        }));
      }
    }
  ]
});
const javascript = outputFiles.find((file) => file.path.endsWith('.js')).text;

async function fixture(run, fetch = async () => new Response('', { status: 503 })) {
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
    indexedDB: new fakeIndexedDB.IDBFactory(),
    changes: [],
    process: { env: {} },
    TextEncoder,
    TextDecoder,
    structuredClone,
    Response,
    Request,
    Headers,
    fetch,
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

function accountServer() {
  const profiles = new Map();
  const server = {
    user: { id: '42', username: 'reader' },
    requests: [],
    preferenceFailure: false,
    pendingGet: null,
    holdPreferenceGet() {
      const { promise, resolve } = Promise.withResolvers();
      const gate = { promise, release: resolve, started: false };
      server.pendingGet = gate;
      return gate;
    },
    async fetch(path, options = {}) {
      server.requests.push({ path, ...options });
      const user = path.endsWith('/session/')
        ? server.user.id
        : options.headers.get('X-Manabi-User');
      let value;
      if (path.endsWith('/session/'))
        value = { user: server.user, csrf_token: 'c'.repeat(64), providers: [] };
      else if (path.endsWith('/connections/')) value = { items: [] };
      else if (path.includes('/preferences/')) {
        if (options.method === 'GET' && server.pendingGet) {
          const gate = server.pendingGet;
          server.pendingGet = null;
          gate.started = true;
          await gate.promise;
        }
        if (server.preferenceFailure)
          return Response.json({ error: 'unavailable' }, { status: 503 });
        const profile = profiles.get(user) ?? { settings: {}, revision: 0 };
        profiles.set(user, profile);
        if (options.method === 'PUT') {
          assert.equal(options.headers.get('If-Match'), '"' + profile.revision + '"');
          profile.settings = JSON.parse(options.body).settings;
          profile.revision++;
        }
        value = { user_id: user, schema_version: 1, ...profile, book_presentation_version: 1 };
      } else throw new Error('Unexpected account endpoint: ' + path);
      return Response.json(value, { headers: { 'X-Manabi-User': user } });
    }
  };
  return server;
}

const accountCheckbox = (window) =>
  [...window.document.querySelectorAll('input[type="checkbox"]')].find((node) =>
    node.closest('label')?.textContent.includes('Sync reader settings')
  );

test('account sync checkbox keeps the chosen state through real storage, delayed requests and repeated enable/disable', async () => {
  for (const strict of [false, true]) {
    const server = accountServer();
    await fixture(async ({ window, api, until }) => {
      api.renderConnections(strict);
      const input = () => accountCheckbox(window);
      await until(() => input() && !input().disabled, 'account controls finish loading');
      assert.equal(input().checked, false);
      const pending = server.holdPreferenceGet();
      try {
        input().click();
        assert.equal(
          input().checked,
          true,
          'the checked state must not revert while consent is saving'
        );
        await until(() => pending.started, 'the real preference client reaches its first request');
        assert.equal((await api.savedPreferences()).enabled, true);
        assert.equal(input().checked, true);
        assert.equal(input().disabled, true);
        assert.equal(api.preferenceStatus().state, 'syncing');
        input().click();
        assert.equal(input().checked, true, 'repeated activation while busy cannot toggle consent');
        assert.equal(
          server.requests.filter(({ path }) => path.includes('/preferences/')).length,
          1
        );
      } finally {
        pending.release();
      }
      await until(
        () => api.preferenceStatus().state === 'synced' && !input().disabled,
        'real preferences finish syncing'
      );
      assert.equal(input().checked, true);
      input().click();
      assert.equal(
        input().checked,
        false,
        'disabling sync must also keep the chosen state immediately'
      );
      await until(
        () => api.preferenceStatus().state === 'off' && !input().disabled,
        'real preferences finish disabling'
      );
      assert.equal((await api.savedPreferences()).enabled, false);
      assert.equal(input().checked, false);
      api.clear();
      await until(() => !input(), 'account screen unmounts');
      api.renderConnections(strict);
      await until(() => input() && !input().disabled, 'account screen remounts');
      assert.equal(input().checked, false, 'remount uses the durable choice');
      input().click();
      assert.equal(input().checked, true);
      await until(
        () => api.preferenceStatus().state === 'synced' && !input().disabled,
        'sync can be enabled again'
      );
      const preferences = server.requests.filter(({ path }) => path.includes('/preferences/'));
      assert.ok(preferences.some(({ method }) => method === 'GET'));
      assert.ok(preferences.some(({ method }) => method === 'PUT'));
      for (const request of preferences) {
        assert.equal(request.path, '/api/reader-web/preferences/?book_presentation_version=1');
        assert.equal(request.credentials, 'same-origin');
        assert.equal(request.headers.get('X-Manabi-Library-Items'), 'snippets-v1');
        assert.equal(request.headers.get('X-Manabi-User'), '42');
        assert.equal(
          request.headers.get('X-CSRFToken'),
          request.method === 'PUT' ? 'c'.repeat(64) : null
        );
      }
    }, server.fetch);
  }
});

test('account sync failure retains saved consent without claiming success and can be disabled or retried', async () => {
  const server = accountServer();
  server.preferenceFailure = true;
  await fixture(async ({ window, api, until }) => {
    api.renderConnections(true);
    const input = () => accountCheckbox(window);
    await until(() => input() && !input().disabled, 'account controls finish loading');
    input().click();
    assert.equal(input().checked, true);
    await until(
      () => api.preferenceStatus().state === 'unavailable' && !input().disabled,
      'failed sync is reported'
    );
    assert.equal(input().checked, true);
    assert.equal((await api.savedPreferences()).enabled, true);
    assert.match(
      window.document.querySelector('[aria-label="Settings sync status"]').textContent,
      /unavailable/
    );
    input().click();
    assert.equal(input().checked, false);
    await until(
      () => api.preferenceStatus().state === 'off' && !input().disabled,
      'consent can be disabled after failure'
    );
    assert.equal((await api.savedPreferences()).enabled, false);
    server.preferenceFailure = false;
    input().click();
    assert.equal(input().checked, true);
    await until(
      () => api.preferenceStatus().state === 'synced' && !input().disabled,
      'explicit retry succeeds'
    );
  }, server.fetch);
});

test('a pending checkbox choice never carries into a newly refreshed account', async () => {
  const server = accountServer();
  await fixture(async ({ window, api, until }) => {
    api.renderConnections(true);
    const input = () => accountCheckbox(window);
    await until(() => input() && !input().disabled, 'account controls finish loading');
    const pending = server.holdPreferenceGet();
    try {
      input().click();
      assert.equal(input().checked, true);
      await until(() => pending.started, 'first account sync waits for its response');
      server.user = { id: '43', username: 'other-reader' };
      await api.refreshAccount(true);
      await until(
        () => window.document.querySelector('strong')?.textContent === 'other-reader',
        'new account renders'
      );
      assert.equal(input().checked, false, 'pending intent belongs only to its original account');
      assert.equal(api.preferenceStatus().enabled, false);
    } finally {
      pending.release();
    }
    await until(() => !input().disabled, 'old request finishes without retaining a busy control');
    assert.equal(input().checked, false);
    assert.equal(await api.savedPreferences('43'), undefined, 'new account has not consented');
    input().click();
    assert.equal(input().checked, true);
    await until(
      () => api.preferenceStatus().state === 'synced' && !input().disabled,
      'new account can explicitly opt in'
    );
    assert.equal((await api.savedPreferences('43')).enabled, true);
  }, server.fetch);
});

test('remounting during an account request can revoke consent without a late checkbox update', async () => {
  const server = accountServer();
  await fixture(async ({ window, api, until }) => {
    api.renderConnections(true);
    const input = () => accountCheckbox(window);
    await until(() => input() && !input().disabled, 'account controls finish loading');
    const pending = server.holdPreferenceGet();
    try {
      input().click();
      assert.equal(input().checked, true);
      await until(() => pending.started, 'preference request is pending');
      api.clear();
      await until(() => !input(), 'original account screen unmounts');
      api.renderConnections(true);
      await until(() => input() && !input().disabled, 'new account screen finishes loading');
      assert.equal(input().checked, true, 'saved consent remains visible on the new screen');
      input().click();
      assert.equal(input().checked, false);
      await until(
        () => api.preferenceStatus().state === 'off' && !input().disabled,
        'new screen revokes consent'
      );
      assert.equal((await api.savedPreferences()).enabled, false);
    } finally {
      pending.release();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(input().checked, false, 'old completion cannot republish its checkbox choice');
    assert.equal(api.preferenceStatus().state, 'off');
    assert.equal(server.requests.filter(({ method }) => method === 'PUT').length, 0);
    input().click();
    assert.equal(input().checked, true);
    await until(
      () => api.preferenceStatus().state === 'synced' && !input().disabled,
      'new screen can opt in again'
    );
  }, server.fetch);
});

test('Settings captures reader arrival before browser history settles and preserves it through hashes and unrelated routes', async () => {
  for (const strict of [false, true])
    await fixture(async ({ window, api, until }) => {
      const document = window.document;
      const back = () => document.querySelector('a[aria-label="Back"]');
      window.history.replaceState({}, '', '/reader-web/b?id=17#paragraph');
      const stop = api.installRouter({
        sameDocumentHistory: true,
        push: () => api.renderRoute(strict),
        replace: () => api.renderRoute(strict)
      });
      await api.goto('/reader-web/settings');
      await until(() => back(), 'incoming Settings mounted');
      assert.equal(window.location.pathname, '/reader-web/b', 'fixture keeps outgoing browser URL');
      assert.equal(back().getAttribute('href'), '/reader-web/b?id=17#paragraph');
      window.history.replaceState({}, '', '/reader-web/settings');
      await api.goto('/reader-web/settings#typography');
      window.routeParams = { '#': 'typography' };
      await api.renderRoute(strict);
      assert.equal(back().getAttribute('href'), '/reader-web/b?id=17#paragraph');
      await api.goto('/reader-web/manage');
      await api.renderRoute(strict);
      assert.equal(
        back().getAttribute('href'),
        '/reader-web/b?id=17#paragraph',
        'retained visit ignores unrelated navigation'
      );
      window.history.replaceState({}, '', '/reader-web/manage?q=next');
      window.routeKey = 'settings-visit-2';
      window.routeParams = {};
      await api.goto('/reader-web/settings');
      await until(
        () => back()?.getAttribute('href') === '/reader-web/manage?q=next',
        'new Expo visit captures its own origin'
      );
      stop();
    });
});

test('direct or mismatched Settings visits use the Library fallback', async () => {
  await fixture(async ({ window, api, until }) => {
    await api.renderRoute();
    const back = () => window.document.querySelector('a[aria-label="Back"]');
    await until(() => back(), 'direct Settings mounted');
    assert.equal(back().getAttribute('href'), '/reader-web/manage');
    const stop = api.installRouter({ push() {}, replace() {} });
    await api.goto('/reader-web/snippets?id=elsewhere');
    window.routeKey = 'direct-settings-2';
    await api.renderRoute();
    await until(() => back(), 'new unmatched visit mounted');
    assert.equal(back().getAttribute('href'), '/reader-web/manage');
    stop();
  });
});

test('Settings return props cannot create external redirects or self-category loops', async () => {
  for (const previous of [
    'https://outside.example/reader-web/b?id=1',
    '//outside.example/reader-web/b',
    '/outside',
    '/reader-web-old/b',
    '/reader-web/settings#layout',
    '/reader-web/settings/',
    'https://fixture:unused@reader.example/reader-web/b'
  ]) {
    await fixture(async ({ window, api, until }) => {
      await api.renderPrevious(previous);
      const back = () => window.document.querySelector('a[aria-label="Back"]');
      await until(() => back(), 'Settings mounted');
      assert.equal(back().getAttribute('href'), '/reader-web/manage');
    });
  }
});
