/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { abortable } from './abort.js';
import { authoredTrackIdentity } from './authored-track.js';
import { assertSparseRepairTiming } from './sparse-transcription.js';
import {
  validateJob,
  ownsJob,
  releasedJob,
  jobCanResume,
  jobContentKey,
  JobOwnershipLost,
  type Job
} from './jobs.js';
/** @license BSD-3-Clause — Manabi media integration. */
import { type Scope, type ContentKey, type Track, validateTrack } from './contracts.js';
import {
  type Replica,
  type Kind,
  type Payload,
  type Remote,
  edit,
  prepare,
  acknowledge,
  ingest,
  remote,
  resolve,
  splitTrack,
  assembleTrack,
  validatePayload,
  same
} from './replica.js';

const key = (scope: Scope, kind: string, id: string) => JSON.stringify([scope, kind, id]);
const prefix = (scope: Scope, kind?: string) =>
  JSON.stringify(kind === undefined ? [scope] : [scope, kind]).slice(0, -1) + ',';
const range = (scope: Scope, kind?: string) => {
  const start = prefix(scope, kind);
  return IDBKeyRange.bound(start, start + '\uffff');
};
export class LocalConflict extends Error {
  constructor() {
    super('Video data changed in another tab. Reopen this video before saving again.');
  }
}
export class ImmutableTrackConflict extends Error {
  constructor() {
    super(
      'This subtitle version already exists or was removed. Save changes as a new track instead.'
    );
  }
}

/** Optional lifetime for writes admitted by an asynchronous sync operation.
 * check() must be synchronous. It runs again inside the transaction, not only
 * before awaiting database availability or a queued read callback.
 */
export interface MediaWriteGuard {
  readonly signal: AbortSignal;
  readonly check: () => void;
}

/** Local-first records. Transactions, not per-tab queues, own cross-tab publication. */
export class MediaStore {
  private opened?: Promise<IDBDatabase>;
  private database?: IDBDatabase;
  private openingWaiters = new Set<AbortController>();
  private closed = false;
  private closing?: Promise<void>;
  private active = new Set<Promise<unknown>>();
  private listeners = new Set<(captionsChanged: boolean) => void>();
  private channel?: BroadcastChannel;
  private notificationQueued = false;
  private captionsChanged = false;
  constructor(
    private factory?: IDBFactory,
    private name = 'manabi-media-v1'
  ) {}

  private open(): Promise<IDBDatabase> {
    if (this.closed) return Promise.reject(new Error('Video storage is closed'));
    if (this.opened) return this.opened;
    let factory: IDBFactory | undefined;
    try {
      factory = this.factory ?? globalThis.indexedDB;
    } catch {
      return Promise.reject(new Error('Browser storage is unavailable'));
    }
    if (!factory) return Promise.reject(new Error('Browser storage is unavailable'));
    const opening = new Promise<IDBDatabase>((yes, no) => {
      const request = factory.open(this.name, 1);
      let rejected = false;
      request.onupgradeneeded = () => {
        for (const name of ['local', 'records']) {
          if (!request.result.objectStoreNames.contains(name))
            request.result.createObjectStore(name);
        }
      };
      request.onerror = () => {
        rejected = true;
        no(request.error ?? new Error('Cannot open video storage'));
      };
      request.onblocked = () => {
        rejected = true;
        no(new Error('Close other video tabs to open storage'));
      };
      request.onsuccess = () => {
        const db = request.result;
        if (rejected) {
          db.close();
          return;
        }
        if (this.closed) {
          db.close();
          no(new Error('Video storage is closed'));
          return;
        }
        this.database = db;
        const retire = () => {
          db.close();
          if (this.database === db) this.database = undefined;
          if (this.opened === opening) this.opened = undefined;
        };
        db.onversionchange = retire;
        db.onclose = retire;
        yes(db);
      };
    });
    this.opened = opening;
    void opening.catch(() => {
      if (this.opened === opening) this.opened = undefined;
    });
    return opening;
  }

