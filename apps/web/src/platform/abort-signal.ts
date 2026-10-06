/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** React Native's AbortSignal lacks throwIfAborted on the qualified Hermes
 * runtime. Retain cancellation without relying on optional browser methods. */
export function assertNotAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason !== undefined) throw signal.reason;
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  throw error;
}
