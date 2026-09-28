/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { get, writable } from 'svelte/store';
import * as reader from '$lib/data/store';
import { appearance$ } from '$lib/appearance/state';
import { availableThemes, portableThemeName } from '$lib/data/theme-option';
import {
  account,
  currentUser,
  localProfileUser,
  localUser,
  IntegrationError,
  request
} from './client';
import { equal, exclusive, mergeRecords, metadata, setMetadata } from './persistence';
import {
  organizationPreference,
  reloadOrganization,
  watchOrganization
} from '$lib/library/organization';
import { parsePreferenceReply } from './auth-contract';

type Flat = Record<string, unknown>;
interface SavedPreferences {
  enabled: boolean;
  initialized: boolean;
  base: Flat;
  local: Flat;
  revision: number;
  /** First-sync intent stays local and survives transient failures/reopening. */
  initialChoice?: 'local' | 'remote';
}
export const preferenceStatus = writable<{ enabled: boolean; state: string; conflicts: string[] }>({
  enabled: false,
  state: 'off',
  conflicts: []
});

const booleanKeys = [
  'hideSpoilerImage',
  'enableVerticalFontKerning',
  'enableFontVPAL',
  'prioritizeReaderStyles',
  'enableTextJustification',
  'enableTextWrapPretty',
  'showCharacterCounter',
  'showPercentage',
  'showFooterChapterCharacterCounter',
  'showFooterChapterPercentage',
  'disableWheelNavigation',
  'autoPositionOnResize',
  'avoidPageBreak',
  'pauseTrackerOnCustomPointChange',
  'customReadingPointEnabled',
  'selectionToBookmarkEnabled',
  'enableTapEdgeToFlip',
  'confirmClose',
  'manualBookmark',
  'autoBookmark',
  'statisticsEnabled',
  'openTrackerOnCompletion',
  'addCharactersOnCompletion',
  'trackerPopupDetection',
  'adjustStatisticsAfterIdleTime'
] as const;
const numberRanges: Record<string, [number, number]> = {
  textIndentation: [0, 20],
  textMarginValue: [0, 200],
  secondDimensionMaxValue: [0, 10000],
  firstDimensionMargin: [0, 1000],
  swipeThreshold: [0, 500],
  autoBookmarkTime: [1, 3600],
  pageColumns: [0, 20],
  startDayHoursForTracker: [0, 23],
  trackerAutostartTime: [0, 86400],
  trackerIdleTime: [0, 86400],
  trackerForwardSkipThreshold: [0, 1000000],
  trackerBackwardSkipThreshold: [0, 1000000],
  verticalCustomReadingPosition: [0, 100],
  horizontalCustomReadingPosition: [0, 100]
};
interface Subject {
  getValue(): unknown;
  next(value: any): void;
  subscribe(fn: () => void): { unsubscribe(): void };
}
function subject(name: string): Subject {
  const value =
    name === 'appearance'
      ? appearance$
      : (reader as unknown as Record<string, Subject>)[`${name}$`];
  if (!value || typeof value.getValue !== 'function')
    throw new Error(`Unknown Reader preference ${name}`);
  return value;
}
interface Binding {
  read(): unknown;
  apply(value: unknown, signal?: AbortSignal): void | Promise<void>;
  source: Subject;
}
const bindings: Record<string, Binding> = {};
function bind(
  key: string,
  name: string,
  valid: (value: unknown) => boolean,
  encode: (value: any) => unknown = (v) => v,
  decode: (value: any) => unknown = (v) => v
) {
  const source = subject(name);
  bindings[key] = {
    source,
    read: () => encode(source.getValue()),
    apply(value) {
      if (valid(value)) source.next(decode(value));
    }
  };
}
bindings.library_organization = {
  source: organizationPreference,
  read: () => structuredClone(organizationPreference.getValue()),
  apply(value, signal) {
    return organizationPreference.next(value, signal);
  }
};
bind('theme', 'appearance', (v) => ['light', 'dark', 'system'].includes(v as string));
bind(
  'font_family',
  'fontFamilyGroupOne',
  (v) => typeof v === 'string' && v.length > 0 && v.length <= 128
);
bind(
  'font_size',
  'fontSize',
  (v) => typeof v === 'number' && Number.isFinite(v) && v >= 8 && v <= 96
);
bind(
  'line_height',
  'lineHeight',
  (v) => typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 3
);
bind(
  'writing_mode',
  'writingMode',
  (v) => v === 'horizontal' || v === 'vertical',
  (v) => (v === 'vertical-rl' ? 'vertical' : 'horizontal'),
  (v) => (v === 'vertical' ? 'vertical-rl' : 'horizontal-tb')
);
bind(
  'furigana',
  'hideFurigana',
  (v) => typeof v === 'boolean',
  (v) => !v,
  (v) => !v
);
// The account transports built-in identities, not custom definitions. A local
// custom palette stays local instead of being replaced by an unrelated remote ID.
const themeSource = subject('theme');
bindings['reader.themeName'] = {
  source: themeSource,
  read: () => portableThemeName(themeSource.getValue()),
  apply(value) {
    const id = portableThemeName(value);
    const current = themeSource.getValue();
    const custom =
      typeof current === 'string' &&
      !availableThemes.has(current) &&
      Object.hasOwn(reader.customThemes$.getValue(), current);
    if (id && !custom) themeSource.next(id);
  }
};
bind(
  'reader.fontFamilyGroupTwo',
  'fontFamilyGroupTwo',
  (v) => typeof v === 'string' && v.length > 0 && v.length <= 128
);
bind(
  'reader.fontWeight',
  'fontWeight',
  (v) => v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 100 && v <= 1000)
);
bind('reader.viewMode', 'viewMode', (v) => v === 'continuous' || v === 'paginated');
for (const key of booleanKeys) bind(`reader.${key}`, key, (v) => typeof v === 'boolean');
for (const [key, [min, max]] of Object.entries(numberRanges)) {
  bind(
    `reader.${key}`,
    key,
    (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
  );
}

function capture(): Flat {
  return Object.fromEntries(
    Object.entries(bindings)
      .map(([key, value]) => [key, value.read()])
      .filter(([, value]) => value !== undefined)
  );
}
function flatten(value: Record<string, unknown>): Flat {
  const result: Flat = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (key === 'reader' && item && typeof item === 'object' && !Array.isArray(item)) {
      for (const [name, v] of Object.entries(item)) {
        if (name !== 'themeName') result[`reader.${name}`] = v;
        else {
          const id = portableThemeName(v);
          if (id) result['reader.themeName'] = id;
        }
      }
    } else result[key] = item;
  }
  return result;
}
function expand(value: Flat): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null),
    extras: Record<string, unknown> = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (key.startsWith('reader.')) extras[key.slice(7)] = item;
    else result[key] = item;
  }
  if (Object.keys(extras).length) result.reader = extras;
  return result;
}
let applying = false;
async function apply(value: Flat, isCurrent: () => boolean, signal: AbortSignal) {
  // One failed binding revokes this attempt, not the entire profile activation.
  // In particular a synchronous scalar failure must not leave an organization
  // write running after the application has already reported failure.
  const attempt = new AbortController();
  const revoke = () => attempt.abort(signal.reason);
  signal.addEventListener('abort', revoke, { once: true });
  if (signal.aborted) revoke();
  const pending: Promise<unknown>[] = [];
  let failed = false;
  let failure: unknown;
  const reject = (error: unknown) => {
    if (!failed) {
      failed = true;
      failure = error;
    }
    attempt.abort(error);
  };
  applying = true;
  try {
    for (const [key, binding] of Object.entries(bindings)) {
      if (!isCurrent() || attempt.signal.aborted) break;
      if (Object.hasOwn(value, key))
        pending.push(Promise.resolve(binding.apply(value[key], attempt.signal)).catch(reject));
    }
  } catch (error) {
    reject(error);
  } finally {
    // Do not suppress user edits while asynchronous storage work settles.
    applying = false;
  }
  try {
    // Each enrolled promise handles failure above; all work must drain before
    // retry or reporting, including transactions aborted by another binding.
    await Promise.all(pending);
    if (failed) throw failure;
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener('abort', revoke);
  }
}
let activeUser: string | null = null;
let active: SavedPreferences | null = null;
let writes: Promise<unknown> = Promise.resolve();
let debounce: ReturnType<typeof setTimeout> | undefined;
const syncRetryAt = new Map<string, number>();
const storageRetryAt = new Map<string, number>();
function retryAt(retries: Map<string, number>, user: string | null | undefined) {
  return user ? (retries.get(user) ?? 0) : 0;
}
function clearRetry(retries: Map<string, number>, user: string) {
  retries.delete(user);
}
let activation = 0;
let applyLifetime = new AbortController();
function advanceActivation() {
  activation += 1;
  applyLifetime.abort();
  applyLifetime = new AbortController();
  return activation;
}
interface PendingPreferenceSave {
  value: SavedPreferences;
  pending?: Promise<void>;
}
// Only uncommitted snapshots are retained. A later edit replaces the older
// snapshot for that profile; recovery must not restore or replay obsolete edits.
const unsavedPreferences = new Map<string, PendingPreferenceSave>();
function writePreferenceSnapshot(user: string, save: PendingPreferenceSave): Promise<void> {
  if (save.pending) return save.pending;
  const pending = writes
    .catch(() => undefined)
    .then(async () => {
      if (unsavedPreferences.get(user) !== save) return;
      await setMetadata(`preferences/${user}`, save.value);
      if (unsavedPreferences.get(user) === save) unsavedPreferences.delete(user);
    })
    .finally(() => {
      if (save.pending === pending) save.pending = undefined;
    });
  save.pending = pending;
  writes = pending;
  return pending;
}
function persist(user: string, state: SavedPreferences) {
  const save = { value: structuredClone(state) };
  unsavedPreferences.set(user, save);
  return writePreferenceSnapshot(user, save);
}
function unchangedUser(user: string) {
  if (currentUser()?.id !== user || activeUser !== user)
    throw new IntegrationError('account_changed');
}

