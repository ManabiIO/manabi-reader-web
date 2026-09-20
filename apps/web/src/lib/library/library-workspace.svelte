<script lang="ts">
  import { onMount, createEventDispatcher, type Snippet } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/dropdown-menu';
  import * as Dialog from '$lib/components/ui/dialog';
  import ActionMenu from '$lib/components/navigation/action-menu.svelte';
  import MoreHorizontal from '@lucide/svelte/icons/ellipsis';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import Search from '@lucide/svelte/icons/search';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import { booklistSortOptions$ } from '$lib/data/store';
  import { StorageKey } from '$lib/data/storage/storage-types';
  import { SortDirection, type SortOption } from '$lib/data/sort-types';
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
    continueBook,
    type ShelfBook,
    type ShelfSeries
  } from './view-model';
  import { isFinished, finishedDay, calendarDay, progressFraction } from './completion';
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

  export let children: Snippet | undefined = undefined;
  export let bookCards: BookCardProps[];
  export let currentBookId: number | undefined;
  export let selectedBookIds: ReadonlySet<number> = new Set();
  export let selectMode = false;
  const dispatch = createEventDispatcher<{
    bookClick: { id: number };
    removeBookClick: { id: number };
  }>();
  let catalogs: Catalog[] = [],
    sources: SourceDescriptor[] = [],
    locals: LocalLibrary[] = [],
    pending: MovePlan[] = [];
  export let collectionsOpen = false;
  let layout: 'grid' | 'list' = 'grid',
    query = '',
    busy = false,
    scanning = false,
    error = '',
    notice = '';
  let dialogOpen = false,
    dialog: 'rename' | 'date' | 'membership' | 'series-name' | 'new-series' = 'rename';
  let targetBook: ShelfBook | undefined,
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
    { property: 'id', label: 'Added' },
    { property: 'progress', label: 'Progress' },
    { property: 'characters', label: 'Characters' },
    { property: 'lastBookModified', label: 'Last Update' },
    { property: 'lastBookmarkModified', label: 'Bookmarked' }
  ];
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
  $: displayed = visibleShelf(
    series?.children || tree,
    (book) =>
      (collectionId !== 'finished' || isFinished(book)) &&
      (!selectedCollection || selectedCollection.members.includes(book.key)) &&
      (!notFinished || !isFinished(book)) &&
      (!query.trim() || book.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),
    sort
  );
  $: visibleBooks = allBooks(displayed);
  $: resume = series ? continueBook(series.books) : undefined;
  $: groupCandidates = books.filter(
    (book) => book.source?.owner === null && book.source.id === groupSource && book.file
  );
  $: warnings = catalogs.flatMap((catalog) => catalog.warnings);

  function previewVisible(element: HTMLElement, node: ShelfNode) {
    let visible = false;
    const schedule = (value: ShelfNode) => {
      if (!visible) return;
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
  function setLayout(value: string) {
    if (value !== 'grid' && value !== 'list') return;
    layout = value;
    try {
      localStorage.setItem('manabi-library-layout', value);
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
    previewQueue = new PreviewQueue(() => {
      if (alive) previewFailures++;
    });
    try {
      layout = localStorage.getItem('manabi-library-layout') === 'list' ? 'list' : 'grid';
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
  function editBook(book: ShelfBook, kind: 'rename' | 'date' | 'membership') {
    targetBook = book;
    dialog = kind;
    name = book.title;
    date = finishedDay(book) || calendarDay();
    newCollectionName = '';
    error = '';
    dialogOpen = true;
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
      if (dialog === 'rename' && targetBook) await presentBook(targetBook.key, { title: name });
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

{#snippet bookMenu(book: ShelfBook)}
  <Menu.Root>
    <Menu.Trigger>
      {#snippet child({ props })}<Button
          {...props}
          variant="ghost"
          class="min-h-11 min-w-11"
          size="icon"
          aria-label={`Actions for ${book.title}`}
          title={`Actions for ${book.title}`}
          disabled={busy}><MoreHorizontal aria-hidden="true" /></Button
        >{/snippet}
    </Menu.Trigger>
    <Menu.Content align="end" class="w-64 max-w-[calc(100vw-1rem)]">
      <Menu.Item onSelect={() => openBook(book)}>Read</Menu.Item>
      <Menu.Separator />
      <Menu.Item onSelect={() => editBook(book, 'rename')}>Rename…</Menu.Item>
      <Menu.Item onSelect={() => editBook(book, 'membership')}>Add to Collection…</Menu.Item>
      <Menu.Item onSelect={() => finish(book)}
        >{isFinished(book) ? 'Mark as Still Reading' : 'Mark as Finished'}</Menu.Item
      >
      {#if isFinished(book)}<Menu.Item onSelect={() => editBook(book, 'date')}
          >Edit Finished Date…</Menu.Item
        >{/if}
      <Menu.Separator />
      <Menu.Sub
        ><Menu.SubTrigger>Book Binding</Menu.SubTrigger><Menu.SubContent>
          <Menu.Label>Cover edge only; reading layout is unchanged</Menu.Label>
          <Menu.RadioGroup
            value={$organization.books[book.key]?.direction || 'unknown'}
            onValueChange={(value) => {
              if (value === 'ltr' || value === 'rtl' || value === 'unknown')
                void action(() => presentBook(book.key, { direction: value }));
            }}
          >
            <Menu.RadioItem value="unknown">Automatic</Menu.RadioItem><Menu.RadioItem value="ltr"
              >Left edge</Menu.RadioItem
            ><Menu.RadioItem value="rtl">Right edge</Menu.RadioItem>
          </Menu.RadioGroup>
        </Menu.SubContent></Menu.Sub
      >
      {#if book.bookId}<Menu.Separator /><Menu.Item
          variant="destructive"
          onSelect={() => dispatch('removeBookClick', { id: book.bookId! })}
          >Remove from This Browser…</Menu.Item
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
      ><Menu.Item onSelect={() => navigate(value.id)}>Open Series</Menu.Item>
      {#if value.source.owner === null}<Menu.Item onSelect={() => editSeries(value)}
          >Rename Series…</Menu.Item
        >
      {:else}<Menu.Label>Cloud folder names are managed in your drive.</Menu.Label>{/if}
    </Menu.Content>
  </Menu.Root>
{/snippet}

<section
  class="library-workspace mx-auto max-w-6xl pb-14"
  aria-label="Library shelves"
  aria-busy={busy || scanning}
>
  <div class="library-toolbar mb-7 flex flex-wrap items-center gap-2 py-3">
    {#if series || collectionId !== 'books'}<Button
        variant="ghost"
        class="min-h-11"
        onclick={() =>
          navigate(
            trail.length > 1 ? trail.at(-2)?.id : undefined,
            series ? collectionId : 'books',
            false
          )}
        ><ArrowLeft aria-hidden="true" />{trail.length > 1
          ? trail.at(-2)?.name
          : series
            ? collectionTitle
            : 'Library'}</Button
      >{/if}
    <ActionMenu label="View" title="Library view options">
      <Menu.RadioGroup value={layout} onValueChange={setLayout}
        ><Menu.RadioItem value="grid">Grid</Menu.RadioItem><Menu.RadioItem value="list"
          >List</Menu.RadioItem
        ></Menu.RadioGroup
      >
      <Menu.Separator /><Menu.Label>Show</Menu.Label>
      <Menu.RadioGroup
        value={notFinished ? 'unfinished' : 'all'}
        onValueChange={(value) => navigate(series?.id, collectionId, value === 'unfinished')}
        ><Menu.RadioItem value="all">{series ? 'All in Series' : 'All Books'}</Menu.RadioItem
        ><Menu.RadioItem value="unfinished">Not Finished</Menu.RadioItem></Menu.RadioGroup
      >
      <Menu.Separator /><Menu.Label>Sort by</Menu.Label>
      <Menu.RadioGroup value={sort.property} onValueChange={(value) => setSort(value)}
        >{#each sortItems as item (item.property)}<Menu.RadioItem value={item.property}
            >{item.label}</Menu.RadioItem
          >{/each}</Menu.RadioGroup
      >
      <Menu.Separator /><Menu.RadioGroup
        value={sort.direction}
        onValueChange={(value) =>
          setSort(sort.property, value === 'asc' ? SortDirection.ASC : SortDirection.DESC)}
        ><Menu.RadioItem value="asc">Ascending</Menu.RadioItem><Menu.RadioItem value="desc"
          >Descending</Menu.RadioItem
        ></Menu.RadioGroup
      >
    </ActionMenu>
    <ActionMenu label="Organize" disabled={busy}>
      <Menu.Item onSelect={newSeries}>Create Series from Books…</Menu.Item>
      <Menu.Item
        onSelect={() => {
          void action(() => load(true));
        }}>Refresh Connected Folders</Menu.Item
      >
      <Menu.Item
        onSelect={() => {
          void goto(resolve('/connections'));
        }}>Accounts and Libraries</Menu.Item
      >
    </ActionMenu>
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
  {#if series}
    <header
      use:previewVisible={series}
      class="series-hero mb-10 rounded-3xl px-6 pt-8 pb-7 text-center"
    >
      <CoverStack books={series.books} hero />
      <div class="mt-7 flex items-center justify-center gap-2">
        <h2 class="min-w-0 break-words font-serif text-3xl font-semibold sm:text-4xl">
          {series.name}
        </h2>
        {@render seriesMenu(series)}
      </div>
      <p class="mt-2 text-sm text-muted-foreground">
        Series · {series.books.length}
        {series.books.length === 1 ? 'Book' : 'Books'}
      </p>
      {#if resume}<Button
          class="mx-auto mt-6 h-auto min-h-14 max-w-lg flex-col whitespace-normal px-6 py-3"
          onclick={() => openBook(resume!)}
          disabled={busy}
          ><span class="font-semibold"
            >{resume.lastBookOpen || resume.progress ? 'Continue Reading' : 'Start Reading'}</span
          ><span class="max-w-full truncate font-normal opacity-80">{resume.title}</span></Button
        >{:else}<p class="mt-6 inline-flex items-center gap-2 text-sm">
          <CircleCheck class="size-4" aria-hidden="true" />All books finished
        </p>{/if}
    </header>
  {:else if collectionId !== 'books'}<h2 class="mb-8 break-words font-serif text-3xl font-semibold">
      {collectionTitle}
    </h2>{/if}
  {#if displayed.length}
    <div
      class:shelf-grid={layout === 'grid'}
      class:shelf-list={layout === 'list'}
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
            <button
              class="book-open"
              on:click={() => navigate(node.id)}
              aria-label={`Open series ${node.name}`}
            >
              <div class="book-thumbnail"><CoverStack books={node.books} /></div>
              <div class="book-copy series-copy">
                <h3>{node.name}</h3>
                <p class="list-detail">Series · {node.books.length} books</p>
              </div>
            </button>
            <div class="book-status">
              <span class="progress-label">{node.books.length} books</span><SourceIcon
                provider={node.source.provider}
                name={node.source.name}
              />{@render seriesMenu(node)}
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
              on:click={() => openBook(book)}
            >
              <div class="book-thumbnail">
                <BookCover
                  imagePath={book.imagePath}
                  title={book.title}
                  direction={book.direction}
                />{#if book.bookId && selectedBookIds.has(book.bookId)}<span class="selection-label"
                    >Selected</span
                  >{/if}
              </div>
              <div class="book-copy">
                <h3>{book.title}</h3>
                <p class="list-detail">
                  {isFinished(book)
                    ? 'Finished'
                    : `${Math.floor(progressFraction(book.progress) * 100)}%`}{#if isFinished(book) && finishedDay(book)}
                    · {finishedDay(book)}{:else if book.bookId === currentBookId}
                    · Reading now{/if}
                </p>
              </div>
            </button>
            <div class="book-status">
              <span class="progress-label"
                >{isFinished(book)
                  ? 'Finished'
                  : `${Math.floor(progressFraction(book.progress) * 100)}%`}</span
              ><SourceIcon
                provider={book.source?.provider}
                name={book.source?.name || ''}
              />{@render bookMenu(book)}
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
      <h3 class="text-lg font-medium">No books here</h3>
      <p class="mt-2 text-sm text-muted-foreground">
        {query || notFinished
          ? 'Try another search or show all books.'
          : 'Add books to this collection from a book’s menu.'}
      </p>
      <Button
        class="mt-5"
        variant="outline"
        onclick={() => {
          query = '';
          navigate(series?.id, 'books', false);
        }}>Show All Books</Button
      >
    </div>
  {:else}{@render children?.()}{/if}
</section>

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
      <div class="grid max-h-[40dvh] gap-3 overflow-y-auto">
        {#each $organization.collections as collection (collection.id)}<label
            class="flex min-h-11 items-center gap-3 rounded-xl border border-border px-3"
            ><input
              type="checkbox"
              checked={collection.members.includes(targetBook.key)}
              disabled={busy}
              on:change={(event) => {
                const member = targetBook!.key,
                  included = event.currentTarget.checked;
                void action(() => setMembership(collection.id, member, included));
              }}
            /><span>{collection.name}</span></label
          >{/each}
        {#if !$organization.collections.length}<p class="text-sm text-muted-foreground">
            Create your first collection below.
          </p>{/if}
      </div>
      <form
        class="flex gap-2"
        on:submit|preventDefault={() => {
          const member = targetBook!.key;
          void action(async () => {
            await createCollection(newCollectionName, [member]);
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
      <form on:submit|preventDefault={submit} class="grid gap-5">
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
              on:change={() => (groupFiles = [])}
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
                  on:change={(event) => toggleGroup(book.file!.id, event.currentTarget.checked)}
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
  .search-box {
    width: 15rem;
  }
  .search-box:focus-within {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  .shelf-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
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
    display: block;
    margin-top: 1rem;
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
  @media (min-width: 640px) {
    .shelf-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  @media (min-width: 960px) {
    .shelf-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
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
