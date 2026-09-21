/** @license MIT — Manabi Reader adaptations; see docs/whispersync.md. */
import {
  AudiobookStorageConflictError,
  captureSession,
  emptySession,
  validateSession,
  type AudiobookSession
} from './persistence';
import type { PlaybackState } from './player';
import { parseSubtitles } from './subtitles';

export interface SessionStorage {
  load: (key: string) => Promise<AudiobookSession | undefined>;
  save: (key: string, value: AudiobookSession) => Promise<void>;
  remove: (key: string) => Promise<void>;
  close: () => Promise<void>;
}
interface PendingWrite {
  data: AudiobookSession;
  waiters: { resolve: () => void; reject: (reason: unknown) => void }[];
}

/**
 * Owns the in-memory checkpoint independently of delayed storage acknowledgments.
 * A failed restore/reset fences writes; playback can still continue in memory.
 * At most one in-flight and one latest pending caption snapshot are retained.
 */
export class AudiobookSessionCoordinator {
  private checkpoint = emptySession();
  private writable = false;
  private conflict?: AudiobookStorageConflictError;
  private restored = false;
  private closing = false;
  private removing = false;
  private generation = 0;
  private pending?: PendingWrite;
  private draining?: Promise<void>;
  private removal?: Promise<void>;

  constructor(
    private readonly store: SessionStorage,
    private readonly key: string
  ) {}

  get snapshot(): AudiobookSession {
    return { ...this.checkpoint, audio: this.checkpoint.audio && { ...this.checkpoint.audio } };
  }

  async restore(): Promise<AudiobookSession | undefined> {
    if (this.closing || this.restored || this.removing)
      throw new Error('Audiobook session cannot be restored now');
    const generation = ++this.generation;
    this.writable = false;
    try {
      const stored = await this.store.load(this.key);
      const data = stored && validateSession(stored);
      // Parse before granting write permission. A valid envelope can still hold
      // damaged captions; silently replacing them with empty text loses data.
      if (data?.subtitleSource) parseSubtitles(data.subtitleSource);
      if (this.closing || generation !== this.generation) return undefined;
      this.checkpoint = data ?? emptySession();
      this.writable = true;
      return data && this.snapshot;
    } finally {
      if (generation === this.generation) this.restored = true;
    }
  }

  capture(
    draft: Pick<
      AudiobookSession,
      'subtitleName' | 'subtitleSource' | 'delay' | 'follow' | 'approximate'
    >,
    playback: PlaybackState
  ): AudiobookSession {
    if (this.closing || this.removing)
      throw new Error('Audiobook session is closed or being reset');
    this.checkpoint = captureSession(draft, playback, this.checkpoint);
    return this.snapshot;
  }

  persist(data: AudiobookSession): Promise<void> {
    if (this.closing) return Promise.reject(new Error('Audiobook session is closed'));
    if (this.conflict) return Promise.reject(this.conflict);
    if (!this.restored || !this.writable || this.removing) {
      return Promise.reject(
        new Error(
          'Saving is disabled to protect unread audiobook data. Remove saved audiobook data to reset this book.'
        )
      );
    }
    let snapshot: AudiobookSession;
    try {
      snapshot = validateSession(data);
    } catch (error) {
      return Promise.reject(error);
    }
    const result = new Promise<void>((resolve, reject) => {
      if (this.pending) {
        this.pending.data = snapshot;
        this.pending.waiters.push({ resolve, reject });
      } else this.pending = { data: snapshot, waiters: [{ resolve, reject }] };
    });
    if (!this.draining) {
      // A microtask also coalesces repeated paused/time/rate events in one turn.
      this.draining = Promise.resolve().then(() => this.drain());
    }
    return result;
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending) {
        const write = this.pending;
        this.pending = undefined;
        try {
          await this.store.save(this.key, write.data);
          for (const waiter of write.waiters) waiter.resolve();
        } catch (error) {
          if (error instanceof AudiobookStorageConflictError) {
            this.writable = false;
            this.conflict = error;
            this.rejectPending(error);
          }
          for (const waiter of write.waiters) waiter.reject(error);
        }
        // Never assign checkpoint here: this acknowledgment may be several
        // seeks, a file replacement, or a Close audio action behind the user.
      }
    } finally {
      // Clear synchronously before resolving waiters' continuations. A finally
      // on the outer promise leaves a window where a new write can be stranded.
      this.draining = undefined;
    }
  }

  private rejectPending(reason: unknown): void {
    const pending = this.pending;
    this.pending = undefined;
    for (const waiter of pending?.waiters ?? []) waiter.reject(reason);
  }

  remove(): Promise<void> {
    if (this.closing || this.removing)
      return Promise.reject(new Error('Audiobook session is closed or being reset'));
    this.removing = true;
    this.writable = false;
    this.generation += 1;
    this.checkpoint = emptySession();
    this.rejectPending(new DOMException('Audiobook data reset', 'AbortError'));
    this.removal = this.finishRemove();
    return this.removal;
  }

  private async finishRemove(): Promise<void> {
    try {
      await this.draining;
      await this.store.remove(this.key);
      if (!this.closing) {
        this.writable = true;
        this.restored = true;
        this.conflict = undefined;
      }
    } finally {
      this.removing = false;
      this.removal = undefined;
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    this.writable = false;
    this.generation += 1;
    try {
      await this.removal;
    } catch {
      /* Reset failure is reported to its caller. */
    }
    await this.draining;
    await this.store.close();
  }
}
