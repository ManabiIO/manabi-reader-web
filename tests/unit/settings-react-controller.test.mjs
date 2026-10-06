/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileFunction } from 'node:vm';
import test from 'node:test';
import { deferred } from './fixtures/offline-module.mjs';
const require = createRequire(import.meta.url);
const ts = require('typescript');
function load(relative, imports = {}) {
  const url = new URL('../../apps/web/src/' + relative, import.meta.url);
  const { outputText, diagnostics } = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX
    },
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
    next(next) {
      value = next;
      for (const fn of listeners) fn(value);
    },
    set(next) {
      this.next(next);
    },
    getValue() {
      return value;
    },
    count() {
      return listeners.size;
    }
  };
}
const runtime = load('reader-react/controller.ts', { react: {} });
const contextModule = load('lib/components/settings/settings-context.ts');
const settingsContext = (entries = []) => {
  const values = new Map(entries);
  return {
    getContext: (key) => values.get(key),
    setContext: (key, value) => (values.set(key, value), value)
  };
};
const drain = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test('React settings field initializes context stores before evaluating its filter, and unsubscribes', () => {
  const filter = store({ category: 'appearance', query: '' });
  const { createSettingsItemGroup } = load('settings-react/settings-item-group-controller.ts', {
    '$lib/state/store': { readable: store },
    '../lib/components/settings/settings-context': contextModule,
    '../reader-react/controller': runtime
  });
  const context = settingsContext([[contextModule.SETTINGS_FILTER, filter]]);
  const c = createSettingsItemGroup(
    { title: 'Auto bookmark time', category: 'reading', settingId: 'auto-bookmark' },
    undefined,
    context
  );
  c.controller.prepare();
  assert.equal(c.visible, false);
  assert.equal(context.getContext(contextModule.SETTINGS_FIELD)(), 'Auto bookmark time');
  filter.set({ category: 'appearance', query: 'auto BOOKMARK' });
  c.controller.prepare();
  assert.equal(c.visible, true);
  assert.equal(c.headingId, 'setting-auto-bookmark-heading');
  c.controller.destroy();
  assert.equal(filter.count(), 0);
});

test('React dimension presets keep opening, previewing and resizing read-only until a chosen value is committed', () => {
  const presets = load('lib/components/settings/dimension-presets.ts');
  const { createSettingsDimensionContent } = load(
    'settings-react/settings-dimension-content-controller.ts',
    {
      '../lib/components/settings/dimension-presets': presets,
      '../reader-react/controller': runtime
    }
  );
  const c = createSettingsDimensionContent(
    { dimensionValue: 160, isVertical: true, isFirstDimension: true },
    undefined,
    settingsContext()
  );
  c.width = 1200;
  c.height = 800;
  c.controller.prepare();
  assert.equal(c.dimensionValue, 160);
  assert.equal(c.label, 'Left and right margins');
  c.preview = { context: c.context, percentage: 50 };
  c.controller.prepare();
  assert.equal(c.shownPercentage, 50);
  assert.equal(c.dimensionValue, 160);
  c.width = 800;
  c.controller.prepare();
  assert.equal(c.dimensionValue, 160);
  assert.equal(c.shownPercentage, 40);
  c.setToValue(25);
  c.controller.prepare();
  assert.equal(c.dimensionValue, 100);
  c.controller.destroy();
});

test('background option stores initialize before rendering and switch subscription with target', () => {
  const library = store({ fade: true, amount: 40 }),
    reader = store({ fade: false, amount: 80 });
  const backgrounds = store({ library: { light: {}, dark: {} }, reader: { light: {}, dark: {} } });
  const { createBackgroundSettings } = load('settings-react/background-settings-controller.ts', {
    '../lib/appearance/backgrounds': { backgrounds },
    '../lib/appearance/state': {
      libraryBackgroundOptions$: library,
      readerBackgroundOptions$: reader
    },
    '../reader-react/controller': runtime
  });
  const c = createBackgroundSettings(
    { target: 'library', label: 'Library' },
    undefined,
    settingsContext()
  );
  c.controller.prepare();
  assert.equal(c.opacity, 0.4);
  assert.equal(library.count(), 1);
  c.target = 'reader';
  c.controller.prepare();
  assert.equal(c.opacity, 0);
  assert.equal(library.count(), 0);
  assert.equal(reader.count(), 1);
  c.controller.destroy();
  assert.equal(reader.count(), 0);
  assert.equal(backgrounds.count(), 0);
});

