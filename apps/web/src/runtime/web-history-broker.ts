/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** A browser entry, not an Expo route. Two equal URLs may be different entries. */
export interface WebHistoryEntry {
  readonly key: string;
  readonly position: number;
  readonly href: string;
  readonly state: unknown;
}

export interface WebHistoryTraversal {
  readonly from: WebHistoryEntry;
  readonly to: WebHistoryEntry;
  /** Also becomes false when app navigation or the account owner invalidates it. */
  isCurrent(): boolean;
  /** Call only after saving and retiring the outgoing reader. Never fabricates popstate. */
  replay(options?: { isCurrent?: () => boolean; notifyListeners?: boolean }): Promise<boolean>;
}

export class WebHistoryBrokerError extends Error {
  constructor(
    readonly reason: 'untracked_entry' | 'history_busy' | 'traversal_timeout' | 'history_failed',
    message: string
  ) {
    super(message);
    this.name = 'WebHistoryBrokerError';
  }
}

export interface WebHistoryBrokerOptions {
  shouldBlock(target?: WebHistoryEntry): boolean;
  /** Known same-document entries may keep their mounted route instead of
   * forwarding a native fragment traversal to the SPA navigator. */
  shouldNotifyPopstate?(entry: WebHistoryEntry, previousEntry: WebHistoryEntry): boolean;
  /** Runs only when the original, exact browser entry has been restored. */
  onTraversal(intent: WebHistoryTraversal): void;
  /** The reader must remain visible. Unknown positions cannot be repaired safely. */
  onBlocked(error: WebHistoryBrokerError): void;
  /**
   * Observe committed entries before downstream popstate listeners run. This
   * cannot veto navigation; observer exceptions are logged and isolated.
   * Restorations and intermediate rejected traversals are never reported.
   */
  onEntry?(
    entry: WebHistoryEntry,
    previousEntry: WebHistoryEntry,
    kind: 'push' | 'replace' | 'traverse'
  ): void;
  /** A missing popstate must not leave a navigation promise pending forever. */
  timeoutMs?: number;
}

export interface WebHistoryBroker {
  /** Last accepted entry, excluding temporary veto/restoration targets. */
  readonly currentEntry: WebHistoryEntry;
  /** Revoke a save/retirement completion before a newer app/account intent. */
  invalidate(): void;
  /** Call after invalidate(), before app push/replace. Rejects on unsafe recovery. */
  waitUntilRestored(): Promise<void>;
  /**
   * Revokes approval; any issued traversal is restored before detaching. Idle
   * detachment is synchronous (StrictMode safe). Await before reinstalling when
   * traversal is pending. The per-window metadata codec lasts until page unload.
   */
  dispose(): Promise<void>;
}

const metadataKey = '__manabi_web_history_v1__';
interface Marker {
  version: 1;
  owner: string;
  key: string;
  position: number;
  record: boolean;
  hadMetadata: boolean;
  originalMetadata?: unknown;
}
type Encoded = Record<string, unknown> & { [metadataKey]: Marker };
const transports = new WeakMap<Window, HistoryTransport>();
let sequence = 0;

function markerOf(value: unknown): Marker | undefined {
  if (!value || typeof value !== 'object') return;
  const marker = (value as Partial<Encoded>)[metadataKey];
  if (
    marker?.version === 1 &&
    typeof marker.owner === 'string' &&
    typeof marker.key === 'string' &&
    Number.isSafeInteger(marker.position) &&
    typeof marker.record === 'boolean' &&
    typeof marker.hadMetadata === 'boolean'
  )
    return marker;
  return undefined;
}

const decoded = new WeakMap<object, unknown>();
function decode(value: unknown): unknown {
  const marker = markerOf(value);
  if (!marker) return value;
  const encoded = value as Encoded;
  if (decoded.has(encoded)) return decoded.get(encoded);
  let result: unknown;
  if (marker.record) {
    const record = { ...encoded };
    delete (record as Partial<Encoded>)[metadataKey];
    if (marker.hadMetadata) record[metadataKey] = marker.originalMetadata as Marker;
    result = record;
  } else result = encoded.value;
  decoded.set(encoded, result);
  return result;
}

