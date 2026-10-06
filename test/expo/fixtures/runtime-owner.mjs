/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import React, { act } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

// Transpile complete production modules, not extracted callbacks or source-text
// assertions. React, its reconciler, effects and the DOM are real. The controlled
// boundaries below stand in for storage/network and the heavyweight reader UI.
const compiled = new Map();
function production(path, dependencies = {}) {
  if (!compiled.has(path)) {
    const source = readFileSync(new URL(`../../../apps/web/src/${path}`, import.meta.url), 'utf8');
    const result = ts.transpileModule(source, {
      fileName: path,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX
      },
      reportDiagnostics: true
    });
    assert.equal(result.diagnostics.length, 0);
    compiled.set(path, result.outputText);
  }
  const module = { exports: {} };
  compileFunction(compiled.get(path), ['require', 'module', 'exports'])(
    (name) => {
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (name.endsWith('.css')) return {};
      assert.ok(
        Object.hasOwn(dependencies, name),
        `Provide the explicit boundary ${path}: ${name}`
      );
      return dependencies[name];
    },
    module,
    module.exports
  );
  return module.exports;
}
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const stores = production('lib/state/store.ts');
const documents = production('lib/snippets/document.ts');
const { summarize } = production('lib/snippets/summary.ts', { './document': documents });
const settings = production('platform/settings-fields.ts');
const bridge = production('platform/bridge-contract.ts', {
  '../native-settings/font-contract.ts': production('native-settings/font-contract.ts')
});
const navigation = production('platform/native-navigation.ts');
const editor = production('native-snippets/editor-model.ts', {
  '../lib/snippets/document': documents
});
const snippetService = production('native-snippets/service.ts', {
  '../lib/snippets/document': documents,
  './editor-model': editor
});
const catalogService = production('native-library/catalog-service.ts', {
  './catalog-contract': production('native-library/catalog-contract.ts')
});
const visibility = production('lib/library/account-visibility.ts', {
  './book-identity.ts': production('lib/library/book-identity.ts', {
    './organization-keys.ts': production('lib/library/organization-keys.ts')
  })
});
function observable(initial) {
  const inner = stores.writable(initial);
  const listeners = new Set();
  return {
    ...inner,
    listeners,
    subscribe(run) {
      const stop = inner.subscribe(run);
      listeners.add(stop);
      return () => {
        listeners.delete(stop);
        stop();
      };
    }
  };
}
function event() {
  const listeners = new Set();
  return {
    listeners,
    subscribe(run) {
      listeners.add(run);
      return {
        unsubscribe() {
          listeners.delete(run);
        }
      };
    },
    next() {
      for (const run of [...listeners]) run();
    }
  };
}