test('reading goal edit fields are not reset by the persisted-goal hydration effect', () => {
  const saved = store({
    timeGoal: 1800,
    characterGoal: 1000,
    goalFrequency: 'daily',
    goalStartDate: '2026-10-02'
  });
  const stores = Object.fromEntries(
    [
      'isOnline$',
      'cacheStorageData$',
      'replicationSaveBehavior$',
      'statisticsMergeMode$',
      'readingGoalsMergeMode$',
      'startDayHoursForTracker$'
    ].map((key) => [key, store(false)])
  );
  const { createSettingsReadingGoals } = load(
    'settings-react/settings-reading-goals-controller.ts',
    {
      '$lib/components/book-reader/book-reading-tracker/book-reading-tracker': {
        ReadingGoalFrequency: { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly' }
      },
      '$lib/data/dialog-manager': {},
      '$lib/data/reading-goal': {},
      '$lib/data/storage/storage-handler-factory': {},
      '$lib/data/storage/storage-types': {},
      '$lib/data/store': { ...stores, readingGoal$: saved },
      '$lib/functions/replication/replicator': {},
      '$lib/functions/utils': { isOnlineSourceAvailable: () => true },
      '$lib/functions/statistic-util': { secondsToMinutes: (value) => value / 60 },
      '../reader-react/controller': runtime,
      '../ui/dialogs': {},
      './settings-reading-goals-merge': {},
      './settings-sync-dialog': {}
    }
  );
  const c = createSettingsReadingGoals({}, undefined, settingsContext());
  c.controller.prepare();
  assert.equal(c.currentTimeGoal, 1800);
  c.currentTimeGoal = 3600;
  c.currentCharacterGoal = 3000;
  c.controller.prepare();
  assert.equal(c.currentTimeGoal, 3600);
  assert.equal(c.currentCharacterGoal, 3000);
  assert.equal(c.currentTimeGoalInMin, 60);
  saved.next({
    timeGoal: 600,
    characterGoal: 500,
    goalFrequency: 'weekly',
    goalStartDate: '2026-10-03'
  });
  c.controller.prepare();
  assert.equal(c.currentTimeGoal, 600);
  assert.equal(c.currentCharacterGoal, 500);
  c.controller.destroy();
  assert.equal(saved.count(), 0);
});

test('migration inspection guards busy state synchronously and preserves safe default data choices', async () => {
  let release;
  const inspected = new Promise((resolve) => {
    release = resolve;
  });
  let inspectedCount = 0,
    closed = 0,
    beforeStop = 0;
  const { createImportTtuScreen } = load('settings-react/import-ttu-screen-controller.ts', {
    '$app/navigation': { beforeNavigate: () => () => beforeStop++ },
    '$app/stores': {
      page: store({ url: new URL('https://reader.example/reader-web/import-ttu') })
    },
    '$app/paths': { resolve: (value) => value },
    '$lib/manabi/ttu-migration': {
      TtuMigration: {
        inspect: () => {
          inspectedCount++;
          return inspected;
        }
      },
      migratedBookChoices: async () => []
    },
    '$lib/manabi/ttu-migration-format': {
      importLabels: { bookData: 'Book data', settings: 'Reader settings' },
      MigrationConflict: class extends Error {}
    },
    '../reader-react/controller': runtime
  });
  const c = createImportTtuScreen({}, undefined, settingsContext());
  c.controller.prepare();
  assert.deepEqual(c.parts, ['bookData']);
  const first = c.choose([{ name: 'backup.zip' }]);
  assert.equal(c.busy, true);
  await c.choose([{ name: 'duplicate.zip' }]);
  assert.equal(inspectedCount, 1);
  release({
    items: [
      { id: 'book', parts: ['bookData'], title: 'Book' },
      { id: 'settings', parts: ['settings'], title: 'Settings' }
    ],
    ignoredFiles: 2,
    close: async () => {
      closed++;
    }
  });
  await first;
  c.controller.prepare();
  assert.equal(c.rows.length, 2);
  assert.equal(c.rows[0].selected, true);
  assert.equal(c.rows[1].selected, false);
  assert.equal(c.ignored, 2);
  c.setRowSelection(c.rows[1].key, true);
  c.controller.prepare();
  assert.equal(c.selected.length, 2);
  c.setRowSelection(c.rows[0].key, false);
  c.controller.prepare();
  assert.equal(c.selected.length, 1);
  c.setRowTarget(c.rows[0].key, 42);
  assert.equal(c.rows[0].targetId, 42);
  c.clear();
  c.controller.prepare();
  assert.equal(c.rows.length, 0);
  assert.equal(c.sources.length, 0);
  await drain();
  assert.equal(closed, 1);
  c.controller.destroy();
  assert.equal(beforeStop, 1);
});

test('authorization starts after mount and reports provider failures instead of leaving a permanent spinner', () => {
  const previous = globalThis.window,
    sent = [];
  globalThis.window = {
    location: { href: 'https://reader.example/auth#error_description=Access%20denied' },
    opener: { postMessage: (value, origin) => sent.push({ value, origin }) }
  };
  try {
    const { createAuthScreen } = load('settings-react/auth-screen-controller.ts', {
      '$app/environment': { browser: true },
      '$lib/functions/replication/error-handler': {},
      '../reader-react/controller': runtime
    });
    const c = createAuthScreen({}, undefined, settingsContext());
    c.controller.prepare();
    assert.equal(c.errorMessage, '');
    assert.deepEqual(sent, []);
    c.controller.start();
    assert.match(c.errorMessage, /Access denied/);
    assert.equal(sent[0].value.type, 'failure');
    assert.equal(sent[0].origin, 'https://reader.example');
    c.controller.destroy();
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

test('import presentation owns admitted route params before browser history commits and preserves its visit state', (t) => {
  const oldWindow = globalThis.window;
  globalThis.window = { location: { search: '?source=ttu' } };
  t.after(() => {
    globalThis.window = oldWindow;
  });
  const page = store({ url: new URL('https://reader.example/reader-web/manage') });
  const { createImportTtuScreen } = load('settings-react/import-ttu-screen-controller.ts', {
    '$app/navigation': { beforeNavigate: () => () => {} },
    '$app/stores': { page },
    '$lib/manabi/ttu-migration': { TtuMigration: {}, migratedBookChoices: async () => [] },
    '$lib/manabi/ttu-migration-format': {
      importLabels: { bookData: 'Book data' },
      MigrationConflict: class extends Error {}
    },
    '../reader-react/controller': runtime
  });
  const c = createImportTtuScreen(
    { routeUrl: 'https://reader.example/reader-web/import-ttu?source=yatsu' },
    undefined,
    settingsContext()
  );
  c.controller.prepare();
  c.controller.start();
  assert.equal(c.yatsu, true);
  c.updateProps({ onClose: () => {} });
  c.controller.prepare();
  assert.equal(c.yatsu, true, 'unrelated prop deltas cannot revoke route admission');
  assert.equal(page.count(), 0, 'global address bar cannot overwrite an admitted route');
  c.message = 'Keep inspected/imported work';
  page.next({ url: new URL('https://reader.example/reader-web/import-ttu') });
  c.controller.prepare();
  assert.equal(c.yatsu, true);
  c.updateProps({ routeUrl: 'https://reader.example/reader-web/import-ttu?source=ttu' });
  c.controller.prepare();
  assert.equal(c.yatsu, false);
  assert.equal(c.message, 'Keep inspected/imported work');
  c.updateProps({ routeUrl: undefined });
  c.controller.prepare();
  assert.equal(page.count(), 1, 'standalone fallback still follows its actual browser page');
  page.next({ url: new URL('https://reader.example/reader-web/import-ttu?source=yatsu') });
  c.controller.prepare();
  assert.equal(c.yatsu, true);
  c.controller.destroy();
  assert.equal(page.count(), 0);
});

test('Expo importer forwards once-decoded route-local source before browser location changes', () => {
  let params = { source: 'yatsu', note: ['literal%20space', 'literal%2Fslash'] };
  const { default: ImportRoute } = load('screens/routes/import-ttu.web.tsx', {
    'expo-router': { useRoute: () => ({ params }) },
    '../../settings-react': { ImportTtuScreen: () => null },
    '../../runtime/paths': { base: '/reader-web' },
    'react/jsx-runtime': require('react/jsx-runtime')
  });
  const node = ImportRoute();
  const url = new URL(node.props.routeUrl);
  assert.equal(url.pathname, '/reader-web/import-ttu');
  assert.equal(url.searchParams.get('source'), 'yatsu');
  assert.deepEqual(url.searchParams.getAll('note'), ['literal%20space', 'literal%2Fslash']);
  params = { source: ['ttu', 'yatsu'] };
  assert.equal(new URL(ImportRoute().props.routeUrl).searchParams.get('source'), 'ttu');
});

test('React Settings consumes one persistence status and preserves manual retry', async () => {
  const status = deferred();
  const grant = deferred();
  let statusCalls = 0;
  let legacyProbeCalls = 0;
  let retryCalls = 0;
  const stores = new Map();
  const dataStores = new Proxy(
    {},
    {
      get(_target, key) {
        if (!stores.has(key)) stores.set(key, store(false));
        return stores.get(key);
      }
    }
  );
  const { createSettingsScreen } = load('settings-react/settings-screen-controller.ts', {
    '$lib/data/store': dataStores,
    '$lib/components/merged-header-icon/merged-entries': {
      mergeEntries: { MANAGE: { routeId: '/manage' }, SETTINGS: { routeId: '/settings' } }
    },
    '$lib/data/env': { pagePath: '/reader-web' },
    '$lib/data/window/navigator/storage': {
      storage: {
        persisted: async () => {
          legacyProbeCalls += 1;
          return false;
        },
        estimate: async () => ({})
      }
    },
    '$lib/data/window/navigator/persistent-storage': {
      persistentStorageStatus: () => {
        statusCalls += 1;
        return status.promise;
      },
      currentPersistentStorageRequest: () => grant.promise,
      retryPersistentStorage: () => {
        retryCalls += 1;
        return grant.promise;
      }
    },
    '$lib/functions/svelte/store': { writableSubject: store },
    '../reader-react/controller': runtime
  });
  const c = createSettingsScreen({}, undefined, settingsContext());
  c.controller.prepare();
  assert.equal(statusCalls, 0, 'render preparation must not inspect persistence');
  c.controller.start();
  assert.equal(statusCalls, 1);
  assert.equal(legacyProbeCalls, 0, 'Settings must not launch a second stale browser probe');
  assert.equal(c.$persistentStorage$, false);
  grant.resolve(true);
  await drain();
  assert.equal(c.$persistentStorage$, false, 'Settings must await the serialized status result');
  status.resolve(true);
  await drain();
  assert.equal(c.$persistentStorage$, true);
  await c.requestPersistentStorage();
  assert.equal(retryCalls, 1);
  assert.equal(c.$persistentStorage$, true);
  c.controller.destroy();
  for (const saved of stores.values()) assert.equal(saved.count(), 0);
});
