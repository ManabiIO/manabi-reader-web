/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BridgeMethod, BridgeScope } from './bridge-contract';

export type NativeReaderIdentity = { kind: 'book'; id: number } | { kind: 'snippet'; id: string };
export interface NativeReaderState {
  identity?: NativeReaderIdentity;
  visible: boolean;
  pending: boolean;
  error: string;
}
export interface NativeReaderClose {
  allowed: boolean;
  destination: '/manage' | '/snippets';
}
type Command = (method: BridgeMethod, payload?: Record<string, unknown>) => Promise<unknown>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function parseNativeReaderIdentity(params: {
  id?: unknown;
  snippet?: unknown;
}): NativeReaderIdentity {
  if (
    params.id !== undefined &&
    params.snippet === undefined &&
    typeof params.id === 'string' &&
    /^[1-9]\d{0,15}$/.test(params.id) &&
    Number.isSafeInteger(Number(params.id))
  )
    return { kind: 'book', id: Number(params.id) };
  if (params.id === undefined && typeof params.snippet === 'string' && uuid.test(params.snippet))
    return { kind: 'snippet', id: params.snippet };
  throw new Error('This reader link is invalid. Open a book or snippet from your Library.');
}
export function nativeReaderPath(identity: NativeReaderIdentity) {
  return identity.kind === 'book' ? `/b?id=${identity.id}` : `/b?snippet=${identity.id}`;
}
const keyOf = (identity: NativeReaderIdentity) => `${identity.kind}:${identity.id}`;
export class ReaderNavigationCancelled extends Error {
  constructor() {
    super('The reader navigation was cancelled.');
  }
}
/** One native admission per reader/account. Async bridge replies never own navigation. */
export class NativeReaderNavigation {
  private scope = '';
  private generation = 0;
  private intent = 0;
  private routeIntent = 0;
  private readerRoute = false;
  private ownershipExit = false;
  private shown = false;
  private error = '';
  private current?: { identity: NativeReaderIdentity; value: unknown };
  private opening?: { key: string; promise: Promise<unknown> };
  private closing?: Promise<NativeReaderClose>;
  constructor(
    private command: Command,
    private replace: (path: string) => void,
    private changed: (state: NativeReaderState) => void
  ) {}
  get state(): NativeReaderState {
    return {
      identity: this.current?.identity,
      visible: this.shown,
      pending: !!this.opening || !!this.closing,
      error: this.error
    };
  }
  private publish() {
    if (this.current && this.readerRoute) this.shown = true;
    this.changed(this.state);
  }
  /** Returns the safe exit for a revoked reader. Never replays its old command. */
  setScope(scope: BridgeScope): NativeReaderClose['destination'] | undefined {
    const key = `${scope.session}:${scope.epoch}`;
    if (key === this.scope) return undefined;
    const destination =
      this.scope && (this.current || this.opening) ? this.destination() : undefined;
    this.ownershipExit ||= !!destination;
    this.scope = key;
    this.generation++;
    this.intent++;
    this.routeIntent++;
    this.current = undefined;
    this.opening = undefined;
    this.closing = undefined;
    this.shown = false;
    this.error = '';
    this.publish();
    return destination;
  }
  dispose() {
    this.generation++;
    this.intent++;
    this.routeIntent++;
    this.current = undefined;
    this.opening = undefined;
    this.closing = undefined;
    this.shown = false;
  }
  private destination(): NativeReaderClose['destination'] {
    return this.current?.identity.kind === 'snippet' ? '/snippets' : '/manage';
  }
  ensureOpen(
    identity: NativeReaderIdentity,
    payload: Record<string, unknown> = identity.kind === 'book'
      ? { bookId: identity.id }
      : { snippetId: identity.id }
  ): Promise<unknown> {
    const key = keyOf(identity);
    if (!this.closing && this.current && keyOf(this.current.identity) === key)
      return Promise.resolve(this.current.value);
    return this.admit(
      key,
      () => this.command('open', payload),
      () => identity
    );
  }
  /** Native snippet action already admitted/mounted its DOM reader; do not open it a second time. */
  readSnippet(payload: Record<string, unknown>): Promise<unknown> {
    return this.admit(
      `snippet-action:${JSON.stringify(payload)}`,
      () => this.command('snippets.action', payload),
      (value) => {
        const id =
          value && typeof value === 'object' && 'readerId' in value ? value.readerId : undefined;
        return parseNativeReaderIdentity({ snippet: id });
      }
    );
  }
  private admit(
    key: string,
    execute: () => Promise<unknown>,
    identity: (value: unknown) => NativeReaderIdentity
  ): Promise<unknown> {
    if (this.opening?.key === key) return this.opening.promise;
    const generation = this.generation;
    const intent = ++this.intent;
    const check = () => {
      if (generation !== this.generation || intent !== this.intent)
        throw new ReaderNavigationCancelled();
    };
    const closing =
      this.current || this.opening || this.closing
        ? this.startClose()
        : Promise.resolve({ allowed: true });
    const opening = { key, promise: Promise.resolve() as Promise<unknown> };
    this.opening = opening;
    this.error = '';
    opening.promise = (async () => {
      try {
        const closed = await closing;
        check();
        if (!closed.allowed) throw new ReaderNavigationCancelled();
        const value = await execute();
        check();
        this.current = { identity: identity(value), value };
        return value;
      } finally {
        if (this.opening === opening) {
          this.opening = undefined;
          this.publish();
        }
      }
    })();
    this.publish();
    return opening.promise;
  }
  close(): Promise<NativeReaderClose> {
    // Even when saving is already coalesced, a newer exit must cancel any open queued behind it.
    this.intent++;
    if (this.closing) return this.closing;
    return this.startClose();
  }
  private startClose(): Promise<NativeReaderClose> {
    if (this.closing) return this.closing;
    const current = this.current;
    const opening = this.opening;
    const generation = this.generation;
    const destination = this.destination();
    if (!current && !opening) return Promise.resolve({ allowed: true, destination });
    const closing = Promise.resolve().then(async () => {
      try {
        const result = await this.command('close');
        if (generation !== this.generation) throw new ReaderNavigationCancelled();
        const allowed =
          !!result && typeof result === 'object' && 'allowed' in result && result.allowed === true;
        const target =
          result &&
          typeof result === 'object' &&
          'destination' in result &&
          result.destination === '/snippets'
            ? '/snippets'
            : destination;
        if (allowed) {
          if (this.current === current) this.current = undefined;
          if (this.opening === opening) this.opening = undefined;
          this.shown = false;
        }
        return { allowed, destination: target } as NativeReaderClose;
      } finally {
        if (this.closing === closing) {
          this.closing = undefined;
          this.publish();
        }
      }
    });
    this.closing = closing;
    this.publish();
    return closing;
  }
  /** The DOM's toolbar/router only emits this after its own close/save path succeeded. */
  didExit() {
    this.intent++;
    this.routeIntent++;
    this.current = undefined;
    this.opening = undefined;
    this.shown = false;
    this.error = '';
    this.publish();
  }
  /** Covers external deep links, pushes, replace/reset, and native Back route observations. */
  async route(path: string, params: { id?: unknown; snippet?: unknown }): Promise<void> {
    const intent = ++this.routeIntent;
    const generation = this.generation;
    const current = () => intent === this.routeIntent && generation === this.generation;
    this.readerRoute = path === '/b';
    if (this.ownershipExit && this.readerRoute) return;
    if (!this.readerRoute) this.ownershipExit = false;
    this.error = '';
    this.publish();
    const restore = () => {
      if (current() && this.current) this.replace(nativeReaderPath(this.current.identity));
    };
    try {
      if (this.readerRoute) {
        let identity: NativeReaderIdentity;
        try {
          identity = parseNativeReaderIdentity(params);
        } catch (cause) {
          const closed = await this.close();
          if (!current()) return;
          if (!closed.allowed) {
            restore();
            return;
          }
          throw cause;
        }
        await this.ensureOpen(identity);
      } else {
        const closed = await this.close();
        if (!current()) return;
        if (!closed.allowed) {
          restore();
          return;
        }
        if (path !== '/') await this.command('route', { path });
      }
    } catch (cause) {
      if (!current()) return;
      restore();
      if (!(cause instanceof ReaderNavigationCancelled))
        this.error =
          cause instanceof Error ? cause.message : 'The reader could not open this link.';
    } finally {
      if (current()) this.publish();
    }
  }
}