export async function runtimeOwner(t, { strict = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://expo.invalid/www.bundle/reader.html'
  });
  const globals = ['window', 'document', 'history', 'location', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = Object.fromEntries(
    globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  );
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    history: dom.window.history,
    location: dom.window.location,
    IS_REACT_ACT_ENVIRONMENT: true
  }))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  let generation = 0;
  const localUser = observable({ id: 'alice', username: 'Alice' });
  const account = observable({ status: 'available' });
  const client = {
    localUser,
    account,
    localProfileUser: () => stores.get(localUser),
    currentUser: () => stores.get(localUser),
    accountGeneration: () => generation,
    accountScope: () => ({ generation, userId: stores.get(localUser)?.id }),
    IntegrationError: class extends Error {
      constructor(code) {
        super(code);
        this.code = code;
      }
    },
    refreshAccount: async () => {},
    signOut: async () => {}
  };
  const operations = [];
  const operationModule = production('lib/manabi/operation-scope.ts', { './client': client });
  const operationBoundary = {
    captureLibraryOperation(...args) {
      const operation = operationModule.captureLibraryOperation(...args);
      const observed = { operation, stopped: 0 };
      operations.push(observed);
      return {
        ...operation,
        stop() {
          observed.stopped++;
          operation.stop();
        }
      };
    }
  };
  const snippetScope = production('lib/snippets/scope.ts', {
    '$lib/state/store': stores,
    '../manabi/client': client
  });
  const baseline = { account: account.listeners.size, user: localUser.listeners.size };
  const changed = event(),
    bookmarks = event();
  const root = createRoot(dom.window.document.getElementById('root'));
  const ref = React.createRef();
  const records = new Map();
  const pages = [];
  const page = {
    set(value) {
      pages.push(value);
    }
  };
  const sessions = [],
    snippetSessions = [],
    closes = [],
    flushes = [],
    navigations = [],
    snapshots = [],
    replies = [];
  const pending = new Map();
  const routers = new Set();
  const catalogLoads = [],
    catalogPreparations = [];
  // Keep catalog admission, token consumption, cancellation and expiry real.
  // Only public network/import work and its canonical storage result are controlled.
  const catalog = new catalogService.NativeCatalogService({
    async load(authority) {
      catalogLoads.push({ authority });
      return structuredClone((await f.catalogLoad?.(authority)) ?? f.catalogPicks);
    },
    async prepare(pick, authority) {
      catalogPreparations.push({ pick, authority });
      const result = await f.catalogPrepare?.(pick, authority);
      if (result) return result;
      const book = f.books[0];
      return {
        bookId: book.id,
        readerBookKey: `content:${book.contentHash}`,
        contentHash: book.contentHash,
        title: book.title,
        lastBookModified: book.lastBookModified
      };
    }
  });
  const libraryLocation = production('lib/library/search-navigation.ts');
  const contentSearch = {
    disposed: 0,
    start: (...args) => f.contentStart(...args),
    read: (...args) => f.contentRead(...args),
    cancel: (...args) => f.contentCancel(...args),
    admitOpen: (...args) => f.contentAdmit(...args),
    dispose() {
      this.disposed++;
    }
  };
  const library = {
    disposed: 0,
    async state(payload, authority) {
      authority.assertCurrent();
      return f.libraryState?.(payload, authority) ?? {};
    },
    async action(payload, authority) {
      authority.assertCurrent();
      return f.libraryAction?.(payload, authority) ?? {};
    },
    readCover(payload, authority) {
      authority.assertCurrent();
      return f.coverRead?.(payload, authority) ?? {};
    },
    cancelCover(payload, authority) {
      authority.assertCurrent();
      return f.coverCancel?.(payload, authority) ?? {};
    },
    async admitAccess(payload, authority) {
      authority.assertCurrent();
      authority.signal.throwIfAborted();
      const result = await f.admit?.(payload, authority);
      authority.signal.throwIfAborted();
      authority.assertCurrent();
      return (
        result ??
        payload.keys.map((id) => {
          const book = f.books.find((book) => book.id === id);
          return {
            bookId: book.id,
            contentHash: book.contentHash,
            title: book.title,
            lastBookModified: book.lastBookModified
          };
        })
      );
    },
    dispose() {
      this.disposed++;
    }
  };
  const database = {
    db: Promise.resolve({}),
    dataListChanged$: changed,
    bookmarksChanged$: bookmarks,
    getBookmark: async () => undefined,
    getAccessibleLastItem: async () => undefined,
    deleteData: (...args) => f.deleteData(...args)
  };
  const reader = { database };
  const settingSubjects = Object.fromEntries(
    settings.settingDefinitions.map((field) => {
      let value =
        field.kind === 'boolean'
          ? false
          : field.kind === 'number'
            ? field.min
            : field.kind === 'choice'
              ? field.choices[0]
              : 'serif';
      return [
        `${field.key}$`,
        {
          getValue: () => value,
          next(next) {
            value = next;
          }
        }
      ];
    })
  );
  Object.assign(reader, settingSubjects);
  const appearanceStores = {
    mode: observable('light'),
    theme: observable('manabi-theme'),
    custom: observable({})
  };
  const appearances = [];
  const snippetsRepository = {
    async load(authority) {
      authority.assertCurrent();
      const owner = snippetScope.scope().owner;
      return {
        owner,
        items: [...records.values()].filter((record) => record.owner === owner).map(summarize),
        drafts: [],
        sources: []
      };
    },
    async read(id, authority) {
      await f.repositoryRead?.(id, authority);
      authority.signal.throwIfAborted();
      authority.assertCurrent();
      return structuredClone(records.get(`${snippetScope.scope().owner}:${id}`));
    },
    async search(_query, items) {
      return { ids: new Set(items.map((item) => item.id)), complete: true };
    }
  };
  function Session(props) {
    const owned = React.useRef({ ...props, mounts: 0, unmounts: 0, exit: undefined });
    React.useEffect(() => {
      const current = owned.current;
      sessions.push(current);
      current.mounts++;
      const controller = {
        setExitHandler(exit) {
          current.exit = exit;
        },
        async requestClose() {
          closes.push(current);
          return f.confirmClose?.(current) ?? true;
        }
      };
      props.bindings.this(controller);
      return () => {
        current.unmounts++;
        props.bindings.this(undefined);
      };
    }, []);
    return React.createElement(
      'article',
      { 'data-book': props.expectedBook.bookId },
      props.expectedBook.title
    );
  }
  const readerScreen = production('reader-react/index.tsx', {
    '../runtime/stores': { page },
    '../runtime/paths': { base: '/reader-web' },
    './session': { ReaderScreen: Session },
    './book-reader': { BookReader: () => null }
  });
  function SnippetReader(props) {
    React.useEffect(() => {
      const observed = { ...props, unmounted: false };
      snippetSessions.push(observed);
      props.bindings.this({
        async flushPosition() {
          props.selectedScope.guard();
          await f.flushSnippet?.(observed);
          props.selectedScope.guard();
          flushes.push({
            owner: props.selectedScope.owner,
            id: props.document.id,
            revision: props.document.revision
          });
        }
      });
      return () => {
        observed.unmounted = true;
        props.bindings.this(undefined);
      };
    }, [props.document, props.selectedScope, props.bindings.this]);
    return React.createElement(
      'article',
      { 'data-snippet': props.document.id, 'data-owner': props.selectedScope.owner },
      documents.displayTitle(props.document)
    );
  }
  const snippetReader = production('platform/snippet-reader.tsx', {
    '../snippets-react': { SnippetReader }
  });
  const runtime = production('platform/reader-runtime.dom.tsx', {
    'expo/dom': { useDOMImperativeHandle: React.useImperativeHandle },
    './bridge-contract': bridge,
    './settings-fields': settings,
    '$lib/data/store': reader,
    '$lib/appearance/state': {
      appearance$: settingSubjects.appearance$,
      resolvedMode$: appearanceStores.mode,
      theme$: appearanceStores.theme,
      customThemes$: appearanceStores.custom
    },
    '$lib/data/theme-option': production('lib/data/theme-option.ts'),
    '../runtime/use-store': production('runtime/use-store.ts'),
    '$lib/manabi/client': client,
    '$lib/state/store': stores,
    '$lib/data/database/books-db/book-records': {
      async readBookSummaries() {
        await f.readSummaries?.();
        return structuredClone(f.books);
      }
    },
    '$lib/manabi/books': { allLinkedBooks: stores.writable([]) },
    '$lib/library/account-visibility': visibility,
    '$lib/manabi/operation-scope': operationBoundary,
    '$lib/data/storage/storage-handler-factory': { getStorageHandler: () => ({}) },
    '$lib/data/storage/storage-types': { StorageKey: { BROWSER: 'browser' } },
    '$lib/functions/replication/replicator': {
      importData: async () => {
        throw new Error('Unexpected import');
      }
    },
    '../runtime/BrowserRuntime': { BrowserRuntime: () => null },
    '../reader-react': readerScreen,
    './native-navigation': navigation,
    '../runtime/paths': { base: '/reader-web' },
    '../runtime/stores': { page },
    '../runtime/navigation': {
      installRouter(router) {
        routers.add(router);
        return () => routers.delete(router);
      }
    },
    '../statistics-react/native-service': {
      dispatchStatisticsAction: (...args) => f.statisticsAction?.(...args) ?? {}
    },
    '../features/statistics/native-owner.dom': {
      dispatchSharedStatisticsAction: (...args) => {
        if (!f.sharedStatisticsAction) throw new Error('Unexpected shared Statistics mutation');
        return f.sharedStatisticsAction(...args);
      }
    },
    '../statistics-react/native-route-dom': production('statistics-react/native-route-dom.ts', {
      '../features/statistics/native-owner.dom': {
        readSharedStatisticsRequest: (...args) => {
          if (!f.sharedStatisticsRead) throw new Error('Unexpected shared Statistics read');
          return f.sharedStatisticsRead(...args);
        }
      },
      './native-service': {
        readStatisticsSnapshot: (...args) => f.statisticsRead?.(...args) ?? {}
      }
    }),
    '../native-snippets/service': snippetService,
    '../native-snippets/dom-repository': {
      createNativeSnippetsRepository: () => snippetsRepository
    },
    './snippet-reader': snippetReader,
    '$lib/snippets/document': documents,
    '$lib/snippets/database': {
      async getRecord(owner, id) {
        await f.readSnippet?.(owner, id);
        return structuredClone(records.get(`${owner}:${id}`));
      }
    },
    '$lib/snippets/scope': snippetScope,
    '$lib/library/search-navigation': libraryLocation,
    '../native-library/content-search-dom': {
      createNativeLibraryContentSearchService: () => contentSearch
    },
    '../native-library/dom-service': { createNativeLibraryService: () => library },
    '../native-library/catalog-dom': { createNativeCatalogService: () => catalog },
    '../native-settings/font-service.dom': {
      createNativeFontService: () => ({
        read: (...args) => f.fontRead?.(...args) ?? {},
        action: (...args) => f.fontAction?.(...args) ?? {},
        import: (...args) => f.fontImport?.(...args) ?? {},
        dispose: () => {
          f.fontDisposals = (f.fontDisposals ?? 0) + 1;
        }
      })
    },
    '../native-settings/service': {
      readNativeSettingsState: async () => ({}),
      dispatchNativeSettingsAction: async () => ({})
    }
  });
  let mounted = true;
  let counter = 0;
  const f = {
    dom,
    ref,
    operations,
    baseline,
    localUser,
    account,
    changed,
    bookmarks,
    library,
    contentSearch,
    catalog,
    catalogLoads,
    catalogPreparations,
    catalogPicks: [
      {
        id: 'public-catalog-fixture',
        title: 'Public catalog fixture',
        author: 'Fixture author',
        summary: '<p>Plain public summary</p>',
        bookUrl: 'https://manabi.io/static/reader/books/library/fixture.epub',
        coverUrl: 'https://manabi.io/static/reader/books/opds/covers/fixture.jpg'
      }
    ],
    libraryLocation,
    routers,
    sessions,
    snippetSessions,
    closes,
    flushes,
    navigations,
    snapshots,
    appearances,
    appearanceStores,
    replies,
    records,
    pages,
    books: [1, 2].map((id) => ({
      id,
      title: `Book ${id}`,
      contentHash: String(id).repeat(64),
      lastBookModified: 10,
      characters: 100
    })),
    get scope() {
      const { session, epoch } = snapshots.at(-1);
      return { session, epoch };
    },
    get book() {
      return dom.window.document.querySelector('[data-book]')?.getAttribute('data-book');
    },
    get snippet() {
      return dom.window.document.querySelector('[data-snippet]')?.getAttribute('data-snippet');
    },
    addSnippet(owner = 'account:alice', title = 'Saved snippet') {
      const document = documents.createSnippet(documents.plainContent('日本語の文章'), title);
      const record = {
        key: JSON.stringify([owner, document.id]),
        owner,
        document,
        locations: [],
        conflicts: [],
        dirty: false,
        progress: {
          revision: document.revision,
          blockId: document.content.content[0].attrs?.id,
          quote: '日本語',
          before: '',
          offset: 2
        }
      };
      records.set(`${owner}:${document.id}`, record);
      return record;
    },
    async changeAccount(id = 'alice') {
      await act(async () => {
        generation++;
        localUser.set(id ? { id, username: id } : null);
        account.set({ status: 'available' });
      });
    },
    async refreshGeneration() {
      await act(async () => {
        generation++;
        account.set({ status: 'available' });
      });
    },
    async start(method, payload = {}, options = {}) {
      const request = {
        version: bridge.BRIDGE_VERSION,
        ...f.scope,
        id: `request_${++counter}`,
        method,
        payload,
        ...options
      };
      const receipt = deferred();
      pending.set(request.id, [...(pending.get(request.id) ?? []), receipt]);
      await act(async () => {
        assert.equal(
          ref.current.execute(request),
          undefined,
          'Expo execute returns immediately; onReply delivers the result'
        );
      });
      return { request, reply: receipt.promise };
    },
    async finish(command) {
      let result;
      await act(async () => {
        result = await command.reply;
      });
      return result;
    },
    async command(method, payload = {}, options) {
      return f.finish(await f.start(method, payload, options));
    },
    async settle(work = () => {}) {
      await act(async () => {
        await work();
      });
    },
    async unmount() {
      if (!mounted) return;
      mounted = false;
      await act(async () => root.unmount());
      await Promise.resolve();
    },
    deleteData: async () => {
      throw new Error('Configure the deletion transaction boundary');
    }
  };
  t.after(async () => {
    await f.unmount();
    dom.window.close();
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const component = React.createElement(runtime.default, {
    ref,
    async onSnapshot(value) {
      snapshots.push(value);
    },
    async onAppearance(value) {
      appearances.push(value);
    },
    async onNavigate(value) {
      navigations.push(value);
    },
    async onReply(value) {
      replies.push(value);
      for (const receipt of pending.get(value.id) ?? []) receipt.resolve(value);
      pending.delete(value.id);
      await f.replyBarrier?.(value);
    }
  });
  f.rebindAppearance = async () => {
    const rebound = React.createElement(runtime.default, {
      ...component.props,
      async onAppearance(value) {
        appearances.push(value);
      }
    });
    await act(async () =>
      root.render(strict ? React.createElement(React.StrictMode, {}, rebound) : rebound)
    );
  };
  await act(async () =>
    root.render(strict ? React.createElement(React.StrictMode, {}, component) : component)
  );
  assert.ok(f.scope.session);
  return f;
}
