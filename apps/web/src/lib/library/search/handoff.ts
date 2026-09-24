/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ReaderLocator } from '../../reader-location';
interface Handoff {
  bookId: number;
  viewer: string | null;
  locator: ReaderLocator;
  expires: number;
}
let pending: Handoff | undefined;
/** Memory-only, single-use navigation. Never encode book passages or credentials in URLs. */
export function prepareLibraryPassage(
  bookId: number,
  viewer: string | null,
  locator: ReaderLocator
) {
  pending = { bookId, viewer, locator, expires: Date.now() + 30000 };
}
export function hasLibraryPassage(bookId: number, viewer: string | null) {
  return (
    !!pending &&
    pending.bookId === bookId &&
    pending.viewer === viewer &&
    pending.expires > Date.now()
  );
}
export function takeLibraryPassage(bookId: number, viewer: string | null) {
  const result = hasLibraryPassage(bookId, viewer) ? pending?.locator : undefined;
  pending = undefined;
  return result;
}
export function clearLibraryPassage() {
  pending = undefined;
}