function encode(value: unknown, owner: string, key: string, position: number): Encoded {
  // Browser History normally clones this itself. Explicit cloning also prevents
  // a caller from mutating metadata/payload before a History implementation does.
  const snapshot = structuredClone(value);
  const record = Object.prototype.toString.call(snapshot) === '[object Object]';
  const data: Record<string, unknown> = record
    ? { ...(snapshot as Record<string, unknown>) }
    : { value: snapshot };
  const marker: Marker = {
    version: 1,
    owner,
    key,
    position,
    record,
    hadMetadata: record && Object.hasOwn(data, metadataKey)
  };
  if (marker.hadMetadata) marker.originalMetadata = data[metadataKey];
  return { ...data, [metadataKey]: marker };
}

function propertyDescriptor(object: object, name: PropertyKey): PropertyDescriptor | undefined {
  for (let current = object; current; current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, name);
    if (descriptor) return descriptor;
  }
  return undefined;
}

/**
 * The transport lasts for the document lifetime, even after a guard is disposed:
 * old entries still contain metadata and must continue exposing the caller's
 * original history.state/popstate.state. No global router or app code is imported.
 */
class HistoryTransport {
  readonly owner = `reader-${Date.now()}-${++sequence}-${Math.random().toString(36).slice(2)}`;
  readonly entries = new Map<number, WebHistoryEntry>();
  current!: WebHistoryEntry;
  guard?: HistoryGuard;
  private entrySequence = 0;
  private readonly rawState: () => unknown;
  private readonly push: History['pushState'];
  private readonly replace: History['replaceState'];
  private readonly go: History['go'];

  constructor(readonly window: Window) {
    const history = window.history;
    const getter = propertyDescriptor(history, 'state')?.get;
    if (!getter) throw new Error('Browser history.state is unavailable.');
    this.rawState = () => getter.call(history);
    this.push = history.pushState.bind(history);
    this.replace = history.replaceState.bind(history);
    this.go = history.go.bind(history);
    Object.defineProperty(history, 'state', {
      configurable: true,
      enumerable: true,
      get: () => decode(this.rawState())
    });
    history.pushState = (data, unused, url) => this.write(false, data, unused, url);
    history.replaceState = (data, unused, url) => this.write(true, data, unused, url);
    // Capture precedes Expo's normal popstate listener, regardless of effect order.
    window.addEventListener('popstate', this.onPopState, true);
    this.seed();
  }

  private seed() {
    this.entries.clear();
    const key = `${this.owner}:${++this.entrySequence}`;
    this.replace(
      encode(decode(this.rawState()), this.owner, key, 0),
      '',
      this.window.location.href
    );
    this.current = Object.freeze({
      key,
      position: 0,
      href: this.window.location.href,
      state: decode(this.rawState())
    });
    this.entries.set(0, this.current);
  }

  private readKnown(): WebHistoryEntry | undefined {
    const marker = markerOf(this.rawState());
    if (!marker || marker.owner !== this.owner) return;
    const recorded = this.entries.get(marker.position);
    if (recorded && recorded.key !== marker.key) return;
    // Only seed/write may establish a previously unknown marker.
    if (!recorded) return;
    if (recorded.href !== this.window.location.href) return;
    return recorded;
  }

  private write(replace: boolean, data: unknown, unused: string, url?: string | URL | null) {
    this.guard?.beforeWrite();
    if (this.actual()?.key !== this.current.key)
      throw new WebHistoryBrokerError(
        'history_busy',
        'The current history entry has not been reconciled; navigation cannot invent its position.'
      );
    const position = replace ? this.current.position : this.current.position + 1;
    const key = replace ? this.current.key : `${this.owner}:${++this.entrySequence}`;
    const previousEntry = this.current;
    const encoded = encode(data, this.owner, key, position);
    (replace ? this.replace : this.push)(encoded, unused, url);
    // Mutation succeeded. Failed structured clones/URLs must not revoke an intent.
    this.guard?.didWrite();
    if (!replace) {
      for (const index of this.entries.keys()) if (index >= position) this.entries.delete(index);
    }
    this.current = Object.freeze({
      key,
      position,
      href: this.window.location.href,
      state: decode(this.rawState())
    });
    this.entries.set(position, this.current);
    this.guard?.notifyEntry(this.current, previousEntry, replace ? 'replace' : 'push');
  }

  private onPopState = (event: PopStateEvent) => {
    // Framework listeners continue seeing exactly their own state, including id.
    Object.defineProperty(event, 'state', { configurable: true, value: decode(event.state) });
    const previousEntry = this.current;
    const entry = this.readKnown();
    if (this.guard?.onPop(entry, event)) return;
    if (entry) this.current = entry;
    else this.seed();
    this.guard?.notifyEntry(this.current, previousEntry, 'traverse');
    if (this.guard?.shouldNotifyPopstate(this.current, previousEntry) === false)
      event.stopImmediatePropagation();
  };

