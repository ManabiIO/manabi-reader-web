/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Set by the bundler once, never inferred from an untrusted document URL. */
export const base = process.env.EXPO_PUBLIC_READER_BASE_PATH ?? '/reader-web';
export const assets = (process.env.EXPO_BASE_URL ?? base).replace(/\/$/, '');
export function resolve(path: string) {
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
export function asset(path: string) {
  return `${assets}/${path.replace(/^\//, '')}`;
}
