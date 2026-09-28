/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { extractCreators, validCreators, type BookCreator } from './book-metadata.ts';

export interface BookMetadata {
  creators?: BookCreator[];
  language?: string;
  publisher?: string;
  published?: string;
  description?: string;
  subjects?: string[];
}
export interface BookSeries {
  name: string;
  index?: number;
}
const limits = { language: 128, publisher: 512, published: 128, description: 16000 } as const;
export function boundedMetadataText(
  value: unknown,
  limit: number,
  multiline = false
): value is string {
  return (
    typeof value === 'string' &&
    value.length <= limit &&
    ![...value].some((char) => {
      const code = char.codePointAt(0)!;
      return (
        (code < 32 && !(multiline && [9, 10, 13].includes(code))) ||
        code === 127 ||
        (code >= 0xd800 && code <= 0xdfff)
      );
    })
  );
}
export function validBookMetadata(value: unknown): value is BookMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (
    Object.keys(item).some((key) => ![...Object.keys(limits), 'creators', 'subjects'].includes(key))
  )
    return false;
  if (
    item.creators !== undefined &&
    (!validCreators(item.creators) ||
      !item.creators.every(
        (creator) =>
          boundedMetadataText(creator.name, 512) &&
          (creator.sortAs === undefined || boundedMetadataText(creator.sortAs, 512))
      ))
  )
    return false;
  if (
    item.subjects !== undefined &&
    (!Array.isArray(item.subjects) ||
      item.subjects.length > 64 ||
      !item.subjects.every((subject) => boundedMetadataText(subject, 240)))
  )
    return false;
  return Object.entries(limits).every(
    ([key, limit]) =>
      item[key] === undefined || boundedMetadataText(item[key], limit, key === 'description')
  );
}
export function validBookSeries(value: unknown): value is BookSeries | null {
  if (value === null) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    Object.keys(item).every((key) => ['name', 'index'].includes(key)) &&
    boundedMetadataText(item.name, 240) &&
    !!item.name.trim() &&
    (item.index === undefined ||
      (typeof item.index === 'number' &&
        Number.isFinite(item.index) &&
        item.index >= 0 &&
        item.index <= 1000000))
  );
}
export function extractBookMetadata(metadata: Record<string, unknown> | undefined): BookMetadata {
  if (!metadata) return {};
  function text(raw: unknown, limit: number, multiline = false): string | undefined {
    if (Array.isArray(raw)) raw = raw[0];
    if (raw && typeof raw === 'object') raw = (raw as Record<string, unknown>)['#text'];
    if (typeof raw !== 'string' && typeof raw !== 'number') return;
    const value = String(raw).trim();
    // Do not cut a UTF-16 surrogate in half when bounding publisher-supplied values.
    let bounded = '';
    for (const char of value) {
      if (bounded.length + char.length > limit) break;
      bounded += char;
    }
    return boundedMetadataText(bounded, limit, multiline) ? bounded : undefined;
  }
  const result: BookMetadata = { creators: extractCreators(metadata) };
  const fields = {
    language: 'dc:language',
    publisher: 'dc:publisher',
    published: 'dc:date',
    description: 'dc:description'
  } as const;
  for (const [key, source] of Object.entries(fields)) {
    const field = key as keyof typeof fields;
    const value = text(metadata[source], limits[field], field === 'description');
    if (value !== undefined) result[field] = value;
  }
  const subjects = metadata['dc:subject'];
  if (subjects !== undefined)
    result.subjects = [
      ...new Set(
        (Array.isArray(subjects) ? subjects : [subjects])
          .slice(0, 64)
          .map((value) => text(value, 240))
          .filter((value): value is string => !!value)
      )
    ];
  return result;
}
