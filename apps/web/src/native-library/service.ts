/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * DOM-owned admission service. No storage, handles, source URLs, or executable callbacks cross the bridge.
 */

import { allBooks, physicalBooks, type ShelfBook, type ShelfNode } from '../lib/library/view-model';
import {
  validBookMetadata,
  validBookSeries,
  boundedMetadataText
} from '../lib/library/book-presentation';
import { calendarDay, isFinished, validDay } from '../lib/library/completion';
import {
  collectionContains,
  wantToReadCollection,
  WANT_TO_READ_ID
} from '../lib/library/want-to-read';
import { sourceKey } from '../lib/library/organization-keys';
import type {
  Organization,
  BookPresentation,
  PresentationChange
} from '../lib/library/organization';
import { coverOverride } from '../lib/library/cover-override';
import { parseCoverImportTarget } from '../platform/bridge-contract';
import type { SourceDescriptor } from '../lib/library/catalog';
import {
  LIBRARY_ACTION_LIMIT,
  type LibraryActionRequest,
  type LibraryAccessIdentity,
  type LibraryAuthority,
  type NativeLibraryState
} from './contract';
import {
  NativeLibraryCoverService,
  type RenderLibraryCover,
  type LibraryCoverTarget
} from './cover-service';
import { libraryNodes, nativeBook, parseLibraryQuery } from './view-model';

export interface LibraryData {
  tree: ShelfNode[];
  organization: Organization;
  sources: SourceDescriptor[];
  /** DOM-only canonical identities, captured with saved covers. */
  coverIdentities?: Record<number, string>;
}
export type LibraryWriteRequest =
  | Exclude<LibraryActionRequest, { type: 'presentation' }>
  | (Omit<Extract<LibraryActionRequest, { type: 'presentation' }>, 'change'> & {
      change: PresentationChange;
    });
