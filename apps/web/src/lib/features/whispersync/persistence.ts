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

/** Separate, optional database; never opens/upgrades/rewrites the reader's book DB. */
export class AudiobookSessionStore {
  private database?: Promise<IDBDatabase>;
  private queue: Promise<void> = Promise.resolve();
  private closing = false;

  // Access indexedDB lazily: its getter itself can throw in a restricted origin.
  constructor(
    private readonly factory?: IDBFactory | (() => IDBFactory | undefined),
    private readonly openTimeoutMs = 8000
  ) {}

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    let factory: IDBFactory | undefined;
    try {
      factory =
        typeof this.factory === 'function'
          ? this.factory()
          : (this.factory ?? globalThis.indexedDB);
    } catch {
      return Promise.reject(new Error('Browser storage is unavailable: access denied'));
    }
    if (!factory) return Promise.reject(new Error('Browser storage is unavailable'));
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open('manabi-whispersync-v1', 1);
      let failed = false;
      const fail = (error: unknown) => {
        failed = true;
        clearTimeout(timer);
        reject(error);
      };
      const timer = setTimeout(
        () => fail(new Error('Audiobook storage did not respond. Playback remains available.')),
        this.openTimeoutMs
      );
      request.onupgradeneeded = () => {
        if (failed) {
          request.transaction?.abort();
          return;
        }
        try {
          if (!request.result.objectStoreNames.contains('sessions'))
            request.result.createObjectStore('sessions');
        } catch (error) {
          fail(error);
          request.transaction?.abort();
        }
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        const db = request.result;
        if (failed) {
          db.close();
          return;
        }
        const forget = () => {
          if (this.database === opening) this.database = undefined;
        };
        db.onversionchange = () => {
          db.close();
          forget();
        };
        db.onclose = forget;
        resolve(db);
      };
      request.onerror = () => fail(request.error ?? new Error('Could not open audiobook storage'));
      request.onblocked = () =>
        fail(
          new Error('Audiobook storage is blocked by another tab. Close it and reopen this panel.')
        );
    });
    this.database = opening;
    void opening.catch(() => {
      if (this.database === opening) this.database = undefined;
    });
    return opening;
  }

  load(key: string): Promise<AudiobookSession | undefined> {
    return this.serialize(async (db) => {
      const value = await this.transaction(db, 'readonly', (store) => store.get(key));
      return value === undefined ? undefined : validateSession(value);
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
    return this.serialize(async (db) => {
      await this.transaction(db, 'readwrite', (store) => store.put(snapshot, key));
    });
  }
  remove(key: string): Promise<void> {
    return this.serialize(async (db) => {
      await this.transaction(db, 'readwrite', (store) => store.delete(key));
    });
  }

  private transaction(
    db: IDBDatabase,
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('sessions', mode);
      let request: IDBRequest | undefined;
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onabort = () =>
        reject(
          transaction.error ??
            new Error('Audiobook storage transaction failed (storage may be full)')
        );
      try {
        request = action(transaction.objectStore('sessions'));
      } catch (error) {
        try {
          transaction.abort();
        } catch {
          /* Already inactive. */
        }
        reject(error);
      }
    });
  }

  private serialize<T>(work: (db: IDBDatabase) => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('Audiobook storage is closed'));
    // Reads participate too: load immediately after save/remove must observe it.
    const operation = this.queue.then(async () => work(await this.open()));
    this.queue = operation.then(
      () => {},
      () => {}
    );
    return operation;
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
  }
}
