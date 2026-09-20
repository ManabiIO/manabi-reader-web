/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Library completion is independent of the reader's position and statistics. */
export interface Completion {
  state: 'finished' | 'reading';
  /** A calendar day, deliberately not a midnight timestamp that shifts with timezone. */
  finishedOn?: string;
  modifiedAt: number;
}
export interface Progress {
  progress?: number | string;
  completion?: Completion;
  lastBookmarkModified?: number;
}
export function calendarDay(time = Date.now()): string {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function validDay(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function validCompletion(value: unknown): value is Completion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).every((k) => ['state', 'finishedOn', 'modifiedAt'].includes(k)) &&
    typeof v.modifiedAt === 'number' &&
    Number.isSafeInteger(v.modifiedAt) &&
    v.modifiedAt >= 0 &&
    v.modifiedAt <= 8640000000000000 &&
    ((v.state === 'finished' && validDay(v.finishedOn)) ||
      (v.state === 'reading' && v.finishedOn === undefined))
  );
}
export function progressFraction(value: unknown): number {
  // Text bookmarks can be element IDs. Only a percent-suffixed string is a percentage.
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+(?:\.\d+)?%$/.test(value)
        ? Number(value.slice(0, -1)) / 100
        : 0;
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}
export function isFinished(value: Progress | undefined): boolean {
  return value?.completion
    ? value.completion.state === 'finished'
    : progressFraction(value?.progress) >= 1;
}
export function finishedDay(value: Progress): string | undefined {
  return isFinished(value) ? value.completion?.finishedOn : undefined;
}
/** Preserve a newer explicit decision when a previously captured autosave arrives late. */
export function mergeCompletion<T extends Progress>(before: Progress | undefined, incoming: T): T {
  const old = before?.completion,
    next = incoming.completion;
  if (next !== undefined && !validCompletion(next)) throw new Error('Invalid completion metadata.');
  const completion = old && (!next || old.modifiedAt >= next.modifiedAt) ? old : next;
  if (completion)
    return {
      ...incoming,
      completion,
      lastBookmarkModified: Math.max(incoming.lastBookmarkModified || 0, completion.modifiedAt)
    };
  if (progressFraction(incoming.progress) >= 1) {
    const time = incoming.lastBookmarkModified || Date.now();
    return {
      ...incoming,
      completion: { state: 'finished', finishedOn: calendarDay(time), modifiedAt: time }
    };
  }
  return incoming;
}
