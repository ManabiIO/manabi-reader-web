/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { openDB, type DBSchema } from 'idb';
import { summarize, type SnippetSummary } from '../snippets/summary';
import type { SnippetRecord, SnippetDraft, SnippetTransfer } from '../snippets/database';

export interface LocalLibrary {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  writable: boolean;
}
export interface BookLink {
  id: string;
  sourceId: string;
  owner: string | null;
  root: string;
  fileId: string;
  name: string;
  contentHash: string;
  bookId: number;
  title: string;
  syncEnabled: boolean;
  /** Explicit consent is bound to the active local/account scope. */
  davAccountId?: string | null;
  base?: Record<string, unknown>;
}
interface IntegrationDB extends DBSchema {
  metadata: { key: string; value: unknown };
  localLibraries: { key: string; value: LocalLibrary };
  books: { key: string; value: BookLink };
  snippets: { key: string; value: SnippetRecord; indexes: { owner: string } };
  snippetDrafts: { key: string; value: SnippetDraft; indexes: { owner: string } };
  snippetSummaries: { key: string; value: SnippetSummary; indexes: { owner: string } };
  snippetTransfers: { key: string; value: SnippetTransfer; indexes: { owner: string } };
}
let promise: ReturnType<typeof openDB<IntegrationDB>> | undefined;
export function integrationDB() {
  if (promise) return promise;
  const forget = () => {
    if (promise === opening) promise = undefined;
  };
  const opening = openDB<IntegrationDB>('manabi-reader-integrations', 3, {
    upgrade(db, oldVersion, _version, tx) {
      if (oldVersion < 1) {
        db.createObjectStore('metadata');
        db.createObjectStore('localLibraries', { keyPath: 'id' });
        db.createObjectStore('books', { keyPath: 'id' });
      }
      if (oldVersion < 2) {
        for (const name of ['snippets', 'snippetDrafts', 'snippetTransfers'] as const) {
          db.createObjectStore(name, { keyPath: 'key' }).createIndex('owner', 'owner');
        }
      }
      if (oldVersion < 3) {
        db.createObjectStore('snippetSummaries', { keyPath: 'key' }).createIndex('owner', 'owner');
        // Upgrade an earlier development store without changing any book rows or document IDs.
        void tx
          .objectStore('snippets')
          .openCursor()
          .then(async (first) => {
            let cursor = first;
            while (cursor) {
              await tx.objectStore('snippetSummaries').put(summarize(cursor.value));
              cursor = await cursor.continue();
            }
          })
          .catch(() => {
            try {
              tx.abort();
            } catch {
              /* An invalid upgrade must not partially commit. */
            }
          });
      }
    },
    blocking() {
      // Let another tab upgrade/delete storage. Never keep returning this
      // closing handle, and never close a replacement opened by a later caller.
      forget();
      void opening.then((db) => db.close()).catch(() => undefined);
    },
    terminated: forget
  });
  promise = opening;
  // A denied/failed open is not a permanent connection. The caller still gets
  // the original rejection; only a later access retries, never an old write.
  void opening.catch(forget);
  return opening;
}
export async function metadata<T>(key: string): Promise<T | undefined> {
  return (await integrationDB()).get('metadata', key) as Promise<T | undefined>;
}
export async function setMetadata(key: string, value: unknown, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const db = await integrationDB();
  signal?.throwIfAborted();
  const tx = db.transaction('metadata', 'readwrite');
  const cancel = () => {
    try {
      tx.abort();
    } catch {
      /* Already settled. */
    }
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const result = await tx.store.put(value, key);
    signal?.throwIfAborted();
    await tx.done;
    return result;
  } catch (error) {
    cancel();
    await tx.done.catch(() => undefined);
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

const queues = new Map<string, Promise<unknown>>();
export async function exclusive<T>(
  name: string,
  work: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  signal?.throwIfAborted();
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(`manabi-reader:${name}`, { signal }, work);
  }
  // Browsers without Web Locks still serialize one tab; remote writes retain
  // their server-side preconditions. Local persistent folders require Chromium.
  const previous = queues.get(name) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => {
      signal?.throwIfAborted();
      return work();
    });
  queues.set(name, next);
  try {
    return await next;
  } finally {
    if (queues.get(name) === next) queues.delete(name);
  }
}

export function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => equal(v, b[i]))
    );
  }
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  return (
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every((key) => Object.hasOwn(right, key) && equal(left[key], right[key]))
  );
}

export function mergeRecords(
  base: Record<string, unknown>,
  local: Record<string, unknown>,
  remote: Record<string, unknown>
) {
  const merged: Record<string, unknown> = Object.create(null);
  const conflicts: string[] = [];
  for (const key of new Set([
    ...Object.keys(base),
    ...Object.keys(local),
    ...Object.keys(remote)
  ])) {
    const before = base[key],
      here = local[key],
      there = remote[key];
    if (equal(here, there) || equal(there, before)) merged[key] = here;
    else if (equal(here, before)) merged[key] = there;
    else {
      conflicts.push(key);
      merged[key] = here;
    }
    if (merged[key] === undefined) delete merged[key];
  }
  return { merged, conflicts };
}