export interface LibraryRepository {
  cover?: RenderLibraryCover;
  load(authority: LibraryAuthority): Promise<LibraryData>;
  write(
    action: LibraryWriteRequest,
    targets: ShelfBook[],
    expected: Record<string, BookPresentation | undefined>,
    authority: LibraryAuthority
  ): Promise<void>;
}
interface Admission {
  key: string;
  created: number;
  targets: Map<string, ShelfBook>;
  /** Existing canonical keys captured by the DOM repository, never native hints. */
  identities: Map<string, string>;
  expected: Record<string, BookPresentation | undefined>;
  collections: Map<string, string>;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function parseAction(value: unknown): LibraryActionRequest {
  if (!record(value) || typeof value.token !== 'string' || value.token.length > 128)
    throw new Error('Invalid Library action.');
  const fields: Record<string, string[]> = {
    presentation: ['keys', 'change', 'preserveSeriesIndex'],
    membership: ['keys', 'collection', 'included'],
    'collection.create': ['name', 'keys'],
    'collection.rename': ['collection', 'name'],
    'collection.remove': ['collection'],
    completion: ['keys', 'state', 'day']
  };
  if (
    typeof value.type !== 'string' ||
    !fields[value.type] ||
    Object.keys(value).some(
      (key) => !['type', 'token', ...fields[value.type as string]].includes(key)
    )
  )
    throw new Error('Unsupported Library action.');
  if (
    'keys' in value &&
    (!Array.isArray(value.keys) ||
      value.keys.length > LIBRARY_ACTION_LIMIT ||
      value.keys.some((key) => typeof key !== 'string' || key.length > 128) ||
      new Set(value.keys).size !== value.keys.length)
  )
    throw new Error('Invalid book selection.');
  if (
    ['presentation', 'membership', 'completion'].includes(value.type) &&
    (!Array.isArray(value.keys) || !value.keys.length)
  )
    throw new Error('Select at least one book.');
  if (
    'collection' in value &&
    (typeof value.collection !== 'string' || value.collection.length > 128)
  )
    throw new Error('Invalid collection.');
  if ('name' in value && (!boundedMetadataText(value.name, 240) || !value.name.trim()))
    throw new Error('Use a collection name of 1–240 characters.');
  if (value.type === 'membership' && typeof value.included !== 'boolean')
    throw new Error('Invalid collection membership.');
  if (value.type === 'presentation') {
    if (
      !record(value.change) ||
      !Object.keys(value.change).length ||
      Object.keys(value.change).some(
        (key) => !['title', 'metadata', 'series', 'direction', 'coverBlur'].includes(key)
      )
    )
      throw new Error('Invalid metadata change.');
    const patch = value.change;
    if ('title' in patch && (!boundedMetadataText(patch.title, 1000) || !patch.title.trim()))
      throw new Error('Use a title of 1–1000 characters.');
    if ('metadata' in patch && !validBookMetadata(patch.metadata))
      throw new Error('Invalid book metadata.');
    if ('series' in patch && !validBookSeries(patch.series))
      throw new Error('Use a series name and a nonnegative volume number.');
    if ('direction' in patch && !['ltr', 'rtl', 'unknown'].includes(patch.direction as string))
      throw new Error('Invalid page direction.');
    if ('coverBlur' in patch && typeof patch.coverBlur !== 'boolean')
      throw new Error('Invalid cover preference.');
    if ('preserveSeriesIndex' in value && typeof value.preserveSeriesIndex !== 'boolean')
      throw new Error('Invalid series preference.');
    if (
      Array.isArray(value.keys) &&
      value.keys.length !== 1 &&
      ('metadata' in patch || 'title' in patch)
    )
      throw new Error('Edit metadata for one book at a time.');
  }
  if (
    value.type === 'completion' &&
    (!['reading', 'finished'].includes(value.state as string) ||
      (value.day !== undefined && (!validDay(value.day) || value.day > calendarDay())))
  )
    throw new Error('Choose a valid finished date no later than today.');
  return structuredClone(value) as LibraryActionRequest;
}
/** Includes physical source identity even when a numeric saved-book ID is reused. */
export function libraryBookLocator(book: ShelfBook) {
  return JSON.stringify([
    'book',
    book.key,
    book.source ? sourceKey(book.source) : null,
    book.file?.id ?? null
  ]);
}
export function libraryBookIdentity(book: ShelfBook) {
  return JSON.stringify([
    book.bookId,
    book.contentHash ?? null,
    book.canonicalTitle,
    book.lastBookModified,
    book.organizationKey,
    book.source && sourceKey(book.source),
    book.file?.id,
    book.file?.expectedContentHash
  ]);
}
export class NativeLibraryService {
  private admissions = new Map<string, Admission>();
  private handles = new Map<string, string>();
  private scope = '';
  private busy = false;
  private covers: NativeLibraryCoverService;
  private coverGeneration = 0;
  constructor(
    private repository: LibraryRepository,
    private token: () => string = () => crypto.randomUUID(),
    private now = () => Date.now()
  ) {
    this.covers = new NativeLibraryCoverService(repository.cover, now);
  }
  private assert(authority: LibraryAuthority) {
    authority.signal.throwIfAborted();
    authority.assertCurrent();
  }
  private bind(authority: LibraryAuthority) {
    this.assert(authority);
    if (authority.key !== this.scope) {
      this.admissions.clear();
      this.covers.dispose();
      this.handles.clear();
      this.scope = authority.key;
    }
  }
  private handle(value: string): string {
    for (const [key, target] of this.handles) if (target === value) return key;
    if (this.handles.size >= 50000)
      throw new Error('This library exceeds the native navigation limit.');
    const key = this.token();
    this.handles.set(key, value);
    return key;
  }
  async state(payload: unknown, authority: LibraryAuthority): Promise<NativeLibraryState> {
    this.bind(authority);
    this.covers.dispose();
    const coverGeneration = ++this.coverGeneration;
    const query = parseLibraryQuery(payload);
    const seriesId = query.series ? this.handles.get(query.series) : '';
    const sourceId = query.source ? this.handles.get(query.source) : '';
    if ((query.series && !seriesId) || (query.source && !sourceId))
      throw new Error('The Library view expired. Return to All Books.');
    const data = await this.repository.load(authority);
    this.assert(authority);
    const books = allBooks(data.tree);
    const { nodes, trail } = libraryNodes(
      data.tree,
      data.organization,
      query,
      seriesId,
      (book) => !sourceId || (!!book.source && sourceKey(book.source) === sourceId)
    );
    const offset = Math.min(
      query.offset,
      Math.max(0, Math.ceil(nodes.length / query.limit) * query.limit - query.limit)
    );
    const targets = new Map<string, ShelfBook>();
    const bookRow = (book: ShelfBook) => {
      const key = this.handle(libraryBookLocator(book));
      targets.set(key, structuredClone(book));
      return {
        ...nativeBook(book, key, data.organization),
        hasCover: !!(
          book.bookId &&
          data.coverIdentities?.[book.bookId] &&
          !book.isPlaceholder &&
          book.imagePath
        )
      };
    };
    const items = nodes.slice(offset, offset + query.limit).map((node) =>
      node.kind === 'book'
        ? bookRow(node.book)
        : {
            kind: 'series' as const,
            key: this.handle(node.id),
            title: node.name.slice(0, 240),
            count: node.books.length,
            personal: !!node.personal
          }
    );
    const detailBook = query.detail
      ? physicalBooks(data.tree).find(
          (book) => libraryBookLocator(book) === this.handles.get(query.detail!)
        )
      : undefined;
    if (query.detail && !detailBook) throw new Error('This book is no longer available.');
    const want = wantToReadCollection(data.organization);
    const collections = [
      want,
      ...data.organization.collections.filter((item) => item.id !== WANT_TO_READ_ID)
    ];
    const token = this.token();
    const coverToken = this.token();
    const response: NativeLibraryState = {
      token,
      coverToken,
      items,
      total: nodes.length,
      offset,
      limit: query.limit,
      totalBooks: books.length,
      collections: collections.map((item) => ({
        id: item.id,
        name: item.name,
        count: books.filter((book) => collectionContains(item, book)).length,
        builtIn: item.id === WANT_TO_READ_ID
      })),
      counts: {
        finished: books.filter(isFinished).length,
        wantToRead: books.filter((book) => collectionContains(want, book)).length
      },
      sources: data.sources.map((source) => ({
        id: this.handle(sourceKey(source)),
        name: source.name.slice(0, 512),
        provider: source.provider,
        physicalActionsAvailable: false as const,
        reason:
          source.provider === 'local'
            ? 'Persistent Android folder access is not available yet. Import files with Import Books.'
            : 'Native provider authentication is not available yet. Saved copies remain readable.'
      })),
      trail: trail.map((series) => ({
        id: this.handle(series.id),
        name: series.name.slice(0, 240)
      })),
      ...(detailBook
        ? {
            detail: {
              ...bookRow(detailBook),
              metadata: { ...detailBook.metadata, creators: detailBook.creators },
              direction: detailBook.direction
            }
          }
        : {})
    };
    if (new TextEncoder().encode(JSON.stringify(response)).length > 640 * 1024)
      throw new Error('This Library view is too large. Use a narrower view.');
    this.assert(authority);
    this.admissions.set(token, {
      key: authority.key,
      created: this.now(),
      targets,
      identities: new Map(
        [...targets].flatMap(([key, book]) => {
          const identity = book.bookId && data.coverIdentities?.[book.bookId];
          return identity ? [[key, identity] as const] : [];
        })
      ),
      expected: structuredClone(
        Object.fromEntries(
          [
            ...new Set(
              [...targets.values()].flatMap((book) => [
                book.organizationKey,
                ...book.organizationAliases
              ])
            )
          ].map((key) => [key, data.organization.books[key]])
        )
      ),
      collections: new Map(collections.map((item) => [item.id, item.name]))
    });
    while (this.admissions.size > 8) this.admissions.delete(this.admissions.keys().next().value!);
    const coverTargets = new Map<string, LibraryCoverTarget>();
    for (const [key, book] of targets) {
      const readerBookKey = book.bookId && data.coverIdentities?.[book.bookId];
      if (readerBookKey && !book.isPlaceholder) coverTargets.set(key, { book, readerBookKey });
    }
    if (coverGeneration === this.coverGeneration)
      this.covers.install(coverToken, authority.key, coverTargets);
    return response;
  }
  readCover(payload: unknown, authority: LibraryAuthority) {
    this.bind(authority);
    return this.covers.read(payload, authority);
  }
  cancelCover(payload: unknown, authority: LibraryAuthority) {
    this.bind(authority);
    return this.covers.cancel(payload, authority);
  }
  /** DOM-only search scope. Native handles are resolved before reading any saved content. */
  async searchBooks(payload: unknown, authority: LibraryAuthority): Promise<ShelfBook[]> {
    this.bind(authority);
    const query = parseLibraryQuery(payload);
    const seriesId = query.series ? this.handles.get(query.series) : '';
    const sourceId = query.source ? this.handles.get(query.source) : '';
    if ((query.series && !seriesId) || (query.source && !sourceId))
      throw new Error('The Library view expired. Return to All Books.');
    const data = await this.repository.load(authority);
    this.assert(authority);
    const { nodes } = libraryNodes(
      data.tree,
      data.organization,
      { ...query, query: '' },
      seriesId,
      (book) => !sourceId || (!!book.source && sourceKey(book.source) === sourceId)
    );
    const books = allBooks(nodes).filter((book) => book.bookId && !book.isPlaceholder);
    if (books.length > 50000) throw new Error('This Library exceeds the local search limit.');
    return structuredClone(books);
  }
  /** Revalidate a retained passage target without minting a native ID-only admission. */
  async validateSearchBook(
    book: ShelfBook,
    authority: LibraryAuthority
  ): Promise<LibraryAccessIdentity> {
    this.bind(authority);
    const data = await this.repository.load(authority);
    this.assert(authority);
    const current = physicalBooks(data.tree).find(
      (candidate) => libraryBookLocator(candidate) === libraryBookLocator(book)
    );
    if (
      !book.bookId ||
      book.isPlaceholder ||
      !current ||
      current.isPlaceholder ||
      libraryBookIdentity(current) !== libraryBookIdentity(book)
    )
      throw new Error('This book changed. Search again before opening its passage.');
    return {
      bookId: book.bookId,
      contentHash: book.contentHash,
      title: book.canonicalTitle,
      lastBookModified: book.lastBookModified
    };
  }
  /** A cover transfer may only bind to an imported immutable content key. */
  admitCover(payload: unknown, authority: LibraryAuthority) {
    this.bind(authority);
    const target = parseCoverImportTarget(payload);
    const admission = this.admissions.get(target.token);
    const book = admission?.targets.get(target.key);
    if (
      !admission ||
      admission.key !== authority.key ||
      this.now() - admission.created < 0 ||
      this.now() - admission.created > 10 * 60 * 1000 ||
      !book
    )
      throw new Error('The Library selection expired. Refresh before changing its cover.');
    if (
      !book.bookId ||
      book.isPlaceholder ||
      !/^[a-f0-9]{64}$/.test(book.contentHash ?? '') ||
      book.organizationKey !== `content:${book.contentHash}`
    )
      throw new Error(
        'Re-import this book before choosing a cover. A verified imported copy is required.'
      );
    return target;
  }
  async replaceCover(
    payload: unknown,
    file: File,
    authority: LibraryAuthority
  ): Promise<{ saved: true }> {
    const target = this.admitCover(payload, authority);
    if (file.type !== target.type) throw new Error('The cover image type changed.');
    const cover = await coverOverride(file, authority);
    this.assert(authority);
    // A second admission check plus the ordinary mutation re-read rejects a replaced
    // book, account ABA, intervening metadata edit, or consumed/expired selection.
    this.admitCover(target, authority);
    return this.performAction(
      { token: target.token, type: 'presentation', keys: [target.key], change: { cover } },
      authority
    );
  }
  async action(payload: unknown, authority: LibraryAuthority): Promise<{ saved: true }> {
    return this.performAction(parseAction(payload), authority);
  }
  private async performAction(
    action: LibraryWriteRequest,
    authority: LibraryAuthority
  ): Promise<{ saved: true }> {
    this.bind(authority);
    const admitted = this.admissions.get(action.token);
    if (
      !admitted ||
      admitted.key !== authority.key ||
      this.now() - admitted.created < 0 ||
      this.now() - admitted.created > 10 * 60 * 1000
    )
      throw new Error('The Library selection expired. Refresh before saving.');
    if (this.busy) throw new Error('Another Library change is in progress.');
    const keys = 'keys' in action ? (action.keys ?? []) : [];
    const targets = keys.map((key) => {
      const book = admitted.targets.get(key);
      if (!book) throw new Error('The selection is outside the current Library view.');
      return book;
    });
    if ('collection' in action && !admitted.collections.has(action.collection))
      throw new Error('This collection is outside the current Library view.');
    if (
      ['collection.rename', 'collection.remove'].includes(action.type) &&
      'collection' in action &&
      action.collection === WANT_TO_READ_ID
    )
      throw new Error('Want to Read is a built-in collection.');
    if (
      targets.some((book) => !book.bookId && !/^content:[a-f0-9]{64}$/.test(book.organizationKey))
    )
      throw new Error(
        'Import this source book before organizing it. Its content identity is not verified.'
      );
    if (action.type === 'completion' && targets.some((book) => !book.bookId))
      throw new Error('Import this book before changing its reading status.');
    // Consume before suspension. A lost acknowledgment requires reconciliation, never a replay.
    this.admissions.delete(action.token);
    this.busy = true;
    try {
      const live = await this.repository.load(authority);
      this.assert(authority);
      const liveByKey = new Map(
        physicalBooks(live.tree).map((book) => [libraryBookLocator(book), book])
      );
      for (const target of targets) {
        const current = liveByKey.get(libraryBookLocator(target));
        if (!current || libraryBookIdentity(current) !== libraryBookIdentity(target))
          throw new Error('A selected book changed. Refresh before saving.');
      }
      if (
        'collection' in action &&
        action.collection !== WANT_TO_READ_ID &&
        !live.organization.collections.some(
          (item) =>
            item.id === action.collection &&
            item.name === admitted.collections.get(action.collection)
        )
      )
        throw new Error('This collection changed. Refresh before saving.');
      await this.repository.write(action, structuredClone(targets), admitted.expected, authority);
      return { saved: true };
    } finally {
      this.busy = false;
    }
  }
  async admitAccess(
    payload: unknown,
    authority: LibraryAuthority
  ): Promise<LibraryAccessIdentity[]> {
    this.bind(authority);
    if (
      !record(payload) ||
      Object.keys(payload).some((key) => !['token', 'keys', 'operation'].includes(key)) ||
      typeof payload.token !== 'string' ||
      payload.token.length > 128 ||
      !['open', 'delete'].includes(payload.operation as string) ||
      !Array.isArray(payload.keys) ||
      !payload.keys.length ||
      payload.keys.length > LIBRARY_ACTION_LIMIT ||
      payload.keys.some((key) => typeof key !== 'string' || key.length > 128) ||
      new Set(payload.keys).size !== payload.keys.length ||
      (payload.operation === 'open' && payload.keys.length !== 1)
    )
      throw new Error('Invalid Library access request.');
    const token = payload.token;
    const keys = [...payload.keys];
    const operation = payload.operation;
    const admitted = this.admissions.get(token);
    if (
      !admitted ||
      admitted.key !== authority.key ||
      this.now() - admitted.created < 0 ||
      this.now() - admitted.created > 10 * 60 * 1000
    )
      throw new Error('The Library selection expired. Refresh before continuing.');
    if (this.busy) throw new Error('Another Library change is in progress.');
    const targets = keys.map((key) => {
      const book = admitted.targets.get(key);
      if (!book || !book.bookId || (operation === 'open' && book.isPlaceholder))
        throw new Error('Only an available imported copy can perform this action.');
      return book;
    });
    this.admissions.delete(token);
    this.busy = true;
    try {
      const live = await this.repository.load(authority);
      this.assert(authority);
      const byKey = new Map(
        physicalBooks(live.tree).map((book) => [libraryBookLocator(book), book])
      );
      for (const [index, book] of targets.entries()) {
        const current = byKey.get(libraryBookLocator(book));
        if (!current || libraryBookIdentity(current) !== libraryBookIdentity(book))
          throw new Error('A selected book changed. Refresh before continuing.');
        const expectedKey = admitted.identities.get(keys[index]);
        if (expectedKey && live.coverIdentities?.[book.bookId!] !== expectedKey)
          throw new Error('A selected book changed. Refresh before continuing.');
      }
      return targets.map((book, index) => ({
        bookId: book.bookId!,
        ...(admitted.identities.has(keys[index])
          ? { readerBookKey: admitted.identities.get(keys[index]) }
          : {}),
        contentHash: book.contentHash,
        title: book.canonicalTitle,
        lastBookModified: book.lastBookModified
      }));
    } finally {
      this.busy = false;
    }
  }
  dispose() {
    this.coverGeneration++;
    this.covers.dispose();
    this.admissions.clear();
    this.handles.clear();
    this.scope = '';
  }
}