interface PreferenceSyncFlight {
  state: SavedPreferences;
  activation: number;
  choice: 'local' | 'remote' | undefined;
  promise: Promise<void>;
}
let preferenceSyncFlight: PreferenceSyncFlight | undefined;

export function syncPreferences(choice?: 'local' | 'remote'): Promise<void> {
  const user = currentUser()?.id;
  if (!user || user !== activeUser || !active?.enabled) return Promise.resolve();
  const state = active;
  const admitted = activation;
  const signal = applyLifetime.signal;
  const flight = preferenceSyncFlight;
  if (
    flight?.state === state &&
    flight.activation === admitted &&
    (choice === undefined || choice === flight.choice)
  )
    return flight.promise;
  // Coalesce before requesting a lock: queued recovery notifications must not
  // become a train of HTTP attempts that ignores the first failure's backoff.
  // An explicit, different conflict choice still gets its own serialized pass.
  const promise = Promise.resolve()
    .then(() => performPreferenceSync(user, state, admitted, signal, choice))
    .finally(() => {
      if (preferenceSyncFlight?.promise === promise) preferenceSyncFlight = undefined;
    });
  preferenceSyncFlight = { state, activation: admitted, choice, promise };
  return promise;
}

async function performPreferenceSync(
  user: string,
  state: SavedPreferences,
  admitted: number,
  signal: AbortSignal,
  choice?: 'local' | 'remote'
): Promise<void> {
  const isCurrent = () =>
    active === state && activation === admitted && state.enabled && currentUser()?.id === user;
  await exclusive(`preferences/${user}`, async () => {
    if (!isCurrent()) return;
    unchangedUser(user);
    preferenceStatus.set({ enabled: true, state: 'syncing', conflicts: [] });
    const captured = structuredClone(state.local);
    let failureKind: 'sync' | 'storage' = 'sync';
    try {
      // The first-sync decision is user intent, not a one-request hint. A lost
      // GET/PUT reply must not change "use this device" into "use the server"
      // on recovery. Persist explicit intent before issuing any HTTP request.
      if (!state.initialized && choice && state.initialChoice !== choice) {
        state.initialChoice = choice;
        failureKind = 'storage';
        await persist(user, state);
        if (!isCurrent()) return;
        failureKind = 'sync';
      }
      let resolution = choice;
      if (
        !state.initialized &&
        resolution === undefined &&
        (state.initialChoice === 'local' || state.initialChoice === 'remote')
      )
        resolution = state.initialChoice;
      const remote = parsePreferenceReply(
        await request<unknown>('preferences/', { userId: user }),
        user
      );
      if (!isCurrent()) return;
      unchangedUser(user);
      if (!remote) throw new IntegrationError('invalid_response');
      const there = flatten(remote.settings);
      let merged: Flat;
      if (
        resolution === 'remote' ||
        (!state.initialized && remote.revision > 0 && resolution !== 'local')
      ) {
        merged = { ...captured, ...there };
      } else if (resolution === 'local' || !state.initialized) {
        merged = { ...there, ...captured };
      } else {
        const combined = mergeRecords(state.base, captured, there);
        if (combined.conflicts.length) {
          clearRetry(syncRetryAt, user);
          preferenceStatus.set({ enabled: true, state: 'conflict', conflicts: combined.conflicts });
          return;
        }
        merged = combined.merged;
      }
      let accepted = remote;
      if (!equal(merged, there)) {
        const response = parsePreferenceReply(
          await request<unknown>('preferences/', {
            method: 'PUT',
            value: { settings: expand(merged) },
            revision: `"${remote.revision}"`,
            userId: user
          }),
          user
        );
        if (!isCurrent()) return;
        unchangedUser(user);
        if (
          !response ||
          response.revision !== remote.revision + 1 ||
          !equal(flatten(response.settings), merged)
        )
          throw new IntegrationError('invalid_response');
        accepted = response;
      }
      // The server path has completed successfully. Local application/storage
      // failures below must not preserve an older Retry-After or be mistaken
      // for a reason to contact the server early.
      clearRetry(syncRetryAt, user);
      const newer = mergeRecords(captured, state.local, merged);
      if (newer.conflicts.length) {
        // Preserve the last mutually accepted baseline. Otherwise a retry would
        // treat the conflicting local value as uncontested and overwrite remote.
        preferenceStatus.set({ enabled: true, state: 'conflict', conflicts: newer.conflicts });
        failureKind = 'storage';
        await persist(user, state);
        return;
      }
      // A preference changed locally while the network request was running.
      // Preserve it and let the next pass send it, rather than applying stale UI.
      state.base = merged;
      state.local = newer.merged;
      state.revision = accepted.revision;
      state.initialized = true;
      delete state.initialChoice;
      failureKind = 'storage';
      await apply(state.local, isCurrent, signal);
      if (!isCurrent()) return;
      await persist(user, state);
      if (!isCurrent()) return;
      unchangedUser(user);
      preferenceStatus.set({
        enabled: true,
        state: equal(state.local, state.base) ? 'synced' : 'pending',
        conflicts: []
      });
    } catch (error) {
      if (!isCurrent()) return;
      if (failureKind === 'sync') reportSyncFailure(user, error, true);
      else reportStorageFailure(user, error, true);
      try {
        await persist(user, state);
      } catch (saveError) {
        if (isCurrent()) reportStorageFailure(user, saveError, true);
        throw saveError;
      }
    }
  });
}

