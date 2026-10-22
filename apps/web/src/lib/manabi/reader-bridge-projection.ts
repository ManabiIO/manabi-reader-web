/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  bookmark,
  canonical,
  date,
  importFile,
  statistics,
  type Plain
} from './ttu-migration-format.ts';
import { validReaderBridgeSnapshot, type ReaderBridgeSnapshot } from './reader-bridge-plan.ts';

export const READER_BRIDGE_RECORD_LIMITS = Object.freeze({
  resumeBytes: 64 * 1024,
  statisticsBytes: 8 * 1024 * 1024,
  statisticsDays: 19999
});
export interface ReaderBridgeFile {
  name: string;
  /** Exact UTF-8 JSON text, retained independently of the normalized projection. */
  body: string;
}
export interface ReaderBridgeProjection {
  snapshot: ReaderBridgeSnapshot;
  /** Validated wire values. A local adapter must map every field before applying;
   * Yatsu location context and dictionary counts cannot be silently discarded. */
  values: Readonly<Record<string, Readonly<Plain>>>;
  /** Keep originals for recovery; normalized values are NOT a lossless wire encoder. */
  originals: readonly Readonly<ReaderBridgeFile>[];
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Compare supported data, excluding transport bookkeeping. Keep scroll fallback
 * coordinates: discarding them can hide a real change in a legacy-only position. */
function semantic(value: Plain, resume: boolean): Plain {
  const out = { ...value };
  delete out[resume ? 'lastBookmarkModified' : 'lastStatisticModified'];
  if (resume && out.completion) {
    out.completion = { ...(out.completion as Plain) };
    delete (out.completion as Plain).modifiedAt;
  }
  if (!resume && out.completedData) {
    out.completedData = { ...(out.completedData as Plain) };
    for (const key of ['lastStatisticModified', 'exporterVersion', 'dbVersion'])
      delete (out.completedData as Plain)[key];
  }
  return out;
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

/** Decode selected progress/statistics files after the adapter has verified book
 * content identity and a stable remote file set. Does not verify those facts,
 * authorize Drive, infer deletion, persist a baseline, or enable cloud writes.
 * The same decoder can project an explicit local export for comparison. */
export async function projectReaderBridgeFiles(
  identity: Omit<ReaderBridgeSnapshot, 'records'>,
  book: { title: string; characters: number },
  files: readonly ReaderBridgeFile[],
  signal?: AbortSignal
): Promise<ReaderBridgeProjection> {
  signal?.throwIfAborted();
  // Capture before the first await: caller mutation cannot relabel a digest.
  const snapshot: ReaderBridgeSnapshot = {
    binding: identity.binding,
    generation: identity.generation,
    profile: identity.profile,
    fingerprint: identity.fingerprint,
    revision: identity.revision,
    records: Object.create(null)
  };
  if (!validReaderBridgeSnapshot(snapshot)) throw new Error('Invalid reader bridge identity.');
  if (
    typeof book.title !== 'string' ||
    !book.title ||
    book.title.length > 4096 ||
    !Number.isSafeInteger(book.characters) ||
    book.characters < 0
  )
    throw new Error('Invalid verified book metadata.');
  if (!Array.isArray(files) || files.length > 2)
    throw new Error('Select at most one progress file and one statistics file.');
  const originals: ReaderBridgeFile[] = [];
  const values: Record<string, Plain> = Object.create(null);
  const parts = new Set<string>();
  const source = snapshot.profile.startsWith('yatsu-') ? 'yatsu' : 'ttu';
  const version = snapshot.profile.split('-').slice(1).join('_');
  const selected: readonly ReaderBridgeFile[] = files;
  for (const file of selected) {
    if (
      !file ||
      typeof file.name !== 'string' ||
      file.name.length > 8192 ||
      /[/\\]/.test(file.name) ||
      [...file.name].some((character) => character.charCodeAt(0) < 32) ||
      typeof file.body !== 'string'
    )
      throw new Error('Invalid reader state file.');
    const descriptor = importFile(file.name, source);
    if (
      !descriptor ||
      !['bookmark', 'statistics'].includes(descriptor.part) ||
      file.name.split('_').slice(1, 3).join('_') !== version
    )
      throw new Error('The reader state file does not match the selected format.');
    if (parts.has(descriptor.part))
      throw new Error('Conflicting reader state files. Keep both for review.');
    parts.add(descriptor.part);
    const maximum =
      descriptor.part === 'bookmark'
        ? READER_BRIDGE_RECORD_LIMITS.resumeBytes
        : READER_BRIDGE_RECORD_LIMITS.statisticsBytes;
    if (file.body.length > maximum || new TextEncoder().encode(file.body).byteLength > maximum)
      throw new Error('Reader state file exceeds the supported size.');
    const parsed: unknown = JSON.parse(file.body);
    if (descriptor.part === 'bookmark') {
      const value = bookmark(parsed, descriptor.modified, source);
      const label = file.name.slice(0, -5).split('_')[4];
      if (
        typeof value.progress === 'number'
          ? label.trim() === '' || Number(label) !== value.progress
          : label !== String(value.progress || 0)
      )
        throw new Error('Bookmark filename and position disagree.');
      if (Number(value.exploredCharCount ?? 0) > book.characters)
        throw new Error('The bookmark is beyond the end of this book.');
      if (
        source === 'yatsu' &&
        (parsed as Plain).sourceBookCharCount !== undefined &&
        (parsed as Plain).sourceBookCharCount !== book.characters
      )
        throw new Error('The Yatsu position describes different book content.');
      if (source === 'yatsu') {
        const original = parsed as Plain;
        if (
          original.targetSectionIndex !== undefined &&
          !Number.isSafeInteger(original.targetSectionIndex)
        )
          throw new Error('Invalid Yatsu section index.');
        // The one-time importer deliberately drops these hints. A continuous
        // comparison must not acknowledge identical pixels in different sections
        // or layouts as an unchanged position. The shared validator checked all
        // fields above; retaining them is not proof of a portable local mapping.
        for (const field of [
          'targetSectionIndex',
          'targetSectionId',
          'sourceViewMode',
          'sourceReaderLayoutKey',
          'sourceBookCharCount'
        ])
          if (original[field] !== undefined) value[field] = original[field];
      }
      values.resume = value;
    } else {
      const metadata = file.name.slice(0, -5).split('_');
      if (
        metadata
          .slice(3, 16)
          .some((field) => !/^\d+$/.test(field) || !Number.isSafeInteger(Number(field)))
      )
        throw new Error('Invalid statistics filename metadata.');
      if (metadata[16] !== undefined && metadata[16] !== 'na') date(metadata[16]);
      // A filename is discovery metadata, not a baseline or a contribution.
      const rows = statistics(parsed, book.title, source);
      if (rows.length > READER_BRIDGE_RECORD_LIMITS.statisticsDays)
        throw new Error('Too many reading days for one bridge snapshot.');
      for (const [index, row] of rows.entries()) {
        const original = (parsed as Plain[])[index];
        if (source === 'yatsu' && original.dictionaryPopupOpenCount !== undefined)
          row.dictionaryPopupOpenCount = original.dictionaryPopupOpenCount;
        values[`statistics/${row.dateKey}`] = row;
      }
    }
    originals.push({ name: file.name, body: file.body });
  }
  const records: Record<string, string> = Object.create(null);
  for (const key of Object.keys(values).sort()) {
    signal?.throwIfAborted();
    records[key] = await digest(canonical(semantic(values[key], key === 'resume')));
  }
  signal?.throwIfAborted();
  snapshot.records = records;
  return freeze({ snapshot, values, originals });
}
