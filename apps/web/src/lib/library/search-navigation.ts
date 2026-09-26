/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ReaderLocator } from '../reader-location';
interface Pending {
  bookId: number;
  owner: string | null;
  locator: ReaderLocator;
  expires: number;
  token: string;
}
let pending: Pending | undefined;
/** Tab-local handoff, not a URL containing private book text; consumed once after layout settles. */
export function queueLibraryLocation(bookId: number, owner: string | null, locator: ReaderLocator) {
  const token = crypto.randomUUID();
  pending = { bookId, owner, locator, expires: Date.now() + 5 * 60 * 1000, token };
  return token;
}
export function takeLibraryLocation(
  bookId: number,
  owner: string | null,
  token: string | null
): ReaderLocator | undefined {
  const value = pending;
  pending = undefined;
  if (
    token &&
    value?.token === token &&
    value.bookId === bookId &&
    value.owner === owner &&
    value.expires >= Date.now()
  )
    return value.locator;
  return undefined;
}
export function clearLibraryLocation() {
  pending = undefined;
}
