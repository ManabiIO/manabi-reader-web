/** @license BSD-3-Clause */
import { canonicalJSON, utf8Size } from './contracts.mjs';
export class MemoryChapterCache {
  constructor(maxBytes = 32 * 1024 * 1024) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid cache budget');
    this.limit = maxBytes;
    this.bytes = 0;
    this.rows = new Map();
  }
  async get(key) {
    const row = this.rows.get(key);
    if (!row) return null;
    this.rows.delete(key);
    this.rows.set(key, row);
    return JSON.parse(row.text);
  }
  async put(key, value) {
    const text = canonicalJSON(value),
      bytes = utf8Size(text);
    if (bytes > this.limit) return;
    const previous = this.rows.get(key);
    if (previous) {
      this.bytes -= previous.bytes;
      this.rows.delete(key);
    }
    while (this.bytes + bytes > this.limit) {
      const oldest = this.rows.keys().next().value;
      this.bytes -= this.rows.get(oldest).bytes;
      this.rows.delete(oldest);
    }
    this.rows.set(key, { text, bytes });
    this.bytes += bytes;
  }
}

// Separate DB: derived chapter cache must never change book/account schemas.
export class IndexedDBChapterCache {
  constructor({
    indexedDB = globalThis.indexedDB,
    maxBytes = 128 * 1024 * 1024,
    maxEntries = 1000
  } = {}) {
    if (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 ||
      !Number.isSafeInteger(maxEntries) ||
      maxEntries < 1
    )
      throw new Error('Invalid cache budget');
    this.idb = indexedDB;
    this.limit = maxBytes;
    this.maxEntries = maxEntries;
    this.opening = null;
  }
  open() {
    if (this.opening) return this.opening;
    if (!this.idb) return Promise.reject(new Error('IndexedDB unavailable'));
    this.opening = new Promise((resolve, reject) => {
      let abandoned = false;
      const request = this.idb.open('reader-derived-chapters-v1', 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('chapters', { keyPath: 'key' });
        store.createIndex('touched', 'touched');
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        abandoned = true;
        reject(new Error('Chapter cache upgrade blocked'));
      };
      request.onsuccess = () => {
        const db = request.result;
        if (abandoned) {
          db.close();
          return;
        }
        db.onversionchange = () => {
          db.close();
          this.opening = null;
        };
        resolve(db);
      };
    }).catch((error) => {
      this.opening = null;
      throw error;
    });
    return this.opening;
  }
  async get(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('chapters', 'readwrite'),
        store = tx.objectStore('chapters');
      let result = null;
      const request = store.get(key);
      request.onsuccess = () => {
        const row = request.result;
        if (row) {
          try {
            result = JSON.parse(row.text);
            store.put({ ...row, touched: Date.now() });
          } catch {
            store.delete(key);
          }
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Cache read failed'));
    });
  }
  async put(key, value) {
    const text = canonicalJSON(value),
      bytes = utf8Size(text);
    if (bytes > this.limit) return;
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('chapters', 'readwrite'),
        store = tx.objectStore('chapters');
      // Metadata totals and eviction happen in one transaction, including
      // concurrent writers in other tabs. Never keep an IDB tx over an await.
      const rows = [];
      const cursor = store.index('touched').openCursor();
      cursor.onsuccess = () => {
        const cur = cursor.result;
        if (cur) {
          if (!Number.isSafeInteger(cur.value.bytes) || cur.value.bytes < 0) {
            cur.delete();
            cur.continue();
            return;
          }
          if (cur.value.key !== key) rows.push({ key: cur.value.key, bytes: cur.value.bytes });
          cur.continue();
          return;
        }
        let total = rows.reduce((sum, r) => sum + r.bytes, 0) + bytes;
        let count = rows.length + 1;
        for (const row of rows) {
          if (total <= this.limit && count <= this.maxEntries) break;
          store.delete(row.key);
          total -= row.bytes;
          --count;
        }
        store.put({ key, text, bytes, touched: Date.now() });
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Cache write failed'));
    });
  }
  async close() {
    if (!this.opening) return;
    const db = await this.opening;
    db.close();
    this.opening = null;
  }
}
