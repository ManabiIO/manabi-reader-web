/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { validCompletion } from '../library/completion.ts';
import { isCompletedStatistics } from './completed-statistics.js';

/** Import-only wire validation. No provider credentials or storage bindings enter here. */
export type ImportPart = 'book' | 'bookmark' | 'statistics' | 'audio' | 'subtitles' | 'goals';
export const importLabels: Record<ImportPart, string> = {
  book: 'Book Data',
  bookmark: 'Bookmarks',
  statistics: 'Statistics',
  audio: 'Audiobook position',
  subtitles: 'Subtitles',
  goals: 'Reading Goals'
};
export type Plain = Record<string, unknown>;
const prefixes: Record<string, ImportPart> = {
  bookdata: 'book',
  progress: 'bookmark',
  statistics: 'statistics',
  audioBook: 'audio',
  subtitles: 'subtitles',
  'ttu-user-goals': 'goals'
};
export interface ImportFile {
  part: ImportPart;
  modified: number;
  characters?: number;
  opened?: number;
}
export function record(value: unknown, description: string): Plain {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Invalid ${description}.`);
  return value as Plain;
}
function keys(value: Plain, allowed: readonly string[], description: string) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error(
      `Unsupported fields in ${description}. Export this item with the current Ttu Ebook Reader.`
    );
}
export function number(value: unknown, description: string, signed = false): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    Math.abs(value) > 1e15 ||
    (!signed && value < 0)
  )
    throw new Error(`Invalid ${description}.`);
  return value;
}
function text(value: unknown, description: string, max = 4096): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`Invalid ${description}.`);
  return value;
}
export function date(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new Error('Invalid reading date.');
  return value;
}
function array(value: unknown, description: string, maximum = 20000): unknown[] {
  if (!Array.isArray(value) || value.length > maximum)
    throw new Error(`Invalid or oversized ${description}.`);
  return value;
}

export function importFile(name: string): ImportFile | undefined {
  const prefix = Object.keys(prefixes).find((item) => name.startsWith(`${item}_`));
  if (!prefix) return undefined;
  const part = prefixes[prefix];
  const extension = part === 'book' ? '.zip' : '.json';
  if (!name.endsWith(extension)) throw new Error(`Invalid file type: ${name}`);
  const fields = name.slice(0, -extension.length).split('_');
  // Book metadata schema upgrades did not change the filename or exported
  // payload shape. Accept this application's v7/v8 archives alongside TTU v6,
  // while future schema versions still require explicit qualification.
  if (fields[1] !== '1' || !['6', '7', '8'].includes(fields[2]))
    throw new Error('Unsupported export version. Re-export with the current Ttu Ebook Reader.');
  const counts: Record<ImportPart, number[]> = {
    book: [6],
    bookmark: [5],
    statistics: [16, 17],
    audio: [5],
    subtitles: [5],
    goals: [4]
  };
  if (!counts[part].includes(fields.length)) throw new Error(`Malformed export filename: ${name}`);
  const modified = Number(fields[part === 'book' ? 4 : 3]);
  if (!/^\d+$/.test(fields[part === 'book' ? 4 : 3]) || !Number.isSafeInteger(modified))
    throw new Error(`Invalid export timestamp: ${name}`);
  if (part !== 'book') return { part, modified };
  if (![fields[3], fields[5]].every((v) => /^\d+$/.test(v) && Number.isSafeInteger(Number(v))))
    throw new Error(`Invalid book metadata: ${name}`);
  return { part, modified, characters: Number(fields[3]), opened: Number(fields[5]) };
}

export function decodeTitle(value: string): string {
  let title: string;
  try {
    title = decodeURIComponent(value)
      .replaceAll('~ttu-star~', '*')
      .replaceAll('~ttu-dend~', '.')
      .replaceAll('~ttu-spc~', ' ');
  } catch {
    throw new Error('Invalid encoded book title.');
  }
  if (!title || title.length > 4096 || [...title].some((c) => c.charCodeAt(0) < 32))
    throw new Error('Invalid book title.');
  return title;
}

export function bookmark(value: unknown, modified: number): Plain {
  const v = record(value, 'bookmark');
  keys(
    v,
    [
      'dataId',
      'scrollX',
      'scrollY',
      'exploredCharCount',
      'progress',
      'lastBookmarkModified',
      'completion'
    ],
    'bookmark'
  );
  if (v.completion !== undefined && !validCompletion(v.completion))
    throw new Error('Invalid book completion metadata.');
  const out: Plain = { lastBookmarkModified: number(v.lastBookmarkModified, 'bookmark timestamp') };
  if (v.completion !== undefined) out.completion = v.completion;
  if (out.lastBookmarkModified !== modified)
    throw new Error('Bookmark filename and data disagree.');
  for (const key of ['scrollX', 'scrollY', 'exploredCharCount']) {
    if (v[key] !== undefined) out[key] = number(v[key], key, key !== 'exploredCharCount');
  }
  if (v.progress !== undefined) {
    if (typeof v.progress === 'number') {
      out.progress = number(v.progress, 'bookmark progress');
      if (v.progress > 1) throw new Error('Bookmark progress must be a fraction.');
    } else out.progress = text(v.progress, 'bookmark anchor');
  }
  if (!['scrollX', 'scrollY', 'exploredCharCount', 'progress'].some((key) => key in out))
    throw new Error('The bookmark contains no reading position.');
  return out; // dataId is deliberately discarded and allocated by the destination DB.
}
const statisticNumbers = [
  'charactersRead',
  'readingTime',
  'minReadingSpeed',
  'altMinReadingSpeed',
  'lastReadingSpeed',
  'maxReadingSpeed'
] as const;
function completed(value: unknown, day: string): Plain {
  const v = record(value, 'completed statistics');
  if (!isCompletedStatistics(v, day)) throw new Error('Invalid completed statistics.');
  return { ...v };
}
export function statistics(value: unknown, title: string): Plain[] {
  const seen = new Set<string>();
  return array(value, 'statistics').map((item) => {
    const v = record(item, 'statistics row');
    keys(
      v,
      [
        ...statisticNumbers,
        'title',
        'dateKey',
        'lastStatisticModified',
        'completedBook',
        'completedData'
      ],
      'statistics'
    );
    if (v.title !== title) throw new Error('Statistics belong to a different book.');
    const day = date(v.dateKey);
    if (seen.has(day)) throw new Error(`Duplicate statistics for ${day}.`);
    seen.add(day);
    const out: Plain = {
      dateKey: day,
      lastStatisticModified: number(v.lastStatisticModified, 'statistics timestamp')
    };
    for (const key of statisticNumbers) out[key] = number(v[key], key);
    if (v.completedBook !== undefined) {
      if (v.completedBook !== 1) throw new Error('Invalid completed-book flag.');
      out.completedBook = 1;
    }
    if (v.completedData !== undefined) out.completedData = completed(v.completedData, day);
    return out;
  });
}
export function audio(value: unknown, title: string, modified: number): Plain {
  const v = record(value, 'audiobook position');
  keys(v, ['title', 'playbackPosition', 'lastAudioBookModified'], 'audiobook position');
  if (v.title !== title || v.lastAudioBookModified !== modified)
    throw new Error('Audiobook metadata disagrees.');
  return {
    playbackPosition: number(v.playbackPosition, 'audiobook position'),
    lastAudioBookModified: modified
  };
}
export function subtitles(value: unknown, title: string, modified: number): Plain {
  const v = record(value, 'subtitles');
  keys(v, ['title', 'subtitleData', 'lastSubtitleDataModified'], 'subtitles');
  if (v.title !== title || v.lastSubtitleDataModified !== modified)
    throw new Error('Subtitle metadata disagrees.');
  const data = record(v.subtitleData, 'subtitle data');
  keys(data, ['name', 'subtitles'], 'subtitle data');
  const ids = new Set<string>();
  const rows = array(data.subtitles, 'subtitles', 50000).map((item) => {
    const row = record(item, 'subtitle');
    const numeric = [
      'originalStartSeconds',
      'startSeconds',
      'originalEndSeconds',
      'endSeconds',
      'subIndex'
    ];
    const optional = ['adjustedStartSeconds', 'adjustedEndSeconds'];
    const strings = ['id', 'startTime', 'endTime', 'originalText', 'text'];
    keys(row, [...numeric, ...optional, ...strings], 'subtitle');
    const out: Plain = {};
    for (const key of numeric) out[key] = number(row[key], key);
    for (const key of optional) if (row[key] !== undefined) out[key] = number(row[key], key);
    for (const key of strings)
      out[key] = text(row[key], key, key.endsWith('Text') || key === 'text' ? 1024 * 1024 : 4096);
    if (Number(out.endSeconds) < Number(out.startSeconds) || !Number.isSafeInteger(out.subIndex))
      throw new Error('Invalid subtitle timing or index.');
    const id = String(out.id);
    if (ids.has(id)) throw new Error('Duplicate subtitle ID.');
    ids.add(id);
    return out;
  });
  return {
    subtitleData: { name: text(data.name, 'subtitle name'), subtitles: rows },
    lastSubtitleDataModified: modified
  };
}
export function goals(value: unknown): Plain[] {
  const seen = new Set<string>();
  const rows = array(value, 'reading goals').map((item) => {
    const v = record(item, 'reading goal');
    keys(
      v,
      [
        'timeGoal',
        'characterGoal',
        'goalFrequency',
        'goalStartDate',
        'goalEndDate',
        'goalOriginalEndDate',
        'lastGoalModified'
      ],
      'reading goal'
    );
    const start = date(v.goalStartDate);
    const end = v.goalEndDate === '' ? '' : date(v.goalEndDate);
    const originalEnd = v.goalOriginalEndDate === '' ? '' : date(v.goalOriginalEndDate);
    if (
      seen.has(start) ||
      (end && end < start) ||
      !['daily', 'weekly', 'monthly'].includes(String(v.goalFrequency))
    )
      throw new Error('Duplicate or invalid reading goal.');
    seen.add(start);
    return {
      timeGoal: number(v.timeGoal, 'time goal'),
      characterGoal: number(v.characterGoal, 'character goal'),
      goalFrequency: v.goalFrequency,
      goalStartDate: start,
      goalEndDate: end,
      goalOriginalEndDate: originalEnd,
      lastGoalModified: number(v.lastGoalModified, 'goal timestamp')
    };
  });
  const sorted = [...rows].sort((a, b) =>
    String(a.goalStartDate).localeCompare(String(b.goalStartDate))
  );
  for (let i = 1; i < sorted.length; i++) {
    if (
      !sorted[i - 1].goalEndDate ||
      String(sorted[i - 1].goalEndDate) >= String(sorted[i].goalStartDate)
    )
      throw new Error('Reading goals have overlapping dates.');
  }
  return rows;
}

/** Stable content comparison excludes local row IDs and object-property ordering. */
export function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const v = value as Plain;
    return `{${Object.keys(v)
      .filter((key) => v[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(v[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
export function withoutIdentity(value: unknown): Plain | undefined {
  if (!value) return undefined;
  const {
    title: _title,
    bookKey: _bookKey,
    dataId: _id,
    manabiTtuReceipt: _receipt,
    ...rest
  } = value as Plain;
  return rest;
}
export class MigrationConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationConflict';
  }
}
function timestamp(value: Plain): number {
  const field = Object.keys(value).find((key) => /^last.*Modified$/.test(key));
  return field ? Number(value[field]) : 0;
}
/** Repeating an acknowledged source snapshot must not undo subsequent Manabi reading. */
export function reconcileImport(
  current: Plain | undefined,
  incoming: Plain,
  previous: string | undefined,
  replace = false
): 'write' | 'acknowledge' | 'skip' {
  const next = canonical(incoming);
  if (next === previous) return 'skip';
  if (canonical(current) === next) return 'acknowledge';
  const prior = previous ? record(JSON.parse(previous), 'migration receipt') : undefined;
  if (!replace && prior && timestamp(incoming) < timestamp(prior)) return 'skip';
  if (
    !replace &&
    ((prior && (canonical(current) !== previous || timestamp(incoming) === timestamp(prior))) ||
      (!prior && current))
  )
    throw new MigrationConflict(
      'Reading data differs from the existing copy. Nothing in this item was changed.'
    );
  return 'write';
}
