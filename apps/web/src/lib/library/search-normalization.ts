/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Shared, locale-independent search normalization (not general Unicode case folding).
 * Lowercasing whole words can produce a final sigma, whereas lowercasing each
 * grapheme cannot see that context. Equate both sigma forms so the worker's
 * source-offset mapping and metadata/query matching agree. Never store this
 * normalized text in a book, excerpt, or durable locator.
 */
export const foldSearch = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\u03c2/g, '\u03c3');
