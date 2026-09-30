import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settingsScript } from './fixtures/settings-script.mjs';

// Node's built-in TypeScript loader cannot evaluate the production enum declarations.
const StorageKey = { BACKUP: 'backup', BROWSER: 'browser', GDRIVE: 'gdrive' };
const InternalStorageSources = {
  INTERNAL_BROWSER: 'ttu-internal-browser',
  INTERNAL_ZIP: 'ttu-internal-zip'
};

const emptyGoal = {
  timeGoal: 0,
  characterGoal: 0,
  goalFrequency: 'daily',
  goalStartDate: ''
};

function syncDialog() {
  const received = [];
  const h = settingsScript(
    'settings-sync-dialog.svelte',
    {
      settingsSyncHeader: 'Sync',
      storageSources: [],
      resolver: (value) => received.push(value)
    },
    {
      InternalStorageSources,
      StorageKey,
      $lastSyncedSettingsSource$: '',
      $lastSyncedSettingsTarget$: ''
    },
    ['closeDialog'],
    ['$lastSyncedSettingsSource$', '$lastSyncedSettingsTarget$']
  );
  return { ...h, received };
}

function storageSourceDialog() {
  const received = [];
  const h = settingsScript(
    'settings-storage-source.svelte',
    {
      configuredName: '',
      configuredIsSyncTarget: false,
      configuredIsStorageSourceDefault: false,
      configuredType: StorageKey.GDRIVE,
      configuredRemoteData: undefined,
      configuredFSData: undefined,
      configuredStoredInManager: false,
      configuredEncryptionDisabled: false,
      resolver: (value) => received.push(value)
    },
    {
      browser: false,
      StorageKey,
      window: {}
    },
    ['closeDialog'],
    []
  );
  return { ...h, received };
}

function mergeDialog() {
  const received = [];
  const h = settingsScript(
    'settings-reading-goals-merge.svelte',
    {
      newReadingGoal: { ...emptyGoal },
      resolver: (value) => received.push(value)
    },
    {
      $readingGoal$: { ...emptyGoal },
      $startDayHoursForTracker$: 0
    },
    ['closeDialog'],
    []
  );
  return { ...h, received };
}

test('destroying an unresolved sync selection cancels exactly once', () => {
  const h = syncDialog();
  h.dispose();
  h.dispose();
  assert.deepEqual(h.received, [[]]);
  assert.deepEqual(h.events, []);
});

test('sync confirmation owns settlement before later cancel or destruction', () => {
  const h = syncDialog();
  h.closeDialog()(false);
  h.closeDialog()(true);
  h.dispose();
  assert.deepEqual(h.received, [
    [
      {
        id: InternalStorageSources.INTERNAL_BROWSER,
        label: 'Browser DB',
        type: StorageKey.BROWSER
      },
      { id: InternalStorageSources.INTERNAL_ZIP, label: 'ZIP File', type: StorageKey.BACKUP }
    ]
  ]);
  assert.deepEqual(h.events, [['close']]);
});

test('destroying an unresolved reading-goal merge returns the existing no-op cancellation result', () => {
  const h = mergeDialog();
  h.dispose();
  h.dispose();
  assert.deepEqual(h.received, [{ readingGoalsToDelete: [], readingGoalsToInsert: [], error: '' }]);
  assert.deepEqual(h.events, []);
});

test('reading-goal cancellation can settle only once', async () => {
  const h = mergeDialog();
  await h.closeDialog()(true);
  await h.closeDialog()(true);
  h.dispose();
  assert.deepEqual(h.received, [{ readingGoalsToDelete: [], readingGoalsToInsert: [], error: '' }]);
  assert.deepEqual(h.events, [['close']]);
});

test('competing reading-goal confirmations cannot both publish', async () => {
  const h = mergeDialog();
  await Promise.all([h.closeDialog()(false), h.closeDialog()(false)]);
  h.dispose();
  assert.deepEqual(h.received, [{ readingGoalsToDelete: [], readingGoalsToInsert: [], error: '' }]);
  assert.deepEqual(h.events, [['close']]);
});

test('destroying an unresolved storage-source editor cancels its caller exactly once', () => {
  const h = storageSourceDialog();
  h.dispose();
  h.dispose();
  assert.deepEqual(h.received, [undefined]);
  assert.deepEqual(h.events, []);
});

test('storage-source close owns settlement before repeated close or destruction', () => {
  const h = storageSourceDialog();
  const result = {
    new: {
      name: 'Fixture',
      type: StorageKey.GDRIVE,
      storedInManager: false,
      encryptionDisabled: true,
      data: { clientId: 'fixture', clientSecret: '' },
      lastSourceModified: 1
    }
  };
  h.closeDialog()(result);
  h.closeDialog()();
  h.dispose();
  assert.deepEqual(h.received, [result]);
  assert.deepEqual(h.events, [['close']]);
});