export async function enablePreferenceSync(enabled: boolean, choice?: 'local' | 'remote') {
  const user = currentUser()?.id;
  if (!user || user !== activeUser || !active) throw new IntegrationError('sign_in_required');
  advanceActivation();
  active = {
    ...active,
    enabled,
    initialChoice: enabled && !active.initialized ? (choice ?? active.initialChoice) : undefined
  };
  if (enabled) active.local = { ...active.local, ...capture() };
  const state = active;
  try {
    await persist(user, state);
  } catch (error) {
    if (active === state && currentUser()?.id === user)
      reportStorageFailure(user, error, state.enabled);
    throw error;
  }
  if (active !== state || currentUser()?.id !== user) return;
  preferenceStatus.set({ enabled, state: enabled ? 'pending' : 'off', conflicts: [] });
  if (enabled) await syncPreferences(state.initialized ? undefined : choice);
}

function preferenceFailure(error: unknown) {
  return error instanceof IntegrationError ? error : new IntegrationError('unavailable');
}
/** Report a cloud-sync failure and retain only its profile's server backoff. */
function reportSyncFailure(user: string, error: unknown, enabled: boolean) {
  const failure = preferenceFailure(error);
  syncRetryAt.set(user, Date.now() + Math.max(failure.retryAfter * 1000, 5000));
  preferenceStatus.set({ enabled, state: failure.code, conflicts: [] });
}
/** Local durability/recovery is independent of server Retry-After policy. */
function reportStorageFailure(user: string, error: unknown, enabled: boolean) {
  const failure = preferenceFailure(error);
  storageRetryAt.set(user, Date.now() + 5000);
  preferenceStatus.set({ enabled, state: failure.code, conflicts: [] });
}
function reportPreferenceFailure(error: unknown, enabled: boolean) {
  const failure = preferenceFailure(error);
  preferenceStatus.set({ enabled, state: failure.code, conflicts: [] });
}

