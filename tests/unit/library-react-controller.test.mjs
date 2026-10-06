/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileFunction } from 'node:vm';
import test from 'node:test';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const path = '../../apps/web/src/library-react/';
function load(name, imports = {}) {
  const url = new URL(path + name, import.meta.url);
  const { outputText, diagnostics } = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
    fileName: url.pathname
  });
  assert.equal(diagnostics.length, 0);
  const module = { exports: {} };
  compileFunction(outputText, ['require', 'module', 'exports'])(
    (name) => {
      assert.ok(Object.hasOwn(imports, name), 'Unexpected dependency: ' + name);
      return imports[name];
    },
    module,
    module.exports
  );
  return module.exports;
}
function store(value) {
  const listeners = new Set();
  return {
    subscribe(fn) {
      listeners.add(fn);
      fn(value);
      return () => listeners.delete(fn);
    },
    set(next) {
      value = next;
      for (const fn of listeners) fn(value);
    },
    count() {
      return listeners.size;
    }
  };
}
const boundary = load('observable-controller.ts', {
  '$lib/state/store': {
    get(source) {
      let value;
      const stop = source.subscribe((next) => (value = next));
      if (typeof stop === 'function') stop();
      else stop.unsubscribe();
      return value;
    }
  }
});
const drain = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test('controller guards see changes synchronously while React subscribers receive one atomic batch', async () => {
  class Model extends boundary.ObservableController {
    owner = 'alice';
    generation = 0;
    get identity() {
      return `${this.owner}:${this.generation}`;
    }
    replace(owner) {
      this.owner = owner;
      this.generation++;
    }
  }
  const model = new Model(),
    snapshots = [];
  model.subscribe(() => snapshots.push(model.identity));
  const stop = model.activate();
  snapshots.length = 0;
  assert.equal(model.identity, 'alice:0');
  const change = model.replace;
  change('bob');
  assert.equal(
    model.identity,
    'bob:1',
    'unbound callbacks retain their controller, and async guards do not wait for React'
  );
  assert.deepEqual(snapshots, []);
  await drain();
  assert.deepEqual(snapshots, ['bob:1']);
  stop();
});

test('derived controller views invalidate when an external store changes', async () => {
  const source = store(1);
  class Model extends boundary.ObservableController {
    start() {
      this.watch(source);
    }
    get value() {
      return boundary.readStore(source) * 2;
    }
  }
  const model = new Model();
  const stop = model.activate();
  assert.equal(source.count(), 1);
  assert.equal(model.value, 2);
  source.set(5);
  assert.equal(model.value, 10);
  await drain();
  stop();
  assert.equal(source.count(), 0);
});

test('React strict lifecycle restarts subscriptions once and retires queued notifications', async () => {
  const source = store(0);
  let starts = 0,
    cleanups = 0,
    notifications = 0;
  class Model extends boundary.ObservableController {
    value = 0;
    start() {
      starts++;
      this.watch(source);
      return () => {
        cleanups++;
      };
    }
  }
  const model = new Model();
  model.subscribe(() => notifications++);
  const first = model.activate();
  first();
  const atStop = notifications;
  source.set(1);
  await drain();
  assert.equal(notifications, atStop);
  const second = model.activate();
  assert.equal(source.count(), 1);
  assert.equal(starts, 2);
  second();
  assert.equal(source.count(), 0);
  assert.equal(cleanups, 2);
});

test('reconciliation writes settle in the same publication without a notification loop', async () => {
  class Model extends boundary.ObservableController {
    value = 0;
    reconcile() {
      if (this.value < 0) this.value = 0;
    }
  }
  const model = new Model();
  let count = 0;
  model.subscribe(() => count++);
  const stop = model.activate();
  count = 0;
  model.value = -1;
  await drain();
  assert.equal(model.value, 0);
  assert.equal(count, 1);
  await drain();
  assert.equal(count, 1);
  stop();
});

test('DOM ref updates never turn React callback-ref detach/attach into a rerender loop', async () => {
  const Original = globalThis.Element;
  globalThis.Element = class Element {};
  try {
    class Model extends boundary.ObservableController {
      element = null;
    }
    const model = new Model();
    let count = 0;
    model.subscribe(() => count++);
    const stop = model.activate();
    count = 0;
    model.element = new Element();
    model.element = null;
    model.element = new Element();
    await drain();
    assert.equal(count, 0);
    stop();
  } finally {
    if (Original === undefined) delete globalThis.Element;
    else globalThis.Element = Original;
  }
});

