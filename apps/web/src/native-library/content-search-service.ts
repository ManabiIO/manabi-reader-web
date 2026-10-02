/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ShelfBook } from '../lib/library/view-model';
import type { BookSearchBatch } from '../lib/search/book-content-source';
import { snapshotReaderLocator, type ReaderLocator } from '../lib/reader-location';
import type { LibraryAccessIdentity, LibraryAuthority } from './contract';
import { parseLibraryQuery } from './view-model';
import {
  CONTENT_SEARCH_HIT_LIMIT,
  CONTENT_SEARCH_LIFETIME,
  CONTENT_SEARCH_PAGE_LIMIT,
  type ContentSearchView,
  type NativeContentHit,
  type NativeContentSearchState
} from './content-search-contract';

/** DOM-only adapters. No locator, book key, account, or source handle crosses the bridge. */
export interface ContentSearchRepository {
  books(view: ContentSearchView, authority: LibraryAuthority): Promise<ShelfBook[]>;
  search(
    query: string,
    books: ShelfBook[],
    authority: LibraryAuthority,
    receive: (batch: BookSearchBatch) => void
  ): Promise<() => void>;
  validate(
    book: ShelfBook,
    locator: ReaderLocator,
    authority: LibraryAuthority
  ): Promise<LibraryAccessIdentity>;
}
interface Selection {
  book: ShelfBook;
  locator: ReaderLocator;
}
interface SearchRun {
  token: string;
  key: string;
  created: number;
  controller: AbortController;
  authority: LibraryAuthority;
  state: NativeContentSearchState;
  selections: Map<string, Selection>;
  stop?: () => void;
  timer?: ReturnType<typeof setTimeout>;
  release(): void;
  consumed: boolean;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const validToken = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128;
function parseStart(value: unknown): { query: string; view: ContentSearchView } {
  if (
    !record(value) ||
    Object.keys(value).some((key) => !['query', 'view'].includes(key)) ||
    typeof value.query !== 'string' ||
    !value.query.trim() ||
    [...value.query].length > 512 ||
    (value.view !== undefined &&
      (!record(value.view) ||
        Object.keys(value.view).some(
          (key) =>
            !['collection', 'series', 'source', 'unfinished', 'sort', 'direction'].includes(key)
        )))
  )
    throw new Error('Enter a passage search of 1–512 characters.');
  const { collection, series, source, unfinished, sort, direction } = parseLibraryQuery(
    value.view ?? {}
  );
  return {
    query: value.query,
    view: { collection, series, source, unfinished, sort, direction }
  };
}

/** One bounded, cancellable search per native Library, retaining single-use passage admissions. */
export class NativeLibraryContentSearchService {
  private run?: SearchRun;
  constructor(
    private repository: ContentSearchRepository,
    private token = () => crypto.randomUUID(),
    private now = () => Date.now()
  ) {}
  private assert(authority: LibraryAuthority) {
    authority.signal.throwIfAborted();
    authority.assertCurrent();
  }
  private current(run: SearchRun) {
    try {
      this.assert(run.authority);
      if (
        this.run !== run ||
        this.now() < run.created ||
        this.now() - run.created >= CONTENT_SEARCH_LIFETIME
      )
        throw new Error('The passage search expired. Search again.');
    } catch (cause) {
      this.stop(run);
      throw cause;
    }
  }
  private stop(run: SearchRun) {
    if (run.controller.signal.aborted) return;
    run.controller.abort();
    run.stop?.();
    run.release();
    clearTimeout(run.timer);
    if (this.run === run) this.run = undefined;
  }
  private selected(payload: unknown, authority: LibraryAuthority, fields: string[]) {
    this.assert(authority);
    if (
      !record(payload) ||
      Object.keys(payload).some((key) => !['token', ...fields].includes(key)) ||
      !validToken(payload.token)
    )
      throw new Error('Invalid passage search request.');
    const run = this.run;
    if (!run || run.token !== payload.token || run.key !== authority.key || run.consumed)
      throw new Error('The passage search expired. Search again.');
    this.current(run);
    return { run, payload };
  }
  start(payload: unknown, authority: LibraryAuthority): NativeContentSearchState {
    this.assert(authority);
    const input = parseStart(payload);
    if (this.run) this.stop(this.run);
    const controller = new AbortController();
    const owned: LibraryAuthority = {
      key: authority.key,
      signal: AbortSignal.any([controller.signal, authority.signal]),
      assertCurrent: () => this.assert(authority)
    };
    const run: SearchRun = {
      token: this.token(),
      key: authority.key,
      created: this.now(),
      controller,
      authority: owned,
      selections: new Map(),
      consumed: false,
      release: () => authority.signal.removeEventListener('abort', abort),
      state: {
        token: '',
        query: input.query,
        status: 'loading',
        items: [],
        total: 0,
        offset: 0,
        limit: CONTENT_SEARCH_PAGE_LIMIT,
        failed: 0,
        truncated: false
      }
    };
    const abort = () => this.stop(run);
    authority.signal.addEventListener('abort', abort, { once: true });
    run.state.token = run.token;
    this.run = run;
    run.timer = setTimeout(() => this.stop(run), CONTENT_SEARCH_LIFETIME);
    void this.search(run, input.view);
    return structuredClone(run.state);
  }
  private async search(run: SearchRun, view: ContentSearchView) {
    try {
      const books = await this.repository.books(view, run.authority);
      this.current(run);
      const selected = new Map(
        books
          .filter((book) => book.bookId && !book.isPlaceholder)
          .map((book) => [book.bookId!, structuredClone(book)])
      );
      const handles = new Map<string, string>();
      const stop = await this.repository.search(
        run.state.query,
        [...selected.values()],
        run.authority,
        (batch) => {
          if (this.run !== run || run.authority.signal.aborted) return;
          this.current(run);
          const items: NativeContentHit[] = [];
          const selections = new Map<string, Selection>();
          let rejected = 0;
          for (const hit of batch.hits.slice(0, CONTENT_SEARCH_HIT_LIMIT)) {
            const book = selected.get(hit.bookId);
            const locator = snapshotReaderLocator(hit.locator);
            const match = hit.excerptMatch;
            if (
              !book ||
              !locator ||
              JSON.stringify(locator).length > 16384 ||
              typeof hit.excerpt !== 'string' ||
              hit.excerpt.length > 8192 ||
              !match ||
              !Number.isSafeInteger(match.start) ||
              !Number.isSafeInteger(match.end) ||
              match.start < 0 ||
              match.end <= match.start ||
              match.end > hit.excerpt.length
            ) {
              rejected++;
              continue;
            }
            const identity = JSON.stringify([hit.bookId, locator]);
            const key = handles.get(identity) ?? this.token();
            handles.set(identity, key);
            if (selections.has(key)) continue;
            selections.set(key, { book, locator });
            items.push({
              key,
              bookId: hit.bookId,
              title: book.title.slice(0, 1000),
              section: locator.resource.spineIndex + 1,
              excerpt: hit.excerpt,
              match: { ...match }
            });
          }
          run.selections = selections;
          run.state = {
            ...run.state,
            status: batch.busy ? 'loading' : 'ready',
            items,
            total: items.length,
            failed: Math.max(0, batch.failed) + rejected,
            truncated: batch.truncated || batch.hits.length > CONTENT_SEARCH_HIT_LIMIT
          };
        }
      );
      if (this.run !== run || run.authority.signal.aborted) stop();
      else run.stop = stop;
    } catch {
      if (this.run !== run || run.authority.signal.aborted) return;
      run.stop?.();
      run.state = {
        ...run.state,
        status: 'error',
        items: [],
        total: 0,
        // Internal provider/database errors may contain paths or identifiers.
        error: 'Saved book passages could not be searched. Refresh the Library and try again.'
      };
      run.selections.clear();
    }
  }
  read(payload: unknown, authority: LibraryAuthority): NativeContentSearchState {
    const { run, payload: value } = this.selected(payload, authority, ['offset', 'limit']);
    const offset = value.offset ?? 0;
    const limit = value.limit ?? CONTENT_SEARCH_PAGE_LIMIT;
    if (
      !Number.isSafeInteger(offset) ||
      Number(offset) < 0 ||
      Number(offset) > CONTENT_SEARCH_HIT_LIMIT ||
      !Number.isSafeInteger(limit) ||
      Number(limit) < 1 ||
      Number(limit) > CONTENT_SEARCH_PAGE_LIMIT
    )
      throw new Error('Invalid passage search page.');
    const response = structuredClone({
      ...run.state,
      offset: Number(offset),
      limit: Number(limit),
      items: run.state.items.slice(Number(offset), Number(offset) + Number(limit))
    });
    if (new TextEncoder().encode(JSON.stringify(response)).length > 640 * 1024)
      throw new Error('This passage search page is too large. Use a smaller page.');
    return response;
  }
  cancel(payload: unknown, authority: LibraryAuthority): { cancelled: true } {
    this.assert(authority);
    if (
      !record(payload) ||
      Object.keys(payload).some((key) => key !== 'token') ||
      !validToken(payload.token)
    )
      throw new Error('Invalid passage search cancellation.');
    // Delayed cleanup for an older query must never cancel its replacement.
    if (this.run?.token === payload.token && this.run.key === authority.key) this.stop(this.run);
    return { cancelled: true };
  }
  async admitOpen(payload: unknown, authority: LibraryAuthority) {
    const { run, payload: value } = this.selected(payload, authority, ['hit']);
    if (!validToken(value.hit)) throw new Error('Invalid passage selection.');
    const selection = run.selections.get(value.hit);
    if (!selection) throw new Error('This passage is outside the current search.');
    run.consumed = true;
    run.stop?.();
    const identity = await this.repository.validate(
      structuredClone(selection.book),
      structuredClone(selection.locator),
      run.authority
    );
    this.assert(authority);
    this.current(run);
    return {
      identity,
      locator: structuredClone(selection.locator),
      /** Check immediately before native reader admission, not after leaving the Library. */
      assertCurrent: () => this.current(run)
    };
  }
  dispose() {
    if (this.run) this.stop(this.run);
  }
}
