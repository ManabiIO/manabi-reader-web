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
export const foldSearchCase = (value: string) => value.toLowerCase().replace(/\u03c2/g, '\u03c3');

export const foldSearch = (value: string) => foldSearchCase(value.normalize('NFKC'));

const boundaryBefore = (value: string, index: number) =>
  index > 0 && /[\s\p{P}\p{S}]/u.test(Array.from(value.slice(0, index)).at(-1) ?? '');

function matchKey(value: string, needle: string) {
  const folded = foldSearch(value);
  const index = folded.indexOf(needle);
  const tier =
    index < 0 ? 4 : folded === needle ? 0 : index === 0 ? 1 : boundaryBefore(folded, index) ? 2 : 3;
  return {
    tier,
    index: index < 0 ? Number.MAX_SAFE_INTEGER : index,
    length: Array.from(folded).length,
    folded
  };
}

/**
 * Deterministic metadata-search relevance: exact, prefix, token-boundary,
 * then interior substring. Shorter and earlier matches win within a tier.
 * Callers should still filter non-matches before presenting results.
 */
export function compareSearchText(left: string, right: string, query: string): number {
  const needle = foldSearch(query.trim());
  if (!needle) return 0;
  const a = matchKey(left, needle);
  const b = matchKey(right, needle);
  return (
    a.tier - b.tier ||
    a.index - b.index ||
    a.length - b.length ||
    a.folded.localeCompare(b.folded)
  );
}
