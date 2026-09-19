/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { get, writable } from 'svelte/store';
import * as reader from '$lib/data/store';
import { appearance$ } from '$lib/appearance/state';
import { account, currentUser, IntegrationError, request } from './client';
import { equal, exclusive, mergeRecords, metadata, setMetadata } from './persistence';

type Flat = Record<string, unknown>;
interface SavedPreferences {
  enabled: boolean;
  initialized: boolean;
  base: Flat;
  local: Flat;
  revision: number;
}
interface PreferenceReply {
  user_id: string;
  schema_version: number;
  revision: number;
  settings: Record<string, unknown>;
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
  apply(value: unknown): void;
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
bind('reader.themeName', 'theme', (v) => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v));
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
  return Object.fromEntries(Object.entries(bindings).map(([key, value]) => [key, value.read()]));
}
function flatten(value: Record<string, unknown>): Flat {
  const result: Flat = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (key === 'reader' && item && typeof item === 'object' && !Array.isArray(item)) {
      for (const [name, v] of Object.entries(item)) result[`reader.${name}`] = v;
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
function apply(value: Flat) {
  applying = true;
  try {
    for (const [key, binding] of Object.entries(bindings))
      if (Object.hasOwn(value, key)) binding.apply(value[key]);
  } finally {
    applying = false;
  }
}
let activeUser: string | null = null;
let active: SavedPreferences | null = null;
let writes: Promise<unknown> = Promise.resolve();
let debounce: ReturnType<typeof setTimeout> | undefined;
let retryAt = 0;
let activation = 0;
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
  const isCurrent = () =>
    active === state && activation === admitted && state.enabled && currentUser()?.id === user;
  await exclusive(`preferences/${user}`, async () => {
    if (!isCurrent()) return;
    unchangedUser(user);
    preferenceStatus.set({ enabled: true, state: 'syncing', conflicts: [] });
    const captured = structuredClone(state.local);
    try {
      const remote = await request<PreferenceReply>('preferences/', { userId: user });
      if (!isCurrent()) return;
      unchangedUser(user);
      if (
        remote.user_id !== user ||
        remote.schema_version !== 1 ||
        !Number.isSafeInteger(remote.revision) ||
        remote.revision < 0 ||
        !remote.settings ||
        typeof remote.settings !== 'object' ||
        Array.isArray(remote.settings)
      ) {
        throw new IntegrationError('invalid_response');
      }
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
        accepted = await request<PreferenceReply>('preferences/', {
          method: 'PUT',
          value: { settings: expand(merged) },
          revision: `"${remote.revision}"`,
          userId: user
        });
        if (!isCurrent()) return;
        unchangedUser(user);
        if (accepted.user_id !== user || !Number.isSafeInteger(accepted.revision))
          throw new IntegrationError('invalid_response');
      }
      const newer = mergeRecords(captured, state.local, merged);
      // A preference changed locally while the network request was running.
      // Preserve it and let the next pass send it, rather than applying stale UI.
      state.base = merged;
      state.local = newer.merged;
      state.revision = accepted.revision;
      state.initialized = true;
      apply(state.local);
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
  activation += 1;
  active = { ...active, enabled };
  if (enabled) active.local = { ...active.local, ...capture() };
  const state = active;
  await persist(user, state);
  if (active !== state || currentUser()?.id !== user) return;
  preferenceStatus.set({ enabled, state: enabled ? 'pending' : 'off', conflicts: [] });
  if (enabled) await syncPreferences(state.initialized ? undefined : choice);
}

export function startPreferenceSync() {
  let stopped = false;
  async function switchUser() {
    const user = currentUser()?.id ?? null;
    if (user === activeUser) return;
    activation += 1;
    activeUser = user;
    active = null;
    clearTimeout(debounce);
    preferenceStatus.set({ enabled: false, state: 'off', conflicts: [] });
    if (!user) return;
    await writes.catch(() => undefined);
    const saved = await metadata<SavedPreferences>(`preferences/${user}`);
    if (stopped || user !== activeUser) return;
    active = saved ?? {
      enabled: false,
      initialized: false,
      local: capture(),
      base: {},
      revision: 0
    };
    if (active.enabled) {
      apply(active.local);
      await syncPreferences();
    }
  }
  const accountSubscription = account.subscribe(() => {
    void switchUser().catch(() => undefined);
  });
  const subscriptions = Object.values(bindings).map((binding) => {
    let initial = true;
    return binding.source.subscribe(() => {
      if (initial) {
        initial = false;
        return;
      }
      if (applying || !activeUser || !active?.enabled) return;
      active.local = { ...active.local, ...capture() };
      void persist(activeUser, active);
      preferenceStatus.set({ enabled: true, state: 'pending', conflicts: [] });
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        void syncPreferences();
      }, 1500);
    });
  });
  const tick = () => {
    if (
      Date.now() >= retryAt &&
      get(preferenceStatus).state !== 'conflict' &&
      get(account).status === 'available' &&
      document.visibilityState === 'visible'
    )
      void syncPreferences();
  };
  const timer = setInterval(tick, 30000);
  window.addEventListener('online', tick);
  return () => {
    stopped = true;
    activation += 1;
    clearInterval(timer);
    clearTimeout(debounce);
    accountSubscription();
    subscriptions.forEach((sub) => sub.unsubscribe());
    window.removeEventListener('online', tick);
    active = null;
    activeUser = null;
  };
}
