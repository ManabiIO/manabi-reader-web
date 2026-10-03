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
  'location',
  'history'
])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
Object.assign(globalThis, indexedDB);
Object.assign(window, { indexedDB: globalThis.indexedDB, IDBKeyRange: globalThis.IDBKeyRange });
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.scrollTo = () => {};
window.HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
window.HTMLDialogElement.prototype.close = function () {
  this.open = false;
};
globalThis.BroadcastChannel = undefined;
globalThis.IntersectionObserver = globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globalThis.fetch = async () => new Response('', { status: 503 });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const {
  ManageRoute,
  LibraryScreen,
  BrowserRuntime,
  database,
  presentBook,
  createCollection,
  refreshLocation,
  installRouter,
  goto,
  beforeNavigate,
  account,
  commitSnippet,
  reloadSnippets,
  createSnippet,
  plainContent,
  RouteParams
} = require(process.argv[2]);
const strict = process.argv[3] === 'true';
const origin = location.origin;
const personalSeries = 'personal-series:Personal%20series';
const seriesURL = new URL('/reader-web/manage', origin);
seriesURL.searchParams.set('series', personalSeries);

async function settle(predicate, message) {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline)
    await act(async () => {
      await delay(10);
    });
  assert.ok(predicate(), message);
}
const container = document.createElement('div');
document.body.append(container);
const root = createRoot(container);
const render = async (children) => {
  const screen = React.createElement(
    React.Fragment,
    null,
    React.createElement(BrowserRuntime),
    children
  );
  await act(async () =>
    root.render(strict ? React.createElement(React.StrictMode, null, screen) : screen)
  );
};

