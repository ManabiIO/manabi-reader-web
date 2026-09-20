/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { combineLatest, distinctUntilChanged, map, Observable, shareReplay, skip } from 'rxjs';
import { writableSubject } from '$lib/functions/svelte/store';
import { initialAppearance, parseCustomThemes, type ColorMode } from '$lib/data/theme-option';

// Own only appearance keys. Keep the released names and existing reactive API.
// Reading a value (including a storage event) must never echo it back over a
// newer edit in another tab. Storage events are notifications, not snapshots.
function read(key: string): string | null | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage.getItem(key);
  } catch {
    return undefined;
  }
}
function write(key: string, value: string): boolean {
  try {
    if (window.localStorage.getItem(key) !== value) window.localStorage.setItem(key, value);
    return true;
  } catch {
    /* Session-only when storage is unavailable. */
    return false;
  }
}
let receiving = false;
const reloaders = new Map<string, () => void>();
function setting<T>(key: string, decode: (raw: string | null) => T, encode: (value: T) => string) {
  let stored = read(key);
  const subject = writableSubject(decode(stored ?? null));
  subject.pipe(skip(1)).subscribe((value) => {
    if (!receiving && typeof window !== 'undefined' && write(key, encode(value)))
      stored = encode(value);
  });
  reloaders.set(key, () => {
    const raw = read(key);
    if (raw === undefined || raw === stored) return;
    stored = raw;
    const value = decode(raw);
    if (encode(value) !== encode(subject.getValue())) subject.next(value);
  });
  return subject;
}
export const theme$ = setting(
  'theme',
  (raw) => (!raw || raw === 'system-theme' ? 'manabi-theme' : raw),
  (value) => value
);
export const customThemes$ = setting('customThemes', parseCustomThemes, JSON.stringify);
export const appearance$ = setting(
  'appearance',
  (raw) => initialAppearance(raw, read('theme'), parseCustomThemes(read('customThemes'))),
  (value) => value
);
const systemDark$ = new Observable<boolean>((subscriber) => {
  if (typeof window === 'undefined') {
    subscriber.next(false);
    return;
  }
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const update = () => subscriber.next(media.matches);
  update();
  media.addEventListener('change', update);
  return () => media.removeEventListener('change', update);
});
export const resolvedMode$ = combineLatest([appearance$, systemDark$]).pipe(
  map(([choice, dark]): ColorMode => (choice === 'system' ? (dark ? 'dark' : 'light') : choice)),
  distinctUntilChanged(),
  shareReplay({ bufferSize: 1, refCount: true })
);
export type BackgroundTarget = 'library' | 'reader';
export type BackgroundMode = ColorMode;
export interface BackgroundOptions {
  fade: boolean;
  amount: number;
}
export function normalizeBackgroundOptions(value: unknown): BackgroundOptions {
  const v = value as Partial<BackgroundOptions> | null;
  return {
    fade: typeof v?.fade === 'boolean' ? v.fade : true,
    amount:
      typeof v?.amount === 'number' && Number.isFinite(v.amount)
        ? Math.min(100, Math.max(0, v.amount))
        : 40
  };
}
function backgroundOptions(target: BackgroundTarget) {
  return setting(
    `manabi.background.${target}`,
    (raw) => {
      try {
        return normalizeBackgroundOptions(JSON.parse(raw ?? 'null'));
      } catch {
        return normalizeBackgroundOptions(null);
      }
    },
    (value) => JSON.stringify(normalizeBackgroundOptions(value))
  );
}
export const libraryBackgroundOptions$ = backgroundOptions('library');
export const readerBackgroundOptions$ = backgroundOptions('reader');

export function startAppearanceSync(): () => void {
  const reload = (key?: string | null) => {
    receiving = true;
    try {
      if (key) reloaders.get(key)?.();
      else for (const refresh of reloaders.values()) refresh();
    } finally {
      receiving = false;
    }
  };
  reload();
  // Persist the one-time migration before a different preset is selected.
  if (read('appearance') === null) write('appearance', appearance$.getValue());
  if (read('theme') === 'system-theme') write('theme', theme$.getValue());
  const changed = (event: StorageEvent) => {
    try {
      if (event.storageArea === window.localStorage) reload(event.key);
    } catch {
      /* Browser preferences remain usable in this tab. */
    }
  };
  const focus = () => reload();
  window.addEventListener('storage', changed);
  window.addEventListener('focus', focus);
  return () => {
    window.removeEventListener('storage', changed);
    window.removeEventListener('focus', focus);
  };
}
