/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  BRIDGE_VERSION,
  MAX_BRIDGE_BYTES,
  bridgeMessageBytes,
  readOnlyBridgeMethods,
  parseBridgeRequest,
  sameScope,
  type BridgeMethod,
  type BridgeReply,
  type BridgeRequest,
  type BridgeScope
} from './bridge-contract.ts';
/** Expo DOM imperative handles return void. Replies arrive through a separate
 * native action and are correlated here; no Promise return crosses that handle. */
export class BridgeClient {
  private pending = new Map<
    string,
    {
      request: BridgeRequest;
      resolve(reply: BridgeReply): void;
      reject(error: Error): void;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();
  private serial = 0;
  private disposed = false;
  private getScope: () => BridgeScope;
  private send: (request: BridgeRequest) => void;
  constructor(getScope: () => BridgeScope, send: (request: BridgeRequest) => void) {
    this.getScope = getScope;
    this.send = send;
  }
  request(
    method: BridgeMethod,
    payload: Record<string, unknown> = {},
    timeoutMs: number | null = method === 'close'
      ? null
      : method === 'import.commit'
        ? 180000
        : 30000
  ): Promise<BridgeReply> {
    if (this.disposed)
      return Promise.reject(
        new Error('The reader host is closed. Reconcile saved state after reopening.')
      );
    if (this.pending.size >= 32)
      return Promise.reject(
        new Error('Too many reader commands are still awaiting acknowledgement.')
      );
    const scope = this.getScope();
    const request = parseBridgeRequest({
      version: BRIDGE_VERSION,
      ...scope,
      id: `${readOnlyBridgeMethods.includes(method) ? 'read_' : ''}command_${Date.now()}_${++this.serial}`,
      method,
      payload
    });
    return new Promise((resolve, reject) => {
      // Close can be waiting on a human confirmation. Only ownership retirement or teardown cancels that wait.
      const timer =
        timeoutMs === null
          ? undefined
          : setTimeout(() => {
              this.pending.delete(request.id);
              reject(
                new Error(
                  'The reader has not acknowledged this command. Refresh saved state before trying it again.'
                )
              );
            }, timeoutMs);
      this.pending.set(request.id, { request, resolve, reject, timer });
      try {
        this.send(request);
      } catch (cause) {
        clearTimeout(timer);
        this.pending.delete(request.id);
        reject(cause instanceof Error ? cause : new Error('The reader command could not be sent.'));
      }
    });
  }
  receive(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const reply = value as BridgeReply;
    if (
      reply.version !== BRIDGE_VERSION ||
      typeof reply.id !== 'string' ||
      typeof reply.ok !== 'boolean' ||
      !['not-started', 'completed', 'unknown'].includes(reply.outcome)
    )
      return false;
    const pending = this.pending.get(reply.id);
    if (!pending || !sameScope(reply, pending.request)) return false;
    let size: number;
    try {
      size = bridgeMessageBytes(JSON.stringify(value));
    } catch {
      return false;
    }
    if (size > MAX_BRIDGE_BYTES) {
      clearTimeout(pending.timer);
      this.pending.delete(reply.id);
      pending.reject(
        new Error('The reader response exceeded the bounded bridge size. Reconcile saved state.')
      );
      return false;
    }
    clearTimeout(pending.timer);
    this.pending.delete(reply.id);
    pending.resolve({
      ...reply,
      stale: !!reply.stale || !sameScope(pending.request, this.getScope())
    });
    return true;
  }
  retireStaleRequests() {
    const scope = this.getScope();
    for (const [id, pending] of this.pending) {
      if (sameScope(pending.request, scope)) continue;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(
        new Error(
          'The reader or account changed before acknowledgement. The saved outcome is unknown and must be reconciled.'
        )
      );
    }
  }
  dispose() {
    this.disposed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(
        new Error(
          'The reader host closed before acknowledgement. The saved outcome must be reconciled.'
        )
      );
    }
    this.pending.clear();
  }
}
