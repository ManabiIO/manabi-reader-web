/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { combineLatest, distinctUntilChanged, map, Observable, shareReplay } from 'rxjs';
import { writableSubject } from '$lib/functions/svelte/store';
import { initialAppearance, type AppearanceMode, type ColorMode } from '$lib/data/theme-option';

function read(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Session-only when storage is unavailable. */
  }
}
function customThemes() {
  try {
    return JSON.parse(read('customThemes') ?? '{}') ?? {};
  } catch {
    return {};
  }
}
export const appearance$ = writableSubject<AppearanceMode>(
  initialAppearance(read('appearance'), read('theme'), customThemes())
);
if (typeof window !== 'undefined') appearance$.subscribe((value) => write('appearance', value));
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
  let initial: unknown;
  try {
    initial = JSON.parse(read(`manabi.background.${target}`) ?? 'null');
  } catch {
    initial = null;
  }
  const subject = writableSubject(normalizeBackgroundOptions(initial));
  if (typeof window !== 'undefined')
    subject.subscribe((value) =>
      write(`manabi.background.${target}`, JSON.stringify(normalizeBackgroundOptions(value)))
    );
  return subject;
}
export const libraryBackgroundOptions$ = backgroundOptions('library');
export const readerBackgroundOptions$ = backgroundOptions('reader');
