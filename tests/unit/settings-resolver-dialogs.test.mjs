import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers';
import { settingsScript, storageTypes } from './fixtures/settings-script.mjs';

// Execute the real enum module through the fixture's TypeScript transpilation.
const { StorageKey, InternalStorageSources } = storageTypes;
const turn = () => new Promise((resolve) => setImmediate(resolve));

const emptyGoal = {
  timeGoal: 0,
  characterGoal: 0,
  goalFrequency: 'daily',
  goalStartDate: ''
};

function syncDialog(initial = {}, bindings = {}) {
  const received = [];
  const h = settingsScript(
    'settings-sync-dialog.svelte',
    {
      settingsSyncHeader: 'Sync',
      storageSources: [],
      resolver: (value) => received.push(value),
      ...initial
    },
    {
      $lastSyncedSettingsSource$: '',
      $lastSyncedSettingsTarget$: '',
      ...bindings
    },
    ['closeDialog'],
    ['$lastSyncedSettingsSource$', '$lastSyncedSettingsTarget$']
  );
  return { ...h, received };
}

function storageSourceDialog(initial = {}, bindings = {}) {
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
      resolver: (value) => received.push(value),
      ...initial
    },
    {
      browser: false,
      window: {},
      ...bindings
    },
    ['closeDialog'],
    []
  );
  return { ...h, received };
}

