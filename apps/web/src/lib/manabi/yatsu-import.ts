/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  countReadingCharacters,
  isReadingCharacter
} from '../functions/count-reading-characters.ts';
import { canonical, record, number as numeric, MigrationConflict } from './ttu-migration-format.ts';
import { projectSearchBook, searchDigest, type SearchResource } from '../library/content-search.ts';
import type { PublicationManifest, ReaderLocator } from '../reader-location';
import type { ReaderAnnotation } from '../data/database/books-db/versions/v7/books-db-v7';
import type { ReaderImportRecord } from '../data/database/books-db/versions/v10/books-db-v10';

export type YatsuPart = 'savedBookmarks' | 'highlights' | 'notes';
const placeholderKey = 'local:00000000-0000-0000-0000-000000000000';
function text(value: unknown, name: string, limit = 65536): string {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > limit) throw new Error(`Invalid Yatsu ${name}.`);
  return value;
}
function timestamp(value: unknown, fallback: number): string {
  const time = value === undefined ? fallback : numeric(value, 'Yatsu timestamp');
  if (!Number.isSafeInteger(time) || time > 8640000000000000)
    throw new Error('Invalid Yatsu timestamp.');
  return new Date(time).toISOString();
}
/** Keep unknown data as inert JSON evidence, never as preferences or active HTML. */
export function yatsuRows(
  value: unknown,
  part: YatsuPart,
  title: string
): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 10000)
    throw new Error(`Invalid or oversized Yatsu ${part}.`);
  return value.map((item) => {
    const row = record(item, `Yatsu ${part}`);
    if (row.bookTitle !== undefined && row.bookTitle !== title)
      throw new Error('Yatsu annotation belongs to another book.');
    if (new TextEncoder().encode(JSON.stringify(row)).byteLength > 192 * 1024)
      throw new Error('Yatsu annotation is too large.');
    if (part === 'notes' && !text(row.text, 'book note').trim())
      throw new Error('Yatsu book note has no text.');
    if (part === 'highlights' && !text(row.text, 'highlight').length)
      throw new Error('Yatsu highlight has no text.');
    for (const field of ['text', 'note', 'textSnippet', 'prefixContext', 'suffixContext'])
      text(row[field], field);
    for (const field of ['label', 'title', 'syncId']) text(row[field], field, 512);
    for (const field of ['dateCreated', 'dateModified', 'lastBookmarkModified'])
      if (row[field] !== undefined) timestamp(row[field], 0);
    if (row.exploredCharCount !== undefined) numeric(row.exploredCharCount, 'character position');
    return row;
  });
}
/** Stable UUID-shaped identities keep repeated imports from duplicating annotations. */
async function importId(seed: string): Promise<string> {
  const digest = await searchDigest(seed);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
function candidates(resources: SearchResource[], row: Record<string, unknown>, quote: string) {
  const matches: { resource: SearchResource; start: number; end: number }[] = [];
  for (const resource of resources) {
    if (
      typeof row.targetSectionId === 'string' &&
      row.targetSectionId &&
      resource.resource.sectionId !== row.targetSectionId
    )
      continue;
    // Yatsu joins nonblank text nodes without adding block separators. Preserve
    // those coordinates as witnesses, but store Manabi's original source range.
    const source = resource.legacy?.text ?? resource.text;
    const prefix = text(row.prefixContext, 'prefix'),
      suffix = text(row.suffixContext, 'suffix');
    let at = source.indexOf(quote);
    while (at >= 0) {
      if (
        (!prefix || source.slice(Math.max(0, at - prefix.length), at) === prefix) &&
        (!suffix || source.slice(at + quote.length, at + quote.length + suffix.length) === suffix)
      ) {
        let from = at,
          to = at + quote.length;
        if (resource.legacy) {
          const first = resource.legacy.runs.find(
            (r) => r.source <= at && at < r.source + r.length
          );
          const last = resource.legacy.runs.find((r) => r.source < to && to <= r.source + r.length);
          if (!first || !last) {
            at = source.indexOf(quote, at + 1);
            continue;
          }
          from = first.target + at - first.source;
          to = last.target + to - last.source;
        }
        const start = [...resource.text.slice(0, from)].length,
          end = [...resource.text.slice(0, to)].length;
        matches.push({ resource, start, end });
        if (matches.length > 1) return matches;
      }
      at = source.indexOf(quote, at + 1);
    }
  }
  return matches;
}
function countedBookmark(resources: SearchResource[], row: Record<string, unknown>) {
  const point = row.exploredCharCount,
    total = row.sourceBookCharCount;
  if (
    !Number.isSafeInteger(point) ||
    !Number.isSafeInteger(total) ||
    Number(point) < 0 ||
    Number(total) <= 0 ||
    Number(point) > Number(total)
  )
    return;
  const counts = resources.map((r) => countReadingCharacters(r.text));
  if (counts.reduce((a, b) => a + b, 0) !== total) return; // Changed counter or gaiji representation: retain, never guess.
  let prior = 0;
  for (let i = 0; i < resources.length; i++) {
    const resource = resources[i],
      count = counts[i];
    if (
      Number(point) >= prior &&
      Number(point) <= prior + count &&
      (row.targetSectionId === undefined || row.targetSectionId === resource.resource.sectionId) &&
      (row.targetSectionIndex === undefined || row.targetSectionIndex === i)
    ) {
      let consumed = prior,
        offset = 0;
      for (const character of resource.text) {
        if (consumed === point) return { resource, offset };
        if (isReadingCharacter(character)) consumed++;
        offset++;
      }
      if (consumed === point) return { resource, offset };
    }
    prior += count;
  }
  return undefined;
}

async function locator(
  resource: SearchResource,
  start: number,
  end: number
): Promise<ReaderLocator> {
  const points = [...resource.text];
  return {
    version: 1,
    bookKey: placeholderKey,
    resource: resource.resource,
    projectionVersion: 2,
    resourceDigest: await searchDigest(resource.text),
    start,
    end,
    quote: points.slice(start, end).join(''),
    prefix: points.slice(Math.max(0, start - 32), start).join(''),
    suffix: points.slice(end, end + 32).join('')
  };
}
export interface PreparedYatsuEntry {
  record: ReaderImportRecord;
  annotation?: ReaderAnnotation;
}
export async function prepareYatsuEntries(
  groups: { part: YatsuPart; rows: Record<string, unknown>[]; modified: number }[],
  title: string,
  fingerprint: string,
  html?: string,
  manifest?: PublicationManifest,
  signal?: AbortSignal
): Promise<PreparedYatsuEntry[]> {
  const resources = html === undefined ? [] : projectSearchBook(html, manifest, true);
  const results: PreparedYatsuEntry[] = [];
  const identities = new Set<string>();
  for (const group of groups)
    for (const row of group.rows) {
      signal?.throwIfAborted();
      // Yatsu notes supply syncId; older highlights/bookmarks supply creation time and source position.
      const seed =
        row.syncId ||
        canonical({
          dateCreated: row.dateCreated,
          startOffset: row.startOffset,
          exploredCharCount: row.exploredCharCount,
          targetSectionId: row.targetSectionId,
          text: group.part === 'highlights' ? row.text : undefined
        });
      const id = await importId(canonical([fingerprint, title, group.part, seed]));
      if (identities.has(id))
        throw new MigrationConflict(
          'Two Yatsu records have the same source identity. Keep the original ZIP and resolve this duplicate before importing.'
        );
      identities.add(id);
      const createdAt = timestamp(row.dateCreated, group.modified),
        modifiedAt = timestamp(row.dateModified, Date.parse(createdAt));
      const quote = text(
        group.part === 'savedBookmarks'
          ? row.textSnippet
          : group.part === 'highlights'
            ? row.text
            : undefined,
        'quote'
      );
      const body = text(group.part === 'notes' ? row.text : row.note, 'note');
      const label =
        text(row.label ?? row.title, 'label', 512) ||
        (group.part === 'notes'
          ? 'Book note'
          : group.part === 'savedBookmarks'
            ? 'Imported bookmark'
            : 'Imported highlight');
      let target: ReaderLocator | undefined;
      if (group.part !== 'notes' && quote) {
        const found = candidates(resources, row, quote);
        if (found.length === 1)
          target = await locator(
            found[0].resource,
            found[0].start,
            group.part === 'savedBookmarks' ? found[0].start : found[0].end
          );
      } else if (
        group.part === 'savedBookmarks' &&
        row.exploredCharCount === 0 &&
        (row.targetSectionIndex === undefined || row.targetSectionIndex === 0) &&
        resources[0] &&
        (!row.targetSectionId || row.targetSectionId === resources[0].resource.sectionId)
      ) {
        target = await locator(resources[0], 0, 0);
      }
      if (!target && group.part === 'savedBookmarks' && !quote) {
        const counted = countedBookmark(resources, row);
        if (counted) target = await locator(counted.resource, counted.offset, counted.offset);
      }
      const status = target ? 'anchored' : group.part === 'notes' ? 'book-note' : 'unresolved';
      const reason =
        status === 'unresolved'
          ? 'The original position is retained, but there is no unique verified passage. No approximate location was substituted.'
          : undefined;
      const imported: ReaderImportRecord = {
        id,
        bookId: 0,
        bookKey: placeholderKey,
        accountId: null,
        part: group.part,
        source: row,
        sourceCanonical: canonical(row),
        status,
        reason,
        label,
        body,
        quote,
        importedBody: body,
        importedLabel: label,
        createdAt,
        modifiedAt
      };
      let annotation: ReaderAnnotation | undefined;
      if (target) {
        annotation = {
          id,
          bookKey: placeholderKey,
          kind: group.part === 'savedBookmarks' ? 'bookmark' : 'highlight',
          targets: [target],
          body: body || undefined,
          label,
          color: ['yellow', 'blue', 'green', 'pink', 'purple'].includes(String(row.color))
            ? (row.color as ReaderAnnotation['color'])
            : 'yellow',
          createdAt,
          modifiedAt,
          revision: 1
        };
        imported.annotationId = id;
      }
      results.push({ record: imported, annotation });
      if (results.length % 32 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        signal?.throwIfAborted();
      }
    }
  return results;
}
export function annotationContent(value: ReaderAnnotation | undefined) {
  if (!value) return '';
  const { revision: _revision, modifiedAt: _modified, ...content } = value;
  return canonical(content);
}
