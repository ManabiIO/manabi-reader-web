/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export interface FullscreenPort {
  readonly fullscreenEnabled: boolean;
  readonly fullscreenElement: Element | null;
  requestFullscreen(element: Element): Promise<void>;
  exitFullscreen(): Promise<void>;
}
export interface ReaderFullscreenState {
  available: boolean;
  active: boolean;
  busy: boolean;
  error: string;
}
interface Session {
  root: Element;
  entered: boolean;
  settled: boolean;
}
// A document-root fullscreen request can outlive its reader. An older promise
// must not close a session subsequently requested by another reader lifetime.
const sessions = new WeakMap<FullscreenPort, Session>();

export class ReaderFullscreen {
  private disposed = false;
  private busy = false;
  private error = '';
  private session?: Session;

  private port: FullscreenPort;
  private root: Element;
  private changed: (state: ReaderFullscreenState) => void;

  constructor(
    port: FullscreenPort,
    root: Element,
    changed: (state: ReaderFullscreenState) => void
  ) {
    this.port = port;
    this.root = root;
    this.changed = changed;
    this.sync();
  }

  sync() {
    const session = this.session;
    if (session && sessions.get(this.port) === session) {
      if (this.port.fullscreenElement === session.root) session.entered = true;
      else if (session.entered) sessions.delete(this.port);
    }
    if (this.disposed) return;
    const active = this.port.fullscreenElement !== null;
    this.changed({
      available: this.port.fullscreenEnabled || active,
      active,
      busy: this.busy,
      error: this.error
    });
  }

  async toggle() {
    if (this.disposed || this.busy) return;
    this.busy = true;
    this.error = '';
    this.sync();
    let requested: Session | undefined;
    try {
      if (this.port.fullscreenElement) {
        // Explicit Exit is allowed for a pre-existing session. Automatic cleanup
        // below is restricted to a session entered by this reader instead.
        sessions.delete(this.port);
        this.session = undefined;
        await this.port.exitFullscreen();
      } else {
        requested = { root: this.root, entered: false, settled: false };
        this.session = requested;
        sessions.set(this.port, requested);
        // No await precedes the browser request: retain the click's activation.
        await this.port.requestFullscreen(this.root);
        requested.settled = true;
        if (sessions.get(this.port) === requested) {
          if (this.port.fullscreenElement === this.root) requested.entered = true;
          else sessions.delete(this.port);
          if (this.disposed) this.release(requested);
        }
      }
    } catch (cause) {
      if (requested && sessions.get(this.port) === requested) sessions.delete(this.port);
      this.error =
        cause instanceof Error
          ? `Fullscreen unavailable: ${cause.message}`
          : 'Fullscreen is unavailable in this browser.';
    } finally {
      if (requested) requested.settled = true;
      this.busy = false;
      this.sync();
    }
  }

  private release(session: Session) {
    if (sessions.get(this.port) !== session) return;
    if (this.port.fullscreenElement === session.root) {
      sessions.delete(this.port);
      // Already dispatched platform exits cannot be recalled; only dispatch one
      // while this exact request still owns the currently visible root.
      void this.port.exitFullscreen().catch(() => undefined);
    } else if (session.settled) sessions.delete(this.port);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.session) this.release(this.session);
  }
}