  subscribe(fn: (captionsChanged: boolean) => void) {
    if (this.closed) throw new Error('Video storage is closed');
    this.listeners.add(fn);
    if (!this.channel && typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel(this.name);
        this.channel.onmessage = ({ data }) => {
          // Only an invalidation hint, never trusted subtitle data. Legacy tabs
          // send "change"; unknown messages conservatively invalidate captions.
          const captions =
            data?.type === 'media-change' && typeof data.captions === 'boolean'
              ? data.captions
              : true;
          this.notify(false, captions);
        };
      } catch {
        /* Restricted contexts can still use local persistence. */
      }
    }
    return () => {
      this.listeners.delete(fn);
      if (!this.listeners.size) {
        this.channel?.close();
        this.channel = undefined;
      }
    };
  }

  private notify(broadcast = true, captions = true) {
    this.captionsChanged ||= captions;
    if (broadcast) {
      try {
        this.channel?.postMessage({ type: 'media-change', captions });
      } catch {
        /* Notification is not the commit. */
      }
    }
    if (this.notificationQueued || this.closed) return;
    this.notificationQueued = true;
    queueMicrotask(() => {
      this.notificationQueued = false;
      const captions = this.captionsChanged;
      this.captionsChanged = false;
      if (this.closed) return;
      for (const fn of this.listeners) {
        try {
          fn(captions);
        } catch {
          /* A broken observer must never leave a committed write pending. */
        }
      }
    });
  }

  private tx<T>(
    name: string | string[],
    mode: IDBTransactionMode,
    work: (
      store: IDBObjectStore,
      result: (value: T) => void,
      fail: (e: unknown) => void,
      transaction: IDBTransaction
    ) => void,
    captions = false,
    signal?: AbortSignal
  ): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Video storage is closed'));
    if (signal?.aborted) return Promise.reject(signal.reason);
    // Admission happens now. close() waits even for calls still opening the database.
    const opening = this.open();
    // Close cancels only operations that have not reached a transaction yet.
    // Once a transaction exists, Close still drains it to preserve committed work.
    const waiter = new AbortController();
    this.openingWaiters.add(waiter);
    const cancelWait = () => waiter.abort(signal?.reason);
    if (signal?.aborted) cancelWait();
    else signal?.addEventListener('abort', cancelWait, { once: true });
    const admitted = abortable(waiter.signal, () => opening).finally(() => {
      this.openingWaiters.delete(waiter);
      signal?.removeEventListener('abort', cancelWait);
    });
    const operation = admitted.then(
      (db) =>
        new Promise<T>((yes, no) => {
          // Opening storage is asynchronous; cancelled/closed publication must
          // not enter a transaction just because its database later became ready.
          if (this.closed) throw new Error('Video storage is closed');
          signal?.throwIfAborted();
          const transaction = db.transaction(name, mode);
          let result: T, error: unknown;
          let hasError = false;
          const cleanup = () => signal?.removeEventListener('abort', cancel);
          const cancel = () => {
            try {
              transaction.abort();
              if (!hasError) {
                hasError = true;
                error = signal!.reason;
              }
            } catch {
              // IndexedDB has already started committing or finished. Its
              // complete/abort event, not a late signal, owns the outcome.
            }
          };
          const fail = (e: unknown) => {
            if (hasError) return;
            hasError = true;
            error = e;
            try {
              transaction.abort();
            } catch {
              cleanup();
              no(e);
            }
          };
          transaction.oncomplete = () => {
            cleanup();
            yes(result);
            if (mode === 'readwrite') this.notify(true, captions);
          };
          transaction.onabort = () => {
            cleanup();
            no(hasError ? error : (transaction.error ?? new Error('Media transaction failed')));
          };
          transaction.onerror = () => {
            /* Abort owns error delivery. */
          };
          signal?.addEventListener('abort', cancel, { once: true });
          try {
            work(
              transaction.objectStore(Array.isArray(name) ? name[0] : name),
              (v) => {
                result = v;
              },
              fail,
              transaction
            );
          } catch (e) {
            fail(e);
          }
        })
    );
    this.active.add(operation);
    void operation.then(
      () => this.active.delete(operation),
      () => this.active.delete(operation)
    );
    return operation;
  }

  local<T>(scope: Scope, kind: string, id: string): Promise<T | undefined> {
    return this.tx('local', 'readonly', (store, done) => {
      const request = store.get(key(scope, kind, id));
      request.onsuccess = () => done(request.result);
    });
  }
  async putLocal(
    scope: Scope,
    kind: string,
    id: string,
    value: unknown,
    guard?: MediaWriteGuard
  ): Promise<void> {
    const snapshot = structuredClone(value),
      signal = guard?.signal,
      check = guard?.check;
    check?.();
    return this.tx(
      'local',
      'readwrite',
      (store) => {
        check?.();
        store.put(snapshot, key(scope, kind, id));
      },
      false,
      signal
    );
  }
  /** Compare and update within a single transaction, including across tabs. */
  updateLocal<T>(
    scope: Scope,
    kind: string,
    id: string,
    change: (old: T | undefined) => T | undefined
  ): Promise<T | undefined> {
    return this.tx('local', 'readwrite', (store, done, fail) => {
      const request = store.get(key(scope, kind, id));
      request.onsuccess = () => {
        try {
          const next = change(request.result);
          if (next !== request.result) {
            if (next === undefined) store.delete(key(scope, kind, id));
            else store.put(next, key(scope, kind, id));
          }
          done(next);
        } catch (e) {
          fail(e);
        }
      };
    });
  }
  /** Admit at most one pending job for this media/audio/language/engine in ONE
   * transaction. A separate read followed by put permits duplicate expensive
   * generation when two tabs click Generate at the same time.
   */
  enqueueJob(scope: Scope, input: Job, guard: () => void = () => {}): Promise<Job> {
    const draft = validateJob(input);
    if (
      draft.status !== 'queued' ||
      draft.nextWindow !== 0 ||
      draft.cues.length ||
      draft.ownerId ||
      draft.completedAt !== undefined ||
      draft.error !== undefined ||
      draft.cancelRequested !== undefined
    )
      throw new Error('Only a fresh transcription job can be enqueued');
    return this.tx('local', 'readwrite', (store, done, fail) => {
      const request = store.getAll(range(scope, 'jobs'));
      request.onsuccess = () => {
        try {
          guard();
          const jobs = (request.result as unknown[]).map(validateJob);
          if (jobs.some((job) => job.id === draft.id))
            throw new Error('Transcription job identity is already in use');
          const compatible = (job: Job) =>
            jobContentKey(job) === jobContentKey(draft) &&
            job.language === draft.language &&
            job.audioTrack === draft.audioTrack &&
            job.duration === draft.duration &&
            job.version === draft.version &&
            job.modelSha256 === draft.modelSha256 &&
            job.engineRevision === draft.engineRevision &&
            job.sparse?.policy === draft.sparse?.policy &&
            job.progressive?.policy === draft.progressive?.policy;
          const existing = jobs.find(
            (job) => (job.status === 'queued' || job.status === 'running') && compatible(job)
          );
          if (existing) {
            done(existing);
            return;
          }
          // Reuse durable windows when Generate is pressed after a pause or a
          // retryable failure. Choosing and requeueing happen in one transaction
          // so simultaneous tabs cannot admit two expensive jobs.
          const resumable = jobs
            .filter((job) => compatible(job) && jobCanResume(job))
            .sort((a, b) => b.createdAt - a.createdAt)[0];
          if (resumable) {
            const resumed = releasedJob(resumable, 'queued');
            delete resumed.error;
            if (resumed.sparse && draft.sparse)
              resumed.sparse = { ...resumed.sparse, targetSeconds: draft.sparse.targetSeconds };
            store.put(resumed, key(scope, 'jobs', resumed.id));
            done(resumed);
            return;
          }
          store.put(draft, key(scope, 'jobs', draft.id));
          done(draft);
        } catch (e) {
          fail(e);
        }
      };
    });
  }
  deleteLocal(scope: Scope, kind: string, id: string): Promise<void> {
    return this.tx('local', 'readwrite', (store) => {
      store.delete(key(scope, kind, id));
    });
  }
  listLocal<T>(scope: Scope, kind: string): Promise<T[]> {
    return this.tx('local', 'readonly', (store, done, fail) => {
      const request = store.getAll(range(scope, kind));
      request.onsuccess = () => {
        try {
          done(request.result);
        } catch (e) {
          fail(e);
        }
      };
    });
  }
  records(scope: Scope, kind?: Kind): Promise<Replica[]> {
    return this.tx('records', 'readonly', (store, done, fail) => {
      // Never load another account's records or every caption page just to paint a shelf.
      const request = store.getAll(range(scope, kind));
      request.onsuccess = () => {
        try {
          const rows: Replica[] = request.result;
          if (rows.some((row) => row?.scope !== scope || (kind !== undefined && row.kind !== kind)))
            throw new Error('Invalid local media record scope');
          done(rows);
        } catch (e) {
          fail(e);
        }
      };
    });
  }
  get(scope: Scope, kind: Kind, id: string): Promise<Replica | undefined> {
    return this.tx('records', 'readonly', (store, done) => {
      const request = store.get(key(scope, kind, id));
      request.onsuccess = () => done(request.result);
    });
  }
  change(
    scope: Scope,
    kind: Kind,
    id: string,
    fn: (r: Replica | undefined) => Replica,
    guard?: MediaWriteGuard
  ): Promise<Replica> {
    const signal = guard?.signal,
      check = guard?.check;
    check?.();
    return this.tx(
      'records',
      'readwrite',
      (store, done, fail) => {
        check?.();
        const request = store.get(key(scope, kind, id));
        request.onsuccess = () => {
          try {
            check?.();
            const next = fn(request.result);
            if (next.scope !== scope || next.kind !== kind || next.id !== id)
              throw new Error('Media record identity changed');
            if (next !== request.result) store.put(next, key(scope, kind, id));
            done(next);
          } catch (e) {
            fail(e);
          }
        };
      },
      kind === 'video_track' || kind === 'video_chunk',
      signal
    );
  }
  async edit(
    scope: Scope,
    kind: Kind,
    id: string,
    mediaKey: ContentKey,
    payload: Payload,
    expectedVersion?: string | null
  ) {
    const snapshot = structuredClone(payload);
    return this.change(scope, kind, id, (old) => {
      if (expectedVersion !== undefined && (old?.localVersion ?? null) !== expectedVersion)
        throw new LocalConflict();
      return edit(old, scope, kind, id, mediaKey, snapshot, crypto.randomUUID());
    });
  }
  prepare(scope: Scope, kind: Kind, id: string, guard?: MediaWriteGuard) {
    return this.change(
      scope,
      kind,
      id,
      (old) => {
        if (!old) throw new Error('Missing record');
        return prepare(old, crypto.randomUUID());
      },
      guard
    );
  }
  ack(
    scope: Scope,
    kind: Kind,
    id: string,
    mutationId: string,
    value: unknown,
    guard?: MediaWriteGuard
  ) {
    const accepted = remote(value);
    return this.change(
      scope,
      kind,
      id,
      (old) => {
        if (!old) throw new Error('Missing record');
        return acknowledge(old, mutationId, accepted);
      },
      guard
    );
  }
  accept(scope: Scope, value: unknown, guard?: MediaWriteGuard) {
    const server = remote(value);
    return this.change(
      scope,
      server.kind,
      server.entity_id,
      (old) => ingest(old, scope, server),
      guard
    );
  }
  conflict(
    scope: Scope,
    kind: Kind,
    id: string,
    value: Remote,
    mutationId?: string,
    guard?: MediaWriteGuard
  ) {
    const server = remote(value);
    return this.change(
      scope,
      kind,
      id,
      (old) => {
        if (!old) throw new Error('Missing record');
        if (server.kind !== kind || server.entity_id !== id || server.book_key !== old.mediaKey)
          throw new Error('Wrong media conflict identity');
        if (mutationId !== undefined && old.pending?.request.mutation_id !== mutationId) return old;
        if (server.revision < Math.max(old.revision, old.conflict?.revision ?? 0)) return old;
        return { ...old, pending: undefined, conflict: server };
      },
      guard
    );
  }
  resolve(scope: Scope, kind: Kind, id: string, choice: 'local' | 'remote') {
    return this.change(scope, kind, id, (old) => {
      if (!old) throw new Error('Missing record');
      return resolve(old, choice);
    });
  }

  /** Publish all pages and the manifest together. Retries of the same version are no-ops. */
  async saveTrack(
    scope: Scope,
    track: Track,
    completion?: { ownerId: string; job: Job; signal?: AbortSignal }
  ): Promise<void> {
    // Authority and cancellation belong to the call, not a later mutation of
    // the caller's completion object while storage is opening.
    const ownerId = completion?.ownerId,
      signal = completion?.signal;
    signal?.throwIfAborted();
    const snapshot = validateTrack(track),
      pieces = splitTrack(snapshot);
    const completed = completion ? validateJob(completion.job) : undefined;
    if (completed?.sparse) assertSparseRepairTiming(completed.sparse);
    if (
      completed &&
      (completed.id !== snapshot.id ||
        jobContentKey(completed) !== snapshot.mediaKey ||
        completed.language !== snapshot.language ||
        completed.status !== 'complete' ||
        !same(completed.cues, snapshot.cues))
    )
      throw new Error('Invalid completed transcription');
    await this.tx<void>(
      completion ? ['records', 'local'] : 'records',
      'readwrite',
      (store, _done, fail, transaction) => {
        if (completion && completed) {
          const jobs = transaction.objectStore('local'),
            jobKey = key(scope, 'jobs', completed.id);
          const request = jobs.get(jobKey);
          request.onsuccess = () => {
            try {
              const current =
                request.result === undefined ? undefined : validateJob(request.result);
              if (!ownsJob(current, ownerId!)) throw new JobOwnershipLost();
              const fields = [
                'version',
                'mediaKey',
                'provisional',
                'verifiedMediaKey',
                'sourceSample',
                'language',
                'audioTrack',
                'duration',
                'modelSha256',
                'engineRevision',
                'nextWindow',
                'createdAt'
              ] as const;
              if (
                fields.some((field) => current![field] !== completed[field]) ||
                !same(current!.cues, completed.cues) ||
                !same(current!.audioProofs ?? null, completed.audioProofs ?? null) ||
                !same(current!.progressive ?? null, completed.progressive ?? null) ||
                !same(current!.sparse ?? null, completed.sparse ?? null)
              )
                throw new Error('Completed transcript differs from its durable checkpoint');
              // Completion and caption publication either both commit or neither does.
              // Once published, cue pages own the text. Keep only a compact completed-job
              // summary so queue scans do not deserialize every previous full transcript.
              // Failed/paused jobs retain their cue checkpoints for actual resume.
              const {
                sparse: _sparse,
                sourceSample: _sourceSample,
                audioProofs: _audioProofs,
                ...summary
              } = completed;
              jobs.put({ ...summary, cues: [] }, jobKey);
            } catch (e) {
              fail(e);
            }
          };
        }
        this.writeTrackPieces(store, scope, pieces, fail);
      },
      true,
      signal
    );
  }
  /** Import deduplication and publication share ONE read/write transaction.
   * Two tabs cannot both observe absence and publish different random IDs.
   * Only a complete, verified matching track may suppress a new import.
   */
  async saveImportedTrack(scope: Scope, input: Track, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const snapshot = validateTrack(input);
    if (!snapshot.complete || (snapshot.origin !== 'embedded' && snapshot.origin !== 'sidecar'))
      throw new Error('Only complete authored captions can be imported');
    const pieces = splitTrack(snapshot),
      wanted = pieces.at(-1)!.payload,
      identity = authoredTrackIdentity(snapshot, wanted.digest as string);
    await this.tx<void>(
      'records',
      'readwrite',
      (store, _done, fail) => {
        const request = store.getAll(range(scope, 'video_track'));
        request.onsuccess = () => {
          try {
            const candidates: Replica[] = [];
            for (const row of request.result as Replica[]) {
              if (row?.scope !== scope || row.kind !== 'video_track')
                throw new Error('Invalid local subtitle manifest scope');
              if (row.mediaKey !== snapshot.mediaKey || row.payload === null) continue;
              validatePayload(row.kind, row.id, row.mediaKey, row.payload);
              const metadata = row.payload.track as Omit<Track, 'cues'>;
              if (
                row.payload.digest === wanted.digest &&
                row.payload.count === wanted.count &&
                authoredTrackIdentity(metadata, row.payload.digest as string) === identity
              )
                candidates.push(row);
            }
            const pages: Replica[] = [];
            const ids = new Set(
              candidates.flatMap((row) =>
                (row.payload!.pages as { id: string }[]).map((page) => page.id)
              )
            );
            let remaining = ids.size;
            const finish = () => {
              if (!candidates.some((row) => assembleTrack(row, pages)))
                this.writeTrackPieces(store, scope, pieces, fail);
            };
            if (!remaining) {
              finish();
              return;
            }
            for (const id of ids) {
              const page = store.get(key(scope, 'video_chunk', id));
              page.onsuccess = () => {
                try {
                  const row: Replica | undefined = page.result;
                  if (row) {
                    if (
                      row.scope !== scope ||
                      row.kind !== 'video_chunk' ||
                      row.id !== id ||
                      row.mediaKey !== snapshot.mediaKey
                    )
                      throw new Error('Invalid local subtitle page identity');
                    validatePayload(row.kind, row.id, row.mediaKey, row.payload);
                    pages.push(row);
                  }
                  if (--remaining === 0) finish();
                } catch (error) {
                  fail(error);
                }
              };
            }
          } catch (error) {
            fail(error);
          }
        };
      },
      true,
      signal
    );
  }

  /** Shared immutable publication path for imports and fenced MOSS completion. */
  private writeTrackPieces(
    store: IDBObjectStore,
    scope: Scope,
    pieces: ReturnType<typeof splitTrack>,
    fail: (error: unknown) => void
  ) {
    for (const piece of pieces) {
      const storageKey = key(scope, piece.kind, piece.id);
      const request = store.get(storageKey);
      request.onsuccess = () => {
        try {
          const old: Replica | undefined = request.result;
          if (old) {
            if (
              old.scope !== scope ||
              old.mediaKey !== piece.key ||
              old.kind !== piece.kind ||
              old.id !== piece.id ||
              !same(old.payload, piece.payload)
            )
              throw new ImmutableTrackConflict();
            return;
          }
          store.put(
            edit(
              undefined,
              scope,
              piece.kind,
              piece.id,
              piece.key,
              piece.payload,
              crypto.randomUUID()
            ),
            storageKey
          );
        } catch (e) {
          fail(e);
        }
      };
    }
  }

  /** Read a consistent manifest/page snapshot for ONE video. Do not fetch all
   * of the account's transcript bodies on every playback/library notification.
   * Requests created inside onsuccess keep the native IDB transaction active;
   * no asynchronous work escapes between reading manifests and their pages.
   */
  tracks(scope: Scope, mediaKey: ContentKey): Promise<Track[]> {
    return this.tx('records', 'readonly', (store, done, fail) => {
      const manifests = store.getAll(range(scope, 'video_track'));
      manifests.onsuccess = () => {
        try {
          const selected: Replica[] = [];
          for (const row of manifests.result as Replica[]) {
            if (row?.scope !== scope || row.kind !== 'video_track')
              throw new Error('Invalid local subtitle manifest scope');
            if (row.mediaKey !== mediaKey || row.payload === null) continue;
            validatePayload(row.kind, row.id, row.mediaKey, row.payload);
            selected.push(row);
          }
          const pages: Replica[] = [];
          const required = selected.flatMap((row) =>
            (row.payload!.pages as { id: string }[]).map((page) => page.id)
          );
          let remaining = required.length;
          const finish = () =>
            done(
              selected
                .map((row) => assembleTrack(row, pages))
                .filter((track): track is Track => !!track)
            );
          if (!remaining) {
            finish();
            return;
          }
          for (const id of required) {
            const request = store.get(key(scope, 'video_chunk', id));
            request.onsuccess = () => {
              try {
                const row: Replica | undefined = request.result;
                if (row) {
                  if (
                    row.scope !== scope ||
                    row.kind !== 'video_chunk' ||
                    row.id !== id ||
                    row.mediaKey !== mediaKey
                  )
                    throw new Error('Invalid local subtitle page identity');
                  validatePayload(row.kind, row.id, row.mediaKey, row.payload);
                  pages.push(row);
                }
                if (--remaining === 0) finish();
              } catch (e) {
                fail(e);
              }
            };
          }
        } catch (e) {
          fail(e);
        }
      };
    });
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    const reason = new Error('Video storage is closed');
    for (const waiter of this.openingWaiters) waiter.abort(reason);
    this.closing = (async () => {
      // Transactions that already exist retain drain semantics. Open waiters
      // were rejected above and cannot create a transaction after Close.
      await Promise.allSettled([...this.active]);
      const database = this.database,
        opening = this.opened;
      this.database = undefined;
      this.opened = undefined;
      if (database) database.close();
      else if (opening)
        void opening.then(
          (db) => db.close(),
          () => {
            /* Opening failures are already observed by open(). */
          }
        );
      this.channel?.close();
      this.channel = undefined;
      this.listeners.clear();
    })();
    return this.closing;
  }
}