  traverse(from: WebHistoryEntry, to: WebHistoryEntry) {
    if (
      this.readKnown()?.key !== from.key ||
      this.entries.get(to.position)?.key !== to.key ||
      from.key === to.key
    )
      throw new WebHistoryBrokerError('untracked_entry', 'The browser history entry changed.');
    this.go(to.position - from.position);
  }

  actual() {
    return this.readKnown();
  }
}

interface PendingIntent {
  version: number;
  from: WebHistoryEntry;
  to: WebHistoryEntry;
  published: boolean;
  replay?: Promise<boolean>;
  resolveReplay?: (allowed: boolean) => void;
  isCurrentOwner?: () => boolean;
  notifyListeners?: boolean;
}
interface Command {
  kind: 'restore' | 'replay';
  target: WebHistoryEntry;
  timer: ReturnType<Window['setTimeout']>;
}

class HistoryGuard implements WebHistoryBroker {
  private version = 0;
  private origin?: WebHistoryEntry;
  private pending?: PendingIntent;
  private command?: Command;
  private fault?: WebHistoryBrokerError;
  private disposed = false;
  private replayCanceled = false;
  private waiters: Array<{ resolve(): void; reject(error: Error): void }> = [];

  constructor(
    private readonly transport: HistoryTransport,
    private readonly options: WebHistoryBrokerOptions
  ) {}
  shouldNotifyPopstate(entry: WebHistoryEntry, previous: WebHistoryEntry) {
    return this.disposed || (this.options.shouldNotifyPopstate?.(entry, previous) ?? true);
  }

  get currentEntry(): WebHistoryEntry {
    return this.transport.current;
  }

  notifyEntry(
    entry: WebHistoryEntry,
    previousEntry: WebHistoryEntry,
    kind: 'push' | 'replace' | 'traverse'
  ) {
    if (this.disposed || this.transport.guard !== this) return;
    try {
      this.options.onEntry?.(entry, previousEntry, kind);
    } catch (error) {
      console.error('Web history entry observer failed', error);
    }
  }

  invalidate = () => {
    this.version++;
    this.pending?.resolveReplay?.(false);
    this.pending = undefined;
    if (this.command?.kind === 'replay') this.replayCanceled = true;
  };

  waitUntilRestored = (): Promise<void> => {
    if (this.fault) return Promise.reject(this.fault);
    if (!this.command && (!this.origin || this.transport.actual()?.key === this.origin.key))
      return Promise.resolve();
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  };

  dispose = (): Promise<void> => {
    this.disposed = true;
    this.invalidate();
    const detach = () => {
      if (this.transport.guard === this) this.transport.guard = undefined;
    };
    if (!this.command) {
      detach();
      return this.fault ? Promise.reject(this.fault) : Promise.resolve();
    }
    return this.waitUntilRestored().finally(detach);
  };

  beforeWrite() {
    if (this.fault) throw this.fault;
    if (this.command || (this.origin && this.transport.actual()?.key !== this.origin.key))
      throw new WebHistoryBrokerError(
        'history_busy',
        'Wait for the original browser history entry before navigating.'
      );
  }

  didWrite() {
    this.invalidate();
    this.origin = undefined;
  }

  private fail(error: WebHistoryBrokerError) {
    if (this.command) this.transport.window.clearTimeout(this.command.timer);
    this.command = undefined;
    this.invalidate();
    this.fault = error;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
    if (!this.disposed) this.options.onBlocked(error);
  }

  private start(kind: Command['kind'], from: WebHistoryEntry, target: WebHistoryEntry) {
    const timer = this.transport.window.setTimeout(() => {
      this.fail(
        new WebHistoryBrokerError(
          'traversal_timeout',
          'Browser history restoration did not settle.'
        )
      );
    }, this.options.timeoutMs ?? 2500);
    this.command = { kind, target, timer };
    try {
      this.transport.traverse(from, target);
    } catch (error) {
      this.fail(
        error instanceof WebHistoryBrokerError
          ? error
          : new WebHistoryBrokerError('history_failed', 'The browser could not traverse history.')
      );
    }
  }

