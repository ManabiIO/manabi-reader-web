/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { Readable } from 'svelte/store';
export const SETTINGS_FILTER = Symbol('settings-filter');
export const SETTINGS_FIELD = Symbol('settings-field');
export type SettingsFilter = { category: string; query: string };
export type SettingsFilterStore = Readable<SettingsFilter>;
export function matchesSetting(filter: SettingsFilter, category: string, text: string): boolean {
  const words = filter.query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  // Search is global, not constrained to the previously selected section.
  if (!words.length && filter.category !== 'all' && filter.category !== category) return false;
  const normalized = text.toLocaleLowerCase();
  return words.every((word) => normalized.includes(word));
}
