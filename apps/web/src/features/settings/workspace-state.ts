/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { settingCategories } from './categories';
export interface SettingsWorkspaceFilter {
  category: string;
  query: string;
}
/** A visit-local filter owner shared by both Settings presentations. It never writes preferences. */
export function createSettingsWorkspaceState(initialCategory = 'appearance') {
  const category = (value: string) =>
    settingCategories.some((item) => item.id === value) ? value : 'appearance';
  let state: SettingsWorkspaceFilter = { category: category(initialCategory), query: '' };
  const listeners = new Set<() => void>();
  const getSnapshot = () => state;
  const set = (next: SettingsWorkspaceFilter) => {
    const normalized = { category: category(next.category), query: next.query };
    if (normalized.category === state.category && normalized.query === state.query) return;
    state = normalized;
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set,
    update(change: (value: SettingsWorkspaceFilter) => SettingsWorkspaceFilter) {
      set(change(state));
    },
    search(query: string) {
      set({ ...state, query });
    },
    choose(nextCategory: string) {
      set({ category: nextCategory, query: '' });
    }
  };
}
