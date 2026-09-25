/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { canonical, record, number, type Plain } from './ttu-migration-format.ts';
import {
  codePointLength,
  makeLocator,
  type ProjectedResource,
  type ReaderLocator
} from '../reader-location.ts';

export type StudyKind = 'savedBookmarks' | 'highlights' | 'notes';
export interface ImportedStudyEntry {
  id: string;
  kind: StudyKind;
  source: Plain;
  title: string;
  text: string;
  note: string;
  color: 'yellow' | 'blue' | 'green' | 'pink' | 'purple';
  createdAt: number;
  modifiedAt: number;
  locator?: ReaderLocator;
  unresolved?: string;
  deleted?: boolean;
}
export interface ImportedStudy {
  version: 1;
  sourceTitle: string;
  fingerprint: string;
  entries: ImportedStudyEntry[];
  receipts: Record<string, string>;
  metadata?: Plain;
}
const maximumEntries = 10_000;
const maxText = 65_536;
function string(value: unknown, name: string, maximum = maxText): string {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > maximum)
    throw new Error(`Invalid Yatsu ${name}.`);
  return value;
}
/** Bounded JSON only. Foreign metadata is never evaluated or inserted as HTML. */
export function safeStudyJSON(value: unknown): Plain {
  let visited = 0;
  const visit = (item: unknown, depth: number): void => {
    if (++visited > 4096 || depth > 12) throw new Error('Oversized Yatsu record.');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') {
      if (item.length > maxText) throw new Error('Oversized Yatsu field.');
      return;
    }
    if (typeof item === 'number') {
      number(item, 'metadata number', true);
      return;
    }
    if (Array.isArray(item)) {
      for (const child of item) visit(child, depth + 1);
      return;
    }
    if (!item || typeof item !== 'object') throw new Error('Invalid Yatsu metadata.');
    for (const [key, child] of Object.entries(item)) {
      if (key.length > 128 || ['__proto__', 'prototype', 'constructor'].includes(key))
        throw new Error('Invalid Yatsu metadata key.');
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
  const v = record(value, 'Yatsu record');
  if (JSON.stringify(v).length > 256 * 1024) throw new Error('Oversized Yatsu record.');
  return structuredClone(v);
}
async function idFor(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, '0')).join('');
}
export async function studyEntries(
  value: unknown,
  kind: StudyKind,
  title: string,
  modified: number
): Promise<ImportedStudyEntry[]> {
  if (!Array.isArray(value) || value.length > maximumEntries)
    throw new Error('Invalid or oversized Yatsu study collection.');
  const seen = new Set<string>();
  const entries: ImportedStudyEntry[] = [];
  for (const row of value) {
    const source = safeStudyJSON(row);
    if (source.bookTitle !== title) throw new Error('Yatsu study data belongs to another book.');
    const createdAt = number(source.dateCreated, 'creation date');
    const modifiedAt = number(source.dateModified ?? modified, 'modification date');
    if (
      !Number.isFinite(new Date(createdAt).getTime()) ||
      !Number.isFinite(new Date(modifiedAt).getTime())
    )
      throw new Error('Invalid Yatsu study date.');
    const text = string(kind === 'savedBookmarks' ? source.textSnippet : source.text, 'study text');
    const label = string(
      kind === 'savedBookmarks' ? source.label : source.title,
      'study title',
      4096
    );
    const note = string(source.note, 'note');
    for (const key of [
      'startOffset',
      'endOffset',
      'targetSectionIndex',
      'targetLocalStartOffset',
      'targetLocalEndOffset',
      'textOccurrenceIndex'
    ]) {
      if (
        source[key] !== undefined &&
        (!Number.isSafeInteger(source[key]) || Number(source[key]) < 0)
      )
        throw new Error(`Invalid Yatsu ${key}.`);
    }
    for (const key of ['prefixContext', 'suffixContext', 'targetSectionId', 'syncId'])
      if (source[key] !== undefined) string(source[key], key, 4096);
    if (
      source.startOffset !== undefined &&
      source.endOffset !== undefined &&
      Number(source.endOffset) < Number(source.startOffset)
    )
      throw new Error('Reversed Yatsu highlight.');
    if (kind === 'highlights' && !text) throw new Error('Yatsu highlight has no original text.');
    // Exported browser IDs are intentionally ignored. Editable labels/notes/color do not change identity.
    const identity =
      kind === 'notes' && source.syncId
        ? ['sync', source.syncId]
        : [
            createdAt,
            source.startOffset,
            source.endOffset,
            source.targetSectionIndex,
            source.targetSectionId,
            source.exploredCharCount,
            source.progress,
            kind === 'highlights' ? text : undefined
          ];
    const id = await idFor([kind, identity]);
    if (seen.has(id))
      throw new Error(
        'Ambiguous duplicate Yatsu study identities. Export these records separately.'
      );
    seen.add(id);
    const color = ['yellow', 'blue', 'green', 'pink', 'purple'].includes(String(source.color))
      ? (source.color as ImportedStudyEntry['color'])
      : 'yellow';
    entries.push({ id, kind, source, title: label, text, note, color, createdAt, modifiedAt });
  }
  return entries;
}
/** Only unique source text (optionally scoped by a verified section) may become a new locator. */
export async function locateStudy(
  entry: ImportedStudyEntry,
  resources: ProjectedResource[]
): Promise<ImportedStudyEntry> {
  if (entry.kind === 'notes')
    return { ...entry, unresolved: 'Book note — not attached to a passage.' };
  const raw = entry.source;
  let candidates = resources;
  if (typeof raw.targetSectionId === 'string' && raw.targetSectionId) {
    candidates = resources.filter((r) => r.resource.sectionId === raw.targetSectionId);
    if (candidates.length !== 1)
      return { ...entry, unresolved: 'The original section could not be verified.' };
    if (
      raw.targetSectionIndex !== undefined &&
      candidates[0].resource.spineIndex !== raw.targetSectionIndex
    )
      return { ...entry, unresolved: 'The original section references disagree.' };
  } else if (typeof raw.targetSectionIndex === 'number') {
    candidates = resources.filter((r) => r.resource.spineIndex === raw.targetSectionIndex);
  }
  const matches: { projected: ProjectedResource; start: number; end: number }[] = [];
  if (entry.text) {
    for (const projected of candidates) {
      let index = -1;
      while ((index = projected.text.indexOf(entry.text, index + 1)) !== -1) {
        const prefix = typeof raw.prefixContext === 'string' ? raw.prefixContext : '';
        const suffix = typeof raw.suffixContext === 'string' ? raw.suffixContext : '';
        if (prefix && !projected.text.slice(0, index).endsWith(prefix)) continue;
        if (suffix && !projected.text.slice(index + entry.text.length).startsWith(suffix)) continue;
        const start = codePointLength(projected.text.slice(0, index));
        matches.push({ projected, start, end: start + codePointLength(entry.text) });
        if (matches.length > 1) break;
      }
      if (matches.length > 1) break;
    }
  } else if (
    entry.kind === 'savedBookmarks' &&
    raw.exploredCharCount === 0 &&
    raw.progress === 0 &&
    candidates.some((r) => r.resource.spineIndex === 0)
  ) {
    const projected = candidates.find((r) => r.resource.spineIndex === 0)!;
    matches.push({ projected, start: 0, end: 0 });
  }
  if (matches.length !== 1)
    return {
      ...entry,
      unresolved: matches.length
        ? 'This excerpt occurs more than once; no location was guessed.'
        : 'Original position retained. It cannot be safely mapped to this layout.'
    };
  const { projected, start, end } = matches[0];
  return { ...entry, locator: await makeLocator('import:pending', projected, start, end) };
}
export function studyComparable(entry: ImportedStudyEntry): string {
  // Derived locators are rebuildable; source witnesses and user edits are not.
  const { locator: _locator, unresolved: _unresolved, ...value } = entry;
  return canonical(value);
}
export function validImportedStudy(value: unknown): value is ImportedStudy {
  if (!value || typeof value !== 'object') return false;
  const v = value as ImportedStudy;
  return (
    v.version === 1 &&
    typeof v.sourceTitle === 'string' &&
    /^[a-f0-9]{64}$/.test(v.fingerprint) &&
    Array.isArray(v.entries) &&
    v.entries.length <= maximumEntries &&
    !!v.receipts &&
    typeof v.receipts === 'object'
  );
}