function mergeDialog(initial = {}, bindings = {}) {
  const received = [];
  const h = settingsScript(
    'settings-reading-goals-merge.svelte',
    {
      newReadingGoal: { ...emptyGoal },
      resolver: (value) => received.push(value),
      ...initial
    },
    {
      $readingGoal$: { ...emptyGoal },
      $startDayHoursForTracker$: 0,
      ...bindings
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

function animationFrames() {
  const callbacks = [];
  return {
    requestAnimationFrame: (callback) => callbacks.push(callback),
    get pending() {
      return callbacks.length;
    },
    flush() {
      for (const callback of callbacks.splice(0)) callback(0);
    }
  };
}

for (const interruption of ['cancel', 'destroy']) {
  test(`reading-goal ${interruption} wins over a confirmation suspended at the real reader tick`, async () => {
    const frames = animationFrames();
    const h = mergeDialog({}, { requestAnimationFrame: frames.requestAnimationFrame });
    const confirming = h.closeDialog()(false);
    assert.equal(frames.pending, 1);
    assert.deepEqual(h.received, []);
    if (interruption === 'cancel') await h.closeDialog()(true);
    else h.dispose();
    assert.deepEqual(h.received, [
      { readingGoalsToDelete: [], readingGoalsToInsert: [], error: '' }
    ]);
    frames.flush();
    await confirming;
    h.dispose();
    assert.equal(h.received.length, 1);
    assert.deepEqual(h.events, interruption === 'cancel' ? [['close']] : []);
    assert.equal(h.stores.readingGoal$.observers.length, 0);
    assert.equal(h.stores.startDayHoursForTracker$.observers.length, 0);
  });
}

test('reading-goal confirmation waits for the frame and publishes the current derived replacement list once', async () => {
  const frames = animationFrames();
  const newGoal = { ...emptyGoal, goalStartDate: '2999-10-03', timeGoal: 1200 };
  const existingGoal = { ...emptyGoal, goalStartDate: '2999-10-01' };
  const h = mergeDialog(
    { newReadingGoal: newGoal },
    { $readingGoal$: existingGoal, requestAnimationFrame: frames.requestAnimationFrame }
  );
  const first = h.closeDialog()(false);
  const second = h.closeDialog()(false);
  assert.equal(frames.pending, 2);
  assert.deepEqual(h.received, []);
  const replacement = { ...emptyGoal, goalStartDate: '2999-10-02' };
  h.instance.existingReadingGoals = [existingGoal, replacement, replacement];
  h.reactive();
  frames.flush();
  await Promise.all([first, second]);
  assert.deepEqual(h.received, [
    {
      readingGoalsToDelete: ['2999-10-02', '2999-10-01'],
      readingGoalsToInsert: [{ ...newGoal, goalEndDate: '', goalOriginalEndDate: '' }],
      error: ''
    }
  ]);
  assert.deepEqual(h.events, [['close']]);
  h.dispose();
});

test('unmount during reading-goal initialization suppresses the pending database result', async () => {
  const frames = animationFrames();
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  let reads = 0;
  const h = mergeDialog(
    { newReadingGoal: { ...emptyGoal, goalStartDate: '2999-10-03' } },
    {
      requestAnimationFrame: frames.requestAnimationFrame,
      database: {
        getReadingGoalsForDateWindow: async () => {
          reads++;
          return pending;
        }
      }
    }
  );
  await h.mount();
  assert.equal(reads, 0);
  frames.flush();
  await turn();
  assert.equal(reads, 1);
  h.dispose();
  resolve([{ ...emptyGoal, goalStartDate: '2999-10-01' }]);
  await turn();
  assert.deepEqual(h.instance.existingReadingGoals, []);
  assert.equal(h.instance.showSpinner, true);
  assert.deepEqual(h.received, [{ readingGoalsToDelete: [], readingGoalsToInsert: [], error: '' }]);
  assert.deepEqual(h.events, []);
});

test('sync confirmation writes its chosen pair to the actual stores and teardown releases subscribers', () => {
  const h = syncDialog({ storageSources: [{ name: 'Remote', type: StorageKey.GDRIVE }] });
  h.instance.selectedSource = 'Remote';
  h.instance.selectedTarget = InternalStorageSources.INTERNAL_BROWSER;
  h.reactive();
  assert.equal(h.stores.lastSyncedSettingsSource$.observers.length, 1);
  assert.equal(h.stores.lastSyncedSettingsTarget$.observers.length, 1);
  assert.ok(
    h.instance.sources.every((source) => source.id !== InternalStorageSources.INTERNAL_BROWSER)
  );
  assert.ok(h.instance.targets.every((target) => target.id !== 'Remote'));
  h.closeDialog()(false);
  assert.equal(h.stores.lastSyncedSettingsSource$.getValue(), 'Remote');
  assert.equal(
    h.stores.lastSyncedSettingsTarget$.getValue(),
    InternalStorageSources.INTERNAL_BROWSER
  );
  assert.deepEqual(h.received, [
    [
      { id: 'Remote', label: 'Remote (gdrive)', type: StorageKey.GDRIVE },
      { id: InternalStorageSources.INTERNAL_BROWSER, label: 'Browser DB', type: StorageKey.BROWSER }
    ]
  ]);
  h.dispose();
  assert.equal(h.stores.lastSyncedSettingsSource$.observers.length, 0);
  assert.equal(h.stores.lastSyncedSettingsTarget$.observers.length, 0);
});

test('sync cancellation preserves previously persisted source and target despite draft changes', () => {
  const h = syncDialog(
    {},
    {
      $lastSyncedSettingsSource$: 'Previously selected source',
      $lastSyncedSettingsTarget$: 'Previously selected target'
    }
  );
  h.closeDialog()(true);
  h.closeDialog()(false);
  h.dispose();
  assert.deepEqual(h.received, [[]]);
  assert.equal(h.stores.lastSyncedSettingsSource$.getValue(), 'Previously selected source');
  assert.equal(h.stores.lastSyncedSettingsTarget$.getValue(), 'Previously selected target');
  assert.deepEqual(h.events, [['close']]);
});

test('late storage-source close after unmount cannot settle or dispatch again', () => {
  const h = storageSourceDialog();
  assert.equal(h.stores.isOnline$.observers.length, 1);
  h.dispose();
  h.closeDialog()({ new: { name: 'Too late' } });
  assert.deepEqual(h.received, [undefined]);
  assert.deepEqual(h.events, []);
  assert.equal(h.stores.isOnline$.observers.length, 0);
});
