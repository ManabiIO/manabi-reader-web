<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { BookOpen, FileText, Video } from '@lucide/svelte';
  import { localUser, localProfileUser } from '../manabi/client';
  import { videoLearningEnabled } from '../media/feature';
  import type { VideoTranscriptBatch } from '../media/video-search';
  import { formatMediaTime } from '../media/time';
  import { snippetItems, scope } from '../snippets/service';
  import { snippetKey, type SnippetHit } from '../snippets/document';
  import { searchBodies } from '../snippets/search';
  import {
    foldSearch,
    searchMatchRange,
    sortSearchText,
    type SearchTextFields
  } from '../library/search-normalization';
  import type { ShelfBook } from '../library/view-model';
  import type { ReaderLocator } from '../reader-location';
  import type { SnippetSummary } from '../snippets/summary';
  import SearchExcerpt from '../components/search-excerpt.svelte';
  import DictionarySearch from './dictionary-search.svelte';
  import { searchBookContents, type BookSearchBatch } from './book-content-source';
  import {
    bookTitleMatchDetail,
    bookTitleSearchFields,
    type BookTitleMatchContext
  } from './book-title-match-text';
  import { queryTask, type SearchState } from './query-task.mjs';
  import {
    librarySearchScopePlan,
    librarySearchScopes,
    type LibrarySearchScope
  } from './library-search-scope';
  export let query = '';
  export let searchScope: LibrarySearchScope = 'everything';
  export let books: ShelfBook[] = [];
  export let matches: ShelfBook[] = [];
  export let bookMatchText: Record<string, readonly BookTitleMatchContext[]> = {};
  export let snippetMembers: string[] | undefined = undefined;
  export let returnTo = '/manage';
  export let openBook: (book: ShelfBook, locator?: ReaderLocator) => void;
  export let onquery: (query: string) => void;
  export let onscope: (scope: LibrarySearchScope) => void;
  type Filter = 'all' | 'dictionary' | 'titles' | 'content';
  interface Row {
    id: string;
    kind: 'Book' | 'Video' | 'Snippet';
    title: string;
    label: string;
    detail?: string;
    titleMatch?: { start: number; end: number };
    /** Search-only metadata used for relevance; never rendered directly. */
    searchText?: SearchTextFields;
    excerpt?: string;
    match?: { start: number; end: number };
    open: () => void;
  }
  interface TitleResults {
    rows: Row[];
    failed: number;
    truncated: boolean;
  }
  interface ContentResults {
    rows: Row[];
    failed: number;
    truncated: boolean;
  }
  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'dictionary', label: 'Dictionary' },
    { id: 'titles', label: 'Titles' },
    { id: 'content', label: 'Content' }
  ];
  let filter: Filter = 'all',
    mounted = false,
    signature = '',
    titleLimit = 30,
    contentLimit = 30;
  let titles: SearchState<TitleResults> = { state: 'idle' };
  let content: SearchState<ContentResults> = { state: 'idle' };
  let results: HTMLElement;
  let focusGeneration = 0;
  const titleTask = queryTask<TitleResults>((value) => {
    titles = value;
  });
  type LazyMediaRuntime = {
    store: import('../media/store').MediaStore;
    search: typeof import('../media/video-search');
  };
  let mediaRuntimePromise: Promise<LazyMediaRuntime> | undefined;
  let mediaSubscribed = false;
  let mediaDisposed = false;
  let stopMedia: () => void = () => {};
  let mediaRevision = 0;
  async function mediaRuntime(): Promise<LazyMediaRuntime> {
    if (!videoLearningEnabled) throw new Error('Video learning is disabled.');
    if (!mediaRuntimePromise) {
      const pending = Promise.all([import('../media/store'), import('../media/video-search')]).then(
        ([store, search]) => ({ store: new store.MediaStore(), search })
      );
      mediaRuntimePromise = pending;
      void pending.catch(() => {
        if (mediaRuntimePromise === pending) mediaRuntimePromise = undefined;
      });
    }
    const runtime = await mediaRuntimePromise;
    if (mediaDisposed) {
      await runtime.store.close();
      throw new DOMException('Search was closed', 'AbortError');
    }
    if (!mediaSubscribed) {
      mediaSubscribed = true;
      stopMedia = runtime.store.subscribe((captionsChanged, metadataChanged) => {
        if (mounted && (captionsChanged || metadataChanged)) mediaRevision++;
      });
    }
    return runtime;
  }
  const contentTask = queryTask<ContentResults>((value) => {
    content = value;
  });
  $: owner = $localUser?.id ?? null;
  $: eligible = $snippetItems.filter(
    (item) => !item.trashedAt && (!snippetMembers || snippetMembers.includes(snippetKey(item.id)))
  );
  $: scopePlan = librarySearchScopePlan(searchScope);
  $: availableFilters = scopePlan.dictionary
    ? filters
    : filters.filter((item) => item.id !== 'dictionary');
  // Scope can also change through URL history/parent state, not only chooseScope().
  // Never retain a hidden Dictionary filter when the new source family excludes it.
  $: if (!scopePlan.dictionary && filter === 'dictionary') filter = 'all';
  $: nextSignature = JSON.stringify([
    query,
    owner,
    filter,
    searchScope,
    scopePlan.books ? books.map((book) => [book.key, book.contentHash, book.lastBookModified]) : [],
    scopePlan.books
      ? matches.map((book) => [
          book.key,
          book.title,
          book.canonicalTitle,
          (book.creators ?? []).map((creator) => creator.name),
          book.series?.name ?? null,
          bookMatchText[book.key] ?? []
        ])
      : [],
    scopePlan.snippets ? eligible.map((item) => [item.key, item.revision]) : [],
    videoLearningEnabled && searchScope === 'everything' ? mediaRevision : 0
  ]);
  $: if (mounted && nextSignature !== signature) {
    signature = nextSignature;
    start();
  }
  $: visibleTitles = (titles.value?.rows ?? []).slice(0, filter === 'all' ? 2 : titleLimit);
  $: visibleContent = (content.value?.rows ?? []).slice(0, filter === 'all' ? 2 : contentLimit);
  function openSnippet(item: SnippetSummary, hit?: SnippetHit) {
    const params = new URLSearchParams({ id: item.id, returnTo });
    if (hit) params.set('locator', JSON.stringify(hit.locator));
    void goto(resolve(`/snippets?${params}`));
  }
  function mixMany<T>(...groups: T[][]): T[] {
    const result: T[] = [];
    const size = Math.max(0, ...groups.map((group) => group.length));
    for (let index = 0; index < size; index++)
      for (const group of groups) if (index < group.length) result.push(group[index]);
    return result;
  }
  function openVideo(key: string, time?: number, track?: string) {
    const params = new URLSearchParams({ media: key });
    if (time !== undefined) params.set('time', String(time));
    if (track) params.set('track', track);
    void goto(resolve(`/videos?${params}`));
  }
  function startTitles() {
    const plan = librarySearchScopePlan(searchScope);
    const selectedBooks = plan.books ? [...matches] : [],
      selectedSnippets = plan.snippets ? [...eligible] : [],
      selectedOwner = owner,
      selectedQuery = query,
      runVideos = videoLearningEnabled && searchScope === 'everything',
      needle = foldSearch(selectedQuery.trim());
    titleTask.start(async (signal, publish) => {
      const guard = () => {
        signal.throwIfAborted();
        if (selectedOwner !== (localProfileUser()?.id ?? null))
          throw new DOMException('Account changed', 'AbortError');
      };
      let snippetScope: ReturnType<typeof scope> | undefined,
        snippetFailed = 0;
      if (plan.snippets && selectedSnippets.length) {
        try {
          snippetScope = scope();
        } catch {
          snippetFailed = 1;
        }
      }
      // Metadata stays local and independent of dictionary initialization and
      // expensive body projection. Do not normalize the editable query to kana.
      const bookRows: Row[] = selectedBooks.map((book) => {
        const titleMatch = searchMatchRange(book.title, selectedQuery);
        const detail = bookTitleMatchDetail(book, bookMatchText[book.key] ?? [], selectedQuery);
        return {
          id: `book:${book.key}`,
          kind: 'Book',
          title: book.title,
          label: `Read ${book.title}`,
          detail,
          titleMatch,
          searchText: bookTitleSearchFields(book, bookMatchText[book.key] ?? []),
          open: () => openBook(book)
        };
      });
      const snippetRows: Row[] = snippetScope
        ? selectedSnippets
            .filter((item) => foldSearch(item.title).includes(needle))
            .map((item) => ({
              id: `snippet:${item.key}`,
              kind: 'Snippet',
              title: item.title,
              label: `Read snippet ${item.title}`,
              titleMatch: searchMatchRange(item.title, selectedQuery),
              open: () => openSnippet(item)
            }))
        : [];
      guard();
      publish({
        state: 'loading',
        value: {
          rows: sortSearchText(
            [...bookRows, ...snippetRows],
            selectedQuery,
            (row) => row.searchText ?? row.title
          ),
          failed: snippetFailed,
          truncated: false
        }
      });
      let videoRows: Row[] = [],
        videoFailed = 0,
        videoTruncated = false;
      if (runVideos) {
        try {
          const media = await mediaRuntime();
          signal.throwIfAborted();
          const result = await media.search.searchVideoTitles(
            media.store,
            media.search.mediaScope(selectedOwner),
            selectedQuery,
            signal
          );
          guard();
          videoTruncated = result.truncated;
          videoRows = result.hits.map((hit) => ({
            id: `video:${hit.key}`,
            kind: 'Video' as const,
            title: hit.title,
            label: `Open video ${hit.title}`,
            detail: hit.duration > 0 ? formatMediaTime(hit.duration) : undefined,
            titleMatch: searchMatchRange(hit.title, selectedQuery),
            open: () => openVideo(hit.key)
          }));
        } catch (error) {
          if (signal.aborted) throw error;
          guard();
          videoFailed = 1;
        }
      }
      guard();
      publish({
        state: 'ready',
        value: {
          rows: sortSearchText(
            [...bookRows, ...videoRows, ...snippetRows],
            selectedQuery,
            (row) => row.searchText ?? row.title
          ),
          failed: snippetFailed + videoFailed,
          truncated: videoTruncated
        }
      });
    }, 0);
  }
  function startContent() {
    const plan = librarySearchScopePlan(searchScope);
    const selectedBooks = plan.books ? [...books] : [],
      selectedSnippets = plan.snippets ? [...eligible] : [],
      needle = query,
      selectedOwner = owner,
      selectedBooksById = new Map(
        selectedBooks.flatMap((book) => (book.bookId ? [[book.bookId, book] as const] : []))
      );
    const runBooks = plan.books && selectedBooks.length > 0;
    const runSnippets = plan.snippets && selectedSnippets.length > 0;
    const runVideos = videoLearningEnabled && searchScope === 'everything';
    contentTask.start(async (signal, publish) => {
      const guard = () => {
        signal.throwIfAborted();
        if (selectedOwner !== (localProfileUser()?.id ?? null))
          throw new DOMException('Account changed', 'AbortError');
      };
      let snippetScope: ReturnType<typeof scope> | undefined;
      let bookBatch: BookSearchBatch = {
        hits: [],
        busy: runBooks,
        failed: 0,
        truncated: false
      };
      let snippetHits = new Map<string, SnippetHit[]>(),
        snippetBusy = runSnippets,
        snippetFailed = 0,
        snippetTruncated = false;
      let videoBatch: VideoTranscriptBatch = {
          hits: [],
          failed: 0,
          truncated: false,
          scanned: 0,
          total: 0
        },
        videoBusy = runVideos,
        videoFailed = 0;
      let stopBooks: (() => void) | undefined, stopSnippets: (() => void) | undefined;
      const stop = () => {
        stopBooks?.();
        stopSnippets?.();
        signal.removeEventListener('abort', stop);
      };
      signal.addEventListener('abort', stop, { once: true });
      const update = () => {
        if (signal.aborted) return;
        guard();
        const bookRows: Row[] = bookBatch.hits.flatMap((hit) => {
          const book = selectedBooksById.get(hit.bookId);
          return book
            ? [
                {
                  id: `book:${book.key}:${hit.locator.resource.spineIndex}:${hit.locator.start}`,
                  kind: 'Book' as const,
                  title: book.title,
                  label: `Open passage in ${book.title}: ${hit.locator.quote}`,
                  detail: `Section ${hit.locator.resource.spineIndex + 1}`,
                  excerpt: hit.excerpt,
                  match: hit.excerptMatch,
                  open: () => openBook(book, hit.locator)
                }
              ]
            : [];
        });
        const videoRows: Row[] = videoBatch.hits.map((hit) => ({
          id: `video:${hit.key}:${hit.trackId}:${hit.cueId}`,
          kind: 'Video' as const,
          title: hit.title,
          label: `Open transcript in ${hit.title} at ${formatMediaTime(hit.time)}: ${hit.text}`,
          detail: `${formatMediaTime(hit.time)} · ${hit.trackLabel || hit.language}`,
          excerpt: hit.text,
          match: hit.match,
          open: () => openVideo(hit.key, hit.time, hit.trackId)
        }));
        const snippetRows: Row[] = selectedSnippets.flatMap((item) =>
          (snippetHits.get(item.id) ?? []).map((hit) => ({
            id: `snippet:${item.key}:${hit.locator.blockId}:${hit.locator.offset}`,
            kind: 'Snippet' as const,
            title: item.title,
            label: `Open passage in ${item.title}: ${hit.locator.quote}`,
            detail: hit.reading ? 'Furigana match' : undefined,
            excerpt: hit.excerpt,
            match: hit.excerptMatch,
            open: () => openSnippet(item, hit)
          }))
        );
        publish({
          state: bookBatch.busy || snippetBusy || videoBusy ? 'loading' : 'ready',
          value: {
            rows: mixMany(bookRows, videoRows, snippetRows),
            failed: bookBatch.failed + snippetFailed + videoBatch.failed + videoFailed,
            truncated: bookBatch.truncated || snippetTruncated || videoBatch.truncated
          }
        });
      };
      if (runSnippets) {
        try {
          snippetScope = scope();
          stopSnippets = searchBodies(
            needle,
            selectedSnippets.map((item) => item.id),
            snippetScope,
            (batch) => {
              snippetHits = batch.hits;
              snippetBusy = batch.busy;
              snippetFailed = batch.failed;
              snippetTruncated = batch.truncated;
              update();
            }
          );
        } catch {
          snippetBusy = false;
          snippetFailed = 1;
        }
      }
      if (runBooks) {
        try {
          stopBooks = await searchBookContents(
            needle,
            selectedBooks,
            selectedOwner,
            signal,
            (batch) => {
              bookBatch = batch;
              update();
            }
          );
        } catch (error) {
          if (signal.aborted) {
            stop();
            throw error;
          }
          bookBatch = { ...bookBatch, busy: false, failed: 1 };
        }
      }
      update();
      if (runVideos) {
        try {
          const media = await mediaRuntime();
          signal.throwIfAborted();
          await media.search.searchVideoTranscripts(
            media.store,
            media.search.mediaScope(selectedOwner),
            needle,
            signal,
            (batch) => {
              videoBatch = batch;
              videoBusy = batch.scanned < batch.total;
              update();
            }
          );
          videoBusy = false;
          update();
        } catch (error) {
          if (signal.aborted) {
            stop();
            throw error;
          }
          videoBusy = false;
          videoFailed = 1;
          update();
        }
      }
      return stop;
    });
  }
  function start() {
    focusGeneration++;
    titleTask.stop();
    contentTask.stop();
    titles = { state: 'idle' };
    content = { state: 'idle' };
    titleLimit = contentLimit = 30;
    if (!query.trim() || [...query].length > 512) return;
    if (filter === 'all' || filter === 'titles') startTitles();
    if (filter === 'all' || filter === 'content') startContent();
  }
  async function choose(value: Filter) {
    filter = value;
    await tick();
    // Keep the selected chip, rather than a now-removed See all button, as the
    // keyboard anchor. Ordinary pressed buttons avoid async automatic tabs.
    results
      .querySelector<HTMLButtonElement>(`[data-search-filter="${value}"]`)
      ?.focus({ preventScroll: true });
  }
  async function chooseScope(value: LibrarySearchScope) {
    searchScope = value;
    onscope(value);
    if (!librarySearchScopePlan(value).dictionary && filter === 'dictionary') filter = 'all';
    await tick();
    results
      .querySelector<HTMLButtonElement>(`[data-search-scope="${value}"]`)
      ?.focus({ preventScroll: true });
  }
  async function more(kind: 'titles' | 'content') {
    const admitted = focusGeneration;
    const before = kind === 'titles' ? titleLimit : contentLimit;
    if (kind === 'titles') titleLimit += 30;
    else contentLimit += 30;
    await tick();
    if (admitted !== focusGeneration || !mounted) return;
    const target = results.querySelectorAll<HTMLButtonElement>(`[data-search-row="${kind}"]`)[
      before
    ];
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest' });
  }
  onMount(() => {
    mounted = true;
    return () => {
      mounted = false;
      mediaDisposed = true;
      titleTask.stop();
      contentTask.stop();
      stopMedia();
      if (mediaRuntimePromise)
        void mediaRuntimePromise.then(({ store }) => store.close()).catch(() => undefined);
    };
  });
