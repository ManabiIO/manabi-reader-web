/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { snapshotReaderLocator, type ReaderLocator } from './reader-location.ts';

/** Optional local precision, bound to the legacy bookmark it accompanies. */
export interface ReaderBookmarkPosition {
  version: 1;
  dataId: number;
  exploredCharCount: number;
  progress: number;
  lastBookmarkModified: number;
  locator: ReaderLocator;
}

interface BookmarkCoordinates {
  dataId: number;
  exploredCharCount?: number;
  progress: number | string | undefined;
  lastBookmarkModified: number;
  readerPosition?: ReaderBookmarkPosition;
}

function preciseLocator(value: unknown, bookKey?: string): ReaderLocator | undefined {
  const locator = snapshotReaderLocator(value, bookKey);
  if (
    !locator ||
    !locator.bookKey ||
    locator.start !== locator.end ||
    locator.quote !== '' ||
    !/^[a-f0-9]{64}$/.test(locator.resourceDigest) ||
    locator.prefix.length > 64 ||
    locator.suffix.length > 64 ||
    [...locator.prefix].length > 32 ||
    [...locator.suffix].length > 32
  )
    return undefined;
  return locator;
}

function validCoordinates(value: BookmarkCoordinates): boolean {
  return (
    Number.isSafeInteger(value.dataId) &&
    value.dataId > 0 &&
    Number.isFinite(value.exploredCharCount) &&
    value.exploredCharCount! >= 0 &&
    typeof value.progress === 'number' &&
    Number.isFinite(value.progress) &&
    value.progress >= 0 &&
    value.progress <= 1 &&
    Number.isFinite(value.lastBookmarkModified) &&
    value.lastBookmarkModified >= 0
  );
}

/** A later legacy/sync/completion update must not revive an older exact point. */
export function bookmarkPosition(
  bookmark: BookmarkCoordinates,
  bookKey: string
): ReaderLocator | undefined {
  const position = bookmark.readerPosition;
  if (
    !bookKey ||
    !validCoordinates(bookmark) ||
    !position ||
    position.version !== 1 ||
    position.dataId !== bookmark.dataId ||
    position.exploredCharCount !== bookmark.exploredCharCount ||
    position.progress !== bookmark.progress ||
    position.lastBookmarkModified !== bookmark.lastBookmarkModified
  )
    return undefined;
  return preciseLocator(position.locator, bookKey);
}

/** Precision is a local extension, not a TTU, WebDAV or personal-sync payload. */
export function withoutBookmarkPosition<T extends BookmarkCoordinates>(bookmark: T): T {
  const snapshot = structuredClone(bookmark);
  delete snapshot.readerPosition;
  return snapshot;
}

export function withBookmarkPosition<T extends BookmarkCoordinates>(
  bookmark: T,
  location?: ReaderLocator
): T {
  // Fresh legacy-only saves explicitly discard precision from older snapshots.
  const snapshot = withoutBookmarkPosition(bookmark);
  const locator = preciseLocator(location);
  if (locator && validCoordinates(snapshot))
    snapshot.readerPosition = {
      version: 1,
      dataId: snapshot.dataId,
      exploredCharCount: snapshot.exploredCharCount!,
      progress: snapshot.progress as number,
      lastBookmarkModified: snapshot.lastBookmarkModified,
      locator
    };
  return snapshot;
}

/** Hashing is preparation, not permission to publish into a newer reader/save. */
export class BookmarkSaveCoordinator {
  private generation = 0;
  private disposed = false;
  private writes: Promise<unknown> = Promise.resolve();

  invalidate(): void {
    this.generation += 1;
  }

  destroy(): void {
    this.disposed = true;
    this.invalidate();
  }

  async save<T extends BookmarkCoordinates>(
    bookmark: T,
    options: {
      locate?: () => Promise<ReaderLocator | undefined>;
      write: (value: T) => Promise<unknown>;
      isCurrent: () => boolean;
      signal?: AbortSignal;
    }
  ): Promise<T | undefined> {
    const generation = ++this.generation;
    const current = () =>
      !this.disposed &&
      generation === this.generation &&
      !options.signal?.aborted &&
      options.isCurrent();
    if (!current()) return undefined;
    const snapshot = structuredClone(bookmark);
    try {
      // locate() snapshots DOM/source coordinates before its first suspension.
      const locator = options.locate ? await options.locate() : undefined;
      if (!current()) return undefined;
      const value = withBookmarkPosition(snapshot, locator);
      const operation = this.writes
        .catch(() => undefined)
        .then(async () => {
          if (!current()) return undefined;
          await options.write(structuredClone(value));
          // A completed write cannot be undone here. Only its UI acknowledgement
          // is withheld; storage owns its existing transaction/authority contract.
          return current() ? value : undefined;
        });
      this.writes = operation;
      return await operation;
    } catch (error) {
      if (!current()) return undefined;
      throw error;
    }
  }
}
