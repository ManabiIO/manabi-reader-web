import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReadingGoalFrequency } from '../../apps/web/src/lib/components/book-reader/book-reading-tracker/book-reading-tracker.ts';
import {
  InternalStorageSources,
  StorageKey
} from '../../apps/web/src/lib/data/storage/storage-types.ts';
import { settingsScript } from './fixtures/settings-script.mjs';

const emptyGoal = {
  timeGoal: 0,
  characterGoal: 0,
  goalFrequency: ReadingGoalFrequency.DAILY,
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
      { id: InternalStorageSources.INTERNAL_BROWSER, label: 'Browser DB', type: StorageKey.BROWSER },
      { id: InternalStorageSources.INTERNAL_ZIP, label: 'ZIP File', type: StorageKey.BACKUP }
    ]
  ]);
  assert.deepEqual(h.events, [['close']]);
});

test('destroying an unresolved reading-goal merge returns the existing no-op cancellation result', () => {
  const h = mergeDialog();
  h.dispose();
  h.dispose();
  assert.deepEqual(h.received, [
    { readingGoalsToDelete: [], readingGoalsToInsert: [], error: '' }
  ]);
  assert.deepEqual(h.events, []);
});

test('reading-goal cancellation can settle only once', async () => {
  const h = mergeDialog();
  await h.closeDialog()(true);
  await h.closeDialog()(true);
  h.dispose();
  assert.deepEqual(h.received, [
    { readingGoalsToDelete: [], readingGoalsToInsert: [], error: '' }
  ]);
  assert.deepEqual(h.events, [['close']]);
});

test('competing reading-goal confirmations cannot both publish', async () => {
  const h = mergeDialog();
  await Promise.all([h.closeDialog()(false), h.closeDialog()(false)]);
  h.dispose();
  assert.deepEqual(h.received, [
    { readingGoalsToDelete: [], readingGoalsToInsert: [], error: '' }
  ]);
  assert.deepEqual(h.events, [['close']]);
});
