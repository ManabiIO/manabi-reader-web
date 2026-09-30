/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { storage } from './storage';

let automaticRequest: Promise<boolean> | undefined;

/**
 * Request origin-level eviction protection at most once per page lifetime.
 * Callers deliberately do not await this: browser permission UI must never
 * delay the local write that motivated the request.
 */
export function requestPersistentStorageOnce(): Promise<boolean> {
  automaticRequest ??= storage.persist().catch(() => false);
  return automaticRequest;
}