  private settleRestored() {
    for (const waiter of this.waiters.splice(0)) waiter.resolve();
    const pending = this.pending;
    if (!pending || pending.published || this.disposed) return;
    pending.published = true;
    const isCurrent = () =>
      !this.disposed && !this.fault && this.pending === pending && this.version === pending.version;
    queueMicrotask(() => {
      if (!isCurrent()) return;
      this.options.onTraversal({
        from: pending.from,
        to: pending.to,
        isCurrent,
        replay: (options) => {
          if (pending.replay) return pending.replay;
          if (!isCurrent() || this.command || this.transport.actual()?.key !== pending.from.key)
            return Promise.resolve(false);
          pending.replay = new Promise((resolve) => {
            pending.resolveReplay = resolve;
          });
          pending.isCurrentOwner = options?.isCurrent;
          pending.notifyListeners = options?.notifyListeners;
          this.replayCanceled = false;
          this.start('replay', pending.from, pending.to);
          return pending.replay;
        }
      });
    });
  }

  onPop(entry: WebHistoryEntry | undefined, event: PopStateEvent): boolean {
    const busy = !!(this.command || this.pending || this.fault);
    if (!busy && (this.disposed || !this.options.shouldBlock(entry))) {
      this.origin = undefined;
      return false;
    }
    const command = this.command;
    if (command?.kind === 'replay' && this.pending?.isCurrentOwner) {
      let current = false;
      try {
        current = this.pending.isCurrentOwner();
      } catch {
        /* Revoked authority. */
      }
      if (!current) this.invalidate();
    }
    if (
      entry &&
      command?.kind === 'replay' &&
      entry.key === command.target.key &&
      !this.replayCanceled &&
      this.pending &&
      !this.disposed &&
      this.pending.version === this.version
    ) {
      this.transport.window.clearTimeout(command.timer);
      this.command = undefined;
      const pending = this.pending;
      const previous = this.transport.current;
      this.transport.current = entry;
      this.origin = undefined;
      this.pending = undefined;
      this.version++;
      pending.resolveReplay?.(true);
      for (const waiter of this.waiters.splice(0)) waiter.resolve();
      if (pending.notifyListeners === false) {
        event.stopImmediatePropagation();
        this.notifyEntry(entry, previous, 'traverse');
        return true;
      }
      // A replay is a real browser event. Only this event reaches Expo.
      return false;
    }
    event.stopImmediatePropagation();
    if (this.fault) return true;
    if (!entry) {
      this.fail(
        new WebHistoryBrokerError(
          'untracked_entry',
          'This history entry is untracked; its position cannot be restored safely.'
        )
      );
      return true;
    }
    if (command && entry.key === command.target.key) {
      // History exposes an entry, not the cause of its traversal. An additional
      // observed origin event below revokes the previous intent. A browser that
      // coalesces a user traversal with this exact restoration provides no way
      // to distinguish the two through the standard History API alone.
      this.transport.window.clearTimeout(command.timer);
      this.command = undefined;
      if (entry.key === this.origin?.key) this.settleRestored();
      else if (this.origin) this.start('restore', entry, this.origin);
      return true;
    }
    if (!this.origin) this.origin = this.transport.current;
    this.invalidate();
    this.pending = {
      version: this.version,
      from: this.origin,
      to: entry,
      published: false
    };
    if (entry.key === this.origin.key) {
      this.pending = undefined;
      if (!command) this.settleRestored();
    } else if (!command) this.start('restore', entry, this.origin);
    return true;
  }
}

/**
 * Install once per web owner; call invalidate on newer app/account navigation.
 *
 * Integration prerequisite: same-document fragment writes (including EPUB
 * anchors) must use the instrumented pushState/replaceState, with scrolling
 * handled separately. A native location.hash/anchor navigation can create an
 * unmarked entry. After Back, its unchanged history.length is indistinguishable
 * from traversal to a pre-existing, untracked fragment. Such entries fail closed;
 * this broker never guesses their positions. Cross-document exits need the
 * application's beforeunload policy, not an asynchronous traversal guard.
 */
export function installWebHistoryBroker(
  window: Window,
  options: WebHistoryBrokerOptions
): WebHistoryBroker {
  let transport = transports.get(window);
  if (!transport) {
    transport = new HistoryTransport(window);
    transports.set(window, transport);
  }
  if (transport.guard) throw new Error('A web history broker is already installed.');
  if (transport.actual()?.key !== transport.current.key)
    throw new WebHistoryBrokerError(
      'untracked_entry',
      'The previous browser traversal has not restored a known current entry.'
    );
  const guard = new HistoryGuard(transport, options);
  transport.guard = guard;
  return guard;
}
