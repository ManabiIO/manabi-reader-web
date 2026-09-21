<script lang="ts">
  import { onMount, createEventDispatcher, type Snippet } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/dropdown-menu';
  import * as Dialog from '$lib/components/ui/dialog';
  import {
    BookOpenIcon as BookOpen,
    BooksIcon as Books,
    CalendarBlankIcon as CalendarBlank,
    CheckCircleIcon as CircleCheck,
    DotsThreeIcon as MoreHorizontal,
    DownloadSimpleIcon as DownloadSimple,
    FolderOpenIcon as FolderOpen,
    ImageSquareIcon as ImageSquare,
    ListIcon as List,
    MagnifyingGlassIcon as Search,
    PencilSimpleIcon as PencilSimple,
    PlusIcon as Plus,
    TrashIcon as Trash
  } from 'phosphor-svelte';
  import { booklistSortOptions$ } from '$lib/data/store';
  import { StorageKey } from '$lib/data/storage/storage-types';
  import type { SortOption } from '$lib/data/sort-types';
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import { account, currentUser } from '$lib/manabi/client';
  import { linkedBooks, refreshLinkedBooks, importLibraryBook } from '$lib/manabi/books';
  import { integrationDB, type LocalLibrary } from '$lib/manabi/persistence';
  import { reconnectLocalLibrary } from '$lib/manabi/sources';
  import {
    sourceDescriptors,
    cachedCatalog,
    librarySource,
    scanCatalog,
    type Catalog,
    type SourceDescriptor
  } from './catalog';
  import {
    organization,
    watchOrganization,
    presentBook,
    setMembership,
    createCollection
  } from './organization';
  import {
    buildShelf,
    allBooks,
    seriesTrail,
    visibleShelf,
    type ShelfBook,
    type ShelfSeries
  } from './view-model';
  import { isFinished, finishedDay, calendarDay } from './completion';
  import { setCompletion } from './commands';
  import {
    createLocalSeries,
    renameLocalSeries,
    resumeLocalSeries,
    pendingMoves
  } from './local-series';
  import { previews, PreviewQueue } from './previews';
  import type { ShelfNode } from './view-model';
  import type { MovePlan } from './file-operations';
  import BookCover from './book-cover.svelte';
  import CoverStack from './cover-stack.svelte';
  import SourceIcon from './source-icon.svelte';
  import CollectionsSheet from './collections-sheet.svelte';
  import { creatorLine, sharedCreatorLine } from './book-metadata';
  import { coverOverride } from './cover-override';
  import type { LibraryMenuModel } from './library-menu';
  import {
    continueBooks,
    finishedGroups,
    formatCalendarDay,
    hasReadingEvidence,
    readingLabel,
    seriesReadingTarget
  } from './reading-state';

  export let children: Snippet | undefined = undefined;
  export let bookCards: BookCardProps[];
  export let currentBookId: number | undefined;
  export let selectedBookIds: ReadonlySet<number> = new Set();
  export let selectMode = false;
  export let destinationTitle = 'Library';
  export let desktopRailOpen = false;
  export let menu: LibraryMenuModel | undefined = undefined;
  const dispatch = createEventDispatcher<{
    bookClick: { id: number };
    selectionManyClick: { ids: number[] };
    selectionScopeChange: { key: string; ids: number[] };
    removeBookClick: { id: number };
  }>();
  let catalogs: Catalog[] = [],
    sources: SourceDescriptor[] = [],
    locals: LocalLibrary[] = [],
    pending: MovePlan[] = [];
  export let collectionsOpen = false;
  let layout: 'grid' | 'list' = 'grid',
    seriesLayout: 'grid' | 'list' = 'list',
    finishedLayout: 'grid' | 'timeline' = 'timeline',
    finishedOrder: 'asc' | 'desc' = 'desc',
    query = '',
    busy = false,
    scanning = false,
    error = '',
    notice = '';
  let announcedSelectionScope = '';
  let dialogOpen = false,
    dialog: 'rename' | 'date' | 'membership' | 'series-name' | 'new-series' = 'rename';
  let targetBook: ShelfBook | undefined,
    coverTarget: ShelfBook | undefined,
    coverInput: HTMLInputElement,
    targetSeries: ShelfSeries | undefined,
    name = '',
    date = '',
    newCollectionName = '';
  let groupSource = '',
    groupFiles: string[] = [];
  let previewFailures = 0;
  let previewQueue: PreviewQueue | undefined;
  let alive = false,
    generation = 0,
    controller: AbortController | undefined;
  const sortItems: { property: SortOption['property']; label: string }[] = [
    { property: 'lastBookOpen', label: 'Recent' },
    { property: 'title', label: 'Title' },
    { property: 'author', label: 'Author' },
    { property: 'id', label: 'Added' }
  ];
  const moreSortItems: { property: SortOption['property']; label: string }[] = [
    { property: 'progress', label: 'Progress' },
    { property: 'characters', label: 'Characters' },
    { property: 'lastBookModified', label: 'Last Update' },
    { property: 'lastBookmarkModified', label: 'Bookmarked' }
  ];
  function booksInMatchingSeries(nodes: ShelfNode[], search: string): string[] {
    let matches: string[] = [];
    for (const node of nodes) {
      if (node.kind !== 'series') continue;
      if (node.name.normalize('NFKC').toLocaleLowerCase().includes(search))
        matches = [...matches, ...node.books.map((book) => book.key)];
      matches = [...matches, ...booksInMatchingSeries(node.children, search)];
    }
    return matches.filter((key, index) => matches.indexOf(key) === index);
  }
  function matchesBookQuery(book: ShelfBook, search: string, seriesMatches: string[]) {
    return (
      !search ||
      seriesMatches.includes(book.key) ||
      [
        book.title,
        book.canonicalTitle,
        ...(book.creators || []).map((creator) => creator.name)
      ].some((value) => value.normalize('NFKC').toLocaleLowerCase().includes(search))
    );
  }
  function includesBook(
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
      matchesBookQuery(book, search, seriesMatches)
    );
  }
  function orderFinishedNodes(nodes: ShelfNode[], direction: 'asc' | 'desc'): ShelfNode[] {
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
  $: sort = $booklistSortOptions$[StorageKey.BROWSER];
  $: tree = buildShelf(bookCards, $linkedBooks, catalogs, sources, $organization, $previews);
  $: books = allBooks(tree);
  $: collectionId = $page.url.searchParams.get('collection') || 'books';
  $: selectedCollection = $organization.collections.find((c) => c.id === collectionId);
  $: collectionTitle =
    collectionId === 'finished' ? 'Finished' : selectedCollection?.name || 'Books';
  $: trail = seriesTrail(tree, $page.url.searchParams.get('series') || '');
  $: series = trail.at(-1);
  $: notFinished = $page.url.searchParams.get('unfinished') === '1';
  $: destinationTitle = series?.name || (collectionId === 'books' ? 'Library' : collectionTitle);
  $: normalizedQuery = query.trim().normalize('NFKC').toLocaleLowerCase();
  $: flatDestination = !series && (collectionId === 'finished' || !!selectedCollection);
  $: seriesMatchedKeys =
    normalizedQuery && !flatDestination
      ? booksInMatchingSeries(series?.children || tree, normalizedQuery)
      : [];
  $: destinationNodes = flatDestination
    ? books
        .filter((book) =>
          includesBook(
            book,
            collectionId,
            selectedCollection?.members,
            notFinished,
            normalizedQuery,
            seriesMatchedKeys
          )
        )
        .map((book) => ({ kind: 'book' as const, id: book.key, book }))
    : series?.children || tree;
  $: sortedDestination = visibleShelf(
    destinationNodes,
    (book) =>
      includesBook(
        book,
        collectionId,
        selectedCollection?.members,
        notFinished,
        normalizedQuery,
        seriesMatchedKeys
      ),
    sort
  );
  $: displayed =
    collectionId === 'finished' && !series
      ? orderFinishedNodes(sortedDestination, finishedOrder)
      : sortedDestination;
  $: visibleBooks = allBooks(displayed);
  $: scopedSeriesBooks = series
    ? series.books.filter((book) =>
        includesBook(
          book,
          collectionId,
          selectedCollection?.members,
          notFinished,
          normalizedQuery,
          seriesMatchedKeys
        )
      )
    : [];
  $: scopedVolumeOrder = series
    ? allBooks(series.children).filter((book) =>
        includesBook(
          book,
          collectionId,
          selectedCollection?.members,
          notFinished,
          normalizedQuery,
          seriesMatchedKeys
        )
      )
    : [];
  $: resume = series ? seriesReadingTarget(scopedSeriesBooks, scopedVolumeOrder) : undefined;
  $: seriesCreators = series ? sharedCreatorLine(scopedSeriesBooks) : undefined;
  $: recentBooks =
    !series && collectionId === 'books' && !notFinished && !normalizedQuery && !selectMode
      ? continueBooks(books)
      : [];
  $: completedGroups =
    collectionId === 'finished' && !series ? finishedGroups(visibleBooks, finishedOrder) : [];
  $: currentLayout =
    collectionId === 'finished' && !series ? finishedLayout : series ? seriesLayout : layout;
  $: selectableBookIds = visibleBooks.flatMap((book) => (book.bookId ? [book.bookId] : []));
  $: selectionScopeKey = `${collectionId}:${series?.id || ''}:${notFinished ? 'unfinished' : 'all'}:${normalizedQuery}`;
  $: selectionSignature = `${selectionScopeKey}:${selectableBookIds.join(',')}`;
  $: if (selectionSignature !== announcedSelectionScope) {
    announcedSelectionScope = selectionSignature;
    dispatch('selectionScopeChange', { key: selectionScopeKey, ids: selectableBookIds });
  }
  $: groupCandidates = books.filter(
    (book) => book.source?.owner === null && book.source.id === groupSource && book.file
  );
  $: warnings = catalogs.flatMap((catalog) => catalog.warnings);
  $: menu = {
    title: destinationTitle,
    canGoBack: !!series || collectionId !== 'books',
    back: navigateBack,
    currentLayout,
    layouts:
      collectionId === 'finished' && !series
        ? [
            { value: 'timeline', label: 'Timeline', icon: 'timeline' },
            { value: 'grid', label: 'Grid', icon: 'grid' }
          ]
        : [
            { value: 'grid', label: 'Grid', icon: 'grid' },
            { value: 'list', label: 'List', icon: 'list' }
          ],
    setLayout,
    showValue: collectionId === 'finished' ? 'finished' : notFinished ? 'unfinished' : 'all',
    showChoices:
      collectionId === 'finished'
        ? [{ value: 'finished', label: 'Finished books' }]
        : [
            { value: 'all', label: series ? 'All in Series' : 'All Books' },
            { value: 'unfinished', label: 'Not Finished' }
          ],
    setShow: (value: string) => navigate(series?.id, collectionId, value === 'unfinished'),
    sortProperty: sort.property,
    sortDirection: sort.direction,
    sortChoices: collectionId === 'finished' && !series ? [] : sortItems,
    moreSortChoices: collectionId === 'finished' && !series ? [] : moreSortItems,
    setSort,
    finishedOrder: collectionId === 'finished' && !series ? finishedOrder : undefined,
    setFinishedOrder,
    createSeries: newSeries,
    refreshFolders: () => void action(() => load(true))
  } satisfies LibraryMenuModel;

  function previewVisible(element: HTMLElement, node: ShelfNode) {
    let visible = false;
    const schedule = (value: ShelfNode) => {
      if (!visible || selectMode) return;
      const wanted = value.kind === 'book' ? [value.book] : value.books.slice(0, 5);
      for (const book of wanted)
        if (book.source && book.file && (!book.imagePath || !book.pageDirection)) {
          const catalog = catalogs.find(
            (c) =>
              c.source.id === book.source!.id &&
              c.source.root === book.source!.root &&
              c.source.owner === book.source!.owner
          );
          if (catalog) previewQueue?.add(book.source, book.file, catalog.scannedAt);
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
  function navigate(seriesId?: string, collection = collectionId, unfinished = notFinished) {
    const url = new URL($page.url);
    if (seriesId) url.searchParams.set('series', seriesId);
    else url.searchParams.delete('series');
    if (collection !== 'books') url.searchParams.set('collection', collection);
    else url.searchParams.delete('collection');
    if (unfinished) url.searchParams.set('unfinished', '1');
    else url.searchParams.delete('unfinished');
    void goto(resolve(`/manage?${url.searchParams.toString()}`));
  }
  function navigateBack() {
    navigate(
      trail.length > 1 ? trail.at(-2)?.id : undefined,
      series ? collectionId : 'books',
      false
    );
  }
  function setLayout(value: string) {
    if (collectionId === 'finished' && !series) {
      if (value !== 'grid' && value !== 'timeline') return;
      finishedLayout = value;
    } else if (series) {
      if (value !== 'grid' && value !== 'list') return;
      seriesLayout = value;
    } else {
      if (value !== 'grid' && value !== 'list') return;
      layout = value;
    }
    try {
      localStorage.setItem(
        collectionId === 'finished' && !series
          ? 'manabi-finished-layout'
          : series
            ? 'manabi-series-layout'
            : 'manabi-library-layout',
        value
      );
    } catch {
      /* layout still works for this session */
    }
  }
  function setSort(property: string, direction = sort.direction) {
    if (!sortItems.some((item) => item.property === property)) return;
    booklistSortOptions$.next({
      ...$booklistSortOptions$,
      [StorageKey.BROWSER]: { property: property as SortOption['property'], direction }
    });
  }
  function setFinishedOrder(value: string) {
    if (value !== 'asc' && value !== 'desc') return;
    finishedOrder = value;
    try {
      localStorage.setItem('manabi-finished-order', value);
    } catch {
      /* preference is optional */
    }
  }
  async function action(work: () => Promise<void>) {
    if (busy) return;
    busy = true;
    error = '';
    notice = '';
    try {
      await work();
    } catch (e) {
      error =
        e instanceof Error
          ? e.message
          : 'The operation did not finish. Your original files are kept.';
    } finally {
      if (alive) {
        busy = false;
        try {
          pending = await pendingMoves();
        } catch {
          /* Preserve the original operation result. */
        }
      }
    }
  }
  async function load(refresh = false) {
    if (refresh) previewFailures = 0;
    previewQueue?.stop();
    previewQueue = new PreviewQueue(() => {
      if (alive) previewFailures++;
    });
    const run = ++generation;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    scanning = true;
    try {
      const owner = currentUser()?.id;
      const nextSources = await sourceDescriptors();
      const nextLocals = await (await integrationDB()).getAll('localLibraries');
      const cached = await Promise.all(nextSources.map(cachedCatalog));
      if (!alive || run !== generation || owner !== currentUser()?.id) return;
      sources = nextSources;
      locals = nextLocals;
      catalogs = cached.filter((c): c is Catalog => !!c);
      const nextPending = await pendingMoves();
      await refreshLinkedBooks();
      if (!alive || run !== generation || owner !== currentUser()?.id) return;
      pending = nextPending;
      for (const source of nextSources) {
        if (
          !refresh &&
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
          if (!alive || run !== generation) return;
          catalogs = [
            ...catalogs.filter(
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
          error = `${source.provider === 'local' ? source.name : 'Connected library'}: ${e instanceof Error ? e.message : 'Could not refresh folders.'} The last saved library is still available.`;
        }
      }
    } finally {
      if (alive && run === generation) scanning = false;
    }
  }
  onMount(() => {
    alive = true;
    try {
      desktopRailOpen = localStorage.getItem('manabi-library-rail-open') === '1';
    } catch {
      /* preference is optional */
    }
    previewQueue = new PreviewQueue(() => {
      if (alive) previewFailures++;
    });
    try {
      layout = localStorage.getItem('manabi-library-layout') === 'list' ? 'list' : 'grid';
      seriesLayout = localStorage.getItem('manabi-series-layout') === 'grid' ? 'grid' : 'list';
      finishedLayout =
        localStorage.getItem('manabi-finished-layout') === 'grid' ? 'grid' : 'timeline';
      finishedOrder = localStorage.getItem('manabi-finished-order') === 'asc' ? 'asc' : 'desc';
    } catch {
      /* default */
    }
    const stopOrganization = watchOrganization((e) => {
      if (alive) error = e instanceof Error ? e.message : 'Could not load collections.';
    });
    let previousOwner: string | null | undefined;
    const stopAccount = account.subscribe(() => {
      const owner = currentUser()?.id ?? null;
      if (owner === previousOwner) return;
      previousOwner = owner;
      previewQueue?.stop();
      previewQueue = new PreviewQueue(() => {
        if (alive) previewFailures++;
      });
      catalogs = catalogs.filter((c) => c.source.owner === null || c.source.owner === owner);
      void load().catch((e) => {
        if (alive) error = e instanceof Error ? e.message : 'Could not load the library.';
      });
    });
    return () => {
      alive = false;
      ++generation;
      controller?.abort();
      previewQueue?.stop();
      stopAccount();
      stopOrganization();
    };
  });
  async function ensureBook(book: ShelfBook): Promise<number> {
    if (book.bookId && !book.isPlaceholder) return book.bookId;
    if (!book.source || !book.file) {
      if (book.bookId) return book.bookId;
      throw new Error('This book has no accessible source.');
    }
    notice = `Adding “${book.title}” to this browser…`;
    // Sync remains opt-in on Accounts and libraries; opening a file never enables remote writes.
    const link = await importLibraryBook(await librarySource(book.source), book.file, false);
    return link.bookId;
  }
  function openBook(book: ShelfBook) {
    void action(async () => {
      const id = await ensureBook(book);
      dispatch('bookClick', { id });
    });
  }
  function saveBook(book: ShelfBook) {
    void action(async () => {
      await ensureBook(book);
      notice = `Saved “${book.title}” to this browser.`;
    });
  }
  function editBook(book: ShelfBook, kind: 'rename' | 'date' | 'membership') {
    targetBook = book;
    dialog = kind;
    name = book.title;
    date = finishedDay(book) || calendarDay();
    newCollectionName = '';
    error = '';
    dialogOpen = true;
  }
  function chooseCover(book: ShelfBook) {
    coverTarget = book;
    coverInput.value = '';
    coverInput.click();
  }
  function coverChanged(files: FileList | null) {
    const file = files?.[0],
      book = coverTarget;
    if (!file || !book) return;
    void action(async () => {
      const cover = await coverOverride(file);
      const bookId = await ensureBook(book);
      const linked = $linkedBooks.find((link) => link.bookId === bookId);
      await presentBook(linked ? `content:${linked.contentHash}` : book.organizationKey, { cover });
      notice = `Updated the cover for “${book.title}”.`;
    });
  }
  function editSeries(value: ShelfSeries) {
    targetSeries = value;
    dialog = 'series-name';
    name = value.name;
    error = '';
    dialogOpen = true;
  }
  function newSeries() {
    const selected = books.filter(
      (book) =>
        book.bookId && selectedBookIds.has(book.bookId) && book.source?.owner === null && book.file
    );
    groupSource =
      selected[0]?.source?.id ||
      (series?.source.owner === null ? series.source.id : locals[0]?.id) ||
      '';
    groupFiles = selected
      .filter((book) => book.source?.id === groupSource)
      .map((book) => book.file!.id);
    name = '';
    dialog = 'new-series';
    error = '';
    dialogOpen = true;
  }
  function toggleGroup(path: string, checked: boolean) {
    groupFiles = checked
      ? [...new Set([...groupFiles, path])]
      : groupFiles.filter((p) => p !== path);
  }
  function finish(book: ShelfBook) {
    void action(async () => {
      await setCompletion(await ensureBook(book), isFinished(book) ? 'reading' : 'finished');
    });
  }
  function submit() {
    if (busy) return;
    const local =
      dialog === 'new-series'
        ? locals.find((l) => l.id === groupSource)
        : locals.find((l) => l.id === targetSeries?.source.id);
    // Permission UI must begin in the initiating click, not after database/network work.
    const permission =
      (dialog === 'new-series' || dialog === 'series-name') && local
        ? reconnectLocalLibrary(local, true)
        : undefined;
    void action(async () => {
      await permission;
      if (dialog === 'rename' && targetBook)
        await presentBook(targetBook.organizationKey, { title: name });
      else if (dialog === 'date' && targetBook)
        await setCompletion(await ensureBook(targetBook), 'finished', date);
      else if (dialog === 'series-name' && targetSeries && local) {
        await renameLocalSeries(local, targetSeries.directoryId, name);
        await load(true);
      } else if (dialog === 'new-series' && local) {
        const parent = series?.source.id === local.id ? series.directoryId : '';
        await createLocalSeries(local, parent, name, groupFiles);
        await load(true);
        notice = 'Series created. Reading progress and collections were kept.';
      } else throw new Error('Connect a writable local folder to change the files on disk.');
      dialogOpen = false;
    });
  }
  function resumeMove(plan: MovePlan) {
    if (busy) return;
    const local = locals.find((l) => l.id === plan.sourceId);
    if (!local) {
      error = 'Reconnect the original local folder before resuming this move.';
      return;
    }
    const permission = reconnectLocalLibrary(local, true);
    void action(async () => {
      await permission;
      await resumeLocalSeries(local);
      await load(true);
      notice = 'Folder change completed.';
    });
  }
</script>

<input
  hidden
  type="file"
  accept="image/png,image/jpeg,image/webp"
  aria-label="Choose replacement cover"
  bind:this={coverInput}
  onchange={(event) => coverChanged(event.currentTarget.files)}
/>

{#snippet bookMenu(book: ShelfBook, labelSuffix: string)}
  <Menu.Root>
    <Menu.Trigger>
      {#snippet child({ props })}<Button
          {...props}
          variant="ghost"
          class="min-h-11 min-w-11"
          size="icon"
          aria-label={`Actions for ${book.title}${labelSuffix}`}
          title={`Actions for ${book.title}${labelSuffix}`}
          disabled={busy}><MoreHorizontal aria-hidden="true" /></Button
        >{/snippet}
    </Menu.Trigger>
    <Menu.Content align="end" class="w-64 max-w-[calc(100vw-1rem)]">
      {#if !book.bookId}<Menu.Item onSelect={() => saveBook(book)}
          ><DownloadSimple aria-hidden="true" />Save to this browser</Menu.Item
        >{/if}
      {#if !book.bookId}<Menu.Separator />{/if}
      <Menu.Item onSelect={() => editBook(book, 'rename')}
        ><PencilSimple aria-hidden="true" />Rename…</Menu.Item
      >
      <Menu.Item onSelect={() => editBook(book, 'membership')}
        ><Books aria-hidden="true" />Add to Collection…</Menu.Item
      >
      <Menu.Item onSelect={() => finish(book)}
        >{#if isFinished(book)}<BookOpen aria-hidden="true" />Mark as Still Reading{:else}<CircleCheck
            aria-hidden="true"
          />Mark as Finished{/if}</Menu.Item
      >
      {#if isFinished(book)}<Menu.Item onSelect={() => editBook(book, 'date')}
          ><CalendarBlank aria-hidden="true" />{finishedDay(book)
            ? 'Edit Finished Date…'
            : 'Set Finished Date…'}</Menu.Item
        >{/if}
      <Menu.Separator />
      <Menu.Item onSelect={() => chooseCover(book)}
        ><ImageSquare aria-hidden="true" />Change Cover…</Menu.Item
      >
      {#if $organization.books[book.organizationKey]?.cover}<Menu.Item
          onSelect={() =>
            void action(() => presentBook(book.organizationKey, { cover: undefined }))}
          ><ImageSquare aria-hidden="true" />Use Original Cover</Menu.Item
        >{/if}
      {#if book.bookId}<Menu.Separator /><Menu.Item
          variant="destructive"
          onSelect={() => dispatch('removeBookClick', { id: book.bookId! })}
          ><Trash aria-hidden="true" />Remove from this browser…</Menu.Item
        >{/if}
    </Menu.Content>
  </Menu.Root>
{/snippet}
{#snippet seriesMenu(value: ShelfSeries)}
  <Menu.Root
    ><Menu.Trigger
      >{#snippet child({ props })}<Button
          {...props}
          variant="ghost"
          class="min-h-11 min-w-11"
          size="icon"
          aria-label={`Actions for series ${value.name}`}
          disabled={busy}><MoreHorizontal aria-hidden="true" /></Button
        >{/snippet}</Menu.Trigger
    >
    <Menu.Content align="end"
      ><Menu.Item onSelect={() => navigate(value.id)}
        ><FolderOpen aria-hidden="true" />Open Series</Menu.Item
      >
      {#if value.source.owner === null}<Menu.Item onSelect={() => editSeries(value)}
          ><PencilSimple aria-hidden="true" />Rename Series…</Menu.Item
        >
      {:else}<Menu.Label>Cloud folder names are managed in your drive.</Menu.Label>{/if}
    </Menu.Content>
  </Menu.Root>
{/snippet}

<div class="library-frame" class:rail-open={desktopRailOpen}>
  {#if desktopRailOpen}<aside
      id="library-collections-navigation"
      class="library-rail"
      aria-label="Collections"
    >
      <h2>Library</h2>
      <nav>
        <button
          aria-current={collectionId === 'books' ? 'page' : undefined}
          onclick={() => {
            query = '';
            navigate(undefined, 'books', false);
          }}><BookOpen aria-hidden="true" /><span>Books</span><span>{books.length}</span></button
        >
        <button
          aria-current={collectionId === 'finished' ? 'page' : undefined}
          onclick={() => {
            query = '';
            navigate(undefined, 'finished', false);
          }}
          ><CircleCheck aria-hidden="true" /><span>Finished</span><span
            >{books.filter(isFinished).length}</span
          ></button
        >
        <h3>My Collection</h3>
        {#each $organization.collections as collection (collection.id)}<button
            aria-current={collectionId === collection.id ? 'page' : undefined}
            onclick={() => {
              query = '';
              navigate(undefined, collection.id, false);
            }}
            ><List aria-hidden="true" /><span>{collection.name}</span><span
              >{books.filter((book) =>
                book.organizationAliases.some((alias) => collection.members.includes(alias))
              ).length}</span
            ></button
          >{/each}
        <button onclick={() => (collectionsOpen = true)}
          ><Plus aria-hidden="true" /><span>New Collection…</span></button
        >
      </nav>
      <p>Synced with Manabi Reader settings when account sync is on.</p>
    </aside>{/if}
  <section
    class="library-workspace max-w-none pb-14"
    aria-label="Library shelves"
    aria-busy={busy || scanning}
  >
    <div class="library-toolbar mb-7 flex items-center py-3">
      <label
        class="search-box ml-auto flex min-h-11 min-w-0 items-center gap-2 rounded-2xl border border-input bg-background px-3"
        ><Search class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span
          class="sr-only">Search library</span
        ><input
          class="min-w-0 w-full bg-transparent outline-none"
          type="search"
          placeholder="Search library"
          bind:value={query}
        /></label
      >
    </div>
    {#if selectMode}<p class="mb-5 text-sm text-muted-foreground">
        Selecting a series includes its matching saved books. Connected previews must be saved
        before they can be exported.
      </p>{/if}
    {#if error}<p
        role="alert"
        class="mb-5 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
      >
        {error}
      </p>{/if}
    {#if notice}<p role="status" class="mb-4 text-sm text-muted-foreground">{notice}</p>{/if}
    {#if scanning}<p role="status" class="mb-4 text-sm text-muted-foreground">
        Reading connected folders…
      </p>{/if}
    {#each pending as plan (plan.id)}<div
        class="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-border p-4"
      >
        <p class="flex-1 text-sm">
          A folder change for “{plan.name}” needs to finish. Verified copies and remaining originals
          have been kept.
        </p>
        <Button onclick={() => resumeMove(plan)} disabled={busy}>Resume Folder Change</Button>
      </div>{/each}
    {#if previewFailures}<p class="mb-4 text-sm text-muted-foreground">
        Some cover previews could not be loaded. Your files are unchanged. Refresh connected folders
        to retry.
      </p>{/if}
    {#if warnings.length}<details class="mb-4 rounded-2xl border border-border p-4 text-sm">
        <summary>Some series names could not be read ({warnings.length})</summary
        >{#each warnings as warning, index (index)}<p class="mt-2 break-words">{warning}</p>{/each}
      </details>{/if}
    {#if recentBooks.length}
      <section class="continue-section mb-10" aria-labelledby="continue-heading">
        <h2 id="continue-heading" class="mb-4 font-serif text-2xl font-semibold">Continue</h2>
        <div class="continue-track" role="list">
          {#each recentBooks as book (book.key)}
            <article class="continue-card" role="listitem">
              <button
                class="continue-open"
                onclick={() => openBook(book)}
                aria-label={`Continue ${book.title}`}
              >
                <div class="continue-cover">
                  <BookCover
                    imagePath={book.imagePath}
                    title={book.title}
                    author={creatorLine(book.creators)}
                    identity={book.key}
                    direction={book.direction}
                  />
                </div>
                <span class="min-w-0 flex-1">
                  <strong class="continue-title">{book.title}</strong>
                  {#if creatorLine(book.creators)}<span class="continue-author"
                      >{creatorLine(book.creators)}</span
                    >{/if}
                  <span class="continue-progress">{readingLabel(book)}</span>
                </span>
              </button>
              <SourceIcon provider={book.source?.provider} name={book.source?.name || ''} />
              {@render bookMenu(book, ' in Continue')}
            </article>
          {/each}
        </div>
      </section>
    {/if}
    {#if series}
      <header
        use:previewVisible={series}
        class="series-hero mb-10 rounded-3xl px-6 pt-8 pb-7 text-center"
      >
        <div class="series-hero-art"><CoverStack books={scopedSeriesBooks} hero /></div>
        <div class="series-hero-copy">
          <div class="flex items-center justify-center gap-2 md:justify-start">
            <p class="min-w-0 break-words font-serif text-3xl font-semibold sm:text-4xl">
              {series.name}
            </p>
            {@render seriesMenu(series)}
          </div>
          <p class="mt-2 text-sm text-muted-foreground">
            Series · {scopedSeriesBooks.length}
            {scopedSeriesBooks.length === 1 ? 'Book' : 'Books'}{#if collectionId !== 'books'}<span>
                in {collectionTitle}</span
              >{/if}
          </p>
          {#if seriesCreators}<p class="mt-1 text-sm text-muted-foreground">
              {seriesCreators}
            </p>{/if}
          {#if resume}<Button
              class="mt-6 h-auto min-h-14 max-w-lg flex-col whitespace-normal px-6 py-3"
              onclick={() => openBook(resume!)}
              disabled={busy}
              ><span class="font-semibold"
                >{hasReadingEvidence(resume) ? 'Continue Reading' : 'Start Reading'}</span
              ><span class="max-w-full truncate font-normal opacity-80">{resume.title}</span
              ></Button
            >{:else}<p class="mt-6 inline-flex items-center gap-2 text-sm">
              <CircleCheck class="size-4" aria-hidden="true" />All books finished
            </p>{/if}
          {#if collectionId !== 'books'}<Button
              class="mt-3"
              variant="ghost"
              onclick={() => navigate(series.id, 'books', false)}>View full series</Button
            >{/if}
        </div>
      </header>
    {:else if recentBooks.length}<h2 class="mb-8 font-serif text-3xl font-semibold">Books</h2>{/if}
    {#if completedGroups.length && collectionId === 'finished' && !series && currentLayout === 'timeline'}
      <div class="finished-timeline" role="list" aria-label="Finished books">
        {#each completedGroups as group (group.day || 'unknown')}
          <section class="finished-group" aria-labelledby={`finished-${group.day || 'unknown'}`}>
            <h3 id={`finished-${group.day || 'unknown'}`} class="finished-day">
              {group.day ? formatCalendarDay(group.day) : 'Date not set'}
            </h3>
            <div class="finished-group-books">
              {#each group.books as book (book.key)}
                <article class="finished-row" role="listitem">
                  <button
                    class="finished-open"
                    onclick={() => openBook(book)}
                    aria-label={`Read ${book.title}`}
                  >
                    <div class="finished-cover">
                      <BookCover
                        imagePath={book.imagePath}
                        title={book.title}
                        author={creatorLine(book.creators)}
                        identity={book.key}
                        direction={book.direction}
                      />
                    </div>
                    <span class="min-w-0 flex-1">
                      <strong class="finished-title">{book.title}</strong>
                      {#if creatorLine(book.creators)}<span class="finished-author"
                          >{creatorLine(book.creators)}</span
                        >{/if}
                      <span class="finished-detail"
                        >Finished{group.day ? ` · ${formatCalendarDay(group.day)}` : ''}</span
                      >
                    </span>
                  </button>
                  <SourceIcon provider={book.source?.provider} name={book.source?.name || ''} />
                  {@render bookMenu(book, '')}
                </article>
              {/each}
            </div>
          </section>
        {/each}
      </div>
      <p class="mt-12 text-center text-sm text-muted-foreground">
        {visibleBooks.length}
        {visibleBooks.length === 1 ? 'book' : 'books'}
      </p>
    {:else if displayed.length}
      <div
        class:shelf-grid={currentLayout === 'grid'}
        class:shelf-list={currentLayout === 'list'}
        role="list"
        aria-label={series?.name || collectionTitle}
      >
        {#each displayed as node (node.id)}
          <article
            role="listitem"
            class="shelf-item"
            use:previewVisible={node}
            class:series-item={node.kind === 'series'}
          >
            {#if node.kind === 'series'}
              {@const seriesBookIds = node.books.flatMap((book) =>
                book.bookId ? [book.bookId] : []
              )}
              {@const selectedInSeries = seriesBookIds.filter((id) =>
                selectedBookIds.has(id)
              ).length}
              <button
                class="book-open"
                class:selected={selectMode && selectedInSeries > 0}
                disabled={selectMode && seriesBookIds.length === 0}
                title={selectMode && seriesBookIds.length === 0
                  ? 'Save books in this series to the browser before selecting them'
                  : undefined}
                aria-pressed={selectMode
                  ? selectedInSeries === 0
                    ? false
                    : selectedInSeries === seriesBookIds.length
                      ? true
                      : 'mixed'
                  : undefined}
                onclick={() =>
                  selectMode
                    ? dispatch('selectionManyClick', {
                        ids: seriesBookIds
                      })
                    : navigate(node.id)}
                aria-label={`${selectMode ? 'Select' : 'Open'} series ${node.name}`}
              >
                <div class="book-thumbnail">
                  <CoverStack books={node.books} />
                  {#if selectMode && selectedInSeries > 0}<span class="selection-label"
                      >{selectedInSeries} selected</span
                    >{/if}
                </div>
                <div class="book-copy series-copy">
                  <h3>{node.name}</h3>
                  <p class="list-detail">Series · {node.books.length} books</p>
                </div>
              </button>
              <div class="book-status">
                <span class="progress-label">{node.books.length} books</span><SourceIcon
                  provider={node.source.provider}
                  name={node.source.name}
                />{#if !selectMode}{@render seriesMenu(node)}{/if}
              </div>
            {:else}
              {@const book = node.book}
              <button
                class="book-open"
                class:selected={!!book.bookId && selectedBookIds.has(book.bookId)}
                aria-pressed={selectMode
                  ? !!book.bookId && selectedBookIds.has(book.bookId)
                  : undefined}
                aria-label={`${selectMode ? 'Select' : 'Read'} ${book.title}`}
                aria-describedby={isFinished(book) && book.bookId
                  ? `finished-description-${book.bookId}`
                  : undefined}
                disabled={selectMode && !book.bookId}
                title={selectMode && !book.bookId
                  ? 'Save this book to the browser before selecting it'
                  : undefined}
                onclick={() =>
                  selectMode && book.bookId
                    ? dispatch('bookClick', { id: book.bookId })
                    : !selectMode
                      ? openBook(book)
                      : undefined}
              >
                <div class="book-thumbnail">
                  <BookCover
                    imagePath={book.imagePath}
                    title={book.title}
                    author={creatorLine(book.creators)}
                    identity={book.key}
                    direction={book.direction}
                  />{#if book.bookId && selectedBookIds.has(book.bookId)}<span
                      class="selection-label">Selected</span
                    >{/if}
                </div>
                <div class="book-copy">
                  <h3>{book.title}</h3>
                  {#if creatorLine(book.creators)}<p class="book-author">
                      {creatorLine(book.creators)}
                    </p>{/if}
                  <p class="list-detail">
                    {readingLabel(book)}{#if isFinished(book) && finishedDay(book)}
                      · {finishedDay(book)}{:else if book.bookId === currentBookId}
                      · Reading now{/if}
                  </p>
                </div>
              </button>
              {#if isFinished(book) && book.bookId}<span
                  id={`finished-description-${book.bookId}`}
                  class="sr-only"
                  >{finishedDay(book)
                    ? `Finished ${formatCalendarDay(finishedDay(book)!)}.`
                    : 'Finished. Date not set.'}</span
                >{/if}
              <div class="book-status">
                <span class="progress-label">{readingLabel(book)}</span><SourceIcon
                  provider={book.source?.provider}
                  name={book.source?.name || ''}
                />{#if !selectMode}{@render bookMenu(book, '')}{/if}
              </div>
            {/if}
          </article>
        {/each}
      </div>
      <p class="mt-12 text-center text-sm text-muted-foreground">
        {visibleBooks.length}
        {visibleBooks.length === 1 ? 'book' : 'books'}
      </p>
    {:else if books.length || series || collectionId !== 'books'}
      <div class="py-16 text-center">
        <h3 class="text-lg font-medium">
          {normalizedQuery
            ? 'No matching books'
            : collectionId === 'finished'
              ? 'No finished books'
              : notFinished
                ? 'All books here are finished'
                : selectedCollection
                  ? 'No books in this collection'
                  : 'No books here'}
        </h3>
        <p class="mt-2 text-sm text-muted-foreground">
          {normalizedQuery
            ? 'Try another search or clear the current search.'
            : collectionId === 'finished'
              ? 'Books you finish will appear here.'
              : notFinished
                ? 'Show all books to include finished titles.'
                : 'Add books to this collection from a book’s menu.'}
        </p>
        {#if normalizedQuery || notFinished}<Button
            class="mt-5"
            variant="outline"
            onclick={() => {
              if (normalizedQuery) query = '';
              else navigate(series?.id, collectionId, false);
            }}>{normalizedQuery ? 'Clear Search' : 'Show All'}</Button
          >{/if}
      </div>
    {:else}{@render children?.()}{/if}
  </section>
</div>

<CollectionsSheet
  bind:open={collectionsOpen}
  {books}
  active={collectionId}
  onchoose={(id) => {
    query = '';
    navigate(undefined, id, false);
  }}
/>
<Dialog.Root bind:open={dialogOpen}>
  <Dialog.Content class={dialog === 'new-series' ? 'sm:max-w-xl' : ''}>
    <Dialog.Header>
      <Dialog.Title
        >{dialog === 'rename'
          ? 'Rename book'
          : dialog === 'date'
            ? 'Edit finished date'
            : dialog === 'membership'
              ? 'Add to collection'
              : dialog === 'series-name'
                ? 'Rename series'
                : 'Create series'}</Dialog.Title
      >
      <Dialog.Description
        >{dialog === 'rename'
          ? 'Change the display name. The original file, reading position and history are unchanged.'
          : dialog === 'date'
            ? 'Change the completion date without changing reading progress or statistics.'
            : dialog === 'membership'
              ? 'A book can belong to more than one collection. This does not move files.'
              : dialog === 'series-name'
                ? 'Save the display name in this folder’s .Manabi-Reader.yaml. The folder path stays the same.'
                : 'Move selected ebook files into a new subfolder. Close external editors first. Progress and collections are preserved; files are verified before originals are removed.'}</Dialog.Description
      >
    </Dialog.Header>
    {#if dialog === 'membership' && targetBook}
      {@const targetOrganizationKey = targetBook.organizationKey}
      <div class="grid max-h-[40dvh] gap-3 overflow-y-auto">
        {#each $organization.collections as collection (collection.id)}<label
            class="flex min-h-11 items-center gap-3 rounded-xl border border-border px-3"
            ><input
              type="checkbox"
              checked={targetBook.organizationAliases.some((alias) =>
                collection.members.includes(alias)
              )}
              disabled={busy}
              onchange={(event) => {
                const included = event.currentTarget.checked;
                void action(() => setMembership(collection.id, targetOrganizationKey, included));
              }}
            /><span>{collection.name}</span></label
          >{/each}
        {#if !$organization.collections.length}<p class="text-sm text-muted-foreground">
            Create your first collection below.
          </p>{/if}
      </div>
      <form
        class="flex gap-2"
        onsubmit={(event) => {
          event.preventDefault();
          void action(async () => {
            await createCollection(newCollectionName, [targetOrganizationKey]);
            newCollectionName = '';
          });
        }}
      >
        <label class="min-w-0 flex-1"
          ><span class="sr-only">New collection name</span><input
            class="min-h-11 w-full rounded-xl border border-input bg-background px-3"
            bind:value={newCollectionName}
            placeholder="New collection name"
            maxlength="240"
            required
          /></label
        ><Button type="submit" class="min-h-11" disabled={busy}>Create</Button>
      </form>
      {#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
      <Dialog.Footer><Button onclick={() => (dialogOpen = false)}>Done</Button></Dialog.Footer>
    {:else}
      <form
        onsubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        class="grid gap-5"
      >
        {#if dialog === 'date'}<label class="grid gap-2"
            >Finished on<input
              type="date"
              class="min-h-11 rounded-xl border border-input bg-background px-3"
              bind:value={date}
              max={calendarDay()}
              required
            /></label
          >
        {:else}<label class="grid gap-2"
            >Name<input
              class="min-h-11 rounded-xl border border-input bg-background px-3"
              bind:value={name}
              required
              maxlength="240"
            /></label
          >{/if}
        {#if dialog === 'new-series'}
          <label class="grid gap-2"
            >Local folder<select
              class="min-h-11 rounded-xl border border-input bg-background px-3"
              bind:value={groupSource}
              onchange={() => (groupFiles = [])}
              >{#each locals as local (local.id)}<option value={local.id}>{local.name}</option
                >{/each}</select
            ></label
          >
          {#if !locals.length}<p class="text-sm text-muted-foreground">
              Creating a series needs a writable local folder. Browser-only imports have no original
              folder to move; cloud originals are currently read-only. <a
                class="underline"
                href={resolve('/connections')}>Manage connected libraries</a
              >.
            </p>{/if}
          <div
            class="grid max-h-[30dvh] gap-2 overflow-y-auto rounded-xl border border-border p-3"
            aria-label="Books to combine"
          >
            {#each groupCandidates as book (book.file!.id)}<label
                class="flex items-center gap-3 py-2"
                ><input
                  type="checkbox"
                  checked={groupFiles.includes(book.file!.id)}
                  onchange={(event) => toggleGroup(book.file!.id, event.currentTarget.checked)}
                /><span class="min-w-0"
                  ><span class="block">{book.title}</span><span
                    class="block break-all text-xs text-muted-foreground">{book.file!.id}</span
                  ></span
                ></label
              >{/each}
          </div>
          <p class="text-xs text-muted-foreground">
            {groupFiles.length} selected · Select at least two books from the same source.
          </p>
        {/if}
        {#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
        <Dialog.Footer
          ><Button variant="outline" disabled={busy} onclick={() => (dialogOpen = false)}
            >Cancel</Button
          ><Button
            type="submit"
            disabled={busy || (dialog === 'new-series' && groupFiles.length < 2)}
            >{busy ? 'Saving…' : dialog === 'new-series' ? 'Move into Series' : 'Save'}</Button
          ></Dialog.Footer
        >
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<style>
  .library-frame {
    min-width: 0;
  }
  .library-workspace {
    width: 100%;
    min-width: 0;
    justify-self: stretch;
    container-type: inline-size;
  }
  .library-rail {
    display: none;
  }
  .search-box input {
    border: 0;
    border-radius: 0;
    padding-inline: 0;
    background: transparent;
    box-shadow: none;
    outline: none;
  }
  .series-hero {
    background: linear-gradient(
      145deg,
      color-mix(in oklch, var(--primary) 12%, var(--background)),
      var(--muted)
    );
  }
  .continue-track {
    display: flex;
    gap: 1rem;
    overflow-x: auto;
    padding: 0.25rem 0.25rem 0.75rem;
    scroll-snap-type: x proximity;
  }
  .continue-card {
    display: flex;
    align-items: center;
    flex: 0 0 min(19rem, calc(100vw - 3rem));
    min-height: 6.5rem;
    border-radius: 1.25rem;
    background: color-mix(in oklch, var(--primary) 12%, var(--card));
    color: var(--card-foreground);
    overflow: hidden;
    scroll-snap-align: start;
  }
  .continue-open {
    display: flex;
    align-items: center;
    gap: 1rem;
    min-width: 0;
    flex: 1;
    padding: 0.75rem 0 0.75rem 0.75rem;
    text-align: left;
  }
  .continue-open:focus-visible,
  .finished-open:focus-visible {
    outline: 3px solid var(--ring);
    outline-offset: -3px;
  }
  .continue-cover {
    width: 3.7rem;
    height: 5rem;
    flex: none;
  }
  .continue-title,
  .continue-author,
  .continue-progress,
  .finished-title,
  .finished-author,
  .finished-detail {
    display: block;
  }
  .continue-title {
    display: -webkit-box;
    overflow: hidden;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-height: 1.25;
  }
  .continue-progress,
  .continue-author,
  .finished-author,
  .finished-detail {
    margin-top: 0.35rem;
    color: var(--muted-foreground);
    font-size: 0.875rem;
  }
  .series-hero-art {
    min-width: 0;
  }
  .series-hero-copy {
    min-width: 0;
  }
  .finished-timeline {
    display: grid;
    gap: 2.5rem;
  }
  .finished-group {
    display: grid;
    gap: 1rem;
  }
  .finished-day {
    font-family: var(--font-serif, Georgia, serif);
    font-size: 1.35rem;
    font-weight: 600;
  }
  .finished-group-books {
    display: grid;
    border-top: 1px solid var(--border);
  }
  .finished-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    padding: 1rem 0;
    border-bottom: 1px solid var(--border);
  }
  .finished-open {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex: 1;
    min-width: 0;
    text-align: left;
  }
  .finished-cover {
    width: 4rem;
    height: 6rem;
    flex: none;
  }
  .finished-title {
    overflow-wrap: anywhere;
    font-weight: 600;
  }
  .continue-author,
  .finished-author,
  .book-author {
    overflow: hidden;
    color: var(--muted-foreground);
    font-size: 0.875rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .continue-author {
    margin-top: 0.25rem;
  }
  .book-author {
    margin-top: 0.25rem;
  }
  .search-box {
    width: 15rem;
  }
  .search-box:focus-within {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  .shelf-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(10rem, 100%), 1fr));
    column-gap: clamp(1.25rem, 5vw, 3rem);
    row-gap: 2.4rem;
    align-items: start;
  }
  .shelf-item {
    position: relative;
    min-width: 0;
  }
  .book-open {
    display: block;
    width: 100%;
    text-align: left;
    border-radius: 3px;
  }
  .book-open:focus-visible {
    outline: 3px solid var(--ring);
    outline-offset: 6px;
  }
  .book-open.selected .book-thumbnail {
    outline: 3px solid var(--primary);
    outline-offset: 6px;
  }
  .book-thumbnail {
    position: relative;
    width: 100%;
    aspect-ratio: 2/3;
  }
  .book-copy {
    display: none;
    min-width: 0;
  }
  .book-copy h3 {
    font-weight: 600;
    overflow-wrap: anywhere;
    line-height: 1.35;
  }
  .series-copy {
    display: none;
  }
  .book-status {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 44px;
    margin-top: 0.35rem;
    color: var(--muted-foreground);
    font-size: 0.875rem;
  }
  .progress-label {
    margin-right: auto;
    font-variant-numeric: tabular-nums;
  }
  .list-detail {
    display: none;
    color: var(--muted-foreground);
    font-size: 0.875rem;
    margin-top: 0.4rem;
  }
  .selection-label {
    position: absolute;
    top: 0.6rem;
    right: 0.6rem;
    border-radius: 999px;
    background: var(--primary);
    color: var(--primary-foreground);
    padding: 0.25rem 0.6rem;
    font-size: 0.75rem;
  }
  .shelf-list {
    display: grid;
  }
  .shelf-list .shelf-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1.25rem 0;
    border-bottom: 1px solid var(--border);
  }
  .shelf-list .book-open {
    display: flex;
    align-items: center;
    gap: 1.25rem;
    min-width: 0;
    flex: 1;
  }
  .shelf-list .book-thumbnail {
    flex: none;
    width: 4.5rem;
  }
  .shelf-list .book-copy,
  .shelf-list .list-detail {
    display: block;
  }
  .shelf-list .book-copy {
    margin-top: 0;
  }
  .shelf-list .book-status {
    flex: none;
    margin-top: 0;
  }
  .shelf-list .progress-label {
    display: none;
  }
  @media (min-width: 768px) {
    .series-hero {
      display: grid;
      grid-template-columns: minmax(18rem, 1fr) minmax(18rem, 1fr);
      align-items: center;
      gap: 2.5rem;
      text-align: left;
    }
    .finished-group {
      grid-template-columns: 9rem minmax(0, 1fr);
      align-items: start;
    }
    .finished-day {
      position: sticky;
      top: 7rem;
      color: var(--muted-foreground);
      font-family: inherit;
      font-size: 0.95rem;
    }
  }
  @media (min-width: 1280px) {
    .library-frame.rail-open {
      display: grid;
      grid-template-columns: 14rem minmax(0, 1fr);
      gap: 2rem;
      align-items: start;
    }
    .library-rail {
      display: block;
      position: sticky;
      top: 6.5rem;
      max-height: calc(100dvh - 8rem);
      overflow-y: auto;
      padding: 1rem 0.75rem;
      border: 1px solid var(--border);
      border-radius: 1.25rem;
      background: var(--card);
    }
    .library-rail h2,
    .library-rail h3 {
      padding: 1.25rem 0.75rem 0.4rem;
      color: var(--muted-foreground);
      font-size: 0.75rem;
      font-weight: 650;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .library-rail h2 {
      padding-top: 0.5rem;
    }
    .library-rail button {
      display: grid;
      grid-template-columns: 1.1rem minmax(0, 1fr) auto;
      align-items: center;
      gap: 0.65rem;
      width: 100%;
      min-height: 2.75rem;
      padding: 0.5rem 0.75rem;
      border-radius: 0.75rem;
      text-align: left;
    }
    .library-rail button:hover,
    .library-rail button[aria-current='page'] {
      background: var(--accent);
    }
    .library-rail button:focus-visible {
      outline: 2px solid var(--ring);
      outline-offset: 2px;
    }
    .library-rail button :global(svg) {
      width: 1.1rem;
      height: 1.1rem;
    }
    .library-rail button span:nth-child(2) {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .library-rail button span:last-child:not(:nth-child(2)) {
      color: var(--muted-foreground);
      font-variant-numeric: tabular-nums;
    }
    .library-rail p {
      margin: 1rem 0.75rem 0.25rem;
      color: var(--muted-foreground);
      font-size: 0.75rem;
    }
  }
  @media (max-width: 560px) {
    .search-box {
      width: 100%;
    }
    .shelf-list .shelf-item {
      gap: 0.4rem;
    }
    .shelf-list .book-open {
      gap: 0.8rem;
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    .book-open:hover .book-thumbnail {
      transform: translateY(-2px);
    }
    .book-thumbnail {
      transition: transform 150ms ease;
    }
  }
</style>
