/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Dependency-free text matching shared by Reader and the standalone media build. */

/** Shared, locale-independent search normalization (not general Unicode case folding).
 * Lowercasing whole words can produce a final sigma, whereas lowercasing each
 * grapheme cannot see that context. Equate both sigma forms so the worker's
 * source-offset mapping and metadata/query matching agree. Never store this
 * normalized text in a book, excerpt, or durable locator.
 */
export const foldSearchCase = (value: string) => value.toLowerCase().replace(/\u03c2/g, '\u03c3');

export const foldSearch = (value: string) => foldSearchCase(value.normalize('NFKC'));

interface SearchMatchKey {
  /** Primary title fields always rank before metadata-only fallback fields. */
  group: number;
  tier: number;
  field: number;
  index: number;
  /** UTF-16 offset in folded text for mapping back to the source. */
  foldedIndex: number;
  length: number;
  folded: string;
}

const boundaryBefore = (value: string, index: number) => {
  if (index <= 0) return false;
  const previous = value.charCodeAt(index - 1);
  const start =
    previous >= 0xdc00 &&
    previous <= 0xdfff &&
    index > 1 &&
    value.charCodeAt(index - 2) >= 0xd800 &&
    value.charCodeAt(index - 2) <= 0xdbff
      ? index - 2
      : index - 1;
  return /[\s\p{P}\p{S}]/u.test(value.slice(start, index));
};

function matchKey(value: string, needle: string, field = 0, group = 0): SearchMatchKey {
  const folded = foldSearch(value);
  if (folded === needle)
    return {
      group,
      tier: 0,
      field,
      index: 0,
      foldedIndex: 0,
      length: Array.from(folded).length,
      folded
    };

  const first = folded.indexOf(needle);
  if (first < 0)
    return {
      group,
      tier: 4,
      field,
      index: Number.MAX_SAFE_INTEGER,
      foldedIndex: -1,
      length: Array.from(folded).length,
      folded
    };

  let best = first;
  let tier = first === 0 ? 1 : 3;
  if (tier === 3) {
    // A later word/symbol boundary is more relevant than an earlier interior
    // substring. Scan only until the first boundary match; all boundary matches
    // share the same tier and the earliest one wins.
    for (let candidate = first; candidate >= 0; candidate = folded.indexOf(needle, candidate + 1)) {
      if (boundaryBefore(folded, candidate)) {
        best = candidate;
        tier = 2;
        break;
      }
    }
  }
  return {
    group,
    tier,
    field,
    // indexOf reports UTF-16 code units. Relevance positions are user-visible
    // Unicode code points so supplementary characters do not distort ordering.
    index: Array.from(folded.slice(0, best)).length,
    foldedIndex: best,
    length: Array.from(folded).length,
    folded
  };
}

const compareStableText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const searchGraphemes = new Intl.Segmenter('ja', { granularity: 'grapheme' });

function bestKey(values: readonly string[], needle: string, group = 0): SearchMatchKey {
  let best = matchKey(values[0] ?? '', needle, 0, group);
  for (let index = 1; index < values.length; index++) {
    const candidate = matchKey(values[index], needle, index, group);
    if (compareKeys(candidate, best) < 0) best = candidate;
  }
  return best;
}

function compareKeys(a: SearchMatchKey, b: SearchMatchKey): number {
  return (
    a.group - b.group ||
    a.tier - b.tier ||
    a.field - b.field ||
    a.index - b.index ||
    a.length - b.length ||
    compareStableText(a.folded, b.folded)
  );
}

/**
 * Deterministic metadata-search relevance: exact, prefix, token-boundary,
 * then interior substring. Within a tier, primary metadata fields win before
 * earlier/shorter secondary-field matches.
 * Callers should still filter non-matches before presenting results.
 */
export function compareSearchText(left: string, right: string, query: string): number {
  const needle = foldSearch(query.trim());
  if (!needle) return 0;
  return compareKeys(matchKey(left, needle), matchKey(right, needle));
}

/** Select the matching field with exactly the same tier and field precedence as sorting. */
export function searchMatchedField(values: readonly string[], query: string): number | undefined {
  const needle = foldSearch(query.trim());
  if (!needle || !values.length) return;
  const best = bestKey(values, needle);
  return best.tier < 4 ? best.field : undefined;
}

/** Sort metadata while normalizing each candidate only once per admitted query. */
export interface SearchTextFields {
  primary: readonly string[];
  secondary?: readonly string[];
}

export function sortSearchText<T>(
  values: readonly T[],
  query: string,
  text: (value: T) => string | readonly string[] | SearchTextFields,
  tie: (left: T, right: T) => number = () => 0,
  options: { matchesOnly?: boolean } = {}
): T[] {
  const needle = foldSearch(query.trim());
  if (!needle) return options.matchesOnly ? [] : [...values];
  const ranked = values.map((value, order) => {
    const fields = text(value);
    let key: SearchMatchKey;
    if (typeof fields === 'string') key = bestKey([fields], needle);
    else if ('primary' in fields) {
      const primary = bestKey(fields.primary, needle, 0);
      key = primary.tier < 4 ? primary : bestKey(fields.secondary ?? [], needle, 1);
    } else key = bestKey(fields, needle);
    return { value, order, key };
  });
  return (options.matchesOnly ? ranked.filter(({ key }) => key.tier < 4) : ranked)
    .sort((a, b) => compareKeys(a.key, b.key) || tie(a.value, b.value) || a.order - b.order)
    .map(({ value }) => value);
}

/**
 * Locate the best-ranked normalized query match in original metadata text without
 * reusing folded offsets as source offsets. Suitable for short UI metadata.
 */
export function searchMatchRange(
  value: string,
  query: string
): { start: number; end: number } | undefined {
  const needle = foldSearch(query.trim());
  if (!needle) return;
  const at = matchKey(value, needle).foldedIndex;
  // Metadata-only Book hits call this for the displayed title first. Avoid
  // grapheme segmentation entirely when that title is not the matching field.
  if (at < 0) return;
  const starts: number[] = [],
    ends: number[] = [];
  for (const part of searchGraphemes.segment(value)) {
    const unit = foldSearch(part.segment);
    for (let index = 0; index < unit.length; index++) {
      starts.push(part.index);
      ends.push(part.index + part.segment.length);
    }
  }
  const start = starts[at],
    end = ends[at + needle.length - 1];
  return Number.isInteger(start) && Number.isInteger(end) && end > start
    ? { start, end }
    : undefined;
}
