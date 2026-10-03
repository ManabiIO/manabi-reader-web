/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * React/controller port of lib/library/library-workspace.svelte; transactions retain their original guards.
 */

import { foldSearch } from '$lib/library/search-normalization';
import { bookTitleMatchIndex } from '$lib/search/book-title-match-text';

import { librarySelectionScopeKey, type LibrarySelectionEligibility } from '$lib/library/selection';
import type { BookPresentation, PresentationChange } from '$lib/library/organization';
import { page } from '$app/stores';
import { goto, replaceState } from '$app/navigation';
import { resolve } from '$app/paths';
import { booklistSortOptions$ } from '$lib/data/store';
import { StorageKey } from '$lib/data/storage/storage-types';
import type { SortOption } from '$lib/data/sort-types';
import type { BookCardProps } from '$lib/components/book-card/book-card-props';
import { currentUser, localProfileUser, localUser } from '$lib/manabi/client';
import {
  allLinkedBooks,
  linkedBooks,
  refreshLinkedBooks,
  importLibraryBook
} from '$lib/manabi/books';
import { integrationDB, type LocalLibrary } from '$lib/manabi/persistence';
import { reconnectLocalLibrary, sha256 } from '$lib/manabi/sources';
import {
  sourceDescriptors,
  cachedCatalog,
  librarySource,
  scanCatalog,
  type Catalog,
  type SourceDescriptor
} from '$lib/library/catalog';
import {
  organization,
  watchOrganization,
  presentBook,
  presentBooks,
  setMembershipMany,
  setWantToRead,
  createCollection
} from '$lib/library/organization';
import {
  buildShelf,
  allBooks,
  seriesTrail,
  visibleShelf,
  type ShelfBook,
  type ShelfSeries
} from '$lib/library/view-model';
import { isFinished, finishedDay, calendarDay } from '$lib/library/completion';
import { visibleLibraryEntries } from '$lib/library/account-visibility';
import {
  WANT_TO_READ_ID,
  wantToReadCollection,
  collectionContains,
  collectionItemCount
} from '$lib/library/want-to-read';
import { setCompletion } from '$lib/library/commands';
import {
  createLocalSeries,
  renameLocalSeries,
  resumeLocalSeries,
  pendingMoves
} from '$lib/library/local-series';
import { previews, PreviewQueue } from '$lib/library/previews';
import type { ShelfNode } from '$lib/library/view-model';
import type { MovePlan } from '$lib/library/file-operations';
import type { ReaderLocator } from '$lib/reader-location';
import {
  libraryShelfSearchQuery,
  parseLibrarySearchScope,
  type LibrarySearchScope
} from '$lib/search/library-search-scope';
import { snippetItems } from '$lib/snippets/service';
import { snippetKey } from '$lib/snippets/document';
import { sharedCreatorLine } from '$lib/library/book-metadata';
import { coverOverride } from '$lib/library/cover-override';
import { contentBookKey, sourceKey } from '$lib/library/organization';
import {
  advanceCloudSeries,
  cancelCloudSeries,
  cloudSeriesStatus,
  cloudSeriesCapabilities,
  prepareCloudSeries,
  recentCloudSeries,
  type CloudSeriesCapability,
  type CloudSeriesPlan
} from '$lib/library/cloud-series';
import type { LibraryMenuModel } from '$lib/library/library-menu';
import { librarySortChoices, readLibrarySort } from '../features/library/sort-options';
import { continueBooks, finishedGroups, seriesReadingTarget } from '$lib/library/reading-state';
import { ObservableController, readStore, tick } from './observable-controller';
export class WorkspaceController extends ObservableController {
  private incomingRouteUrl: string | undefined;
  private routeUrlSnapshot: string | undefined;
  constructor(routeUrl?: string) {
    super();
    this.incomingRouteUrl = routeUrl;
    this.routeUrlSnapshot = routeUrl;
  }
  setRouteUrl(routeUrl: string | undefined) {
    // Shallow search writes change our live snapshot without changing Expo's
    // incoming props. Compare against the last incoming prop, not that snapshot,
    // so an unrelated parent render cannot undo a locally edited query/scope.
    if (routeUrl === this.incomingRouteUrl) return;
    this.incomingRouteUrl = routeUrl;
    this.routeUrlSnapshot = routeUrl;
    this.pendingQueryURL = undefined;
    this.pendingLibrarySearchScope = undefined;
    this.flush();
  }
  get url() {
    return this.routeUrlSnapshot === undefined
      ? readStore(page).url
      : new URL(this.routeUrlSnapshot);
  }
  onRemoveBook: (id: number) => void = () => {};
  onSelectionCancel: () => void = () => {};
  onSelectionChange: (selection: { ids: number[]; previews: string[] }) => void = () => {};
  onPrepareBook: (request: { prepare: () => Promise<number>; locator?: ReaderLocator }) => void =
    () => {};
  onEligibilityChange: (eligibility: LibrarySelectionEligibility) => void = () => {};
  coverWidths: Record<string, number> = {};
  shelfElement!: HTMLElement;
  bookCards: BookCardProps[] = [];
  currentBookId!: number | undefined;
  selectedBookIds: ReadonlySet<number> = new Set();
  selectedPreviewKeys: ReadonlySet<string> = new Set();
  selectMode = false;
  catalogs: Catalog[] = [];
  sources: SourceDescriptor[] = [];
  locals: LocalLibrary[] = [];
  pending: MovePlan[] = [];
  collectionsOpen = false;
  layout: 'grid' | 'list' = 'grid';
  seriesLayout: 'grid' | 'list' = 'list';
  finishedLayout: 'grid' | 'timeline' = 'timeline';
  finishedOrder: 'asc' | 'desc' = 'desc';
  query = '';
  busy = false;
  scanning = false;
  error = '';
  notice = '';
  organizationDialog!: 'metadata' | 'series' | 'collections' | undefined;
  organizationTargets: ShelfBook[] = [];
  organizationSnapshot: Record<string, BookPresentation | undefined> = {};
  organizationOwner: string | null = null;
  organizationEpoch = 0;
  organizationScope = '';
  dialogOpen = false;
  dialog: 'details' | 'rename' | 'date' | 'membership' | 'series-name' | 'new-series' = 'rename';
  targetBook!: ShelfBook | undefined;
  coverTarget!: ShelfBook | undefined;
  coverInput!: HTMLInputElement;
  newCollectionInput!: HTMLInputElement | undefined;
  targetSeries!: ShelfSeries | undefined;
  name = '';
  date = '';
  newCollectionName = '';
  groupSource = '';
  groupFiles: string[] = [];
  cloudCapabilities: Record<string, CloudSeriesCapability> = {};
  cloudPlans: {
    source: SourceDescriptor;
    plan: CloudSeriesPlan;
  }[] = [];
  cloudPlan!: CloudSeriesPlan | undefined;
  cloudPlanSource!: SourceDescriptor | undefined;
  previewFailures = 0;
  previewQueue!: PreviewQueue | undefined;
  alive = false;
  generation = 0;
  controller!: AbortController | undefined;
  sortItems = librarySortChoices.slice(0, 4);
  moreSortItems = librarySortChoices.slice(4);
  queryURL = '';
  librarySearchScope: LibrarySearchScope = 'everything';
  pendingQueryURL!: string | undefined;
  pendingLibrarySearchScope!: LibrarySearchScope | undefined;
  groupKey = (source: SourceDescriptor) => (source.owner === null ? source.id : sourceKey(source));
  cloudPollBusy = false;
  cloudPollAfter = 0;
  rememberCoverWidth(key: string, fraction: number) {
    if ((this.coverWidths[key] ?? 1) !== fraction)
      this.coverWidths = { ...this.coverWidths, [key]: fraction };
  }
  get personalSeriesNames() {
    return [
      ...new Set(this.books.flatMap((book) => (book.series ? [book.series.name] : [])))
    ].sort();
  }
  booksInMatchingSeries(nodes: ShelfNode[], search: string): string[] {
    let matches: string[] = [];
    for (const node of nodes) {
      if (node.kind !== 'series') continue;
      if (foldSearch(node.name).includes(search))
        matches = [...matches, ...node.books.map((book) => book.key)];
      matches = [...matches, ...this.booksInMatchingSeries(node.children, search)];
    }
    return matches.filter((key, index) => matches.indexOf(key) === index);
  }
  matchesBookQuery(book: ShelfBook, search: string, seriesMatches: string[]) {
    return (
      !search ||
      seriesMatches.includes(book.key) ||
      [
        book.title,
        book.canonicalTitle,
        ...(book.creators || []).map((creator) => creator.name)
      ].some((value) => foldSearch(value).includes(search))
    );
  }
  includesBook(
    book: ShelfBook,
    destination: string,
    members: string[] | undefined,
    unfinishedOnly: boolean,
    search: string,
    seriesMatches: string[]
  ) {
    return (
      (destination !== 'finished' || isFinished(book)) &&
      (!members || book.organizationAliases.some((alias) => members.includes(alias))) &&
      (!unfinishedOnly || !isFinished(book)) &&
      this.matchesBookQuery(book, search, seriesMatches)
    );
  }
  orderFinishedNodes(nodes: ShelfNode[], direction: 'asc' | 'desc'): ShelfNode[] {
    return [...nodes].sort((left, right) => {
      if (left.kind !== 'book' || right.kind !== 'book') return 0;
      const leftDay = finishedDay(left.book),
        rightDay = finishedDay(right.book);
      if (!leftDay || !rightDay) {
        if (leftDay) return -1;
        if (rightDay) return 1;
      } else {
        const compared = leftDay.localeCompare(rightDay);
        if (compared) return direction === 'asc' ? compared : -compared;
      }
      return (
        left.book.title.localeCompare(right.book.title, undefined, {
          numeric: true,
          sensitivity: 'base'
        }) || left.book.key.localeCompare(right.book.key)
      );
    });
  }
  get sort() {
    return readLibrarySort(readStore(booklistSortOptions$)[StorageKey.BROWSER]);
  }
  get viewerId() {
    return readStore(localUser)?.id ?? null;
  }
  get accountEntries() {
    return visibleLibraryEntries(this.bookCards, readStore(allLinkedBooks), this.viewerId);
  }
  get tree() {
    return buildShelf(
      this.accountEntries.cards,
      this.accountEntries.links,
      this.catalogs,
      this.sources,
      readStore(organization),
      readStore(previews)
    );
  }
  get books() {
    return allBooks(this.tree);
  }
  get collectionId() {
    return this.url.searchParams.get('collection') || 'books';
  }
  get wantToRead() {
    return wantToReadCollection(readStore(organization));
  }
  get customCollections() {
    return readStore(organization).collections.filter(
      (collection) => collection.id !== WANT_TO_READ_ID
    );
  }
  get selectedCollection() {
    return this.collectionId === WANT_TO_READ_ID
      ? this.wantToRead
      : this.customCollections.find((c) => c.id === this.collectionId);
  }
  get activeSnippetKeys() {
    return new Set(
      readStore(snippetItems)
        .filter((item) => !item.trashedAt)
        .map((item) => snippetKey(item.id))
    );
  }
  get wantToReadCount() {
    return collectionItemCount(this.wantToRead, this.books, this.activeSnippetKeys);
  }
  get customCollectionCounts() {
    return Object.fromEntries(
      this.customCollections.map((collection) => [
        collection.id,
        collectionItemCount(collection, this.books, this.activeSnippetKeys)
      ])
    );
  }
  get selectedKeys() {
    return new Set([
      ...this.selectedPreviewKeys,
      ...this.visibleBooks
        .filter((book) => book.bookId && this.selectedBookIds.has(book.bookId))
        .map((book) => book.key)
    ]);
  }
  get selectedBooks() {
    return this.visibleBooks.filter((book) => this.selectedKeys.has(book.key));
  }
  changeSelectedKeys(keys: ReadonlySet<string>) {
    const selected = this.visibleBooks.filter((book) => keys.has(book.key));
    this.onSelectionChange({
      ids: [...new Set(selected.flatMap((book) => (book.bookId ? [book.bookId] : [])))],
      previews: selected.filter((book) => !book.bookId).map((book) => book.key)
    });
  }
  selectAllVisible() {
    this.changeSelectedKeys(new Set(this.visibleBooks.map((book) => book.key)));
  }
  get collectionTitle() {
    return this.collectionId === 'finished' ? 'Finished' : this.selectedCollection?.name || 'Books';
  }
  get trail() {
    return seriesTrail(this.tree, this.url.searchParams.get('series') || '');
  }
  get series() {
    return this.trail.at(-1);
  }
  get notFinished() {
    return this.url.searchParams.get('unfinished') === '1';
  }
  get destinationTitle() {
    return this.series?.name || (this.collectionId === 'books' ? 'Library' : this.collectionTitle);
  }
  get nextQueryURL() {
    return this.url.searchParams.get('q') ?? '';
  }
  get nextLibrarySearchScope() {
    return parseLibrarySearchScope(this.url.searchParams.get('scope'));
  }
  get nextSelectionSearch() {
    return foldSearch(this.nextQueryURL.trim());
  }
  get searchableBooks() {
    return this.books;
  }
  get normalizedQuery() {
    return foldSearch(this.query.trim());
  }
  get unifiedSearchOwnsShelf() {
    return !!this.normalizedQuery && !this.selectMode;
  }
  get shelfQuery() {
    return libraryShelfSearchQuery(this.normalizedQuery, this.selectMode);
  }
  get metadataMatchIndex() {
    return bookTitleMatchIndex(
      this.searchableBooks,
      this.tree,
      readStore(organization).collections,
      this.normalizedQuery
    );
  }
  get metadataMatchText() {
    return this.metadataMatchIndex.textByBook;
  }
  get metadataMatches() {
    return this.searchableBooks.filter(
      (book) =>
        this.matchesBookQuery(book, this.normalizedQuery, []) ||
        this.metadataMatchIndex.matchedKeys.has(book.key)
    );
  }
  get flatDestination() {
    return !this.series && (this.collectionId === 'finished' || !!this.selectedCollection);
  }
  get seriesMatchedKeys() {
    return this.shelfQuery && !this.flatDestination
      ? this.booksInMatchingSeries(this.series?.children || this.tree, this.shelfQuery)
      : [];
  }
  get destinationNodes() {
    return this.unifiedSearchOwnsShelf
      ? []
      : this.flatDestination
        ? this.books
            .filter((book) =>
              this.includesBook(
                book,
                this.collectionId,
                this.selectedCollection?.members,
                this.notFinished,
                this.shelfQuery,
                this.seriesMatchedKeys
              )
            )
            .map((book) => ({ kind: 'book' as const, id: book.key, book }))
        : this.series?.children || this.tree;
  }
  get sortedDestination() {
    return visibleShelf(
      this.destinationNodes,
      (book) =>
        this.includesBook(
          book,
          this.collectionId,
          this.selectedCollection?.members,
          this.notFinished,
          this.shelfQuery,
          this.seriesMatchedKeys
        ),
      this.sort,
      !!this.series?.personal
    );
  }
  get displayed() {
    return this.collectionId === 'finished' && !this.series
      ? this.orderFinishedNodes(this.sortedDestination, this.finishedOrder)
      : this.sortedDestination;
  }
  get visibleBooks() {
    return allBooks(this.displayed);
  }
  get scopedSeriesBooks() {
    return !this.unifiedSearchOwnsShelf && this.series
      ? this.series.books.filter((book) =>
          this.includesBook(
            book,
            this.collectionId,
            this.selectedCollection?.members,
            this.notFinished,
            this.shelfQuery,
            this.seriesMatchedKeys
          )
        )
      : [];
  }
  get scopedVolumeOrder() {
    return !this.unifiedSearchOwnsShelf && this.series
      ? allBooks(this.series.children).filter((book) =>
          this.includesBook(
            book,
            this.collectionId,
            this.selectedCollection?.members,
            this.notFinished,
            this.shelfQuery,
            this.seriesMatchedKeys
          )
        )
      : [];
  }
  get resume() {
    return this.series
      ? seriesReadingTarget(this.scopedSeriesBooks, this.scopedVolumeOrder)
      : undefined;
  }
  get seriesCreators() {
    return this.series ? sharedCreatorLine(this.scopedSeriesBooks) : undefined;
  }
  get recentBooks() {
    return !this.series &&
      this.collectionId === 'books' &&
      !this.notFinished &&
      !this.normalizedQuery &&
      !this.selectMode
      ? continueBooks(this.books)
      : [];
  }
  get completedGroups() {
    return this.collectionId === 'finished' && !this.series
      ? finishedGroups(this.visibleBooks, this.finishedOrder)
      : [];
  }
  get currentLayout() {
    return this.collectionId === 'finished' && !this.series
      ? this.finishedLayout
      : this.series
        ? this.seriesLayout
        : this.layout;
  }
  selectionScopeFor(search: string, searchScope: LibrarySearchScope) {
    return librarySelectionScopeKey({
      viewerId: this.viewerId,
      collectionId: this.collectionId,
      seriesId: this.series?.id,
      unfinished: this.notFinished,
      searchScope,
      search
    });
  }
  retireSelectionScope(key: string) {
    if (!this.selectMode || key === this.selectionScopeKey) return;
    // Search state mutates before the shelf graph settles. Publish a new empty
    // scope synchronously so hidden selections cannot remain actionable.
    this.onEligibilityChange({ key, ids: [], previews: [] });
  }
  get selectableBookIds() {
    return this.visibleBooks.flatMap((book) => (book.bookId ? [book.bookId] : []));
  }
  get selectionScopeKey() {
    return this.selectionScopeFor(this.normalizedQuery, this.librarySearchScope);
  }
  get selectablePreviewKeys() {
    return this.visibleBooks.filter((book) => !book.bookId).map((book) => book.key);
  }
  get selectionEligibility() {
    return {
      key: this.selectionScopeKey,
      ids: this.selectableBookIds,
      previews: this.selectablePreviewKeys
    };
  }
  get groupCandidates() {
    return this.books.filter(
      (book) => book.source && this.groupKey(book.source) === this.groupSource && book.file
    );
  }
  get groupCloudSource() {
    return this.sources.find(
      (source) => source.owner !== null && this.groupKey(source) === this.groupSource
    );
  }
  get warnings() {
    return this.catalogs.flatMap((catalog) => catalog.warnings);
  }
  get menu() {
    return {
      title: this.destinationTitle,
      canGoBack: !!this.series || this.collectionId !== 'books',
      back: this.navigateBack,
      search: { query: this.query, setQuery: this.setQuery },
      currentLayout: this.currentLayout,
      layouts:
        this.collectionId === 'finished' && !this.series
          ? [
              { value: 'timeline', label: 'Timeline', icon: 'timeline' },
              { value: 'grid', label: 'Grid', icon: 'grid' }
            ]
          : [
              { value: 'grid', label: 'Grid', icon: 'grid' },
              { value: 'list', label: 'List', icon: 'list' }
            ],
      setLayout: this.setLayout,
      showValue:
        this.collectionId === 'finished' ? 'finished' : this.notFinished ? 'unfinished' : 'all',
      showChoices:
        this.collectionId === 'finished'
          ? [{ value: 'finished', label: 'Finished books' }]
          : [
              { value: 'all', label: this.series ? 'All in Series' : 'All Books' },
              { value: 'unfinished', label: 'Not Finished' }
            ],
      setShow: (value: string) =>
        this.navigate(this.series?.id, this.collectionId, value === 'unfinished'),
      sortProperty: this.sort.property,
      sortDirection: this.sort.direction,
      sortChoices: this.collectionId === 'finished' && !this.series ? [] : this.sortItems,
      moreSortChoices: this.collectionId === 'finished' && !this.series ? [] : this.moreSortItems,
      setSort: this.setSort,
      finishedOrder:
        this.collectionId === 'finished' && !this.series ? this.finishedOrder : undefined,
      setFinishedOrder: this.setFinishedOrder,
      createSeries: this.newSeries,
      selectedActions: {
        busy: this.busy,
        savedCount: this.selectedBooks.filter((book) => book.bookId).length,
        collections: () => this.editOrganization('collections', this.selectedBooks),
        series: () => this.editOrganization('series', this.selectedBooks),
        blur: this.blurSelected,
        unblur: this.unblurSelected,
        canBlur: this.selectedBooks.some((book) => !book.coverBlur),
        canUnblur: this.selectedBooks.some((book) => book.coverBlur)
      },
      refreshFolders: this.refreshFolders,
      selectedWantToRead: {
        canAdd: this.selectedBooks.some((book) => !collectionContains(this.wantToRead, book)),
        canRemove: this.selectedBooks.some((book) => collectionContains(this.wantToRead, book)),
        set: this.saveSelectedWantToRead
      }
    } satisfies LibraryMenuModel;
  }
  previewVisible(element: HTMLElement, node: ShelfNode) {
    let visible = false;
    const schedule = (value: ShelfNode) => {
      if (!visible || this.selectMode) return;
      const wanted = value.kind === 'book' ? [value.book] : value.books.slice(0, 5);
      for (const book of wanted)
        if (book.source && book.file && (!book.imagePath || !book.pageDirection)) {
          const catalog = this.catalogs.find(
            (c) =>
              c.source.id === book.source!.id &&
              c.source.root === book.source!.root &&
              c.source.owner === book.source!.owner
          );
          if (catalog) this.previewQueue?.add(book.source, book.file, catalog.scannedAt);
        }
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          visible = true;
          schedule(node);
          observer.disconnect();
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(element);
    return {
      update(value: ShelfNode) {
        node = value;
        schedule(value);
      },
      destroy() {
        observer.disconnect();
      }
    };
  }
  navigate(seriesId?: string, collection = this.collectionId, unfinished = this.notFinished) {
    const url = new URL(this.url);
    if (seriesId) url.searchParams.set('series', seriesId);
    else url.searchParams.delete('series');
    if (collection !== 'books') url.searchParams.set('collection', collection);
    else url.searchParams.delete('collection');
    if (unfinished) url.searchParams.set('unfinished', '1');
    else url.searchParams.delete('unfinished');
    void goto(resolve(`/manage?${url.searchParams.toString()}`));
  }
  navigateBack() {
    this.navigate(
      this.trail.length > 1 ? this.trail.at(-2)?.id : undefined,
      this.series ? this.collectionId : 'books',
      false
    );
  }
  librarySearchURL(queryValue: string, scopeValue: LibrarySearchScope) {
    const url = new URL(this.url);
    if (queryValue) url.searchParams.set('q', queryValue);
    else url.searchParams.delete('q');
    if (scopeValue === 'everything') url.searchParams.delete('scope');
    else url.searchParams.set('scope', scopeValue);
    return url;
  }
  replaceLibrarySearchURL(url: URL) {
    // q/scope are local presentation state for this already-mounted route.
    // Shallow replacement keeps the address bar/shareability in sync without
    // starting Expo navigation work on each keystroke or filter change.
    if (this.routeUrlSnapshot !== undefined) this.routeUrlSnapshot = url.href;
    replaceState(`${resolve('/manage')}${url.search}${url.hash}`, readStore(page).state);
  }
  setQuery(value: string) {
    this.retireSelectionScope(
      this.selectionScopeFor(foldSearch(value.trim()), this.librarySearchScope)
    );
    this.query = this.queryURL = value;
    this.pendingQueryURL = value;
    this.replaceLibrarySearchURL(this.librarySearchURL(value, this.librarySearchScope));
  }
  setSearchScope(value: LibrarySearchScope) {
    this.retireSelectionScope(this.selectionScopeFor(this.normalizedQuery, value));
    this.librarySearchScope = value;
    this.pendingLibrarySearchScope = value;
    this.replaceLibrarySearchURL(this.librarySearchURL(this.queryURL, value));
  }
  setLayout(value: string) {
    if (this.collectionId === 'finished' && !this.series) {
      if (value !== 'grid' && value !== 'timeline') return;
      this.finishedLayout = value;
    } else if (this.series) {
      if (value !== 'grid' && value !== 'list') return;
      this.seriesLayout = value;
    } else {
      if (value !== 'grid' && value !== 'list') return;
      this.layout = value;
    }
    try {
      localStorage.setItem(
        this.collectionId === 'finished' && !this.series
          ? 'manabi-finished-layout'
          : this.series
            ? 'manabi-series-layout'
            : 'manabi-library-layout',
        value
      );
    } catch {
      /* layout still works for this session */
    }
  }
  setSort(property: string, direction = this.sort.direction) {
    if (![...this.sortItems, ...this.moreSortItems].some((item) => item.property === property))
      return;
    booklistSortOptions$.next({
      ...readStore(booklistSortOptions$),
      [StorageKey.BROWSER]: { property: property as SortOption['property'], direction }
    });
  }
  setFinishedOrder(value: string) {
    if (value !== 'asc' && value !== 'desc') return;
    this.finishedOrder = value;
    try {
      localStorage.setItem('manabi-finished-order', value);
    } catch {
      /* preference is optional */
    }
  }
  async action(work: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    this.notice = '';
    try {
      await work();
    } catch (e) {
      this.error =
        e instanceof Error
          ? e.message
          : 'The operation did not finish. Your original files are kept.';
    } finally {
      if (this.alive) {
        this.busy = false;
        try {
          this.pending = await pendingMoves();
        } catch {
          /* Preserve the original operation result. */
        }
      }
    }
  }
  async load(refresh = false) {
    if (refresh) this.previewFailures = 0;
    this.previewQueue?.stop();
    this.previewQueue = new PreviewQueue(() => {
      if (this.alive) this.previewFailures++;
    });
    const run = ++this.generation;
    this.controller?.abort();
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.scanning = true;
    try {
      const owner = localProfileUser()?.id;
      const nextSources = await sourceDescriptors();
      const nextLocals = await (await integrationDB()).getAll('localLibraries');
      const cached = await Promise.all(nextSources.map((source) => cachedCatalog(source)));
      if (!this.alive || run !== this.generation || owner !== localProfileUser()?.id) return;
      this.sources = nextSources;
      this.locals = nextLocals;
      this.catalogs = cached.filter((c): c is Catalog => !!c);
      const nextPending = await pendingMoves();
      await refreshLinkedBooks();
      if (!this.alive || run !== this.generation || owner !== localProfileUser()?.id) return;
      this.pending = nextPending;
      const cloud = nextSources.filter(
        (source) => source.owner === currentUser()?.id && source.provider === 'onedrive'
      );
      const cloudState = await Promise.all(
        cloud.map(async (source) => {
          const [capability, plans] = await Promise.allSettled([
            cloudSeriesCapabilities(source),
            recentCloudSeries(source)
          ]);
          return {
            source,
            capability: capability.status === 'fulfilled' ? capability.value : undefined,
            plans: plans.status === 'fulfilled' ? plans.value.items : [],
            receiptsChanged: plans.status === 'fulfilled' && plans.value.receiptsChanged
          };
        })
      );
      if (!this.alive || run !== this.generation || owner !== localProfileUser()?.id) return;
      this.cloudCapabilities = Object.fromEntries(
        cloudState.flatMap(({ source, capability }) =>
          capability ? [[sourceKey(source), capability]] : []
        )
      );
      this.cloudPlans = cloudState.flatMap(({ source, plans }) =>
        plans
          .filter((plan) => !['complete', 'cancelled'].includes(plan.status))
          .map((plan) => ({ source, plan }))
      );
      const cloudWithReceipts = new Set(
        cloudState
          .filter(({ receiptsChanged }) => receiptsChanged)
          .map(({ source }) => sourceKey(source))
      );
      for (const source of nextSources) {
        if (
          !refresh &&
          !cloudWithReceipts.has(sourceKey(source)) &&
          cached.some(
            (c) =>
              c?.source.id === source.id &&
              c.source.root === source.root &&
              c.source.owner === source.owner
          )
        )
          continue;
        try {
          const catalog = await scanCatalog(await librarySource(source), source, signal);
          if (!this.alive || run !== this.generation) return;
          this.catalogs = [
            ...this.catalogs.filter(
              (c) =>
                !(
                  c.source.id === source.id &&
                  c.source.root === source.root &&
                  c.source.owner === source.owner
                )
            ),
            catalog
          ];
        } catch (e) {
          if (signal.aborted) return;
          this.error = `${source.provider === 'local' ? source.name : 'Connected library'}: ${e instanceof Error ? e.message : 'Could not refresh folders.'} The last saved library is still available.`;
        }
      }
    } finally {
      if (this.alive && run === this.generation) this.scanning = false;
    }
  }
  async ensureBook(book: ShelfBook): Promise<number> {
    if (
      book.bookId &&
      !book.isPlaceholder &&
      (!book.source ||
        !book.file ||
        readStore(linkedBooks).some(
          (link) =>
            link.bookId === book.bookId &&
            link.sourceId === book.source?.id &&
            link.owner === book.source?.owner &&
            link.root === book.source?.root &&
            link.fileId === book.file?.id
        ))
    )
      return book.bookId;
    if (!book.source || !book.file) {
      if (book.bookId) return book.bookId;
      throw new Error('This book has no accessible source.');
    }
    this.notice = `Adding “${book.title}” to this browser…`;
    // Sync remains opt-in on Accounts and libraries; opening a file never enables remote writes.
    const link = await importLibraryBook(
      await librarySource(book.source),
      book.file,
      false,
      book.bookId
    );
    return link.bookId;
  }
  async stableOrganizationBook(book: ShelfBook): Promise<ShelfBook> {
    if (book.bookId && /^content:[a-f0-9]{64}$/.test(book.organizationKey)) return book;
    if (!book.source || !book.file) {
      if (/^content:[a-f0-9]{64}$/.test(book.organizationKey)) return book;
      if (book.bookId) return book; // Legacy imports remain device-local until verified.
      throw new Error('This book has no accessible source.');
    }
    const owner = localProfileUser()?.id ?? null;
    const original = await (await librarySource(book.source)).read(book.file);
    const hash = await sha256(await original.arrayBuffer());
    if (owner !== (localProfileUser()?.id ?? null)) throw new Error('The account changed.');
    const organizationKey = contentBookKey(hash);
    return {
      ...book,
      organizationKey,
      organizationAliases: [...new Set([...book.organizationAliases, organizationKey])]
    };
  }
  editOrganization(mode: 'metadata' | 'series' | 'collections', targets: ShelfBook[]) {
    if (this.busy || !targets.length) return;
    this.organizationEpoch++;
    this.organizationTargets = structuredClone(targets);
    this.organizationOwner = localProfileUser()?.id ?? null;
    this.organizationSnapshot = structuredClone(readStore(organization).books);
    this.organizationDialog = mode;
  }
  async stableBatch(targets: ShelfBook[], current: () => boolean) {
    const stable: ShelfBook[] = [];
    for (const book of targets) {
      if (!current()) throw new Error('The library changed. Reopen this action.');
      stable.push(await this.stableOrganizationBook(book));
    }
    if (!current()) throw new Error('The library changed. Reopen this action.');
    return stable;
  }
  async organize(work: (targets: ShelfBook[], current: () => boolean) => Promise<void>) {
    if (this.busy) throw new Error('Another library change is in progress.');
    const epoch = this.organizationEpoch,
      owner = this.organizationOwner,
      targets = structuredClone(this.organizationTargets);
    const current = () =>
      this.alive && epoch === this.organizationEpoch && owner === (localProfileUser()?.id ?? null);
    this.busy = true;
    try {
      const stable = await this.stableBatch(targets, current);
      await work(stable, current);
      if (current()) this.organizationTargets = stable;
    } finally {
      if (this.alive) this.busy = false;
    }
  }
  saveOrganization(change: PresentationChange) {
    const expected = this.organizationDialog === 'metadata' ? this.organizationSnapshot : undefined;
    const preserveSeriesIndex = this.organizationDialog === 'series';
    return this.organize((targets, current) =>
      presentBooks(
        targets.map((book) => book.organizationKey),
        change,
        current,
        expected,
        preserveSeriesIndex
      )
    );
  }
  saveBatchMembership(id: string, included: boolean) {
    return this.organize((targets, current) => setMembershipMany(id, targets, included, current));
  }
  async createBatchCollection(name: string) {
    await this.organize(async (targets, current) => {
      await createCollection(
        name,
        targets.map((book) => book.organizationKey),
        current
      );
    });
  }
  saveSelectedWantToRead(included: boolean) {
    this.saveWantToRead(this.selectedBooks, included);
  }
  blurSelected() {
    this.blurBooks(this.selectedBooks, true);
  }
  unblurSelected() {
    this.blurBooks(this.selectedBooks, false);
  }
  refreshFolders() {
    void this.action(() => this.load(true));
  }
  blurBooks(targets: ShelfBook[], coverBlur: boolean) {
    const owner = localProfileUser()?.id ?? null;
    const snapshot = structuredClone(targets);
    const epoch = this.organizationEpoch;
    const current = () =>
      this.alive && epoch === this.organizationEpoch && owner === (localProfileUser()?.id ?? null);
    void this.action(async () => {
      const stable = await this.stableBatch(snapshot, current);
      await presentBooks(
        stable.map((book) => book.organizationKey),
        { coverBlur },
        current
      );
      if (current()) this.notice = coverBlur ? 'Covers blurred.' : 'Original covers revealed.';
    });
  }
  openBook(book: ShelfBook, locator?: ReaderLocator) {
    // Relinking refreshes the book list and can remount this workspace. The
    // owning page, not this replaceable projection, fences the async request.
    this.onPrepareBook({ prepare: () => this.ensureBook(book), locator });
  }
  saveBook(book: ShelfBook) {
    void this.action(async () => {
      await this.ensureBook(book);
      this.notice = `Saved “${book.title}” to this browser.`;
    });
  }
  editBook(book: ShelfBook, kind: 'details' | 'rename' | 'date' | 'membership') {
    this.cloudPlan = undefined;
    this.cloudPlanSource = undefined;
    this.targetBook = book;
    this.dialog = kind;
    this.name = book.title;
    this.date = finishedDay(book) || calendarDay();
    this.newCollectionName = '';
    this.error = '';
    this.dialogOpen = true;
  }
  dateInfo(time: number) {
    return time ? new Date(time).toLocaleString() : 'No data';
  }
  chooseCover(book: ShelfBook) {
    this.coverTarget = book;
    this.coverInput.value = '';
    this.coverInput.click();
  }
  coverChanged(files: FileList | null) {
    const file = files?.[0],
      book = this.coverTarget;
    if (!file || !book) return;
    void this.action(async () => {
      const cover = await coverOverride(file);
      const bookId = await this.ensureBook(book);
      const linked = readStore(linkedBooks).find((link) => link.bookId === bookId);
      await presentBook(linked ? `content:${linked.contentHash}` : book.organizationKey, { cover });
      this.notice = `Updated the cover for “${book.title}”.`;
    });
  }
  editSeries(value: ShelfSeries) {
    this.targetSeries = value;
    this.cloudPlan = undefined;
    this.cloudPlanSource = undefined;
    this.dialog = 'series-name';
    this.name = value.name;
    this.error = '';
    this.dialogOpen = true;
  }
  newSeries() {
    const selected = this.books.filter(
      (book) => book.bookId && this.selectedBookIds.has(book.bookId) && book.source && book.file
    );
    this.groupSource =
      (selected[0]?.source ? this.groupKey(selected[0].source) : undefined) ||
      (this.series?.source ? this.groupKey(this.series.source) : this.locals[0]?.id) ||
      '';
    this.groupFiles = selected
      .filter((book) => book.source && this.groupKey(book.source) === this.groupSource)
      .map((book) => book.file!.id);
    this.name = '';
    this.cloudPlan = undefined;
    this.cloudPlanSource = undefined;
    this.dialog = 'new-series';
    this.error = '';
    this.dialogOpen = true;
  }
  toggleGroup(path: string, checked: boolean) {
    this.groupFiles = checked
      ? [...new Set([...this.groupFiles, path])]
      : this.groupFiles.filter((p) => p !== path);
  }
  finish(book: ShelfBook) {
    void this.action(async () => {
      await setCompletion(await this.ensureBook(book), isFinished(book) ? 'reading' : 'finished');
    });
  }
  saveWantToRead(targets: ShelfBook[], included: boolean) {
    const removedKeys = new Set(targets.map((book) => book.key));
    const firstRemoved = this.visibleBooks.findIndex((book) => removedKeys.has(book.key));
    const nextBook = [
      ...this.visibleBooks.slice(firstRemoved + 1),
      ...this.visibleBooks.slice(0, firstRemoved).reverse()
    ].find((book) => !removedKeys.has(book.key));
    const focusWasInMenu = !!document.activeElement?.closest('[role="menu"], .shelf-item');
    let changed = false;
    void this.action(async () => {
      const stable: ShelfBook[] = [];
      for (const book of targets) stable.push(await this.stableOrganizationBook(book));
      await setWantToRead(stable, included);
      changed = true;
      this.notice = included ? 'Added to Want to Read.' : 'Removed from Want to Read.';
    }).then(async () => {
      if (
        this.alive &&
        changed &&
        !included &&
        this.collectionId === WANT_TO_READ_ID &&
        focusWasInMenu
      ) {
        await tick();
        const next = nextBook
          ? this.shelfElement.querySelector<HTMLButtonElement>(
              `[data-book-key="${CSS.escape(nextBook.key)}"] button[aria-haspopup="menu"]`
            )
          : this.shelfElement.querySelector<HTMLButtonElement>('[data-empty-library-action]');
        (next || this.shelfElement).focus();
      }
    });
  }
  submit() {
    if (this.busy) return;
    const local =
      this.dialog === 'new-series'
        ? this.locals.find((l) => l.id === this.groupSource)
        : this.locals.find((l) => l.id === this.targetSeries?.source?.id);
    // Permission UI must begin in the initiating click, not after database/network work.
    const permission =
      (this.dialog === 'new-series' || this.dialog === 'series-name') && local
        ? reconnectLocalLibrary(local, true)
        : undefined;
    void this.action(async () => {
      await permission;
      if (this.dialog === 'rename' && this.targetBook)
        await presentBook((await this.stableOrganizationBook(this.targetBook)).organizationKey, {
          title: this.name
        });
      else if (this.dialog === 'date' && this.targetBook)
        await setCompletion(await this.ensureBook(this.targetBook), 'finished', this.date);
      else if (this.dialog === 'series-name' && this.targetSeries && local) {
        await renameLocalSeries(local, this.targetSeries.directoryId, this.name);
        await this.load(true);
      } else if (this.dialog === 'series-name' && this.targetSeries?.source?.owner) {
        const source = this.targetSeries.source;
        if (!this.cloudCapabilities[sourceKey(source)]?.can_edit)
          throw new Error('Connect this OneDrive library with series editing access first.');
        this.cloudPlan = await prepareCloudSeries(source, {
          operation: 'rename_series',
          root: source.root,
          folder_id: this.targetSeries.directoryId,
          name: this.name
        });
        this.cloudPlanSource = source;
        return;
      } else if (this.dialog === 'new-series' && local) {
        const parent = this.series?.source?.id === local.id ? this.series.directoryId : '';
        await createLocalSeries(local, parent, this.name, this.groupFiles);
        await this.load(true);
        this.notice = 'Series created. Reading progress and collections were kept.';
      } else if (this.dialog === 'new-series' && this.groupCloudSource) {
        const source = this.groupCloudSource;
        if (!this.cloudCapabilities[sourceKey(source)]?.can_edit)
          throw new Error('Connect this OneDrive library with series editing access first.');
        this.cloudPlan = await prepareCloudSeries(source, {
          operation: 'create_series',
          root: source.root,
          parent_id:
            this.series?.source && sourceKey(this.series.source) === sourceKey(source)
              ? this.series.directoryId
              : source.root,
          folder_name: this.name,
          name: this.name,
          book_ids: this.groupFiles
        });
        this.cloudPlanSource = source;
        return;
      } else throw new Error('Connect a writable local folder to change the files on disk.');
      this.dialogOpen = false;
    });
  }
  cloudPlanCurrent(source: SourceDescriptor, plan: CloudSeriesPlan) {
    return (
      this.alive &&
      this.dialogOpen &&
      this.cloudPlan?.id === plan.id &&
      this.cloudPlanSource &&
      sourceKey(this.cloudPlanSource) === sourceKey(source) &&
      currentUser()?.id === source.owner
    );
  }
  async showCloudPlan(source: SourceDescriptor, plan: CloudSeriesPlan) {
    if (!this.cloudPlanCurrent(source, plan)) return;
    this.cloudPlan = plan;
    this.cloudPlans = [
      { source, plan },
      ...this.cloudPlans.filter((entry) => entry.plan.id !== plan.id)
    ];
    if (plan.status === 'complete') {
      this.cloudPlan = undefined;
      this.cloudPlanSource = undefined;
      this.dialogOpen = false;
      await this.load(true);
      if (this.alive && currentUser()?.id === source.owner)
        this.notice = 'Series updated. Reading progress, notes and collections were kept.';
    }
  }
  async pollCloudPlan() {
    const plan = this.cloudPlan,
      source = this.cloudPlanSource;
    if (
      this.cloudPollBusy ||
      this.busy ||
      !plan ||
      !source ||
      !this.cloudPlanCurrent(source, plan) ||
      !['preparing', 'queued', 'running', 'reconcile'].includes(plan.status) ||
      Date.now() < this.cloudPollAfter
    )
      return;
    this.cloudPollBusy = true;
    try {
      const next = await cloudSeriesStatus(source, plan.id);
      await this.showCloudPlan(source, next);
    } catch (failure) {
      // A status outage does not justify repeating admission or provider writes.
      // Keep the durable plan available and back off bounded, read-only polling.
      this.cloudPollAfter = Date.now() + 5000;
      if (this.cloudPlanCurrent(source, plan))
        this.error =
          failure instanceof Error
            ? failure.message
            : 'Could not refresh this change. Its saved status will be checked again.';
    } finally {
      this.cloudPollBusy = false;
    }
  }
  confirmCloudPlan() {
    if (!this.cloudPlan || !this.cloudPlanSource || this.cloudPlan.status !== 'prepared') return;
    const source = this.cloudPlanSource,
      plan = this.cloudPlan;
    void this.action(async () => {
      const next = await advanceCloudSeries(source, plan);
      await this.showCloudPlan(source, next);
    });
  }
  abandonCloudPlan() {
    if (!this.cloudPlan || !this.cloudPlanSource) return;
    const source = this.cloudPlanSource,
      plan = this.cloudPlan;
    void this.action(async () => {
      const next = await cancelCloudSeries(source, plan.id);
      if (!this.cloudPlanCurrent(source, plan)) return;
      this.cloudPlan = next;
      this.cloudPlans = [
        { source, plan: next },
        ...this.cloudPlans.filter((entry) => entry.plan.id !== plan.id)
      ];
      this.dialogOpen = false;
      await this.load(true);
    });
  }
  resumeCloudPlan(source: SourceDescriptor, plan: CloudSeriesPlan) {
    if (this.busy) return;
    this.cloudPlanSource = source;
    this.cloudPlan = plan;
    this.dialog = plan.operation === 'rename_series' ? 'series-name' : 'new-series';
    this.dialogOpen = true;
  }
  resumeMove(plan: MovePlan) {
    if (this.busy) return;
    const local = this.locals.find((l) => l.id === plan.sourceId);
    if (!local) {
      this.error = 'Reconnect the original local folder before resuming this move.';
      return;
    }
    const permission = reconnectLocalLibrary(local, true);
    void this.action(async () => {
      await permission;
      await resumeLocalSeries(local);
      await this.load(true);
      this.notice = 'Folder change completed.';
    });
  }
  reconcile() {
    if (this.pendingQueryURL !== undefined && this.nextQueryURL === this.pendingQueryURL)
      this.pendingQueryURL = undefined;
    if (this.pendingQueryURL === undefined && this.queryURL !== this.nextQueryURL) {
      this.retireSelectionScope(
        this.selectionScopeFor(this.nextSelectionSearch, this.nextLibrarySearchScope)
      );
      this.queryURL = this.nextQueryURL;
      this.query = this.nextQueryURL;
    }
    if (
      this.pendingLibrarySearchScope !== undefined &&
      this.nextLibrarySearchScope === this.pendingLibrarySearchScope
    )
      this.pendingLibrarySearchScope = undefined;
    if (
      this.pendingLibrarySearchScope === undefined &&
      this.librarySearchScope !== this.nextLibrarySearchScope
    ) {
      this.retireSelectionScope(
        this.selectionScopeFor(this.nextSelectionSearch, this.nextLibrarySearchScope)
      );
      this.librarySearchScope = this.nextLibrarySearchScope;
    }
    if (this.organizationScope !== this.selectionScopeKey) {
      this.organizationScope = this.selectionScopeKey;
      this.organizationEpoch++;
      this.organizationDialog = undefined;
      this.organizationTargets = [];
    }
  }
  start() {
    this.watch(
      booklistSortOptions$,
      localUser,
      allLinkedBooks,
      organization,
      previews,
      page,
      snippetItems,
      linkedBooks
    );
    return (() => {
      this.alive = true;
      this.previewQueue = new PreviewQueue(() => {
        if (this.alive) this.previewFailures++;
      });
      try {
        this.layout = localStorage.getItem('manabi-library-layout') === 'list' ? 'list' : 'grid';
        this.seriesLayout =
          localStorage.getItem('manabi-series-layout') === 'grid' ? 'grid' : 'list';
        this.finishedLayout =
          localStorage.getItem('manabi-finished-layout') === 'grid' ? 'grid' : 'timeline';
        this.finishedOrder =
          localStorage.getItem('manabi-finished-order') === 'asc' ? 'asc' : 'desc';
      } catch {
        /* default */
      }
      const stopOrganization = watchOrganization((e) => {
        if (this.alive) this.error = e instanceof Error ? e.message : 'Could not load collections.';
      });
      let previousOwner: string | null | undefined;
      const seriesPoll = setInterval(() => void this.pollCloudPlan(), 1000);
      const stopAccount = localUser.subscribe(() => {
        const owner = localProfileUser()?.id ?? null;
        if (owner === previousOwner) return;
        previousOwner = owner;
        if (this.cloudPlanSource && this.cloudPlanSource.owner !== currentUser()?.id) {
          this.cloudPlan = undefined;
          this.cloudPlanSource = undefined;
          this.dialogOpen = false;
        }
        this.organizationEpoch++;
        this.organizationDialog = undefined;
        this.organizationTargets = [];
        this.previewQueue?.stop();
        this.previewQueue = new PreviewQueue(() => {
          if (this.alive) this.previewFailures++;
        });
        this.catalogs = this.catalogs.filter(
          (c) => c.source.owner === null || c.source.owner === owner
        );
        void this.load().catch((e) => {
          if (this.alive)
            this.error = e instanceof Error ? e.message : 'Could not load the library.';
        });
      });
      return () => {
        this.alive = false;
        clearInterval(seriesPoll);
        this.organizationEpoch++;
        ++this.generation;
        this.controller?.abort();
        this.previewQueue?.stop();
        stopAccount();
        stopOrganization();
      };
    })();
  }
}