function startPreferenceSyncReady() {
  let stopped = false;
  let loadingActivation: number | undefined;
  let restoration:
    | { state: SavedPreferences; activation: number; signal: AbortSignal; pending?: Promise<void> }
    | undefined;
  function restoreProfile(value: NonNullable<typeof restoration>): Promise<void> {
    if (value.pending) return value.pending;
    const isCurrent = () => !stopped && active === value.state && activation === value.activation;
    const pending = (async () => {
      try {
        await apply(value.state.local, isCurrent, value.signal);
      } catch (error) {
        if (isCurrent() && activeUser) reportStorageFailure(activeUser, error, value.state.enabled);
        return;
      }
      if (!isCurrent()) return;
      if (restoration === value) restoration = undefined;
      preferenceStatus.set({ enabled: value.state.enabled, state: 'pending', conflicts: [] });
      try {
        await syncPreferences();
      } catch (error) {
        if (isCurrent() && activeUser) reportSyncFailure(activeUser, error, value.state.enabled);
      }
    })().finally(() => {
      if (value.pending === pending) value.pending = undefined;
    });
    value.pending = pending;
    return pending;
  }
  async function switchUser() {
    if (stopped) return;
    const user = localProfileUser()?.id ?? null;
    if (restoration && (restoration.state !== active || restoration.activation !== activation))
      restoration = undefined;
    if (user === activeUser && active) {
      if (
        restoration?.state === active &&
        restoration.activation === activation &&
        Date.now() >= retryAt(storageRetryAt, user)
      )
        await restoreProfile(restoration);
      return;
    }
    if (user === activeUser && loadingActivation === activation) return;
    const admitted = advanceActivation();
    const signal = applyLifetime.signal;
    activeUser = user;
    active = null;
    restoration = undefined;
    loadingActivation = admitted;
    clearTimeout(debounce);
    preferenceStatus.set({ enabled: false, state: 'off', conflicts: [] });
    const isCurrent = () => !stopped && activation === admitted && user === activeUser;
    try {
      if (!user) return;
      await writes.catch(() => undefined);
      if (!isCurrent()) return;
      // A failed local save still owns the latest user intent, notably an
      // unsaved disable-consent choice. Never replace it with stale disk data.
      const retained = unsavedPreferences.get(user);
      const saved = retained
        ? structuredClone(retained.value)
        : await metadata<SavedPreferences>(`preferences/${user}`);
      if (!isCurrent()) return;
      active = saved
        ? { ...saved, local: flatten(expand(saved.local)), base: flatten(expand(saved.base)) }
        : {
            enabled: false,
            initialized: false,
            local: capture(),
            base: {},
            revision: 0
          };
      preferenceStatus.set({
        enabled: active.enabled,
        state: active.enabled ? 'pending' : 'off',
        conflicts: []
      });
      if (active.enabled) {
        restoration = { state: active, activation: admitted, signal };
        await restoreProfile(restoration);
      }
    } catch (error) {
      if (isCurrent() && user) reportStorageFailure(user, error, active?.enabled ?? false);
    } finally {
      if (loadingActivation === admitted) loadingActivation = undefined;
    }
  }
  const accountSubscription = localUser.subscribe(() => {
    void switchUser();
  });
  const refresh = async () => {
    if (stopped || document.visibilityState !== 'visible') return;
    const previous = active;
    const previousRestoration =
      restoration?.state === active && restoration?.activation === activation
        ? restoration
        : undefined;
    await switchUser();
    // New/retried restoration owns its application and first sync attempt.
    if (active !== previous || restoration || previousRestoration) return;
    if (stopped) return;
    const state = active;
    const user = activeUser;
    const admitted = activation;
    const isCurrent = () =>
      !stopped && activation === admitted && active === state && activeUser === user;
    const save = user && unsavedPreferences.get(user);
    if (user && save && Date.now() >= retryAt(storageRetryAt, user)) {
      try {
        // Local durability must recover independently of server backoff or
        // whether cloud sync is enabled.
        await writePreferenceSnapshot(user, save);
        if (!isCurrent()) return;
        if (!unsavedPreferences.has(user) && get(preferenceStatus).state === 'unavailable')
          preferenceStatus.set({
            enabled: state?.enabled ?? false,
            state: state?.enabled ? 'pending' : 'off',
            conflicts: []
          });
      } catch (error) {
        if (isCurrent() && unsavedPreferences.get(user) === save)
          reportStorageFailure(user, error, state?.enabled ?? false);
        return;
      }
    }
    if (
      !isCurrent() ||
      !user ||
      Date.now() < retryAt(syncRetryAt, user) ||
      get(preferenceStatus).state === 'conflict' ||
      get(account).status !== 'available'
    )
      return;
    try {
      await syncPreferences();
    } catch (error) {
      if (isCurrent()) reportSyncFailure(user, error, state?.enabled ?? false);
    }
  };
  const tick = () => void refresh();
  const subscriptions = Object.entries(bindings).map(([key, binding]) => {
    let initial = true;
    return binding.source.subscribe(() => {
      if (initial) {
        initial = false;
        return;
      }
      if (stopped || applying || !activeUser || !active?.enabled) return;
      const state = active;
      const user = activeUser;
      const admitted = activation;
      // Capture only the binding that changed. Capturing the entire UI here
      // could replace a pending saved organization with the old visible one
      // merely because the user adjusted font size during restoration.
      const value = binding.read();
      if (value === undefined) return;
      state.local = { ...state.local, [key]: value };
      const pending = persist(user, state);
      void pending.catch((error) => {
        if (!stopped && activation === admitted && active === state && writes === pending)
          reportStorageFailure(user, error, state.enabled);
      });
      preferenceStatus.set({ enabled: true, state: 'pending', conflicts: [] });
      clearTimeout(debounce);
      debounce = setTimeout(tick, 1500);
    });
  });
  const timer = setInterval(tick, 30000);
  window.addEventListener('online', tick);
  document.addEventListener('visibilitychange', tick);
  return () => {
    if (stopped) return;
    stopped = true;
    advanceActivation();
    clearInterval(timer);
    clearTimeout(debounce);
    accountSubscription();
    subscriptions.forEach((sub) => sub.unsubscribe());
    window.removeEventListener('online', tick);
    document.removeEventListener('visibilitychange', tick);
    active = null;
    activeUser = null;
  };
}

