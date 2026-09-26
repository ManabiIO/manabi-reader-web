/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { encodeBook } from '$lib/data/database/books-db/book-binary';

import { database, lastReadingGoalsModified$, readingGoal$ } from '$lib/data/store';
import { getCurrentReadingGoal } from '$lib/data/reading-goal';
import type {
  BooksDbBookData,
  StoredBookData,
  BooksDbBookmarkData,
  BooksDbStatistic,
  BooksDbAudioBook,
  BooksDbSubtitleData,
  BooksDbReadingGoal
} from '$lib/data/database/books-db/versions/books-db';
import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
import { StorageDataType, StorageKey } from '$lib/data/storage/storage-types';
import {
  LimitedArchive,
  ArchiveBudget,
  BACKUP_ARCHIVE_LIMITS
} from '$lib/functions/file-loaders/utils/limited-archive';
import { readRestoredBook } from '$lib/functions/file-loaders/utils/restored-book';
import {
  sanitizeBookHtml,
  sanitizeBookStyleSheet
} from '$lib/functions/book-security/book-content-security';
import buildDummyBookImage from '$lib/functions/file-loaders/utils/build-dummy-book-image';
import { exclusive } from './persistence';
import {
  importFile,
  decodeTitle,
  canonical,
  withoutIdentity,
  reconcileImport,
  MigrationConflict,
  bookmark,
  statistics,
  audio,
  subtitles,
  goals,
  type Plain,
  type ImportPart,
  type ImportFile
} from './ttu-migration-format';

// Large outer exports are read lazily; the existing per-book decoder budget is unchanged.
// Limits are counted against actual decoded bytes, including nested book packages.
export const TTU_MIGRATION_LIMITS = Object.freeze({
  ...BACKUP_ARCHIVE_LIMITS,
  compressedBytes: 8 * 1024 ** 3,
  totalBytes: 32 * 1024 ** 3,
  entryCount: 100000,
  metadataReadBytes: 32 * 1024 ** 2,
  concurrency: 1
});
interface Receipt {
  version: 1;
  sourceTitle: string;
  content: string;
  records: Record<string, string>;
}
type MigratedBook = StoredBookData & { manabiTtuImport?: Receipt };
export interface MigratedBookChoice {
  id: number;
  title: string;
  sourceTitle: string;
}
export interface MigrationItem {
  id: string;
  title: string;
  parts: ImportPart[];
  error?: string;
}
interface IndexedItem extends MigrationItem {
  files: Partial<Record<ImportPart, { path: string; metadata: ImportFile }>>;
}
export interface MigrationOptions {
  parts: readonly ImportPart[];
  targetId?: number;
  replace?: boolean;
}
export interface MigrationResult {
  status: 'imported' | 'unchanged';
  title: string;
  bookId?: number;
  records: number;
}
function receipt(book: MigratedBook): Receipt | undefined {
  const value = book.manabiTtuImport;
  return value?.version === 1 &&
    typeof value.sourceTitle === 'string' &&
    /^[a-f0-9]{64}$/.test(value.content) &&
    value.records &&
    typeof value.records === 'object'
    ? value
    : undefined;
}
async function hash(value: Blob | string): Promise<string> {
  const bytes =
    typeof value === 'string' ? new TextEncoder().encode(value) : await value.arrayBuffer();
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (v) =>
    v.toString(16).padStart(2, '0')
  ).join('');
}
function imageMime(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return (
    (
      {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        bmp: 'image/bmp',
        webp: 'image/webp',
        avif: 'image/avif',
        svg: 'image/svg+xml'
      } as Record<string, string>
    )[extension] ?? 'application/octet-stream'
  );
}
function sameSource(book: MigratedBook, title: string, fingerprint?: string): boolean {
  const value = receipt(book);
  return !!value && value.sourceTitle === title && (!fingerprint || value.content === fingerprint);
}
export async function migratedBookChoices(): Promise<MigratedBookChoice[]> {
  const db = await database.db;
  const tx = db.transaction('data');
  const choices: MigratedBookChoice[] = [];
  let cursor = await tx.store.openCursor();
  while (cursor) {
    const prior = receipt(cursor.value);
    if (prior)
      choices.push({
        id: cursor.value.id,
        title: cursor.value.title,
        sourceTitle: prior.sourceTitle
      });
    cursor = await cursor.continue();
  }
  await tx.done;
  return choices;
}

