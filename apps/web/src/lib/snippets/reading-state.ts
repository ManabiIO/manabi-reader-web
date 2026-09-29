/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { librarySource } from '../library/catalog';
import { sha256 } from '../manabi/sources';
import {
  getRecord,
  mutateRecord,
  locationKey,
  type Location,
  type SnippetRecord
} from './database';
import { canonical, isUUID, type SnippetLocator } from './document';
import type { SnippetScope } from './scope';

/** Reuse the existing conditional managed-state transport, with a domain-separated document key.
 * This does not create a numeric book row or derive identity from mutable content. */
export async function readingKey(id: string) {
  if (!isUUID(id)) throw new Error('Invalid snippet identity.');
  return `book_${await sha256(`manabi-snippet-reading-v1:${id}`)}`;
}
interface ReadingState extends Record<string, unknown> {
  format: 'manabi-snippet-reading';
  version: 1;
  id: string;
  readAt: number;
  locator: SnippetLocator;
}
function validLocator(value: unknown): value is SnippetLocator {
  if (!value || typeof value !== 'object') return false;
  const x = value as SnippetLocator;
  return (
    typeof x.blockId === 'string' &&
    x.blockId.length <= 256 &&
    typeof x.quote === 'string' &&
    x.quote.length <= 4000 &&
    typeof x.before === 'string' &&
    x.before.length <= 256 &&
    Number.isSafeInteger(x.offset) &&
    x.offset >= 0 &&
    x.offset <= 2 * 1024 * 1024 &&
    isUUID(x.revision)
  );
}
function decode(value: Record<string, unknown> | null, id: string): ReadingState | undefined {
  if (value === null) return;
  if (
    value.format !== 'manabi-snippet-reading' ||
    value.version !== 1 ||
    value.id !== id ||
    !Number.isSafeInteger(value.readAt) ||
    Number(value.readAt) < 0 ||
    !validLocator(value.locator)
  )
    throw new Error('Unsupported snippet reading state. The original has been kept.');
  return value as ReadingState;
}
/** Older records used readAt for both visits and positions. Freeze that fallback
 * before a visit changes readAt; no database-version or remote-envelope change is needed. */
function progressTime(record: SnippetRecord): number {
  return record.progress ? (record.progressAt ?? record.readAt ?? 0) : 0;
}
function sameProgress(a: SnippetRecord, b: SnippetRecord): boolean {
  return progressTime(a) === progressTime(b) && canonical(a.progress) === canonical(b.progress);
}
export async function saveProgress(id: string, locator: SnippetLocator, selected: SnippetScope) {
  if (!validLocator(locator)) throw new Error('Invalid reading location.');
  await mutateRecord(selected.owner, id, selected.guard, (current) => {
    if (!current) throw new Error('Snippet no longer exists.');
    const changedAt = Math.max(Date.now(), progressTime(current) + 1);
    return {
      ...current,
      progress: structuredClone(locator),
      readAt: Math.max(changedAt, (current.readAt ?? 0) + 1),
      progressAt: changedAt,
      progressDirty: !!current.destination
    };
  });
}
/** Record an intentional open without replacing a successfully resolved saved position. */
export async function touchReading(id: string, selected: SnippetScope) {
  await mutateRecord(
    selected.owner,
    id,
    selected.guard,
    (current) =>
      current && {
        ...current,
        readAt: Math.max(Date.now(), (current.readAt ?? 0) + 1),
        // A visit is not a scroll. Re-publishing the cached cursor here could
        // overwrite a newer remote position while the initial refresh is pending.
        progressAt: current.progress ? progressTime(current) : undefined
      }
  );
}
export async function syncReading(id: string, selected: SnippetScope, target?: Location) {
  const current = await getRecord(selected.owner, id);
  selected.guard();
  // Only the transfer's explicit target may sync while it owns the document.
  // A concurrent refresh must not acknowledge a save to the departing source.
  if (!current || (current.transfer && !target)) return;
  const location =
    target ?? current.locations.find((l) => locationKey(l) === current.primary && !l.missing);
  if (!location) return;
  // Account ownership is not enough: a move can change the storage home while
  // a read or write is in flight. Its old reply must not clear the new home's
  // pending position, adopt its remote cursor, or release a successor transfer.
  const primary = current.primary,
    transfer = current.transfer;
  function requireStorage(record: SnippetRecord | undefined): asserts record is SnippetRecord {
    selected.guard();
    if (
      !record ||
      record.primary !== primary ||
      record.transfer !== transfer ||
      (!target && !record.locations.some((l) => locationKey(l) === primary && !l.missing))
    )
      throw new Error(
        'Snippet storage changed while synchronizing its reading position. Retry at the current location.'
      );
  }
  const adapter = await librarySource(location.source),
    key = await readingKey(id);
  selected.guard();
  const remote = await adapter.state(key);
  selected.guard();
  const remoteState = decode(remote.value, id);
  const here = await getRecord(selected.owner, id);
  selected.guard();
  if (!here) return;
  requireStorage(here);
  if (here.progress && (here.progressDirty || target)) {
    const value: ReadingState = {
      format: 'manabi-snippet-reading',
      version: 1,
      id,
      // Keep the v1 wire field, but give it only the position's timestamp.
      readAt: progressTime(here),
      locator: here.progress
    };
    // A transfer takes the most recent known reading intent, not a stale local percentage.
    const winner = remoteState && remoteState.readAt > value.readAt ? remoteState : value;
    const result =
      remoteState && canonical(remoteState) === canonical(winner)
        ? remote
        : await adapter.write(key, winner, remote.revision);
    selected.guard();
    if (canonical(decode(result.value, id)) !== canonical(winner))
      throw new Error('Reading-state write could not be verified.');
    await mutateRecord(selected.owner, id, selected.guard, (latest) => {
      requireStorage(latest);
      return {
        ...latest,
        ...(sameProgress(latest, here)
          ? {
              progress: winner.locator,
              progressAt: winner.readAt,
              readAt: Math.max(latest.readAt ?? 0, winner.readAt),
              progressDirty: false
            }
          : {}),
        stateCheckedAt: Date.now(),
        progressToken: result.revision
      };
    });
  } else if (remoteState && (!here.progress || remoteState.readAt > progressTime(here))) {
    await mutateRecord(selected.owner, id, selected.guard, (latest) => {
      requireStorage(latest);
      return {
        ...latest,
        ...(!latest.progressDirty && (!latest.progress || progressTime(latest) < remoteState.readAt)
          ? {
              progress: remoteState.locator,
              progressAt: remoteState.readAt,
              readAt: Math.max(latest.readAt ?? 0, remoteState.readAt)
            }
          : {}),
        stateCheckedAt: Date.now(),
        progressToken: remote.revision
      };
    });
  }
}
