/** @license MIT — Manabi Reader adaptations; see docs/whispersync.md. */
import { MAX_SUBTITLE_BYTES } from './subtitles';
import type { AudioIdentity, PlaybackState } from './player';

export interface AudiobookSession {
  version: 1;
  subtitleName: string;
  subtitleSource: string;
  audio?: AudioIdentity;
  position: number;
  rate: number;
  delay: number;
  follow: boolean;
  approximate: boolean;
  updatedAt: number;
}
export const sessionKey = (bookId: number, title: string): string =>
  JSON.stringify([bookId, title]);
export function emptySession(): AudiobookSession {
  return {
    version: 1,
    subtitleName: '',
    subtitleSource: '',
    position: 0,
    rate: 1,
    delay: 0,
    follow: false,
    approximate: false,
    updatedAt: 0
  };
}

/** Persisted data is untrusted. Playback works even when storage is unavailable. */
export function validateSession(value: unknown): AudiobookSession {
  if (!value || typeof value !== 'object') throw new Error('Invalid saved audiobook data');
  const v = value as Record<string, unknown>;
  const bounded = (n: unknown, min: number, max: number): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  if (
    v.version !== 1 ||
    typeof v.subtitleName !== 'string' ||
    v.subtitleName.length > 1024 ||
    typeof v.subtitleSource !== 'string' ||
    v.subtitleSource.length > MAX_SUBTITLE_BYTES ||
    new TextEncoder().encode(v.subtitleSource).length > MAX_SUBTITLE_BYTES ||
    !bounded(v.position, 0, 3_600_000_000) ||
    !bounded(v.rate, 0.5, 3) ||
    !bounded(v.delay, -3600, 3600) ||
    !bounded(v.updatedAt, 0, Number.MAX_SAFE_INTEGER) ||
    typeof v.follow !== 'boolean' ||
    typeof v.approximate !== 'boolean'
  ) {
    throw new Error('Saved audiobook data is invalid or from an unsupported version');
  }
  let audio: AudioIdentity | undefined;
  if (v.audio !== undefined) {
    if (!v.audio || typeof v.audio !== 'object') throw new Error('Invalid saved audio identity');
    const a = v.audio as Record<string, unknown>;
    if (
      typeof a.name !== 'string' ||
      a.name.length > 1024 ||
      !bounded(a.size, 0, Number.MAX_SAFE_INTEGER) ||
      !Number.isInteger(a.size) ||
      !bounded(a.lastModified, 0, Number.MAX_SAFE_INTEGER)
    )
      throw new Error('Invalid saved audio identity');
    audio = { name: a.name, size: a.size, lastModified: a.lastModified };
  }
  return {
    version: 1,
    subtitleName: v.subtitleName,
    subtitleSource: v.subtitleSource,
    audio,
    position: v.position,
    rate: v.rate,
    delay: v.delay,
    updatedAt: v.updatedAt,
    follow: v.follow,
    approximate: v.approximate
  };
}

/** Initial metadata loading and closing a player must not erase its checkpoint. */
export function captureSession(
  draft: Pick<
    AudiobookSession,
    'subtitleName' | 'subtitleSource' | 'delay' | 'follow' | 'approximate'
  >,
  playback: PlaybackState,
  previous: AudiobookSession,
  updatedAt = Date.now()
): AudiobookSession {
  return validateSession({
    ...draft,
    version: 1,
    audio: playback.file && playback.ready ? playback.file : previous.audio,
    position: playback.file && playback.ready ? playback.time : previous.position,
    rate: playback.rate,
    updatedAt
  });
}

export class AudiobookStorageConflictError extends Error {
  constructor() {
    super(
      'Audiobook data changed in another tab. Saving is paused to protect that version. Close other reader tabs and reopen this book before continuing, or explicitly remove saved audiobook data to start over.'
    );
    this.name = 'AudiobookStorageConflictError';
  }
}

interface StoredRecord {
  revision?: string;
  session?: AudiobookSession;
}

/** Legacy v1 sessions are adopted only after a successful read. */
function readStoredRecord(value: unknown): StoredRecord {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object') throw new Error('Invalid saved audiobook record');
  const record = value as Record<string, unknown>;
  const revision = record.storageRevision;
  if (
    revision !== undefined &&
    (typeof revision !== 'string' || !revision || revision.length > 128)
  )
    throw new Error('Invalid saved audiobook revision');
  if (record.tombstone !== undefined) {
    if (
      record.tombstone !== true ||
      typeof revision !== 'string' ||
      Object.keys(record).some((key) => key !== 'storageRevision' && key !== 'tombstone')
    )
      throw new Error('Invalid audiobook reset marker');
    return { revision };
  }
  return { revision, session: validateSession(record) };
}