/** A File-backed import session. Preview holds filenames only, not every decoded book. */
export class TtuMigration {
  readonly items: readonly MigrationItem[];
  readonly ignoredFiles: number;
  private archive?: LimitedArchive;
  private importing = false;
  private budget = new ArchiveBudget(TTU_MIGRATION_LIMITS.totalBytes);

  private constructor(
    readonly file: File,
    private readonly index: IndexedItem[],
    ignored: number
  ) {
    this.items = index.map(({ files: _files, ...item }) => item);
    this.ignoredFiles = ignored;
  }
  static async inspect(file: File, signal?: AbortSignal): Promise<TtuMigration> {
    const archive = await LimitedArchive.open(file, {
      limits: TTU_MIGRATION_LIMITS,
      literalNames: true,
      signal
    });
    try {
      const grouped = new Map<string, IndexedItem>();
      let ignored = 0;
      for (const entry of archive.entries.values()) {
        if (entry.directory) continue;
        signal?.throwIfAborted();
        const path = entry.filename.startsWith('ttu-reader-data/')
          ? entry.filename.slice(16)
          : entry.filename;
        const pieces = path.split('/');
        const name = pieces[pieces.length - 1];
        if (!/^(?:bookdata|progress|statistics|audioBook|subtitles|ttu-user-goals)_/.test(name)) {
          ignored++;
          continue;
        }
        const isGoal = name.startsWith('ttu-user-goals_');
        if ((isGoal && pieces.length !== 1) || (!isGoal && pieces.length !== 2))
          throw new Error(
            'Choose a ZIP from Export → ZIP File, with book folders at its top level.'
          );
        const key = isGoal ? '' : pieces[0];
        let item = grouped.get(key);
        if (!item) {
          item = {
            id: String(grouped.size),
            title: isGoal ? 'Reading Goals' : key,
            parts: [],
            files: {}
          };
          grouped.set(key, item);
          try {
            if (!isGoal) item.title = decodeTitle(key);
          } catch (error) {
            item.error = (error as Error).message;
          }
        }
        try {
          const meta = importFile(name)!;
          if (item.files[meta.part])
            throw new Error(
              `Multiple ${meta.part} files for this item. Export a clean copy before importing.`
            );
          item.files[meta.part] = { path: entry.filename, metadata: meta };
          item.parts.push(meta.part);
        } catch (error) {
          item.error = (error as Error).message;
        }
      }
      const index = [...grouped.values()];
      const titles = new Map<string, IndexedItem>();
      for (const item of index) {
        if (item.parts.includes('goals')) continue;
        const previous = titles.get(item.title);
        if (previous)
          previous.error = item.error =
            'Two folders decode to the same title. Export those books separately.';
        titles.set(item.title, item);
      }
      if (!index.length)
        throw new Error(
          'No Ttu Ebook Reader export data found. Choose a ZIP from Export → ZIP File.'
        );
      return new TtuMigration(file, index, ignored);
    } finally {
      await archive.close();
    }
  }

  async close(): Promise<void> {
    const archive = this.archive;
    this.archive = undefined;
    await archive?.close();
    this.budget = new ArchiveBudget(TTU_MIGRATION_LIMITS.totalBytes);
  }

  async importItem(
    id: string,
    options: MigrationOptions,
    signal?: AbortSignal
  ): Promise<MigrationResult> {
    if (this.importing) throw new Error('An import from this ZIP is already running.');
    this.importing = true;
    try {
      return await this.readAndCommit(id, options, signal);
    } finally {
      this.importing = false;
    }
  }

