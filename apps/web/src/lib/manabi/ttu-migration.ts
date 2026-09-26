/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { database, lastReadingGoalsModified$, readingGoal$ } from '$lib/data/store';
import { getCurrentReadingGoal } from '$lib/data/reading-goal';
import type {
  BooksDbBookData,
  BooksDbBookmarkData,
  BooksDbStatistic,
  BooksDbAudioBook,
  BooksDbSubtitleData,
  BooksDbReadingGoal
} from '$lib/data/database/books-db/versions/books-db';
import { contentStatisticKey, statisticRange } from '$lib/data/database/books-db/reader-statistics';
import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
import { StorageDataType, StorageKey } from '$lib/data/storage/storage-types';
import {
  LimitedArchive,
  ArchiveBudget,
  BACKUP_ARCHIVE_LIMITS
} from '$lib/functions/file-loaders/utils/limited-archive';
import { readRestoredBook } from '$lib/functions/file-loaders/utils/restored-book';
import { bookKey, updateOrganization } from '$lib/library/organization';
import {
  sanitizeBookHtml,
  sanitizeBookStyleSheet
} from '$lib/functions/book-security/book-content-security';
import buildDummyBookImage from '$lib/functions/file-loaders/utils/build-dummy-book-image';
import { exclusive } from './persistence';
import { currentUser } from './client';
import { yatsuRows, prepareYatsuEntries, annotationContent, type YatsuPart } from './yatsu-import';
import { parseYatsuSettings } from './yatsu-settings-format';
import { importYatsuSettings } from './yatsu-settings';
import { validateImportedAnnotation } from '$lib/reader-annotations';
import type { ReaderAnnotation } from '$lib/data/database/books-db/versions/v7/books-db-v7';
import {
  importFile,
  decodeTitle,
  canonical,
  withoutIdentity,
  reconcileImport,
  MigrationConflict,
  bookmark,
  yatsuMetadata,
  statistics,
  audio,
  subtitles,
  goals,
  type Plain,
  type ImportSource,
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
  yatsuMetadata?: Plain;
  records: Record<string, string>;
}
type MigratedBook = BooksDbBookData & { manabiTtuImport?: Receipt };
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
  counts?: Partial<Record<ImportPart, number>>;
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
  warning?: string;
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
  readonly source: ImportSource;
  private archive?: LimitedArchive;
  private importing = false;
  private budget = new ArchiveBudget(TTU_MIGRATION_LIMITS.totalBytes);

  private constructor(
    readonly file: File,
    private readonly index: IndexedItem[],
    ignored: number,
    source: ImportSource
  ) {
    this.items = index.map(({ files: _files, ...item }) => item);
    this.ignoredFiles = ignored;
    this.source = source;
  }
  static async inspect(file: File, signal?: AbortSignal): Promise<TtuMigration> {
    const archive = await LimitedArchive.open(file, {
      limits: TTU_MIGRATION_LIMITS,
      literalNames: true,
      signal
    });
    try {
      let source: ImportSource = 'ttu';
      let yatsuBookCount: number | undefined;
      if (archive.entries.has('yatsu-backup-manifest.json')) {
        const manifestText = await archive.readText('yatsu-backup-manifest.json');
        if (manifestText.length > 16_384)
          throw new Error('Oversized Yatsu Reader backup manifest.');
        const manifest = JSON.parse(manifestText);
        if (
          !manifest ||
          typeof manifest !== 'object' ||
          Array.isArray(manifest) ||
          manifest.app !== 'Yatsu Reader' ||
          manifest.manifestVersion !== 1 ||
          manifest.kind !== 'complete-local-browser-backup' ||
          manifest.sourceStorage !== 'browser' ||
          !Number.isSafeInteger(manifest.bookCount) ||
          manifest.bookCount < 0 ||
          !Array.isArray(manifest.includedDataTypes) ||
          manifest.includedDataTypes.some(
            (part: unknown) => typeof part !== 'string' || part.length > 64
          ) ||
          !manifest.compatibility ||
          manifest.compatibility.exporterVersion !== 1 ||
          manifest.compatibility.databaseVersion !== 11
        )
          throw new Error('Unsupported Yatsu Reader backup manifest.');
        source = 'yatsu';
        yatsuBookCount = manifest.bookCount;
      }
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
        if (
          (name.startsWith('bookmeta_') && source !== 'yatsu') ||
          (!/^(?:bookdata|bookmeta|bookmarks|highlights|notes|progress|statistics|audioBook|subtitles|ttu-user-goals)_/.test(
            name
          ) &&
            !(source === 'yatsu' && name === 'yatsu-local-settings.json'))
        ) {
          ignored++;
          continue;
        }
        const isGoal = name.startsWith('ttu-user-goals_');
        const isSettings = source === 'yatsu' && name === 'yatsu-local-settings.json';
        const global = isGoal || isSettings;
        if ((global && pieces.length !== 1) || (!global && pieces.length !== 2))
          throw new Error(
            'Choose a ZIP from Export → ZIP File, with book folders at its top level.'
          );
        const key = isGoal ? '' : isSettings ? '@settings' : pieces[0];
        let item = grouped.get(key);
        if (!item) {
          item = {
            id: String(grouped.size),
            title: isGoal ? 'Reading Goals' : isSettings ? 'Safe reader settings' : key,
            parts: [],
            files: {}
          };
          grouped.set(key, item);
          try {
            if (!global) item.title = decodeTitle(key);
          } catch (error) {
            item.error = (error as Error).message;
          }
        }
        try {
          const meta = importFile(name, source)!;
          if (item.files[meta.part])
            throw new Error(
              `Multiple ${meta.part} files for this item. Export a clean copy before importing.`
            );
          item.files[meta.part] = { path: entry.filename, metadata: meta };
          item.parts.push(meta.part);
          if (
            source === 'yatsu' &&
            ['savedBookmarks', 'highlights', 'notes', 'settings'].includes(meta.part)
          ) {
            const value = JSON.parse(await archive.readText(entry.filename));
            item.counts ??= {};
            item.counts[meta.part] =
              meta.part === 'settings'
                ? Object.keys(parseYatsuSettings(value).values).length
                : yatsuRows(value, meta.part as YatsuPart, item.title).length;
          }
        } catch (error) {
          item.error = (error as Error).message;
        }
      }
      const index = [...grouped.values()];
      if (source === 'yatsu') {
        if (index.filter((item) => item.parts.includes('book')).length !== yatsuBookCount)
          throw new Error('Yatsu Reader backup book count does not match its manifest.');
      }
      const titles = new Map<string, IndexedItem>();
      for (const item of index) {
        if (item.parts.includes('goals') || item.parts.includes('settings')) continue;
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
      return new TtuMigration(file, index, ignored, source);
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
    const accountId = currentUser()?.id ?? null;
    const assertAccount = () => {
      if ((currentUser()?.id ?? null) !== accountId)
        throw new Error('Account changed during import.');
    };
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
    if (item.parts.includes('settings'))
      return importYatsuSettings(await readJSON('settings'), !!options.replace, signal);
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
    const metadata = await readJSON('metadata');
    const collectionTags =
      metadata === undefined
        ? undefined
        : yatsuMetadata(metadata, item.files.metadata!.metadata.modified);
    for (const part of ['bookmark', 'statistics', 'audio', 'subtitles'] as const) {
      const value = await readJSON(part);
      if (value === undefined) continue;
      const modified = item.files[part]!.metadata.modified;
      if (part === 'bookmark') imported.bookmark = bookmark(value, modified, this.source);
      if (part === 'statistics') imported.statistics = statistics(value, item.title, this.source);
      if (part === 'audio') imported.audio = audio(value, item.title, modified);
      if (part === 'subtitles') imported.subtitles = subtitles(value, item.title, modified);
    }
    if (
      content &&
      imported.bookmark?.exploredCharCount !== undefined &&
      Number(imported.bookmark.exploredCharCount) > content.characters
    )
      throw new Error('The bookmark is beyond the end of this book.');
    const groups: { part: YatsuPart; rows: Plain[]; modified: number }[] = [];
    for (const part of ['savedBookmarks', 'highlights', 'notes'] as const) {
      const value = await readJSON(part);
      if (value !== undefined)
        groups.push({
          part,
          rows: yatsuRows(value, part, item.title),
          modified: item.files[part]!.metadata.modified
        });
    }
    const anchorBook =
      content ?? (options.targetId ? await database.getData(options.targetId) : undefined);
    const prepared = await prepareYatsuEntries(
      groups,
      item.title,
      fingerprint ??
        (anchorBook as MigratedBook | undefined)?.manabiTtuImport?.content ??
        String(options.targetId),
      anchorBook?.elementHtml,
      anchorBook?.publicationManifest,
      signal
    );
    const newIdentity = crypto.randomUUID();
    signal?.throwIfAborted();
    assertAccount();
    const core = await exclusive<MigrationResult>('import-library-book', async () => {
      const db = await database.db;
      const tx = db.transaction(
        [
          'data',
          'bookmark',
          'statistic',
          'readerStatistic',
          'lastModified',
          'audioBook',
          'subtitle',
          'readerLocalIdentity',
          'readerAnnotation',
          'readerAnnotationScope',
          'readerAnnotationOutbox',
          'readerBookScope',
          'readerImportRecord'
        ],
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
        assertAccount();
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
          if (!content || !options.parts.includes('book'))
            throw new Error('Import Book Data before importing reading data.');
          let contentToAdd = content;
          if (content.contentHash) {
            let copy = await tx.objectStore('data').openCursor();
            while (copy) {
              if (
                copy.value.contentHash === content.contentHash &&
                (receipt(copy.value)?.content ??
                  canonical({
                    html: copy.value.elementHtml,
                    css: copy.value.styleSheet,
                    sections: copy.value.sections
                  })) !==
                  (receipt(copy.value)
                    ? fingerprint
                    : canonical({
                        html: content.elementHtml,
                        css: content.styleSheet,
                        sections: content.sections
                      }))
              ) {
                // The exported hash is a claim about unavailable original
                // bytes. Conflicting decoded content cannot inherit that ID.
                contentToAdd = { ...content, contentHash: undefined };
                break;
              }
              copy = await copy.continue();
            }
          }
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
            .add({ ...contentToAdd, title } as BooksDbBookData);
          target = { ...contentToAdd, id, title };
          created = true;
        }
        if (target.storageSource)
          throw new MigrationConflict(
            'This book is linked to external storage. Import into an unlinked local copy instead.'
          );
        const scope = await tx.objectStore('readerBookScope').get(target.id);
        if (scope && scope.accountId !== accountId)
          throw new MigrationConflict(
            'This imported copy belongs to another account. Switch back to that account before importing.'
          );
        if (
          prepared.some((entry) => entry.annotation) &&
          target.elementHtml !== anchorBook?.elementHtml
        )
          throw new MigrationConflict(
            'Book content changed after passage preparation. Reopen the import before continuing.'
          );
        let identity = await tx.objectStore('readerLocalIdentity').get(target.id);
        if (!identity && !target.contentHash) {
          identity = { bookId: target.id, uuid: newIdentity };
          await tx.objectStore('readerLocalIdentity').put(identity);
        }
        const annotationBookKey = target.contentHash
          ? `content:${target.contentHash.toLowerCase()}`
          : `local:${identity!.uuid}`;
        const prior: Receipt = receipt(target) ?? {
          version: 1,
          sourceTitle: item.title,
          content: fingerprint!,
          records: {}
        };
        const nextReceipt: Receipt = { ...prior, records: { ...prior.records } };
        let changed = 0;
        if (metadata && canonical(metadata) !== canonical(prior.yatsuMetadata)) {
          const incoming = metadata as Plain;
          const older =
            prior.yatsuMetadata &&
            Number(incoming.lastBookMetaModified) <
              Number(prior.yatsuMetadata.lastBookMetaModified);
          if (!older || options.replace) {
            const author = typeof incoming.author === 'string' ? incoming.author.trim() : '';
            const previousAuthor = prior.yatsuMetadata?.author;
            if (author && author !== previousAuthor) {
              const localAuthor = target.creators?.map((creator) => creator.name).join(', ') ?? '';
              if (
                !created &&
                localAuthor &&
                localAuthor !== previousAuthor &&
                localAuthor !== author &&
                !options.replace
              )
                throw new MigrationConflict(
                  'The local author differs from Yatsu. Review before replacing book metadata.'
                );
              target = { ...target, creators: [{ name: author }] };
            }
            // Keep original series position, cover preference and source identifiers as inert evidence.
            nextReceipt.yatsuMetadata = incoming;
            changed++;
          }
        }
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
        const statisticKey = contentStatisticKey(target);
        const statisticStore = statisticKey
          ? tx.objectStore('readerStatistic')
          : tx.objectStore('statistic');
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
            await statisticStore.get(statisticKey ? [statisticKey, day] : [title, day]),
            () =>
              statisticKey
                ? tx.objectStore('readerStatistic').put({
                    ...value,
                    title,
                    bookKey: statisticKey
                  } as BooksDbStatistic & {
                    bookKey: string;
                  })
                : tx
                    .objectStore('statistic')
                    .put({ ...value, title } as unknown as BooksDbStatistic)
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
        for (const entry of prepared) {
          signal?.throwIfAborted();
          assertAccount();
          const incoming = { ...entry.record, bookId, bookKey: annotationBookKey, accountId };
          const before = await tx.objectStore('readerImportRecord').get(incoming.id);
          if (before && (before.bookKey !== annotationBookKey || before.accountId !== accountId))
            throw new MigrationConflict(
              'Imported annotation identity belongs to another book or account.'
            );
          if (before?.sourceCanonical === incoming.sourceCanonical) continue; // Never undo later edits/deletion on a repeated ZIP.
          const local = await tx.objectStore('readerAnnotation').get(incoming.id);
          if (
            before &&
            !options.replace &&
            (before.deletedAt ||
              before.body !== before.importedBody ||
              before.label !== before.importedLabel ||
              (before.annotationId && annotationContent(local) !== before.appliedAnnotation))
          )
            throw new MigrationConflict(
              'An imported note or bookmark was changed locally. Review before replacing it with this ZIP.'
            );
          if (local && !before)
            throw new MigrationConflict('An unrelated saved annotation has the same identity.');
          if (entry.annotation) {
            const mapped = entry.annotation;
            const value: ReaderAnnotation = validateImportedAnnotation({
              ...mapped,
              bookKey: annotationBookKey,
              targets: mapped.targets.map((target) => ({ ...target, bookKey: annotationBookKey })),
              revision: (local?.revision ?? 0) + 1
            });
            await tx.objectStore('readerAnnotation').put(value);
            incoming.appliedAnnotation = annotationContent(value);
            if (accountId) {
              const owner = await tx.objectStore('readerAnnotationScope').get(value.id);
              if (owner && owner.accountId !== accountId)
                throw new MigrationConflict('Saved annotation belongs to another account.');
              await tx
                .objectStore('readerAnnotationScope')
                .put({ annotationId: value.id, accountId });
              if (annotationBookKey.startsWith('content:'))
                await tx.objectStore('readerAnnotationOutbox').put({
                  id: crypto.randomUUID(),
                  accountId,
                  bookKey: annotationBookKey,
                  annotationId: value.id,
                  baseRevision: local?.revision ?? 0,
                  localRevision: value.revision,
                  value,
                  createdAt: new Date().toISOString()
                });
            }
          } else if (local && before?.annotationId && !local.deletedAt) {
            const removed = {
              ...local,
              revision: local.revision + 1,
              modifiedAt: new Date().toISOString(),
              deletedAt: new Date().toISOString()
            };
            await tx.objectStore('readerAnnotation').put(removed);
            if (accountId && annotationBookKey.startsWith('content:'))
              await tx.objectStore('readerAnnotationOutbox').put({
                id: crypto.randomUUID(),
                accountId,
                bookKey: annotationBookKey,
                annotationId: local.id,
                baseRevision: local.revision,
                localRevision: removed.revision,
                value: removed,
                createdAt: removed.modifiedAt
              });
          }
          await tx.objectStore('readerImportRecord').put(incoming);
          changed++;
        }
        if (imported.statistics && changed) {
          let lastModified = 0;
          let cursor = await statisticStore.openCursor(
            statisticKey ? statisticRange(statisticKey) : IDBKeyRange.bound([title], [title, []])
          );
          while (cursor) {
            lastModified = Math.max(lastModified, cursor.value.lastStatisticModified);
            cursor = await cursor.continue();
          }
          await tx.objectStore('lastModified').put({
            title: statisticKey ?? title,
            dataType: StorageDataType.STATISTICS,
            lastModifiedValue: lastModified
          });
        }
        // Receipt and payloads commit together. No cross-database "import succeeded" marker.
        if (created || canonical(prior) !== canonical(nextReceipt))
          await tx
            .objectStore('data')
            .put({ ...target, manabiTtuImport: nextReceipt } as MigratedBook);
        signal?.throwIfAborted();
        assertAccount();
        await tx.done;
        getStorageHandler(window, StorageKey.BROWSER).clearData();
        database.bookmarksChanged$.next();
        database.dataListChanged$.next(undefined);
        return {
          status: created || changed ? 'imported' : 'unchanged',
          title,
          bookId,
          records: changed,
          warning: prepared.length
            ? `${prepared.filter((entry) => entry.record.status === 'anchored').length} anchored passage(s), ${prepared.filter((entry) => entry.record.status === 'book-note').length} book note(s), ${prepared.filter((entry) => entry.record.status === 'unresolved').length} unlocated record(s) retained. Open Bookmarks & Notes for imported notes and original records.`
            : undefined
        };
      } catch (error) {
        cancel();
        await tx.done.catch(() => undefined);
        throw error;
      } finally {
        signal?.removeEventListener('abort', cancel);
      }
    });
    if (collectionTags?.length && core.bookId !== undefined) {
      if (signal?.aborted)
        return { ...core, warning: 'Book imported; retry this ZIP to finish collection tags.' };
      let added = 0;
      try {
        const member = bookKey(core.bookId);
        assertAccount();
        await updateOrganization(
          (value) => {
            assertAccount();
            for (const name of collectionTags) {
              let collection = value.collections.find((item) => item.name === name);
              if (!collection) {
                collection = { id: crypto.randomUUID(), name, members: [] };
                value.collections.push(collection);
                added++;
              }
              if (!collection.members.includes(member)) {
                collection.members.push(member);
                added++;
              }
            }
          },
          {
            key: `yatsu-organization:${core.bookId}`,
            value: canonical(collectionTags),
            modified: item.files.metadata!.metadata.modified
          }
        );
      } catch {
        return { ...core, warning: 'Book imported; retry this ZIP to finish collection tags.' };
      }
      if (added) return { ...core, status: 'imported', records: core.records + added };
    }
    return core;
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
