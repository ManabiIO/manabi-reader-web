<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { database } from '$lib/data/store';
  import { currentUser } from '$lib/manabi/client';
  import { creatorLine } from './book-metadata';
  import { makeLocator, projectPublication } from '$lib/reader-location';
  import { readerBookKeyFor } from '$lib/reader-identity';
  import { metadataMatches } from './search/metadata';
  import { maxQueryPoints } from './search/text';
  import { digest } from './search/digest';
  import { clearSearchIndex, searchIndexVersion } from './search/cache';
  import { prepareLibraryPassage, clearLibraryPassage } from './search/handoff';
  import type { ContentHit, SearchReply } from './search/protocol';
  import type { ShelfBook } from './view-model';
  import BookCover from './book-cover.svelte';

  export let books: ShelfBook[] = [];
  export let labels: Record<string, string[]> = {};
  export let query = '';
  export let viewer: string | null = null;
  export let onopen: (book: ShelfBook, passage?: boolean) => void;
  let mounted = false,
    generation = 0,
    selection = 0;
  let worker: Worker | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let groups: { bookId: number; hits: ContentHit[]; truncated: boolean }[] = [];
  let searching = false,
    scanned = 0,
    failed = 0,
    truncated = false,
    cacheUnavailable = false;
  let error = '',
    navigationError = '',
    metadataLimit = 20,
    groupLimit = 10;
  let indexClearing = false;
  let root: HTMLDivElement;
  $: matches = metadataMatches(books, query, labels);
  $: eligible = books.filter((book) => !!book.bookId && !book.isPlaceholder);
  $: byId = new Map(eligible.map((book) => [book.bookId!, book]));
  $: tooLong = [...query].length > maxQueryPoints;
  // Covers, source refreshes and metadata ordering need not restart a content search.
  $: scopeKey = JSON.stringify([
    viewer,
    eligible
      .map((book) => [book.bookId, book.contentHash, book.lastBookModified])
      .sort((a, b) => Number(a[0]) - Number(b[0]))
  ]);
  $: if (mounted) schedule(query, scopeKey);

  function stop() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    worker?.terminate();
    worker = undefined;
  }
  function schedule(_query: string, _scope: string) {
    stop();
    generation++;
    selection++;
    groups = [];
    scanned = 0;
    failed = 0;
    error = '';
    navigationError = '';
    truncated = false;
    cacheUnavailable = false;
    metadataLimit = 20;
    groupLimit = 10;
    searching = !!query.trim() && !tooLong && eligible.length > 0;
    // The metadata section is rendered now; no IDB, projection, digest or worker awaits it.
    if (searching) timer = setTimeout(() => void start(generation), 150);
  }
  function failure(id: number) {
    if (id !== generation) return;
    stop();
    searching = false;
    error = 'Content search could not finish. Book matches are still available.';
  }
  async function start(id: number) {
    const selectedBooks = eligible.map((book) => ({
      id: book.bookId!,
      contentHash: book.contentHash
    }));
    const selectedQuery = query,
      selectedViewer = viewer;
    try {
      const db = await database.db;
      if (id !== generation || !mounted) return;
      const next = new Worker(new URL('./search/worker.ts', import.meta.url), { type: 'module' });
      worker = next;
      next.onerror = () => failure(id);
      next.onmessageerror = () => failure(id);
      next.onmessage = (event: MessageEvent<SearchReply>) => {
        if (worker !== next || id !== generation || event.data.id !== id) return;
        const message = event.data;
        if (message.type === 'book') groups = [...groups, message];
        else if (message.type === 'progress') {
          scanned = message.scanned;
          failed = message.failed;
          cacheUnavailable = message.cacheUnavailable;
        } else if (message.type === 'done') {
          searching = false;
          truncated = message.truncated;
          next.terminate();
          worker = undefined;
        } else failure(id);
      };
      next.postMessage({
        type: 'search',
        id,
        query: selectedQuery,
        viewer: selectedViewer,
        database: { name: db.name, version: db.version },
        books: selectedBooks
      });
    } catch {
      failure(id);
    }
  }
  function openBook(book: ShelfBook) {
    ++selection;
    if ((currentUser()?.id ?? null) !== viewer) {
      navigationError = 'The account changed. Search again.';
      return;
    }
    clearLibraryPassage();
    onopen(book);
  }
  async function openPassage(hit: ContentHit) {
    const token = ++selection,
      epoch = generation,
      owner = viewer;
    navigationError = '';
    const book = byId.get(hit.bookId);
    if (!book) return;
    const current = () =>
      mounted &&
      token === selection &&
      epoch === generation &&
      owner === viewer &&
      (currentUser()?.id ?? null) === owner &&
      byId.has(hit.bookId);
    try {
      // A worker/cache match is evidence, not navigation authority. Resolve against fresh canonical DOM.
      const db = await database.db;
      const tx = db.transaction(['data', 'readerBookScope']);
      const stored = await tx.objectStore('data').get(hit.bookId);
      const scope = await tx.objectStore('readerBookScope').get(hit.bookId);
      await tx.done;
      if (scope && scope.accountId !== owner)
        throw new Error('This book belongs to another account.');
      if (!current()) return;
      if (
        !stored ||
        (await digest(
          JSON.stringify([
            searchIndexVersion,
            stored.elementHtml,
            stored.publicationManifest ?? null
          ])
        )) !== hit.signature
      )
        throw new Error('This book changed. Search again to find the passage.');
      if (!current()) return;
      const template = document.createElement('template');
      // Saved book content has already passed the import sanitizer; this node is never mounted.
      template.innerHTML = stored.elementHtml;
      const projected = projectPublication(template.content, stored.publicationManifest).find(
        (item) =>
          item.resource.href === hit.resource.href &&
          item.resource.spineIndex === hit.resource.spineIndex
      );
      if (!projected || (await digest(projected.text)) !== hit.resourceDigest)
        throw new Error(
          'This passage could not be located safely. Open the book and use Search Book.'
        );
      if (!current()) return;
      const key = await readerBookKeyFor(hit.bookId, stored.contentHash);
      const locator = await makeLocator(key, projected, hit.start, hit.end);
      if (!current()) return;
      prepareLibraryPassage(hit.bookId, owner, locator);
      onopen(book, true);
    } catch (cause) {
      if (current())
        navigationError = cause instanceof Error ? cause.message : 'Could not open this passage.';
    }
  }
  async function rebuild() {
    stop();
    ++generation;
    ++selection;
    searching = false;
    indexClearing = true;
    try {
      await clearSearchIndex();
      if (mounted) schedule(query, scopeKey);
    } catch {
      if (mounted) error = 'The search index could not be cleared. Your books are unchanged.';
    } finally {
      if (mounted) indexClearing = false;
    }
  }
  function moveFocus(event: KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || event.isComposing) return;
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-library-result]')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : Math.max(0, Math.min(buttons.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)));
    buttons[index]?.focus();
  }
  onMount(() => {
    mounted = true;
  });
  onDestroy(() => {
    mounted = false;
    ++generation;
    ++selection;
    stop();
  });
