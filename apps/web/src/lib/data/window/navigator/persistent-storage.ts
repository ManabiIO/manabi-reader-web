/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { createStorageAccess } from './storage-access.mjs';

const automaticStorage = createStorageAccess(() => globalThis.navigator?.storage);
let automaticRequest: Promise<boolean> | undefined;
let automaticSettled = false;
let automaticResult: boolean | undefined;

function startRequest() {
  automaticSettled = false;
  let current: Promise<boolean>;
  current = automaticStorage
    .persist()
    .catch(() => false)
    .then((result) => {
      if (automaticRequest === current) automaticResult = result;
      return result;
    })
    .finally(() => {
      if (automaticRequest === current) automaticSettled = true;
    });
  automaticRequest = current;
  return current;
}

/**
 * Request origin-level eviction protection at most once per page lifetime.
 * Callers deliberately do not await this: browser permission UI must never
 * delay the local write that motivated the request.
 */
export function requestPersistentStorageOnce(): Promise<boolean> {
  return automaticRequest ?? startRequest();
}

/**
 * User-initiated retry shares any active browser prompt. A completed denial can
 * be retried explicitly, but a successful grant is never requested twice.
 */
export function retryPersistentStorage(): Promise<boolean> {
  if (automaticRequest && !automaticSettled) return automaticRequest;
  if (automaticResult === true) return Promise.resolve(true);
  return startRequest();
}

/** Return the current automatic request without starting browser permission UI. */
export function currentPersistentStorageRequest(): Promise<boolean> | undefined {
  return automaticRequest;
}