try {
  const db = await database.db;
  await db.put('data', {
    id: 1,
    title: 'Preferences parity',
    contentHash: 'a'.repeat(64),
    libraryOwner: null,
    elementHtml: '<p>Generated test fixture</p>',
    sections: [],
    blobs: {},
    characters: 0,
    lastBookModified: 1,
    lastBookOpen: 0
  });
  for (const [id, title, hash] of [
    [2, 'Independent volume', 'b'],
    [3, 'Finished volume', 'c']
  ])
    await db.put('data', {
      id,
      title,
      contentHash: hash.repeat(64),
      libraryOwner: null,
      elementHtml: '<p>Generated test fixture</p>',
      sections: [],
      blobs: {},
      characters: 0,
      lastBookModified: 1,
      lastBookOpen: 0
    });
  await db.put('bookmark', {
    dataId: 3,
    progress: 1,
    lastBookmarkModified: 1,
    completion: { state: 'finished', finishedOn: '2026-10-02', modifiedAt: 1 }
  });
  await presentBook(`content:${'a'.repeat(64)}`, { series: { name: 'Personal series' } });
  const collection = await createCollection('Only independent', [`content:${'b'.repeat(64)}`]);
  database.dataListChanged$.next(undefined);
  await render(
    React.createElement(
      RouteParams.Provider,
      { value: { series: personalSeries } },
      React.createElement(ManageRoute)
    )
  );
  assert.equal(location.href, `${origin}/reader-web/manage`, 'Expo history has not committed yet');
  await settle(
    () => container.querySelector('button[aria-label="Actions for Preferences parity"]'),
    'the incoming route must open its own personal series before the global URL commits'
  );
  const manage = (params) =>
    React.createElement(RouteParams.Provider, { value: params }, React.createElement(ManageRoute));
  await act(async () => {
    window.history.replaceState(
      { expoState: 'must survive' },
      '',
      '/reader-web/settings?foreign=1'
    );
    refreshLocation();
  });
  await render(manage({ series: personalSeries }));
  assert.ok(
    container.querySelector('button[aria-label="Actions for Preferences parity"]'),
    "a retained Manage route must not follow another screen's global URL"
  );
  await render(manage({ collection: 'finished' }));
  await settle(
    () => container.querySelector('button[aria-label="Actions for Finished volume"]'),
    'same-instance route parameter replacement reaches the finished shelf'
  );
  assert.equal(
    container.querySelector('button[aria-label="Actions for Independent volume"]'),
    null
  );
  await render(manage({ collection }));
  await settle(
    () => container.querySelector('button[aria-label="Actions for Independent volume"]'),
    'the custom collection must reach a ready shelf despite the stale Settings global URL'
  );
  assert.equal(container.querySelector('button[aria-label="Actions for Finished volume"]'), null);

  const retained = {},
    incoming = {};
  const readyRetained = (library, workspace) => Object.assign(retained, { library, workspace });
  const readyIncoming = (library, workspace) => Object.assign(incoming, { library, workspace });
  const retainedURL = `${origin}/reader-web/manage?collection=${encodeURIComponent(collection)}&scope=snippets`;
  let incomingURL = `${seriesURL.href}&scope=books&note=one&note=two#shelf`;
  let mountIncoming = false;
  const screens = () =>
    React.createElement(
      React.Fragment,
      null,
      React.createElement(
        'section',
        { id: 'retained' },
        React.createElement(LibraryScreen, { routeUrl: retainedURL, onReady: readyRetained })
      ),
      mountIncoming &&
        React.createElement(
          'section',
          { id: 'incoming' },
          React.createElement(LibraryScreen, { routeUrl: incomingURL, onReady: readyIncoming })
        )
    );
  await render(screens());
  await settle(
    () => retained.library && !retained.library.loading && !retained.workspace.scanning,
    'the retained route has already received the completed list before the incoming route mounts'
  );
  let listPublications = 0;
  const listSubscription = database.dataList$.subscribe(() => listPublications++);
  assert.equal(listPublications, 1);
  mountIncoming = true;
  await render(screens());
  await settle(
    () =>
      incoming.library &&
      retained.library &&
      !incoming.library.loading &&
      !retained.library.loading &&
      !incoming.workspace.scanning &&
      !retained.workspace.scanning,
    'both actually mounted Library controllers finish loading independently'
  );
  assert.equal(listPublications, 1, 'mounting a second route does not fetch the Library again');
  const loadingEvents = [];
  const loadingSubscription = database.listLoading$.subscribe((value) => loadingEvents.push(value));
  assert.deepEqual(
    loadingEvents,
    [false],
    'late readiness subscribers receive the committed state'
  );
  await act(async () => database.dataListChanged$.next(undefined));
  await settle(
    () => listPublications === 2 && !incoming.library.loading && !retained.library.loading,
    'an actual list refresh makes both retained and incoming controllers ready again'
  );
  assert.deepEqual(
    loadingEvents,
    [false, true, false],
    'reload retains its actual busy/ready transition'
  );
  loadingSubscription.unsubscribe();
  listSubscription.unsubscribe();
  const active = incoming.workspace,
    old = retained.workspace;
  assert.equal(active.series.id, personalSeries);
  assert.equal(old.collectionId, collection);
  assert.deepEqual(
    old.visibleBooks.map((book) => book.bookId),
    [2]
  );
  assert.ok(
    container.querySelector('#incoming button[aria-label="Actions for Preferences parity"]')
  );
  assert.ok(
    container.querySelector('#retained button[aria-label="Actions for Independent volume"]')
  );

  const routed = [];
  const stopRouter = installRouter({
    push: (path) => routed.push(['push', path]),
    replace: (path) => routed.push(['replace', path])
  });
  try {
    const pendingPick = new AbortController();
    incoming.library.pickDownload = pendingPick;
    const generation = incoming.library.openGeneration;
    const stopDenied = beforeNavigate((navigation) => navigation.cancel());
    await act(async () => goto('/reader-web/connections'));
    stopDenied();
    assert.equal(
      pendingPick.signal.aborted,
      false,
      'denied departure preserves the pending Library operation'
    );
    assert.equal(incoming.library.openGeneration, generation);
    assert.deepEqual(routed, [], 'denied departure never reaches Expo');
    await act(async () => goto('/reader-web/connections'));
    assert.equal(
      pendingPick.signal.aborted,
      true,
      'admitted departure cancels the pending operation'
    );
    assert.ok(incoming.library.openGeneration > generation);
    routed.length = 0;
    const depth = window.history.length;
    await act(async () => {
      incoming.library.selectMode = true;
      active.setQuery('Preferences');
      active.setSearchScope('snippets');
    });
    assert.equal(window.history.length, depth, 'search edits replace the current history entry');
    assert.deepEqual(routed, [], 'search edits must not push or replace an Expo stack screen');
    assert.equal(window.history.state.expoState, 'must survive');
    assert.equal(active.query, 'Preferences');
    assert.equal(active.librarySearchScope, 'snippets');
    assert.equal(active.url.searchParams.get('series'), personalSeries);
    assert.deepEqual(active.url.searchParams.getAll('note'), ['one', 'two']);
    assert.equal(active.url.hash, '#shelf');
    assert.equal(active.url.searchParams.has('foreign'), false);
    assert.equal(old.query, '', 'another retained Library never adopts the shallow query');
    assert.equal(old.librarySearchScope, 'snippets');
    assert.equal(old.collectionId, collection);

    await render(screens());
    await act(async () => active.setRouteUrl(incomingURL));
    assert.equal(active.query, 'Preferences', 'unchanged incoming props preserve the local query');
    assert.equal(active.librarySearchScope, 'snippets', 'unchanged incoming props preserve scope');
    await act(async () => {
      window.history.replaceState(
        { expoState: 'must survive' },
        '',
        '/reader-web/manage?collection=finished&q=foreign&scope=books'
      );
      refreshLocation();
    });
    assert.equal(active.series.id, personalSeries);
    assert.equal(active.query, 'Preferences');
    assert.equal(active.librarySearchScope, 'snippets');
    assert.equal(old.collectionId, collection);
    assert.equal(old.query, '');
    await act(async () => active.navigateBack());
    const navigated = new URL(routed.at(-1)[1], origin);
    assert.equal(navigated.searchParams.get('q'), 'Preferences');
    assert.equal(navigated.searchParams.get('scope'), 'snippets');
    assert.equal(navigated.searchParams.has('series'), false);
    assert.equal(navigated.searchParams.has('collection'), false);
    assert.deepEqual(navigated.searchParams.getAll('note'), ['one', 'two']);

    // Route replacement must retire selection and in-flight organization authority.
    incomingURL = `${origin}/reader-web/manage?scope=books`;
    await render(screens());
    await act(async () => {
      active.setQuery('');
      active.setSearchScope('books');
      active.selectAllVisible();
    });
    assert.deepEqual([...incoming.library.selectedBookIds].sort(), [1, 2, 3]);
    let release,
      admitted,
      commits = 0;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let mutation;
    await act(async () => {
      active.editOrganization('metadata', active.visibleBooks);
      mutation = active.organize(async (_targets, current) => {
        admitted = current;
        await gate;
        if (current()) commits++;
      });
    });
    assert.equal(admitted(), true);
    const previousEpoch = active.organizationEpoch;
    incomingURL = `${origin}/reader-web/manage?collection=${encodeURIComponent(collection)}&unfinished=1&q=Independent&scope=books`;
    await render(screens());
    await settle(
      () =>
        !incoming.library.loading &&
        active.collectionId === collection &&
        active.visibleBooks.length === 1,
      'the replacement filtered collection becomes ready'
    );
    assert.equal(incoming.workspace, active, 'the same controller receives changed route props');
    assert.equal(active.query, 'Independent', 'changed incoming props supersede a local query');
    assert.equal(active.notFinished, true);
    assert.deepEqual(
      active.visibleBooks.map((book) => book.bookId),
      [2]
    );
    assert.equal(incoming.library.selectedBookIds.size, 0, 'retired scope selections are cleared');
    assert.equal(active.organizationDialog, undefined);
    assert.ok(active.organizationEpoch > previousEpoch);
    assert.equal(
      admitted(),
      false,
      'a route replacement cannot authorize the pending metadata write'
    );
    await act(async () => {
      release();
      await mutation;
    });
    assert.equal(commits, 0);
    await act(async () => active.selectAllVisible());
    assert.deepEqual(
      [...incoming.library.selectedBookIds],
      [2],
      'Select All uses the one ready collection book, not the previous three-book scope'
    );

    // The rendered search result must pass this Library's return URL, not the
    // Settings/other-Library global URL, into real snippet navigation.
    incomingURL = `${origin}/reader-web/manage?collection=${encodeURIComponent(collection)}&q=Route&scope=snippets`;
    await act(async () => {
      incoming.library.selectMode = false;
    });
    await render(screens());
    await act(async () => {
      // Seed the real persisted owner. Injecting snippetItems directly races the
      // live BrowserRuntime's legitimate asynchronous IndexedDB refresh and can
      // lose this synthetic row before the unchanged navigation assertion.
      await commitSnippet(
        createSnippet(plainContent('Route fixture content'), 'Route target'),
        null,
        undefined
      );
      await reloadSnippets();
    });
    await settle(
      () => container.querySelector('#incoming button[aria-label="Read snippet Route target"]'),
      'the mounted route-local search produces the snippet title result'
    );
    await act(async () => {
      container.querySelector('#incoming button[aria-label="Read snippet Route target"]').click();
    });
    const snippetURL = new URL(routed.at(-1)[1], origin);
    assert.equal(snippetURL.pathname, '/snippets');
    assert.equal(
      snippetURL.searchParams.get('returnTo'),
      new URL(incomingURL).pathname + new URL(incomingURL).search
    );

    // Account replacement still retires metadata authority independently of routing.
    incomingURL = seriesURL.href;
    await render(screens());
    await act(async () => active.editOrganization('metadata', active.visibleBooks));
    const accountEpoch = active.organizationEpoch;
    await act(async () =>
      account.set({
        status: 'available',
        session: {
          user: { id: 'replacement', username: 'replacement' },
          csrf_token: 'x'.repeat(64),
          providers: []
        }
      })
    );
    assert.ok(active.organizationEpoch > accountEpoch);
    assert.equal(active.organizationDialog, undefined);
    assert.equal(active.organizationTargets.length, 0);
    await settle(
      () => !incoming.library.loading && !retained.library.loading,
      'an account replacement cannot strand either mounted Library in Loading'
    );
  } finally {
    stopRouter();
  }
  console.log('Library route ownership completed');
} finally {
  await act(async () => root.unmount());
  dom.window.close();
}
