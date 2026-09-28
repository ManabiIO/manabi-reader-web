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
function apply(value: Flat, isCurrent: () => boolean, signal: AbortSignal) {
  const pending: (void | Promise<void>)[] = [];
  applying = true;
  try {
    for (const [key, binding] of Object.entries(bindings)) {
      if (!isCurrent() || signal.aborted) break;
      if (Object.hasOwn(value, key)) pending.push(binding.apply(value[key], signal));
    }
  } catch (error) {
    // A synchronous preference setter must not orphan an already-started
    // asynchronous organization write. Observe every enrolled promise.
    pending.push(Promise.reject(error));
  } finally {
    applying = false;
  }
  // Only synchronous publication suppresses feedback. Local edits made while
  // organization storage settles must still enter the next sync pass.
  return Promise.all(pending);
}
let activeUser: string | null = null;
let active: SavedPreferences | null = null;
let writes: Promise<unknown> = Promise.resolve();
let debounce: ReturnType<typeof setTimeout> | undefined;
let retryAt = 0;
let activation = 0;
let applyLifetime = new AbortController();
function advanceActivation() {
  activation += 1;
  applyLifetime.abort();
  applyLifetime = new AbortController();
  return activation;
}
function persist(user: string, state: SavedPreferences) {
  const copy = structuredClone(state);
  writes = writes.catch(() => undefined).then(() => setMetadata(`preferences/${user}`, copy));
  return writes;
}
function unchangedUser(user: string) {
  if (currentUser()?.id !== user || activeUser !== user)
    throw new IntegrationError('account_changed');
}

export async function syncPreferences(choice?: 'local' | 'remote'): Promise<void> {
  const user = currentUser()?.id;
  if (!user || user !== activeUser || !active?.enabled) return;
  const state = active;
  const admitted = activation;
  const signal = applyLifetime.signal;
  const isCurrent = () =>
    active === state && activation === admitted && state.enabled && currentUser()?.id === user;
  await exclusive(`preferences/${user}`, async () => {
    if (!isCurrent()) return;
    unchangedUser(user);
    preferenceStatus.set({ enabled: true, state: 'syncing', conflicts: [] });
    const captured = structuredClone(state.local);
    try {
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
        choice === 'remote' ||
        (!state.initialized && remote.revision > 0 && choice !== 'local')
      ) {
        merged = { ...captured, ...there };
      } else if (choice === 'local' || !state.initialized) {
        merged = { ...there, ...captured };
      } else {
        const combined = mergeRecords(state.base, captured, there);
        if (combined.conflicts.length) {
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
      const newer = mergeRecords(captured, state.local, merged);
      if (newer.conflicts.length) {
        // Preserve the last mutually accepted baseline. Otherwise a retry would
        // treat the conflicting local value as uncontested and overwrite remote.
        preferenceStatus.set({ enabled: true, state: 'conflict', conflicts: newer.conflicts });
        await persist(user, state);
        return;
      }
      // A preference changed locally while the network request was running.
      // Preserve it and let the next pass send it, rather than applying stale UI.
      state.base = merged;
      state.local = newer.merged;
      state.revision = accepted.revision;
      state.initialized = true;
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
      const failure =
        error instanceof IntegrationError ? error : new IntegrationError('unavailable');
      retryAt = Date.now() + Math.max(failure.retryAfter * 1000, 5000);
      preferenceStatus.set({ enabled: true, state: failure.code, conflicts: [] });
      await persist(user, state);
    }
  });
}

export async function enablePreferenceSync(enabled: boolean, choice?: 'local' | 'remote') {
  const user = currentUser()?.id;
  if (!user || user !== activeUser || !active) throw new IntegrationError('sign_in_required');
  advanceActivation();
  active = { ...active, enabled };
  if (enabled) active.local = { ...active.local, ...capture() };
  const state = active;
  await persist(user, state);
  if (active !== state || currentUser()?.id !== user) return;
  preferenceStatus.set({ enabled, state: enabled ? 'pending' : 'off', conflicts: [] });
  if (enabled) await syncPreferences(state.initialized ? undefined : choice);
}

/** Report optional sync/storage failure without discarding local settings or consent. */
function reportPreferenceFailure(error: unknown, enabled: boolean) {
  const failure = error instanceof IntegrationError ? error : new IntegrationError('unavailable');
  retryAt = Date.now() + Math.max(failure.retryAfter * 1000, 5000);
  preferenceStatus.set({ enabled, state: failure.code, conflicts: [] });
}

function startPreferenceSyncReady() {
  let stopped = false;
  let loadingActivation: number | undefined;
  async function switchUser() {
    if (stopped) return;
    const user = localProfileUser()?.id ?? null;
    if (user === activeUser && (active || loadingActivation === activation)) return;
    const admitted = advanceActivation();
    const signal = applyLifetime.signal;
    activeUser = user;
    active = null;
    loadingActivation = admitted;
    clearTimeout(debounce);
    preferenceStatus.set({ enabled: false, state: 'off', conflicts: [] });
    const isCurrent = () => !stopped && activation === admitted && user === activeUser;
    try {
      if (!user) return;
      await writes.catch(() => undefined);
      if (!isCurrent()) return;
      const saved = await metadata<SavedPreferences>(`preferences/${user}`);
      // Identity alone is insufficient: a delayed A load must not survive A→B→A.
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
        await apply(active.local, isCurrent, signal);
        if (!isCurrent()) return;
        await syncPreferences();
      }
    } catch (error) {
      if (isCurrent()) reportPreferenceFailure(error, active?.enabled ?? false);
    } finally {
      if (loadingActivation === admitted) loadingActivation = undefined;
    }
  }
  const accountSubscription = localUser.subscribe(() => {
    void switchUser();
  });
  const refresh = async () => {
    if (stopped || document.visibilityState !== 'visible' || Date.now() < retryAt) return;
    // Retry a failed local profile read even offline. This cannot enable sync:
    // the persisted consent still has to load successfully first.
    const previous = active;
    await switchUser();
    // A newly loaded profile already performed its initial sync in switchUser.
    if (active !== previous) return;
    if (
      stopped ||
      Date.now() < retryAt ||
      get(preferenceStatus).state === 'conflict' ||
      get(account).status !== 'available'
    )
      return;
    const state = active;
    const admitted = activation;
    try {
      await syncPreferences();
    } catch (error) {
      // Lock acquisition and a failed recovery write can reject outside the
      // transport's catch. Observe them without publishing into a later scope.
      if (!stopped && activation === admitted && active === state)
        reportPreferenceFailure(error, state?.enabled ?? false);
    }
  };
  const tick = () => void refresh();
  const subscriptions = Object.values(bindings).map((binding) => {
    let initial = true;
    return binding.source.subscribe(() => {
      if (initial) {
        initial = false;
        return;
      }
      if (stopped || applying || !activeUser || !active?.enabled) return;
      const state = active;
      const admitted = activation;
      state.local = { ...state.local, ...capture() };
      const pending = persist(activeUser, state);
      void pending.catch((error) => {
        if (!stopped && activation === admitted && active === state && writes === pending)
          reportPreferenceFailure(error, state.enabled);
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
