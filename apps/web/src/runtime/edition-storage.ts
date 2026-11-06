/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { logicalStorageKey, storageName, storageNamespace } from './edition';

export interface KeyValueStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Logical-key adapter: enumeration/clear cannot cross into another app or old development data. */
export function editionStorage(storage: KeyValueStorage, namespace = storageNamespace): Storage {
  const keys = () => {
    const values: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key !== null) {
        const logical = logicalStorageKey(key, namespace);
        if (logical !== null) values.push(logical);
      }
    }
    return values;
  };
  return {
    get length() {
      return keys().length;
    },
    key(index) {
      return keys()[index] ?? null;
    },
    getItem(key) {
      return storage.getItem(storageName(key, namespace));
    },
    setItem(key, value) {
      storage.setItem(storageName(key, namespace), value);
    },
    removeItem(key) {
      storage.removeItem(storageName(key, namespace));
    },
    clear() {
      for (const key of keys()) storage.removeItem(storageName(key, namespace));
    }
  };
}