function createStorageRevision(): string {
  // getRandomValues also works where randomUUID is unavailable. Never silently
  // downgrade to a timestamp: two tabs can commit during the same millisecond.
  if (typeof globalThis.crypto?.getRandomValues !== 'function')
    throw new Error('Secure random values are unavailable; audiobook data was not changed');
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Separate, optional database; never opens/upgrades/rewrites the reader's book DB. */
export class AudiobookSessionStore {
  private database?: Promise<IDBDatabase>;
  private queue: Promise<unknown> = Promise.resolve();
  private closing = false;
  private readonly revisions = new Map<string, string | undefined>();
  private readonly factory?: IDBFactory;
  private readonly useDefaultFactory: boolean;

  constructor(factory?: IDBFactory) {
    this.factory = factory;
    this.useDefaultFactory = arguments.length === 0;
  }

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    let factory: IDBFactory | undefined;
    // Merely accessing indexedDB can throw in restricted browsing contexts.
    try {
      factory = this.useDefaultFactory ? globalThis.indexedDB : this.factory;
    } catch {
      return Promise.reject(new Error('Browser storage is unavailable'));
    }
    if (!factory) return Promise.reject(new Error('Browser storage is unavailable'));
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open('manabi-whispersync-v1', 1);
      let failed = false;
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('sessions'))
          request.result.createObjectStore('sessions');
      };
      request.onsuccess = () => {
        const db = request.result;
        if (failed) {
          db.close();
          return;
        }
        const retire = () => {
          db.close();
          if (this.database === opening) this.database = undefined;
        };
        db.onversionchange = retire;
        db.onclose = () => {
          if (this.database === opening) this.database = undefined;
        };
        resolve(db);
      };
      request.onerror = () => {
        failed = true;
        reject(request.error ?? new Error('Could not open audiobook storage'));
      };
      request.onblocked = () => {
        failed = true;
        reject(
          new Error('Audiobook storage is blocked by another tab. Close it and reopen this panel.')
        );
      };
    });
    this.database = opening;
    void opening.catch(() => {
      if (this.database === opening) this.database = undefined;
    });
    return opening;
  }

  load(key: string): Promise<AudiobookSession | undefined> {
    return this.enqueue(async (db) => {
      const result = await new Promise<unknown>((resolve, reject) => {
        const transaction = db.transaction('sessions', 'readonly');
        const request = transaction.objectStore('sessions').get(key);
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () =>
          reject(transaction.error ?? new Error('Could not read saved audiobook data'));
      });
      const record = readStoredRecord(result);
      this.revisions.set(key, record.revision);
      return record.session;
    });
  }

  save(key: string, session: AudiobookSession): Promise<void> {
    // Copy and validate now, not when a later queued operation runs.
    let snapshot: AudiobookSession;
    try {
      snapshot = validateSession(session);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.write(key, snapshot);
  }
  remove(key: string): Promise<void> {
    return this.write(key);
  }

  private write(key: string, snapshot?: AudiobookSession): Promise<void> {
    return this.enqueue(
      (db) =>
        new Promise<void>((resolve, reject) => {
          // The read/compare/put occur in ONE readwrite transaction. A per-instance
          // Promise queue alone cannot serialize different tabs' stale snapshots.
          const revision = createStorageRevision();
          const transaction = db.transaction('sessions', 'readwrite');
          const store = transaction.objectStore('sessions');
          let failure: unknown;
          transaction.oncomplete = () => {
            this.revisions.set(key, revision);
            resolve();
          };
          transaction.onabort = () =>
            reject(
              failure ??
                transaction.error ??
                new Error('Could not save audiobook data (storage may be full)')
            );
          try {
            if (!snapshot) {
              // Explicit reset may replace a corrupt/unread record. Keep ONLY a
              // fresh revision marker so an older tab cannot resurrect its payload.
              store.put({ storageRevision: revision, tombstone: true }, key);
              return;
            }
            const read = store.get(key);
            read.onsuccess = () => {
              try {
                const current = readStoredRecord(read.result);
                if (!this.revisions.has(key) && current.session !== undefined)
                  throw new Error('Restore saved audiobook data before replacing an unread record');
                const expected = this.revisions.has(key)
                  ? this.revisions.get(key)
                  : current.revision;
                if (current.revision !== expected) throw new AudiobookStorageConflictError();
                store.put({ ...snapshot, storageRevision: revision }, key);
              } catch (error) {
                failure = error;
                transaction.abort();
              }
            };
          } catch (error) {
            failure = error;
            transaction.abort();
          }
        })
    );
  }

  private enqueue<T>(operation: (database: IDBDatabase) => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('Audiobook storage is closed'));
    // Reads share the queue too: close waits for them, and load after save sees
    // that save even when the connection is still opening.
    const result = this.queue.then(async () => operation(await this.open()));
    this.queue = result.catch(() => {});
    return result;
  }

  async close(): Promise<void> {
    this.closing = true;
    await this.queue;
    try {
      (await this.database)?.close();
    } catch {
      /* Opening failure was reported to the caller. */
    }
    this.database = undefined;
    this.revisions.clear();
  }
}
