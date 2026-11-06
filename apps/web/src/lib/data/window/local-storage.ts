/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { editionStorage } from '../../../runtime/edition-storage';

class WindowStorage {
  private readonly store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  key(index: number) {
    return [...this.store.keys()][index] ?? null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
  getItem(key: string) {
    return this.store.get(key) ?? null;
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
}

export const localStorage = editionStorage(
  typeof window === 'undefined' ? new WindowStorage() : window.localStorage
);
