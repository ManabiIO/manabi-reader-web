/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { createStorageAccess } from './storage-access.mjs';

const automaticStorage = createStorageAccess(() => globalThis.navigator?.storage);
let automaticRequest: Promise<boolean> | undefined;
let automaticAttempted = false;
let automaticResult: boolean | undefined;

function startRequest() {
  automaticAttempted = true;
  let current: Promise<boolean>;
  current = automaticStorage
    .persist()
    .catch(() => false)
    .then((result) => {
      if (automaticRequest === current && automaticResult !== true) automaticResult = result;
      return result;
    })
    .finally(() => {
      if (automaticRequest === current) automaticRequest = undefined;
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
  if (automaticRequest) return automaticRequest;
  if (automaticAttempted) return Promise.resolve(automaticResult === true);
  return startRequest();
}

/**
 * User-initiated retry shares any active browser prompt. A completed denial can
 * be retried explicitly, but a successful grant is never requested twice.
 */
export function retryPersistentStorage(): Promise<boolean> {
  if (automaticRequest) return automaticRequest;
  if (automaticResult === true) return Promise.resolve(true);
  return startRequest();
}

/**
 * Return current persistence state without racing a stale persisted() snapshot.
 * This never starts browser permission UI.
 */
export async function persistentStorageStatus(): Promise<boolean> {
  if (await automaticStorage.persisted()) {
    automaticAttempted = true;
    automaticResult = true;
    return true;
  }
  const request = automaticRequest;
  if (request) return request;
  return automaticResult === true;
}

/** Return only the currently in-flight automatic/manual request, if any. */
export function currentPersistentStorageRequest(): Promise<boolean> | undefined {
  return automaticRequest;
}