</script>

<div class="unified-search" aria-label="Library search results" bind:this={results}>
  <div class="search-controls">
    <div class="control-group">
      <span id="library-search-scope-label" class="control-label">Search in</span>
      <div role="group" aria-labelledby="library-search-scope-label" class="scopes">
        {#each librarySearchScopes as item (item.id)}<button
            type="button"
            data-search-scope={item.id}
            aria-pressed={searchScope === item.id}
            onclick={() => void chooseScope(item.id)}>{item.label}</button
          >{/each}
      </div>
    </div>
    <div class="control-group">
      <span id="library-search-result-type-label" class="control-label">Show</span>
      <div role="group" aria-labelledby="library-search-result-type-label" class="filters">
        {#each availableFilters as item (item.id)}<button
            type="button"
            data-search-filter={item.id}
            aria-pressed={filter === item.id}
            onclick={() => void choose(item.id)}>{item.label}</button
          >{/each}
      </div>
    </div>
  </div>
  {#if scopePlan.dictionary && (filter === 'all' || filter === 'dictionary')}<DictionarySearch
      {query}
      full={filter === 'dictionary'}
      expand={() => void choose('dictionary')}
      {onquery}
    />{/if}
  {#if [...query].length > 512 && filter !== 'dictionary'}<p role="alert">
      Use a search of 512 characters or fewer.
    </p>{/if}
  {#if filter === 'all' || filter === 'titles'}
    <section aria-labelledby="title-search-heading" aria-busy={titles.state === 'loading'}>
      <header>
        <h2 id="title-search-heading">Titles</h2>
        {#if filter === 'all'}<button type="button" onclick={() => void choose('titles')}
            >See all titles <span aria-hidden="true">→</span></button
          >{/if}
      </header>
      {#if titles.state === 'loading'}<p class="note" role="status">Searching titles…</p>{/if}
      {#if titles.state === 'error' || titles.value?.failed}<p class="note" role="status">
          {titles.error ??
            'Some title sources could not be searched. Other title matches remain available.'}
          <button type="button" onclick={startTitles}>Retry titles</button>
        </p>{/if}
      <ul aria-label="Title results">
        {#each visibleTitles as row (row.id)}<li>
            <button
              type="button"
              class="result-row"
              data-search-row="titles"
              aria-label={row.label}
              aria-describedby={row.detail ? `title-detail-${row.id}` : undefined}
              onclick={row.open}
            >
              <span class="type-icon" aria-hidden="true"
                >{#if row.kind === 'Book'}<BookOpen
                    size={20}
                  />{:else if row.kind === 'Video'}<Video size={20} />{:else}<FileText
                    size={20}
                  />{/if}</span
              >
              <span class="row-copy"
                ><strong><SearchExcerpt text={row.title} match={row.titleMatch} /></strong><small id={row.detail ? `title-detail-${row.id}` : undefined}
                  >{row.kind}{row.detail ? ` · ${row.detail}` : ''}</small
                ></span
              >
            </button>
          </li>{/each}
      </ul>
      {#if titles.state === 'ready' && !visibleTitles.length}<p class="note">
          No matching titles.
        </p>{/if}
      {#if filter === 'titles' && (titles.value?.rows.length ?? 0) > titleLimit}<button
          type="button"
          onclick={() => void more('titles')}>Show more titles</button
        >{/if}
      {#if titles.value?.truncated}<p class="note">
          Some video titles were omitted. Refine your query for more specific matches.
        </p>{/if}
    </section>
  {/if}
  {#if filter === 'all' || filter === 'content'}
    <section aria-labelledby="content-search-heading" aria-busy={content.state === 'loading'}>
      <header>
        <h2 id="content-search-heading">Content</h2>
        {#if filter === 'all'}<button type="button" onclick={() => void choose('content')}
            >See all content <span aria-hidden="true">→</span></button
          >{/if}
      </header>
      {#if content.state === 'loading'}<p class="note" role="status">
          Searching saved content…
        </p>{/if}
      {#if content.state === 'error' || content.value?.failed}<p class="note" role="status">
          {content.error ??
            'Some saved content could not be searched. Other matches are still available.'}
          <button type="button" onclick={startContent}>Retry content</button>
        </p>{/if}
      <ul aria-label="Content results">
        {#each visibleContent as row (row.id)}<li>
            <button
              type="button"
              class="result-row passage"
              data-search-row="content"
              aria-label={row.label}
              onclick={row.open}
            >
              <span class="type-icon" aria-hidden="true"
                >{#if row.kind === 'Book'}<BookOpen
                    size={20}
                  />{:else if row.kind === 'Video'}<Video size={20} />{:else}<FileText
                    size={20}
                  />{/if}</span
              >
              <span class="row-copy"
                ><span class="excerpt"
                  ><SearchExcerpt text={row.excerpt ?? ''} match={row.match} /></span
                ><small>{row.kind} · {row.title}{row.detail ? ` · ${row.detail}` : ''}</small></span
              >
            </button>
          </li>{/each}
      </ul>
      {#if content.state === 'ready' && !visibleContent.length && !content.value?.failed}<p
          class="note"
        >
          No matches in content saved in this browser.
        </p>{/if}
      {#if filter === 'content' && (content.value?.rows.length ?? 0) > contentLimit}<button
          type="button"
          onclick={() => void more('content')}>Show more content</button
        >{/if}
      {#if content.value?.truncated}<p class="note">
          The local search limit was reached. Refine your query for more specific matches.
        </p>{/if}
      <p class="note scope-note">
        {searchScope === 'books'
          ? 'Searches saved books without downloading cloud content.'
          : searchScope === 'snippets'
            ? 'Searches snippets already indexed in this browser.'
            : videoLearningEnabled
              ? 'Searches saved books, snippets and published video transcripts without downloading cloud video bytes or starting transcription.'
              : 'Searches saved books and snippets without downloading cloud content.'}
      </p>
    </section>
  {/if}
</div>

<style>
  .unified-search {
    display: grid;
    gap: clamp(20px, 1.75rem, 28px);
    max-width: 64rem;
    margin-inline: auto;
  }
  .search-controls {
    position: sticky;
    top: var(--library-header-height, 0px);
    z-index: 2;
    display: grid;
    gap: 8px;
    padding-block: 8px 10px;
    border-bottom: 1px solid color-mix(in oklch, var(--border) 65%, transparent);
    background: color-mix(in oklch, var(--background) 94%, transparent);
    backdrop-filter: blur(12px);
  }
  .control-group {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  .control-label {
    color: var(--muted-foreground);
    font-size: 0.75rem;
    font-weight: 600;
  }
  .scopes,
  .filters {
    min-width: 0;
  }
  .scopes {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px;
    width: min(100%, 28rem);
  }
  .filters {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  button {
    min-height: 44px;
    padding: 10px 12px;
    border-radius: 0.7rem;
  }
  .scopes button,
  .filters button {
    border-radius: 999px;
    border: 1px solid transparent;
    overflow-wrap: anywhere;
  }
  .scopes button[aria-pressed='true'],
  .filters button[aria-pressed='true'] {
    border-color: var(--border);
    background: var(--muted);
    font-weight: 650;
  }
  button:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 3px;
  }
  section {
    min-width: 0;
    border-top: 1px solid var(--border);
    padding-top: 1rem;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  h2 {
    font-size: 1.125rem;
    font-weight: 650;
  }
  header button,
  .note button {
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0.4rem 0;
    display: grid;
    gap: 0.3rem;
  }
  .result-row {
    display: flex;
    gap: 14px;
    align-items: center;
    width: 100%;
    text-align: start;
    padding: 14px;
  }
  .result-row:hover {
    background: var(--muted);
  }
  .type-icon {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    background: var(--muted);
    border-radius: 10px;
  }
  .row-copy {
    display: grid;
    gap: 0.2rem;
    min-width: 0;
    flex: 1;
  }
  strong {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  small,
  .note {
    color: var(--muted-foreground);
    font-size: 0.8rem;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  .note {
    margin-block: 0.6rem;
  }
  .excerpt {
    line-height: 1.65;
    overflow-wrap: anywhere;
  }
  .passage {
    align-items: start;
  }
  .scope-note {
    font-size: 0.75rem;
  }
  @media (max-width: 480px) {
    header button {
      font-size: 0.8rem;
    }
  }
  @media (max-height: 40rem) {
    .search-controls {
      position: static;
      backdrop-filter: none;
    }
  }
  @media (forced-colors: active) {
    .scopes button[aria-pressed='true'],
    .filters button[aria-pressed='true'] {
      outline: 2px solid Highlight;
      outline-offset: -2px;
      border-color: Highlight;
      color: Highlight;
    }
  }
</style>