  private async readAndCommit(
    id: string,
    options: MigrationOptions,
    signal?: AbortSignal
  ): Promise<MigrationResult> {
    signal?.throwIfAborted();
    const item = this.index.find((entry) => entry.id === id);
    if (!item || item.error) throw new Error(item?.error ?? 'Import item not found.');
    if (!item.parts.some((part) => options.parts.includes(part)))
      throw new Error('Choose at least one available data type for this item.');
    this.archive ??= await LimitedArchive.open(this.file, {
      limits: TTU_MIGRATION_LIMITS,
      literalNames: true,
      signal,
      budget: this.budget
    });
    const archive = this.archive;
    const readJSON = async (part: ImportPart) => {
      const file = item.files[part];
      if (!file || !options.parts.includes(part)) return undefined;
      return JSON.parse(await archive.readText(file.path));
    };
    if (item.parts.includes('goals')) {
      const rows = goals(await readJSON('goals'));
      return this.commitGoals(rows, !!options.replace, signal);
    }
    let content: Omit<BooksDbBookData, 'id'> | undefined;
    let fingerprint: string | undefined;
    const bookFile = item.files.book;
    // Even when importing only progress, a supplied package proves book identity.
    if (bookFile) {
      const data = await readRestoredBook(await archive.readBlob(bookFile.path), imageMime, {
        budget: this.budget,
        signal
      });
      if (!data || data.title !== item.title)
        throw new Error('Book Data and its folder title disagree.');
      const media: [string, string][] = [];
      for (const name of Object.keys(data.blobs).sort()) {
        signal?.throwIfAborted();
        media.push([name, await hash(data.blobs[name])]);
      }
      const characters =
        bookFile.metadata.characters ||
        Math.max(0, ...data.sections.map((s) => (s.startCharacter ?? 0) + (s.characters ?? 0)));
      // Hash decoded content, not ZIP timestamps/compression or browser-local IDs.
      fingerprint = await hash(
        canonical({
          html: data.elementHtml,
          css: data.styleSheet,
          sections: data.sections,
          language: data.language,
          creators: data.creators,
          pageDirection: data.pageDirection,
          characters,
          media,
          cover: data.coverImage ? await hash(data.coverImage) : null
        })
      );
      const imageReferences = new Map<string, string>();
      for (const name of Object.keys(data.blobs)) {
        const placeholder = buildDummyBookImage(name);
        imageReferences.set(placeholder, placeholder);
        imageReferences.set(`ttu:${name}`, placeholder);
      }
      const policy = { document, resolveImage: (source: string) => imageReferences.get(source) };
      content = {
        ...data,
        title: item.title,
        elementHtml: sanitizeBookHtml(data.elementHtml, policy),
        styleSheet: sanitizeBookStyleSheet(data.styleSheet, document),
        htmlBackup: data.htmlBackup ? sanitizeBookHtml(data.htmlBackup, policy) : undefined,
        characters,
        hasThumb: !!data.coverImage,
        lastBookModified: bookFile.metadata.modified,
        lastBookOpen: bookFile.metadata.opened ?? 0
      };
    }
    const imported: { bookmark?: Plain; statistics?: Plain[]; audio?: Plain; subtitles?: Plain } =
      {};
    for (const part of ['bookmark', 'statistics', 'audio', 'subtitles'] as const) {
      const value = await readJSON(part);
      if (value === undefined) continue;
      const modified = item.files[part]!.metadata.modified;
      if (part === 'bookmark') imported.bookmark = bookmark(value, modified);
      if (part === 'statistics') imported.statistics = statistics(value, item.title);
      if (part === 'audio') imported.audio = audio(value, item.title, modified);
      if (part === 'subtitles') imported.subtitles = subtitles(value, item.title, modified);
    }
    if (
      content &&
      imported.bookmark?.exploredCharCount !== undefined &&
      Number(imported.bookmark.exploredCharCount) > content.characters
    )
      throw new Error('The bookmark is beyond the end of this book.');
    const storedContent = content ? await encodeBook(content) : undefined;
    signal?.throwIfAborted();
    return exclusive('import-library-book', async () => {
      const db = await database.db;
      const tx = db.transaction(
        ['data', 'bookmark', 'statistic', 'lastModified', 'audioBook', 'subtitle'],
        'readwrite'
      );
      const cancel = () => {
        try {
          tx.abort();
        } catch {
          /* Already completed. */
        }
      };
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        signal?.throwIfAborted();
        let target: MigratedBook | undefined;
        if (options.targetId) {
          const found = await tx.objectStore('data').get(options.targetId);
          if (!found || !sameSource(found, item.title, fingerprint))
            throw new Error('That book is not a matching previous import. Import Book Data first.');
          target = found;
        } else if (fingerprint) {
          let cursor = await tx.objectStore('data').openCursor();
          while (cursor) {
            if (sameSource(cursor.value, item.title, fingerprint)) {
              if (target)
                throw new MigrationConflict(
                  'Several migrated copies match. Choose the destination book.'
                );
              target = cursor.value;
            }
            cursor = await cursor.continue();
          }
        } else throw new Error('Choose the previously imported book for this data-only export.');
        let created = false;
        if (!target) {
          if (!storedContent || !options.parts.includes('book'))
            throw new Error('Import Book Data before importing reading data.');
          let title = item.title;
          let suffix = 1;
          // Also preserve orphaned statistics retained after an unrelated book was deleted.
          while (
            (await tx.objectStore('data').index('title').getKey(title)) ||
            (await tx.objectStore('statistic').count(IDBKeyRange.bound([title], [title, []]))) ||
            (await tx.objectStore('audioBook').getKey(title)) ||
            (await tx.objectStore('subtitle').getKey(title))
          )
            title = `${item.title} [Ttu import ${++suffix}]`;
          const id = await tx
            .objectStore('data')
            .add({ ...storedContent, title } as StoredBookData);
          target = { ...storedContent, id, title };
          created = true;
        }
        if (target.storageSource)
          throw new MigrationConflict(
            'This book is linked to external storage. Import into an unlinked local copy instead.'
          );
        const prior: Receipt = receipt(target) ?? {
          version: 1,
          sourceTitle: item.title,
          content: fingerprint!,
          records: {}
        };
        const nextReceipt: Receipt = { ...prior, records: { ...prior.records } };
        let changed = 0;
        const merge = async (
          key: string,
          incoming: Plain,
          current: unknown,
          write: () => Promise<unknown>
        ) => {
          signal?.throwIfAborted();
          const decision = reconcileImport(
            withoutIdentity(current),
            incoming,
            prior.records[key],
            !!options.replace
          );
          if (decision === 'skip') return;
          if (decision === 'write') {
            await write();
            changed++;
          }
          nextReceipt.records[key] = canonical(incoming);
        };
        const bookId = target.id,
          title = target.title;
        if (imported.bookmark) {
          const value = imported.bookmark;
          if (
            value.exploredCharCount !== undefined &&
            Number(value.exploredCharCount) > target.characters
          )
            throw new Error('The bookmark is beyond the end of this book.');
          await merge('bookmark', value, await tx.objectStore('bookmark').get(bookId), () =>
            tx
              .objectStore('bookmark')
              .put({ ...value, dataId: bookId } as unknown as BooksDbBookmarkData)
          );
        }
        for (const value of imported.statistics ?? []) {
          const day = String(value.dateKey);
          await merge(
            `statistics/${day}`,
            value,
            await tx.objectStore('statistic').get([title, day]),
            () =>
              tx.objectStore('statistic').put({ ...value, title } as unknown as BooksDbStatistic)
          );
        }
        if (imported.audio) {
          const value = imported.audio;
          await merge('audio', value, await tx.objectStore('audioBook').get(title), () =>
            tx.objectStore('audioBook').put({ ...value, title } as unknown as BooksDbAudioBook)
          );
        }
        if (imported.subtitles) {
          const value = imported.subtitles;
          await merge('subtitles', value, await tx.objectStore('subtitle').get(title), () =>
            tx.objectStore('subtitle').put({ ...value, title } as unknown as BooksDbSubtitleData)
          );
        }
        if (imported.statistics && changed) {
          let lastModified = 0;
          let cursor = await tx
            .objectStore('statistic')
            .openCursor(IDBKeyRange.bound([title], [title, []]));
          while (cursor) {
            lastModified = Math.max(lastModified, cursor.value.lastStatisticModified);
            cursor = await cursor.continue();
          }
          await tx
            .objectStore('lastModified')
            .put({ title, dataType: StorageDataType.STATISTICS, lastModifiedValue: lastModified });
        }
        // Receipt and payloads commit together. No cross-database "import succeeded" marker.
        if (created || canonical(prior) !== canonical(nextReceipt))
          await tx
            .objectStore('data')
            .put({ ...target, manabiTtuImport: nextReceipt } as MigratedBook);
        signal?.throwIfAborted();
        await tx.done;
        getStorageHandler(window, StorageKey.BROWSER).clearData();
        database.bookmarksChanged$.next();
        database.dataListChanged$.next(undefined);
        return {
          status: created || changed ? 'imported' : 'unchanged',
          title,
          bookId,
          records: changed
        };
      } catch (error) {
        cancel();
        await tx.done.catch(() => undefined);
        throw error;
      } finally {
        signal?.removeEventListener('abort', cancel);
      }
    });
  }

  private async commitGoals(
    rows: Plain[],
    replace: boolean,
    signal?: AbortSignal
  ): Promise<MigrationResult> {
    return exclusive('import-library-book', async () => {
      const tx = (await database.db).transaction('readingGoal', 'readwrite');
      const cancel = () => {
        try {
          tx.abort();
        } catch {
          /* Already completed. */
        }
      };
      signal?.addEventListener('abort', cancel, { once: true });
      let changed = 0;
      try {
        const existing = await tx.store.getAll();
        for (const row of rows) {
          signal?.throwIfAborted();
          const start = String(row.goalStartDate),
            end = String(row.goalEndDate) || '9999-12-31';
          const overlap = existing.find(
            (goal) =>
              goal.goalStartDate !== start &&
              goal.goalStartDate <= end &&
              (goal.goalEndDate || '9999-12-31') >= start
          );
          if (overlap)
            throw new MigrationConflict(
              'Reading Goals overlap existing dates. Resolve the overlap in Statistics before importing.'
            );
          const current = existing.find((goal) => goal.goalStartDate === start) as
            | (BooksDbReadingGoal & { manabiTtuReceipt?: string })
            | undefined;
          const decision = reconcileImport(
            withoutIdentity(current),
            row,
            current?.manabiTtuReceipt,
            replace
          );
          if (decision !== 'skip') {
            await tx.store.put({
              ...row,
              manabiTtuReceipt: canonical(row)
            } as unknown as BooksDbReadingGoal);
            if (decision === 'write') changed++;
          }
        }
        signal?.throwIfAborted();
        await tx.done;
      } catch (error) {
        cancel();
        await tx.done.catch(() => undefined);
        throw error;
      } finally {
        signal?.removeEventListener('abort', cancel);
      }
      if (changed) {
        lastReadingGoalsModified$.next(Date.now());
        readingGoal$.next(await getCurrentReadingGoal());
      }
      return {
        status: changed ? 'imported' : 'unchanged',
        title: 'Reading Goals',
        records: changed
      };
    });
  }
}