function headerHarness() {
  const media = { matches: false, addEventListener() {}, removeEventListener() {} };
  const original = globalThis.window;
  globalThis.window = { matchMedia: () => media, location: { search: '' } };
  const source = store('browser');
  const stores = Object.fromEntries(
    [
      'booklistSortOptions$',
      'cacheStorageData$',
      'fileCountData$',
      'fsStorageSource$',
      'gDriveStorageSource$',
      'isOnline$',
      'oneDriveStorageSource$'
    ].map((key) => [
      key,
      store(
        key === 'booklistSortOptions$'
          ? { browser: { property: 'title', direction: 'asc' } }
          : false
      )
    ])
  );
  const { HeaderController } = load('header-controller.ts', {
    './observable-controller': boundary,
    '$lib/components/navigation/docs-link': { openUserGuide() {} },
    '$app/environment': { browser: true },
    '$app/paths': { resolve: (x) => x },
    '$app/navigation': { goto() {} },
    '$lib/data/sort-types': { SortDirection: { ASC: 'asc', DESC: 'desc' } },
    '$lib/data/storage/handler/filesystem-handler': { FilesystemStorageHandler: {} },
    '$lib/data/storage/storage-handler-factory': { getStorageHandler() {} },
    '$lib/data/storage/storage-types': {
      StorageKey: { BROWSER: 'browser', GDRIVE: 'gdrive', ONEDRIVE: 'onedrive', FS: 'fs' }
    },
    '$lib/data/storage/storage-view': {
      isStorageSourceAvailable: () => false,
      storageSource$: source
    },
    '$lib/data/store': stores,
    '$lib/functions/file-dom/input-allow-directory': { inputAllowDirectory() {} },
    '$lib/functions/file-dom/input-file': { inputFile() {} },
    '$lib/functions/utils': { isMobile$: store(false), isOnOldUrl: () => false }
  });
  return {
    HeaderController,
    restore() {
      if (original === undefined) delete globalThis.window;
      else globalThis.window = original;
    }
  };
}
test('the active React header preserves IME text until composition ends, with external-navigation fencing', async () => {
  const h = headerHarness();
  try {
    const model = new h.HeaderController(),
      queries = [];
    model.libraryMenu = { search: { query: '', setQuery: (q) => queries.push(q) } };
    const stop = model.activate();
    assert.equal(model.hydrated, true);
    model.searchCompositionStarted({ currentTarget: { value: 'に' } });
    model.searchInputChanged({ currentTarget: { value: '日本' }, isComposing: true });
    assert.deepEqual(queries, []);
    model.searchCompositionEnded({ currentTarget: { value: '日本語' } });
    assert.deepEqual(queries, ['日本語']);
    model.searchCompositionStarted({ currentTarget: { value: '途中' } });
    model.libraryMenu = { search: { query: 'new navigation', setQuery: (q) => queries.push(q) } };
    model.flush();
    model.searchCompositionEnded({ currentTarget: { value: '古い入力' } });
    assert.deepEqual(queries, ['日本語']);
    assert.equal(model.searchDraft, 'new navigation');
    stop();
    await drain();
  } finally {
    h.restore();
  }
});

test('unwatched synchronous store reads dispose function and object subscriptions', () => {
  for (const objectSubscription of [false, true]) {
    let stops = 0;
    const source = {
      subscribe(run) {
        run(42);
        return objectSubscription
          ? {
              unsubscribe() {
                stops++;
              }
            }
          : () => {
              stops++;
            };
      }
    };
    assert.equal(boundary.readStore(source), 42);
    assert.equal(stops, 1);
  }
});