</script>

<div
  bind:this={root}
  class="library-search min-w-0"
  role="group"
  aria-label="Library search results"
>
  {#if tooLong}<p role="alert" class="mb-4 text-sm">
      Use at most {maxQueryPoints} characters in a search.
    </p>{/if}
  <section aria-labelledby="library-metadata-heading" class="mb-8">
    <h2 id="library-metadata-heading" class="mb-3 text-xl font-semibold">
      Books <span class="text-sm font-normal text-muted-foreground">{matches.length}</span>
    </h2>
    <p class="mb-3 text-sm text-muted-foreground">
      Title, author, series, and collections across your library.
    </p>
    <ul class="grid gap-1">
      {#each matches.slice(0, metadataLimit) as book (book.key)}
        <li>
          <button
            onkeydown={moveFocus}
            data-library-result="metadata"
            class="result-book"
            onclick={() => openBook(book)}
            aria-label={`Open ${book.title}`}
          >
            <span class="result-cover"
              ><BookCover
                imagePath={book.imagePath}
                title={book.title}
                identity={book.key}
                direction={book.direction}
              /></span
            >
            <span class="min-w-0 flex-1 text-left"
              ><strong class="block break-words">{book.title}</strong>
              {#if book.creators?.length}<span class="block text-sm text-muted-foreground"
                  >{creatorLine(book.creators)}</span
                >{/if}
              {#if book.isPlaceholder}<span class="block text-xs text-muted-foreground"
                  >Not saved in this browser</span
                >{/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
    {#if !matches.length && !tooLong}<p class="text-sm text-muted-foreground">
        No matching books. Content results may still contain this text.
      </p>{/if}
    {#if matches.length > metadataLimit}<Button
        variant="ghost"
        class="mt-2"
        onclick={() => (metadataLimit += 20)}>Show more book matches</Button
      >{/if}
  </section>
  <section aria-labelledby="library-content-heading">
    <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h2 id="library-content-heading" class="text-xl font-semibold">Content</h2>
      <Button variant="ghost" size="sm" disabled={indexClearing} onclick={rebuild}
        >Rebuild search index</Button
      >
    </div>
    <p class="mb-4 text-sm text-muted-foreground" role="status" aria-live="polite">
      {#if searching}Searching saved books… {scanned} of {eligible.length} checked.
      {:else if error}{error}
      {:else if !eligible.length}Save books to this browser to search their contents.
      {:else if !tooLong}{groups.reduce((n, group) => n + group.hits.length, 0)} passage matches in {groups.length}
        books.{/if}
      {#if failed}
        {failed} books could not be searched. Your books are unchanged.{/if}
      {#if truncated}
        Showing the first 500 matches. Refine your search for more specific results.{/if}
    </p>
    {#if eligible.length < books.length}<p class="mb-3 text-xs text-muted-foreground">
        Connected books that are not saved here appear in Books, but are not downloaded for content
        search.
      </p>{/if}
    {#if cacheUnavailable}<p class="mb-3 text-xs text-muted-foreground">
        The reusable search index is unavailable. Searching still works without saving the index.
      </p>{/if}
    {#if error || failed}<Button
        variant="outline"
        class="mb-4"
        onclick={() => schedule(query, scopeKey)}>Retry content search</Button
      >{/if}
    {#if navigationError}<p role="alert" class="mb-4 text-sm text-destructive">
        {navigationError}
      </p>{/if}
    {#each groups.slice(0, groupLimit) as group (group.bookId)}
      {@const book = byId.get(group.bookId)}
      {#if book}<article class="mb-5 overflow-hidden rounded-2xl border border-border">
          <h3 class="break-words bg-muted/50 px-4 py-3 font-semibold">{book.title}</h3>
          <ul class="divide-y divide-border">
            {#each group.hits as hit (`${hit.resource.spineIndex}:${hit.start}:${hit.end}`)}
              <li>
                <button
                  onkeydown={moveFocus}
                  data-library-result="content"
                  class="result-passage"
                  onclick={() => openPassage(hit)}
                >
                  <span class="mb-1 block text-xs text-muted-foreground"
                    >Section {hit.resource.spineIndex + 1}</span
                  >
                  <span>{hit.before}<mark>{hit.match}</mark>{hit.after}</span>
                </button>
              </li>
            {/each}
          </ul>
          {#if group.truncated}<p class="px-4 py-2 text-xs text-muted-foreground">
              First {group.hits.length} matches shown in this book.
            </p>{/if}
        </article>{/if}
    {/each}
    {#if groups.length > groupLimit}<Button
        variant="ghost"
        onclick={async () => {
          groupLimit += 10;
          await tick();
        }}>Show more content matches</Button
      >{/if}
  </section>
</div>

<style>
  .result-book {
    display: flex;
    align-items: center;
    gap: 1rem;
    width: 100%;
    min-height: 76px;
    padding: 0.75rem;
    border-radius: 1rem;
  }
  .result-cover {
    display: block;
    width: 36px;
    flex: none;
  }
  .result-passage {
    width: 100%;
    min-height: 44px;
    text-align: start;
    padding: 0.8rem 1rem;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    line-height: 1.7;
  }
  .result-book:hover,
  .result-passage:hover {
    background: var(--muted);
  }
  .result-book:focus-visible,
  .result-passage:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: -2px;
  }
  mark {
    color: inherit;
    background: var(--accent);
    text-decoration: underline;
    text-decoration-color: var(--ring);
    text-underline-offset: 0.18em;
  }
</style>
