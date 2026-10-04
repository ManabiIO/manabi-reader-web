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
  createNativeLibraryService,
  StorageKey,
  booklistSortOptions$,
  BrowserRuntime,
  database,
  userFonts$,
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

  const nativeLibrary = createNativeLibraryService();
  const authority = {
    key: 'sort-session',
    signal: new AbortController().signal,
    assertCurrent() {}
  };
  const originalSorts = structuredClone(booklistSortOptions$.getValue());
  await act(async () => workspace.setSort('author', 'asc'));
  assert.deepEqual((await nativeLibrary.state({}, authority)).sort, {
    property: 'author',
    direction: 'asc'
  });
  const sortAdmission = await nativeLibrary.state({}, authority);
  await act(async () =>
    nativeLibrary.action(
      { token: sortAdmission.token, type: 'sort', property: 'title', direction: 'desc' },
      authority
    )
  );
  assert.deepEqual(workspace.sort, { property: 'title', direction: 'desc' });
  assert.deepEqual(
    JSON.parse(window.localStorage.getItem('booklistSortOptions'))[StorageKey.BROWSER],
    workspace.sort
  );
  for (const provider of [StorageKey.GDRIVE, StorageKey.ONEDRIVE, StorageKey.FS])
    assert.deepEqual(booklistSortOptions$.getValue()[provider], originalSorts[provider]);
  nativeLibrary.dispose();
  const remountedNativeLibrary = createNativeLibraryService();
  assert.deepEqual((await remountedNativeLibrary.state({}, authority)).sort, workspace.sort);
  const failedAdmission = await remountedNativeLibrary.state({}, authority);
  const storedSorts = window.localStorage.getItem('booklistSortOptions');
  const setItem = window.Storage.prototype.setItem;
  window.Storage.prototype.setItem = function (key, value) {
    if (key === 'booklistSortOptions') throw new Error('Sort persistence unavailable');
    return setItem.call(this, key, value);
  };
  try {
    await assert.rejects(
      remountedNativeLibrary.action(
        { token: failedAdmission.token, type: 'sort', property: 'id', direction: 'asc' },
        authority
      ),
      /Sort persistence unavailable/
    );
    assert.equal(window.localStorage.getItem('booklistSortOptions'), storedSorts);
    assert.deepEqual(workspace.sort, { property: 'title', direction: 'desc' });
    assert.deepEqual((await remountedNativeLibrary.state({}, authority)).sort, workspace.sort);
  } finally {
    window.Storage.prototype.setItem = setItem;
  }
  const previousFinishedOrder = window.localStorage.getItem('manabi-finished-order');
  try {
    await act(async () => workspace.setFinishedOrder('asc'));
    assert.equal(
      (await remountedNativeLibrary.state({ collection: 'finished' }, authority)).finishedOrder,
      'asc'
    );
    const finishedAdmission = await remountedNativeLibrary.state(
      { collection: 'finished' },
      authority
    );
    await remountedNativeLibrary.action(
      { token: finishedAdmission.token, type: 'finished.order', value: 'desc' },
      authority
    );
    assert.equal(window.localStorage.getItem('manabi-finished-order'), 'desc');
    const restartedFinished = createNativeLibraryService();
    assert.equal(
      (await restartedFinished.state({ collection: 'finished' }, authority)).finishedOrder,
      'desc'
    );
    const deniedOrder = await restartedFinished.state({ collection: 'finished' }, authority);
    window.Storage.prototype.setItem = function (key, value) {
      if (key === 'manabi-finished-order') throw new Error('Finished persistence unavailable');
      return setItem.call(this, key, value);
    };
    try {
      await assert.rejects(
        restartedFinished.action(
          { token: deniedOrder.token, type: 'finished.order', value: 'asc' },
          authority
        ),
        /Finished persistence unavailable/
      );
      assert.equal(
        (await restartedFinished.state({ collection: 'finished' }, authority)).finishedOrder,
        'desc'
      );
      assert.deepEqual(workspace.sort, { property: 'title', direction: 'desc' });
    } finally {
      window.Storage.prototype.setItem = setItem;
      restartedFinished.dispose();
    }
  } finally {
    if (previousFinishedOrder === null) window.localStorage.removeItem('manabi-finished-order');
    else window.localStorage.setItem('manabi-finished-order', previousFinishedOrder);
  }
  const layoutKeys = ['manabi-library-layout', 'manabi-series-layout', 'manabi-finished-layout'];
  const previousLayouts = layoutKeys.map((key) => window.localStorage.getItem(key));
  try {
    await act(async () => workspace.setLayout('list'));
    assert.equal((await remountedNativeLibrary.state({}, authority)).layout, 'list');
    const layoutAdmission = await remountedNativeLibrary.state({}, authority);
    await remountedNativeLibrary.action(
      { token: layoutAdmission.token, type: 'layout', value: 'grid' },
      authority
    );
    assert.equal(window.localStorage.getItem(layoutKeys[0]), 'grid');
    assert.equal(window.localStorage.getItem(layoutKeys[1]), previousLayouts[1]);
    assert.equal(window.localStorage.getItem(layoutKeys[2]), previousLayouts[2]);
    const restarted = createNativeLibraryService();
    assert.equal((await restarted.state({}, authority)).layout, 'grid');
    const finished = await restarted.state({ collection: 'finished' }, authority);
    await restarted.action({ token: finished.token, type: 'layout', value: 'list' }, authority);
    assert.equal(
      window.localStorage.getItem(layoutKeys[2]),
      'timeline',
      'native list preserves the web timeline choice'
    );
    assert.equal(window.localStorage.getItem(layoutKeys[0]), 'grid');
    const failedLayout = await restarted.state({}, authority);
    window.Storage.prototype.setItem = function (key, value) {
      if (key === layoutKeys[0]) throw new Error('Layout persistence unavailable');
      return setItem.call(this, key, value);
    };
    try {
      await assert.rejects(
        restarted.action({ token: failedLayout.token, type: 'layout', value: 'list' }, authority),
        /Layout persistence unavailable/
      );
      assert.equal((await restarted.state({}, authority)).layout, 'grid');
    } finally {
      window.Storage.prototype.setItem = setItem;
    }
    const getItem = window.Storage.prototype.getItem;
    window.Storage.prototype.getItem = function (key) {
      if (layoutKeys.includes(key)) throw new Error('Layout read unavailable');
      return getItem.call(this, key);
    };
    try {
      assert.equal((await restarted.state({}, authority)).layout, 'grid');
    } finally {
      window.Storage.prototype.getItem = getItem;
    }
    restarted.dispose();
  } finally {
    layoutKeys.forEach((key, index) =>
      previousLayouts[index] === null
        ? window.localStorage.removeItem(key)
        : window.localStorage.setItem(key, previousLayouts[index])
    );
  }
  remountedNativeLibrary.dispose();
  await act(async () => booklistSortOptions$.next(originalSorts));

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
// Mount the actual embedded font effect, including StrictMode retirement. The
// cache and Blob URL APIs are owned fixtures; font decoding is the APK probe's job.
for (const strict of [false, true]) {
  const created = [],
    revoked = [],
    reads = [];
  let finishLate;
  URL.createObjectURL = (blob) => {
    const url = `blob:https://localhost.test/font-${created.length}`;
    created.push({ url, blob });
    return url;
  };
  URL.revokeObjectURL = (url) => revoked.push(url);
  globalThis.caches = {
    async open(name) {
      assert.equal(name, 'ttu-userfonts');
      return {
        async match(path) {
          reads.push(path);
          if (path.endsWith('late.woff2'))
            return new Promise((resolve) => {
              finishLate = resolve;
            });
          return new Response('cached font bytes');
        }
      };
    }
  };
  const font = { name: 'Embedded face', fileName: 'face.woff2', path: '/userfonts/face.woff2' };
  userFonts$.next([font]);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const runtime = React.createElement(BrowserRuntime, { embedded: true });
  await act(async () =>
    root.render(strict ? React.createElement(React.StrictMode, null, runtime) : runtime)
  );
  await settle(
    () => document.querySelector('#ttu-userfonts')?.textContent.includes('blob:'),
    'embedded CSS receives its cached Blob resource'
  );
  assert.equal(document.querySelectorAll('#ttu-userfonts').length, 1);
  assert.match(document.querySelector('#ttu-userfonts').textContent, /Embedded face/);
  assert.equal(await created.at(-1).blob.text(), 'cached font bytes');
  const live = created.at(-1).url;
  await act(async () =>
    userFonts$.next([{ name: 'Late face', fileName: 'late.woff2', path: '/userfonts/late.woff2' }])
  );
  await settle(() => !!finishLate, 'replacement cache read starts');
  assert.ok(revoked.includes(live), 'replacement retires the previous face URL');
  const count = created.length;
  await act(async () => root.unmount());
  await act(async () => finishLate(new Response('late bytes')));
  assert.equal(created.length, count, 'retired effect cannot materialize late font bytes');
  assert.equal(new Set(revoked).size, revoked.length, 'every URL is revoked once');
  assert.equal(document.querySelector('#ttu-userfonts'), null);
  assert.ok(reads.every((path) => path.startsWith('/userfonts/')));
  assert.ok(
    !requests.some((url) => url.includes('/userfonts/')),
    'no font URL falls back to network'
  );
  container.remove();
  userFonts$.next([]);
}
dom.window.close();
console.log('Library startup and remount completed');
