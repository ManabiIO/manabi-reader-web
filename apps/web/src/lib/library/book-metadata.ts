/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export interface BookCreator {
  name: string;
  sortAs?: string;
}

interface ParsedCreator extends BookCreator {
  id?: string;
  role?: string;
}

function boundedText(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const text = value.replace(/\s+/gu, ' ').trim();
  return text ? text.slice(0, 512) : undefined;
}

export function extractCreators(metadata: Record<string, unknown> | undefined): BookCreator[] {
  if (!metadata) return [];
  const raw = metadata['dc:creator'];
  const values = (Array.isArray(raw) ? raw : [raw]).slice(0, 32);
  const parsed = values.flatMap((value): ParsedCreator[] => {
    if (typeof value === 'string') {
      const name = boundedText(value);
      return name ? [{ name }] : [];
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    const name = boundedText(record['#text']);
    if (!name) return [];
    const id = boundedText(record['@_id']);
    const role = boundedText(record['@_role'] ?? record['@_opf:role'])?.toLowerCase();
    const sortAs = boundedText(record['@_file-as'] ?? record['@_opf:file-as']);
    return [
      {
        name,
        ...(id ? { id } : {}),
        ...(sortAs ? { sortAs } : {}),
        ...(role ? { role } : {})
      }
    ];
  });
  const refinements = metadata.meta ?? metadata['opf:meta'];
  for (const rawRefinement of (Array.isArray(refinements) ? refinements : [refinements]).slice(
    0,
    128
  )) {
    if (!rawRefinement || typeof rawRefinement !== 'object' || Array.isArray(rawRefinement))
      continue;
    const refinement = rawRefinement as Record<string, unknown>;
    const target = boundedText(refinement['@_refines']);
    const property = boundedText(refinement['@_property'])?.toLowerCase();
    const value = boundedText(refinement['#text'] ?? refinement['@_content']);
    if (!target?.startsWith('#') || !property || !value) continue;
    const creator = parsed.find((entry) => entry.id === target.slice(1));
    if (!creator) continue;
    if (property === 'role') creator.role = value.toLowerCase();
    if (property === 'file-as') creator.sortAs = value;
  }
  const authorRoles = new Set(['aut', 'author']);
  const authors = parsed.filter((creator) => creator.role && authorRoles.has(creator.role));
  const chosen = authors.length ? authors : parsed.filter((creator) => !creator.role);
  const seen = new Set<string>();
  return chosen.flatMap(({ name, sortAs }): BookCreator[] => {
    const key = `${name}\u0000${sortAs || ''}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ name, ...(sortAs ? { sortAs } : {}) }];
  });
}

export function creatorLine(creators: BookCreator[] | undefined): string {
  return creators?.map((creator) => creator.name).join(', ') || '';
}

export function creatorSortKey(creators: BookCreator[] | undefined): string | undefined {
  const creator = creators?.[0];
  return creator ? creator.sortAs || creator.name : undefined;
}

export function sharedCreatorLine(books: { creators?: BookCreator[] }[]): string | undefined {
  if (!books.length) return;
  const first = creatorLine(books[0].creators);
  if (!first || books.some((book) => creatorLine(book.creators) !== first)) return;
  return first;
}

export function validCreators(value: unknown): value is BookCreator[] {
  return (
    Array.isArray(value) &&
    value.length <= 32 &&
    value.every(
      (creator) =>
        creator &&
        typeof creator === 'object' &&
        !Array.isArray(creator) &&
        Object.keys(creator).every((key) => key === 'name' || key === 'sortAs') &&
        typeof creator.name === 'string' &&
        creator.name.length > 0 &&
        creator.name.length <= 512 &&
        creator.name === creator.name.replace(/\s+/gu, ' ').trim() &&
        (creator.sortAs === undefined ||
          (typeof creator.sortAs === 'string' &&
            creator.sortAs.length > 0 &&
            creator.sortAs.length <= 512 &&
            creator.sortAs === creator.sortAs.replace(/\s+/gu, ' ').trim()))
    )
  );
}
