import { openDB, type DBSchema } from 'idb';

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
  base?: Record<string, unknown>;
}
interface IntegrationDB extends DBSchema {
  metadata: { key: string; value: unknown };
  localLibraries: { key: string; value: LocalLibrary };
  books: { key: string; value: BookLink };
}
let promise: ReturnType<typeof openDB<IntegrationDB>> | undefined;
export function integrationDB() {
  promise ??= openDB<IntegrationDB>('manabi-reader-integrations', 1, {
    upgrade(db) {
      db.createObjectStore('metadata');
      db.createObjectStore('localLibraries', { keyPath: 'id' });
      db.createObjectStore('books', { keyPath: 'id' });
    }
  });
  return promise;
}
export async function metadata<T>(key: string): Promise<T | undefined> {
  return (await integrationDB()).get('metadata', key) as Promise<T | undefined>;
}
export async function setMetadata(key: string, value: unknown) {
  return (await integrationDB()).put('metadata', value, key);
}

const queues = new Map<string, Promise<unknown>>();
export async function exclusive<T>(name: string, work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(`manabi-reader:${name}`, work);
  }
  // Browsers without Web Locks still serialize one tab; remote writes retain
  // their server-side preconditions. Local persistent folders require Chromium.
  const previous = queues.get(name) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work);
  queues.set(name, next);
  try { return await next; } finally { if (queues.get(name) === next) queues.delete(name); }
}

export function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => equal(v, b[i]));
  }
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  return Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every((key) => Object.hasOwn(right, key) && equal(left[key], right[key]));
}

export function mergeRecords(base: Record<string, unknown>, local: Record<string, unknown>, remote: Record<string, unknown>) {
  const merged: Record<string, unknown> = Object.create(null);
  const conflicts: string[] = [];
  for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    const before = base[key], here = local[key], there = remote[key];
    if (equal(here, there) || equal(there, before)) merged[key] = here;
    else if (equal(here, before)) merged[key] = there;
    else { conflicts.push(key); merged[key] = here; }
    if (merged[key] === undefined) delete merged[key];
  }
  return { merged, conflicts };
}
