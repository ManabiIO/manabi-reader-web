/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as fakeIndexedDB from 'fake-indexeddb';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { outputFiles } = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { EditorsPicks } from './apps/web/src/library-react/editors-picks';
      import { DialogHost, MessageDialog } from './apps/web/src/ui/dialogs';
      import { dialogManager } from './apps/web/src/lib/data/dialog-manager';
      import { goto, beforeNavigate } from './apps/web/src/runtime/navigation';
      const root = createRoot(document.getElementById('root'));
      let props = {}, strict = false;
      const render = () => {
        const content = <><EditorsPicks onOpen={() => {}} {...props} /><DialogHost /></>;
        root.render(strict ? <React.StrictMode>{content}</React.StrictMode> : content);
      };
      window.controls = {
        goto, beforeNavigate,
        render: (next = {}, strictMode = strict) => {
          props = next;
          strict = strictMode;
          render();
        },
        fail: () => {
          dialogManager.dialogs$.next([{component: MessageDialog, props: {
            title: 'Could not open book', message: 'The catalog book could not be opened.'
          }}]);
          props = {...props, openingId: ''};
          render();
        },
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
  outdir: '/tmp/manabi-editors-picks-test-bundle',
  jsx: 'automatic',
  loader: { '.css': 'empty', '.wasm': 'file', '.onnx': 'file' },
  define: {
    'process.env.NODE_ENV': '"development"',
    'import.meta.url': '"https://reader.example/fixture.js"'
  },
  logLevel: 'warning'
});
const javascript = outputFiles.find((file) => file.path.endsWith('.js')).text;
const index = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>All Books (6)</title>
  <link rel="subsection" href="/static/reader/books/opds/feeds/all.xml"/></entry></feed>`;
const picks = [
  {
    id: 'first',
    title: 'First Pick',
    author: 'First Author',
    summary: 'A selected book.',
    cover: true
  },
  { id: 'second', title: 'Second Pick' },
  { id: 'third', title: 'Third Pick' },
  { id: 'fourth', title: 'Fourth Pick' },
  { id: 'fifth', title: 'Fifth Pick' },
  { id: 'sixth', title: 'Sixth Pick' }
];
const feed = (books = picks) =>
  `<feed xmlns="http://www.w3.org/2005/Atom">${books
    .map(
      (pick) => `<entry><id>${pick.id}</id><title>${pick.title}</title>
    ${pick.author ? `<author><name>${pick.author}</name></author>` : ''}
    ${pick.summary ? `<summary>${pick.summary}</summary>` : ''}
    ${pick.cover ? `<link rel="cover" href="/static/reader/books/opds/covers/${pick.id}.jpg"/>` : ''}
    <link rel="http://opds-spec.org/acquisition" type="application/epub+zip"
      href="/static/reader/books/library/${pick.id}.epub"/></entry>`
    )
    .join('')}</feed>`;

async function fixture(run, { online = true } = {}) {
  const errors = [],
    requests = [];
  const console = new VirtualConsole();
  console.on('jsdomError', (error) => errors.push(error.message));
  console.on('error', (...parts) => errors.push(parts.map(String).join(' ')));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://reader.example/reader-web/manage',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: console
  });
  const { window } = dom,
    { document } = window;
  Object.assign(window, {
    ...fakeIndexedDB,
    indexedDB: new fakeIndexedDB.IDBFactory(),
    process: { env: {} },
    TextEncoder,
    TextDecoder,
    structuredClone,
    Response,
    Request,
    Headers,
    fetch: (url, options = {}) => {
      assert.ok(String(url).includes('/static/reader/books/opds/'), String(url));
      if (options.signal?.aborted) return Promise.reject(options.signal.reason);
      return new Promise((resolve, reject) => {
        const request = {
          url,
          options,
          settled: false,
          aborted: false,
          // Keep the transport completion controllable even after abort. This
          // proves stale completions cannot publish or start another feed fetch.
          respond(body = String(url).endsWith('/index.xml') ? index : feed(), status = 200) {
            this.settled = true;
            resolve(new Response(body, { status }));
          },
          reject(message = 'The catalog returned 503.') {
            this.settled = true;
            reject(new window.Error(message));
          }
        };
        requests.push(request);
        options.signal?.addEventListener(
          'abort',
          () => {
            request.aborted = true;
          },
          { once: true }
        );
      });
    },
    BroadcastChannel: class {
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
  });
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  let visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {}
  });
  window.scrollTo = () => {};
  // Only missing native top-layer behavior is supplied. Component rendering,
  // application DialogHost, navigation, focus restoration and feed parsing are real.
  // JSDOM cannot qualify keyboard default activation or layout; the unchanged
  // Playwright suite remains authoritative for Enter/Tab, scrolling and geometry.
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
    this.querySelector('button')?.focus();
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  window.eval(javascript);
  const api = window.controls;
  const pause = () => new Promise((resolve) => setTimeout(resolve, 10));
  const until = async (predicate, message) => {
    for (let attempt = 0; attempt < 80 && !predicate(); attempt++) await pause();
    assert.ok(predicate(), message);
  };
  const region = () =>
    document.querySelector('[role="region"][aria-label="Editor\'s Picks books"]');
  const buttons = () => [...(region()?.querySelectorAll('button') ?? [])];
  const retry = () =>
    [...document.querySelectorAll('button')].find((button) => button.textContent === 'Try Again');
  const activeRequest = (suffix) =>
    requests.findLast(
      (request) => !request.aborted && !request.settled && String(request.url).endsWith(suffix)
    );
  const load = async (books = picks) => {
    await until(() => activeRequest('/index.xml'), 'a current index request starts');
    activeRequest('/index.xml').respond();
    await until(() => activeRequest('/all.xml'), 'the real loader requests the All Books feed');
    activeRequest('/all.xml').respond(feed(books));
    await until(
      () => !document.querySelector('[role="status"]')?.textContent.includes('Loading books'),
      'the feed settles'
    );
  };
  try {
    await run({
      window,
      document,
      api,
      until,
      pause,
      requests,
      activeRequest,
      load,
      region,
      buttons,
      retry,
      online(value) {
        online = value;
        window.dispatchEvent(new window.Event(value ? 'online' : 'offline'));
      },
      visibility(value) {
        visibility = value;
        document.dispatchEvent(new window.Event('visibilitychange'));
      },
      event(type) {
        window.dispatchEvent(new window.Event(type));
      }
    });
  } finally {
    api.unmount();
    for (const request of requests) if (!request.settled) request.reject('Late transport failure');
    await pause();
    window.close();
  }
  assert.deepEqual(errors, [], 'mounted catalog and dialog must not emit React or DOM errors');
}

test('Editor’s Picks restores the original accessible card, cover, scroll-region and heading contract', async () => {
  for (const strict of [false, true])
    for (const embedded of [false, true])
      await fixture(async ({ api, document, until, load, region, buttons, requests }) => {
        api.render({ embedded, headingId: 'custom-picks-heading' }, strict);
        await until(() => document.querySelector('[role="status"]'), 'loading is announced');
        assert.equal(document.querySelector('[role="status"]').textContent, 'Loading books…');
        assert.equal(region(), null);
        await load();
        const section = region().closest('section');
        assert.equal(section.getAttribute('aria-labelledby'), 'custom-picks-heading');
        assert.equal(document.getElementById('custom-picks-heading').tagName, 'H3');
        assert.equal(document.getElementById('custom-picks-heading').textContent, "Editor's Picks");
        assert.equal(section.querySelectorAll('h2').length, 0);
        assert.equal(region().tabIndex, 0);
        for (const token of [
          'overflow-y-auto',
          'overscroll-contain',
          'pr-1',
          `max-h-[min(34rem,${embedded ? 55 : 60}dvh)]`
        ])
          assert.ok(region().classList.contains(token), token);
        assert.equal(section.classList.contains('p-[16px]'), embedded);
        assert.deepEqual(
          [...region().querySelectorAll('h4')].map((title) => title.textContent),
          picks.map((pick) => pick.title)
        );
        const cards = [...region().querySelectorAll('article')];
        assert.equal(cards.length, 6);
        for (const card of cards) {
          for (const token of ['flex', 'flex-wrap', 'min-w-0', 'gap-[12px]', 'p-[12px]'])
            assert.ok(card.classList.contains(token), token);
          for (const token of ['w-[76px]', 'h-[112px]', 'shrink-0'])
            assert.ok(card.firstElementChild.classList.contains(token), token);
          assert.equal(card.querySelector('button').querySelector('h4'), null);
        }
        const cover = cards[0].querySelector('img');
        assert.equal(cover.getAttribute('alt'), '');
        assert.equal(cover.getAttribute('loading'), 'lazy');
        assert.equal(cover.src, 'https://reader.example/static/reader/books/opds/covers/first.jpg');
        assert.equal(cards[1].querySelector('svg').getAttribute('aria-hidden'), 'true');
        assert.deepEqual(
          [...cards[0].querySelectorAll('p')].map((p) => p.textContent),
          ['First Author', 'A selected book.']
        );
        assert.equal(cards[1].querySelectorAll('p').length, 0);
        for (const button of buttons()) {
          assert.equal(button.textContent, 'Open');
          assert.equal(button.dataset.variant, 'secondary');
          assert.equal(button.dataset.size, 'sm');
          assert.ok(button.classList.contains('min-h-11'));
          assert.equal(button.disabled, false);
        }
        for (const request of requests) {
          assert.equal(request.options.credentials, 'omit');
          assert.equal(request.options.redirect, 'error');
        }
      });
});

test('the focused opening action remains enabled, blocks duplicate activation, and regains focus after the real error dialog', async () => {
  for (const strict of [false, true])
    await fixture(async ({ api, window, document, until, load, buttons }) => {
      const opened = [];
      const onOpen = (pick) => {
        opened.push(pick.id);
        api.render({ onOpen, openingId: pick.id });
      };
      api.render({ onOpen }, strict);
      await load();
      const [first, second] = buttons();
      first.focus();
      assert.equal(document.activeElement, first);
      first.click();
      first.click();
      second.click();
      assert.deepEqual(opened, ['first'], 'same-turn activations dispatch only one book');
      await until(() => first.textContent === 'Opening…', 'the pending label renders');
      assert.equal(document.activeElement, first);
      assert.equal(first.disabled, false);
      assert.equal(first.tabIndex, 0);
      assert.equal(first.getAttribute('aria-disabled'), 'true');
      assert.equal(first.getAttribute('aria-busy'), 'true');
      assert.ok(
        buttons()
          .slice(1)
          .every((button) => button.disabled)
      );
      first.click();
      second.click();
      assert.deepEqual(opened, ['first'], 'pending activation does not dispatch a duplicate');
      api.fail();
      await until(
        () => document.querySelector('dialog[open]'),
        'the application error dialog opens'
      );
      const dialog = document.querySelector('dialog[open]');
      assert.match(dialog.textContent, /Could not open book/);
      assert.notEqual(document.activeElement, first);
      dialog.dispatchEvent(new window.Event('cancel', { cancelable: true }));
      await until(
        () => !dialog.open && document.activeElement === first,
        'dismissal restores the original action focus'
      );
      assert.equal(first, buttons()[0], 'state changes preserve the keyed action DOM node');
      assert.equal(first.textContent, 'Open');
      assert.equal(first.disabled, false);
      assert.equal(first.getAttribute('aria-busy'), 'false');
      assert.equal(first.getAttribute('aria-disabled'), 'false');
      assert.ok(buttons().every((button) => !button.disabled));
      first.click();
      await until(() => opened.length === 2, 'the failed action can be retried');
    });
});

test('load failure, repeated retry and empty feeds retain mutually exclusive original states', async () => {
  await fixture(async ({ api, document, until, activeRequest, requests, retry, region, load }) => {
    api.render();
    await until(() => activeRequest('/index.xml'), 'index loading starts');
    activeRequest('/index.xml').reject();
    await until(retry, 'the exact Try Again button renders');
    assert.equal(document.querySelector('[role="alert"]'), null);
    assert.match(
      document.querySelector('[role="status"]').textContent,
      /^Editor's Picks are unavailable right now\./
    );
    assert.equal(region(), null);
    retry().click();
    retry().click();
    assert.equal(requests.length, 2, 'a pending retry cannot start another request');
    await load([]);
    assert.equal(region(), null);
    assert.equal(document.querySelector('[role="status"]'), null);
    assert.equal(retry(), undefined);
    assert.match(document.querySelector('section').textContent, /No books are listed right now\./);
  });
});

test('offline mount and an offline pending load recover only through the visible explicit retry', async () => {
  await fixture(
    async ({ api, until, requests, retry, online, load, region, activeRequest, pause }) => {
      api.render({}, true);
      await until(retry, 'offline initial state offers retry');
      assert.equal(requests.length, 0);
      retry().click();
      assert.equal(requests.length, 0);
      online(true);
      await pause();
      assert.ok(retry(), 'online does not race removal of the retry control');
      assert.equal(requests.length, 0);
      retry().click();
      await until(() => activeRequest('/index.xml'), 'retry starts while online');
      const interrupted = activeRequest('/index.xml');
      online(false);
      await until(retry, 'offline transition returns to the retry state');
      assert.equal(interrupted.options.signal.aborted, true);
      interrupted.respond();
      await pause();
      assert.equal(requests.length, 1, 'aborted index cannot advance to an All Books request');
      online(true);
      retry().click();
      await load();
      assert.equal(region().querySelectorAll('article').length, 6);
    },
    { online: false }
  );
});

test('Strict Mode, unmount and stale transport completion cannot publish or restart the retired catalog', async () => {
  await fixture(
    async ({ api, until, activeRequest, requests, region, event, visibility, online, pause }) => {
      api.render({}, true);
      await until(() => requests.length === 2, 'Strict Mode replays setup');
      assert.equal(requests[0].options.signal.aborted, true);
      requests[0].respond();
      const pending = activeRequest('/index.xml');
      api.clear();
      await until(() => pending.options.signal.aborted, 'unmount aborts the live request');
      pending.respond();
      event('pageshow');
      visibility('visible');
      online(false);
      online(true);
      await pause();
      assert.equal(region(), null);
      assert.equal(
        requests.length,
        2,
        'removed listeners and stale completions cannot restart a load'
      );
    }
  );
});

test('visibility pause resumes one load, while pagehide stays suspended until pageshow', async () => {
  await fixture(
    async ({ api, until, activeRequest, requests, visibility, event, pause, load, region }) => {
      api.render();
      await until(() => activeRequest('/index.xml'), 'initial load starts');
      const initial = activeRequest('/index.xml');
      visibility('hidden');
      assert.equal(initial.options.signal.aborted, true);
      visibility('visible');
      await until(() => requests.length === 2, 'visibility resumes a canceled load');
      initial.reject('A stale failure must not replace the new loading state.');
      const resumed = activeRequest('/index.xml');
      resumed.respond();
      await until(() => activeRequest('/all.xml'), 'the feed starts');
      const pendingFeed = activeRequest('/all.xml');
      event('pagehide');
      assert.equal(pendingFeed.options.signal.aborted, true);
      visibility('hidden');
      visibility('visible');
      event('online');
      pendingFeed.respond();
      await pause();
      assert.equal(requests.length, 3, 'visibility and network events cannot revive pagehide');
      assert.equal(region(), null);
      event('pageshow');
      await load();
      assert.equal(region().querySelectorAll('article').length, 6);
      const count = requests.length;
      visibility('hidden');
      visibility('visible');
      event('pageshow');
      await pause();
      assert.equal(requests.length, count, 'a populated catalog is not fetched again on resume');
    }
  );
});

test('denied and same-route navigation preserve loading; admitted departure cannot restart until this route returns', async () => {
  await fixture(
    async ({ api, until, activeRequest, requests, visibility, event, pause, load, region }) => {
      api.render();
      await until(() => activeRequest('/index.xml'), 'initial load starts');
      const initial = activeRequest('/index.xml');
      const removeGuard = api.beforeNavigate((navigation) => navigation.cancel());
      await api.goto('/reader-web/settings');
      assert.equal(
        initial.options.signal.aborted,
        false,
        'a denied route intent keeps the current load alive'
      );
      removeGuard();
      await api.goto('/reader-web/manage?view=all');
      assert.equal(
        initial.options.signal.aborted,
        false,
        'same-route view changes keep the catalog lifetime'
      );
      assert.equal(requests.length, 1);
      await api.goto('/reader-web/settings');
      assert.equal(
        initial.options.signal.aborted,
        true,
        'admitted departure aborts before dispatch'
      );
      initial.respond();
      visibility('hidden');
      visibility('visible');
      event('pageshow');
      event('online');
      await pause();
      assert.equal(
        requests.length,
        1,
        'other-route arrival and document events cannot revive the old owner'
      );
      assert.equal(region(), null);
      await api.goto('/reader-web/manage?view=all');
      await load([...picks].reverse());
      assert.deepEqual(
        [...region().querySelectorAll('h4')].map((title) => title.textContent),
        picks.map((pick) => pick.title).reverse()
      );
    }
  );
});

test('a duplicate-id feed fails recoverably and a reordered retry preserves book identity and order', async () => {
  await fixture(async ({ api, until, activeRequest, load, retry, region, buttons }) => {
    const opened = [];
    api.render({ onOpen: (pick) => opened.push([pick.id, pick.bookUrl]) });
    await until(() => activeRequest('/index.xml'), 'index request starts');
    activeRequest('/index.xml').respond();
    await until(() => activeRequest('/all.xml'), 'feed request starts');
    activeRequest('/all.xml').respond(feed([picks[0], picks[0]]));
    await until(retry, 'duplicate IDs become a recoverable catalog error');
    assert.equal(region(), null);
    retry().click();
    await load([picks[2], picks[0], picks[1]]);
    assert.deepEqual(
      [...region().querySelectorAll('h4')].map((title) => title.textContent),
      ['Third Pick', 'First Pick', 'Second Pick']
    );
    buttons()[0].click();
    assert.deepEqual(opened, [
      ['third', 'https://reader.example/static/reader/books/library/third.epub']
    ]);
  });
});