function searchHarness() {
  const user = store(null);
  const snippets = store([
    {
      id: '10000000-0000-4000-8000-000000000001',
      key: 'snippet:10000000-0000-4000-8000-000000000001',
      title: 'Cat note',
      revision: 1
    }
  ]);
  let snippetKeyReads = 0,
    bookQueries = 0;
  const tasks = [];
  const queryTask = () => {
    const task = {
      work: undefined,
      delay: undefined,
      start(work, delay = 100) {
        task.work = work;
        task.delay = delay;
      },
      stop() {}
    };
    tasks.push(task);
    return task;
  };
  const referenceRevision = () => {
    let current,
      initialized = false,
      revision = 0;
    return (next) => {
      if (!initialized || next !== current) {
        initialized = true;
        current = next;
        revision++;
      }
      return revision;
    };
  };
  const arrayRevision = (equal) => {
    let current,
      initialized = false,
      revision = 0;
    return (next) => {
      if (initialized && next === current) return revision;
      const changed =
        !initialized ||
        !current ||
        next.length !== current.length ||
        next.some((item, index) => !equal(item, current[index]));
      if (changed) revision++;
      initialized = true;
      current = next;
      return revision;
    };
  };
  const { SearchController } = load('search-controller.ts', {
    './observable-controller': boundary,
    '$app/navigation': { goto() {} },
    '$app/paths': { resolve: (value) => value },
    '$lib/manabi/client': { localUser: user, localProfileUser: () => null },
    '$lib/media/feature': { videoLearningEnabled: false },
    '$lib/snippets/service': {
      snippetItems: snippets,
      scope: () => ({ guard() {} })
    },
    '$lib/snippets/document': {
      snippetKey: (id) => {
        snippetKeyReads++;
        return 'snippet:' + id;
      }
    },
    '$lib/snippets/search': { searchBodies: () => () => {} },
    '$lib/search/book-content-source': { searchBookContents: async () => () => {} },
    '$lib/search/book-title-match-text': {
      queryBookTitleSearchSnapshot: () => {
        bookQueries++;
        return { matchedKeys: new Set(), textByBook: {} };
      }
    },
    '$lib/library/search-normalization': { foldSearch: (value) => value.toLowerCase() },
    '$lib/search/result-rows': {
      bookTitleRows: () => [],
      scopedSnippetTitleRows: () => ({ rows: [], failed: false }),
      videoTitleRows: () => [],
      sortTitleRows: (rows) => rows,
      bookContentRows: () => [],
      snippetContentRows: () => [],
      videoContentRows: () => []
    },
    '$lib/search/source-session': { startSearchSources: () => () => {} },
    '$lib/search/query-task.mjs': { queryTask },
    '$lib/search/invalidation': {
      advanceMediaSearchRevisions: (current) => current,
      arrayRevision,
      referenceRevision,
      searchResultPlan: (filter) => ({
        titles: filter === 'all' || filter === 'titles',
        content: filter === 'all' || filter === 'content'
      })
    },
    '$lib/search/library-search-scope': {
      librarySearchQueryWithinLimit: (value) => [...value].length <= 512,
      librarySearchScopePlan: (scope) =>
        scope === 'books'
          ? { books: true, snippets: false, dictionary: false }
          : scope === 'snippets'
            ? { books: false, snippets: true, dictionary: false }
            : { books: true, snippets: true, dictionary: true }
    }
  });
  return {
    SearchController,
    tasks,
    reads: () => ({ snippetKeyReads, bookQueries })
  };
}

test('active React unified search keeps corpus work behind the debounced generation', async () => {
  const harness = searchHarness();
  const model = new harness.SearchController();
  let bookReads = 0;
  const books = new Proxy(
    [
      {
        key: 'book:a',
        bookId: 1,
        isPlaceholder: false,
        title: 'Cat guide',
        contentHash: 'a'.repeat(64),
        lastBookModified: 1
      }
    ],
    {
      get(target, key, receiver) {
        if (key === Symbol.iterator || key === '0' || key === 'length') bookReads++;
        return Reflect.get(target, key, receiver);
      }
    }
  );
  model.books = books;
  model.bookSearchSnapshot = { direct: [{ key: 'book:a', folded: ['cat guide'] }], contexts: [] };
  model.query = 'c';

  void model.nextTitleSignature;
  void model.nextContentSignature;
  const admitted = harness.reads();
  assert.equal(bookReads, 0, 'scalar signatures must not iterate the Book corpus');
  assert.equal(admitted.snippetKeyReads, 1);

  model.query = 'ca';
  void model.nextTitleSignature;
  void model.nextContentSignature;
  assert.equal(bookReads, 0, 'query-only invalidation must keep the same Book snapshot O(1)');
  assert.equal(
    harness.reads().snippetKeyReads,
    admitted.snippetKeyReads,
    'query-only invalidation must reuse the admitted Snippet projection'
  );

  model.startTitles();
  assert.equal(harness.tasks[0].delay, 100);
  assert.equal(harness.reads().bookQueries, 0, 'Book metadata admission must wait for debounce');
  assert.equal(bookReads, 0, 'starting a title query must not clone the Book corpus');

  await harness.tasks[0].work(new AbortController().signal, () => {});
  assert.equal(harness.reads().bookQueries, 1);
  assert.ok(bookReads > 0, 'Book corpus iteration is admitted only inside debounced work');
});
