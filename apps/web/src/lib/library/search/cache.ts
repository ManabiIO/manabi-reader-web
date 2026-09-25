/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { SearchResource } from './projection';

export const searchIndexVersion = 1;
export const searchIndexDatabase = 'manabi-reader-library-index';
const maxBytes = 32 * 1024 * 1024;
const maxBooks = 64;
interface CachedText {
  key: string;
  signature: string;
  resources: SearchResource[];
  bytes: number;
  touched: number;
}
interface IndexDB extends DBSchema {
  texts: { key: string; value: CachedText; indexes: { touched: number } };
}
export class TextCache {
  private db?: IDBPDatabase<IndexDB>;
  unavailable = false;
  async open() {
    try {
      this.db = await openDB<IndexDB>(searchIndexDatabase, searchIndexVersion, {
        upgrade(db) {
          db.createObjectStore('texts', { keyPath: 'key' }).createIndex('touched', 'touched');
        },
        blocking: () => this.close()
      });
    } catch {
      this.unavailable = true;
    }
  }
  async get(key: string, signature: string): Promise<SearchResource[] | undefined> {
    if (!this.db) return;
    try {
      const item = await this.db.get('texts', key);
      if (item?.signature !== signature || !Array.isArray(item.resources)) return;
      // Derived data is disposable. Corrupt entries must not become source locators.
      if (
        item.resources.some(
          (r) =>
            typeof r.text !== 'string' ||
            !/^[a-f0-9]{64}$/.test(r.digest) ||
            !r.resource ||
            !Number.isSafeInteger(r.resource.spineIndex)
        )
      )
        return;
      return item.resources;
    } catch {
      this.unavailable = true;
      return;
    }
  }
  async put(key: string, signature: string, resources: SearchResource[]) {
    const db = this.db;
    if (!db || this.unavailable) return;
    const bytes = resources.reduce((n, r) => n + r.text.length * 2 + 512, 0);
    if (bytes > maxBytes / 2) return;
    try {
      // Account/book scopes are part of the key; a hit never grants permission to search it.
      const tx = db.transaction('texts', 'readwrite');
      await tx.store.put({ key, signature, resources, bytes, touched: Date.now() });
      const entries = await tx.store.index('touched').getAll();
      let total = entries.reduce((n, entry) => n + entry.bytes, 0),
        count = entries.length;
      for (const entry of entries) {
        if (total <= maxBytes && count <= maxBooks) break;
        await tx.store.delete(entry.key);
        total -= entry.bytes;
        count--;
      }
      await tx.done;
    } catch {
      this.unavailable = true;
    }
  }
  close() {
    this.db?.close();
    this.db = undefined;
  }
}
export async function clearSearchIndex() {
  // Clear rather than delete: a running reader cannot block database deletion.
  const db = await openDB<IndexDB>(searchIndexDatabase, searchIndexVersion, {
    upgrade(db) {
      db.createObjectStore('texts', { keyPath: 'key' }).createIndex('touched', 'touched');
    }
  });
  try {
    await db.clear('texts');
  } finally {
    db.close();
  }
}