export function startPreferenceSync() {
  let stopped = false;
  let pending = false;
  let ready = false;
  let retryBootstrapAt = 0;
  let stop: () => void = () => undefined;
  let stopWatching: () => void = () => undefined;
  const bootstrap = async () => {
    if (
      stopped ||
      ready ||
      pending ||
      document.visibilityState !== 'visible' ||
      Date.now() < retryBootstrapAt
    )
      return;
    pending = true;
    try {
      // Organization must be loaded before capturing it for account sync. A
      // transient read failure is not an empty library to upload to the server.
      await reloadOrganization();
      if (stopped) return;
      stopWatching = watchOrganization((error) => {
        if (!stopped) reportPreferenceFailure(error, get(preferenceStatus).enabled);
      });
      stop = startPreferenceSyncReady();
      ready = true;
      stopBootstrap();
    } catch (error) {
      stopWatching();
      stopWatching = () => undefined;
      if (!stopped) {
        retryBootstrapAt = Date.now() + 5000;
        reportPreferenceFailure(error, false);
      }
    } finally {
      pending = false;
    }
  };
  const tick = () => void bootstrap();
  const timer = setInterval(tick, 30000);
  function stopBootstrap() {
    clearInterval(timer);
    window.removeEventListener('online', tick);
    document.removeEventListener('visibilitychange', tick);
  }
  window.addEventListener('online', tick);
  document.addEventListener('visibilitychange', tick);
  void bootstrap();
  return () => {
    if (stopped) return;
    stopped = true;
    stopBootstrap();
    stopWatching();
    stop();
  };
}
