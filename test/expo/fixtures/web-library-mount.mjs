/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import * as indexedDB from 'fake-indexeddb';

const require = createRequire(import.meta.url);
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'https://localhost.test/reader-web/manage',
  pretendToBeVisual: true
});
for (const key of [
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'Element',
  'HTMLElement',
  'HTMLInputElement',
  'MutationObserver',
  'Event',
  'CustomEvent',
  'DOMParser',
  'Node',
  'FileReader',
  'Image',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'location',
  'history'
])
  globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
Object.assign(globalThis, indexedDB);
Object.assign(window, { indexedDB: globalThis.indexedDB, IDBKeyRange: globalThis.IDBKeyRange });
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.scrollTo = () => {};
globalThis.BroadcastChannel = undefined;
globalThis.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
const observed = new Set();
globalThis.ResizeObserver = class {
  observe(element) {
    observed.add(element);
  }
  unobserve(element) {
    observed.delete(element);
  }
  disconnect() {
    observed.clear();
  }
};
const requests = [];
globalThis.fetch = async (url) => {
  requests.push(String(url));
  return new Response('', { status: 503 });
};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
// Import only after the browser environment exists: this includes the actual
// cold DatabaseService, controllers, stores, and runtime subscription owners.
const {
  LibraryScreen,
  BrowserRuntime,
  database,
  refreshLocation,
  installRouter,
  beforeNavigate
} = require(process.argv[2]);

async function settle(predicate, message) {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline)
    await act(async () => {
      await delay(10);
    });
  assert.ok(predicate(), message);
}

for (const strict of [false, true]) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let library, workspace;
  const ready = (m, w) => {
    library = m;
    workspace = w;
  };
  const screen = React.createElement(
    React.Fragment,
    null,
    React.createElement(BrowserRuntime),
    React.createElement(LibraryScreen, { onReady: ready })
  );
  await act(async () => {
    root.render(strict ? React.createElement(React.StrictMode, null, screen) : screen);
  });
  assert.ok(container.querySelector('input[webkitdirectory]'), 'folder import is mounted');
  await settle(() => !library.loading && !workspace.scanning, 'cold IndexedDB work completes');
  assert.match(container.textContent, /Make room for a good book/);
  assert.equal(document.querySelectorAll('#manabi-packaged-fonts').length, 1);
  assert.ok(requests.includes('/api/reader-web/session/'));

  // Anchor destinations must work independently of Expo's primary-click routing:
  // native gestures and copied links use the DOM href, including its query/hash.
  const destinations = [
    ['Import from Ttu Ebook Reader', '/reader-web/import-ttu'],
    ['Import from Yatsu Reader', '/reader-web/import-ttu?source=yatsu'],
    ['Local folder', '/reader-web/connections#local-heading'],
    ['Google Drive', '/reader-web/connections#cloud-heading'],
    ['Dropbox', '/reader-web/connections#cloud-heading'],
    ['OneDrive', '/reader-web/connections#cloud-heading']
  ];
  const links = [...container.querySelectorAll('[data-slot="library-empty-state"] a')];
  assert.deepEqual(
    links.map((link) => [link.textContent.trim(), link.getAttribute('href')]),
    destinations
  );
  assert.deepEqual(
    links.map((link) => link.href),
    destinations.map(([, destination]) => new URL(destination, location.origin).href)
  );
  const routes = [],
    intents = [],
    prevented = [];
  const stopRouter = installRouter({
    push: (path) => routes.push(path),
    replace: (path) => routes.push(path)
  });
  const stopNavigation = beforeNavigate((event) => intents.push(event.to.url.href));
  // Observe the production handler's decision, then suppress JSDOM's unsupported
  // native navigation. This listener cannot turn a canceled gesture into a pass.
  const observeDefault = (event) => {
    prevented.push(event.defaultPrevented);
    event.preventDefault();
  };
  document.addEventListener('click', observeDefault);
  document.addEventListener('auxclick', observeDefault);
  try {
    for (const link of links) {
      for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
        await act(async () => {
          link.dispatchEvent(
            new window.MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              [modifier]: true
            })
          );
        });
        assert.equal(prevented.at(-1), false, `${modifier} retains native link behavior`);
      }
      for (const type of ['click', 'auxclick']) {
        await act(async () => {
          link.dispatchEvent(
            new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 1 })
          );
        });
        assert.equal(prevented.at(-1), false, `middle ${type} retains native link behavior`);
      }
    }
    assert.deepEqual(routes, [], 'native gestures do not dispatch an Expo route');
    assert.deepEqual(intents, [], 'native gestures do not start an in-tab navigation guard');
    for (const link of links) {
      await act(async () => {
        link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      assert.equal(prevented.at(-1), true, 'ordinary clicks use the in-app navigation adapter');
    }
    assert.deepEqual(
      routes,
      destinations.map(([, destination]) => destination.slice('/reader-web'.length))
    );
    assert.deepEqual(
      intents,
      destinations.map(([, destination]) => new URL(destination, location.origin).href)
    );
  } finally {
    document.removeEventListener('click', observeDefault);
    document.removeEventListener('auxclick', observeDefault);
    stopNavigation();
    stopRouter();
  }

  // Real async list refreshes and route changes must remain live after startup.
  const db = await database.db;
  await act(async () => {
    await db.put('data', {
      id: 1,
      title: 'Mounted library regression fixture',
      contentHash: 'a'.repeat(64),
      libraryOwner: null,
      elementHtml: '<p>Generated test fixture</p>',
      sections: [],
      blobs: {},
      characters: 0,
      lastBookModified: 1,
      lastBookOpen: 0
    });
    database.dataListChanged$.next(undefined);
  });
  await settle(() => library.bookCards.length === 1, 'a new database row reaches the library');
  assert.match(container.textContent, /Mounted library regression fixture/);
  await act(async () => {
    window.history.replaceState({}, '', '/reader-web/manage?collection=finished');
    refreshLocation();
  });
  await settle(
    () => !library.loading && workspace.collectionId === 'finished',
    'a later storage read and navigation both settle'
  );
  assert.equal(library.destinationTitle, 'Finished');
  await act(async () => {
    window.history.replaceState({}, '', '/reader-web/manage');
    refreshLocation();
  });
  assert.equal(library.destinationTitle, 'Library');
  assert.equal(workspace.visibleBooks.length, 1);
  await act(async () => {
    await db.delete('data', 1);
    database.dataListChanged$.next(undefined);
  });
  await settle(
    () => !library.bookCards.length,
    'removing the fixture returns to the empty library'
  );

  await act(async () => root.unmount());
  assert.equal(library.pageAlive, false);
  assert.equal(workspace.alive, false);
  assert.equal(observed.size, 0);
  assert.equal(document.querySelector('#manabi-packaged-fonts'), null);
  const stoppedRequests = requests.length;
  window.dispatchEvent(new Event('online'));
  await delay(20);
  assert.equal(requests.length, stoppedRequests, 'the unmounted runtime removes online listeners');
  container.remove();
}
dom.window.close();
console.log('Library startup and remount completed');
