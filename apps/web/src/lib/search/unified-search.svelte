<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { BookOpen, FileText, Video } from '@lucide/svelte';
  import { localUser, localProfileUser } from '../manabi/client';
  import { videoLearningEnabled } from '../media/feature';
  import { snippetItems, scope } from '../snippets/service';
  import { snippetKey, type SnippetHit } from '../snippets/document';
  import { searchBodies } from '../snippets/search';
  import type { ShelfBook } from '../library/view-model';
  import type { ReaderLocator } from '../reader-location';
  import type { SnippetSummary } from '../snippets/summary';
  import SearchExcerpt from '../components/search-excerpt.svelte';
  import DictionarySearch from './dictionary-search.svelte';
  import { searchBookContents } from './book-content-source';
  import {
    queryBookTitleSearchSnapshot,
    type BookTitleSearchSnapshot
  } from './book-title-match-text';
  import { foldSearch } from '../library/search-normalization';
  import {
    bookTitleRows,
    scopedSnippetTitleRows,
    videoTitleRows,
    sortTitleRows,
    bookContentRows,
    snippetContentRows,
    videoContentRows,
    type SearchRow
  } from './result-rows';
  import { startSearchSources, type SearchSource, type SearchResults } from './source-session';
  import { queryTask, type SearchState } from './query-task.mjs';
  import {
    advanceMediaSearchRevisions,
    arrayRevision,
    referenceRevision,
    searchResultPlan,
    type SearchResultFilter
  } from './invalidation';
  import {
    librarySearchQueryWithinLimit,
    librarySearchScopePlan,
    librarySearchScopes,
    type LibrarySearchScope
  } from './library-search-scope';
  export let query = '';
  export let searchScope: LibrarySearchScope = 'everything';
  export let books: ShelfBook[] = [];
  export let bookSearchSnapshot: BookTitleSearchSnapshot = { direct: [], contexts: [] };
  export let snippetMembers: string[] | undefined = undefined;
  export let returnTo = '/manage';
  export let openBook: (book: ShelfBook, locator?: ReaderLocator) => void;
  export let onquery: (query: string) => void;
  export let onscope: (scope: LibrarySearchScope) => void;
  type Results = SearchResults<SearchRow>;
  const filters: { id: SearchResultFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'dictionary', label: 'Dictionary' },
    { id: 'titles', label: 'Titles' },
    { id: 'content', label: 'Content' }
  ];
  let filter: SearchResultFilter = 'all',
    mounted = false,
    titleSignature = '',
    contentSignature = '',
    titleLimit = 30,
    contentLimit = 30;
  let titles: SearchState<Results> = { state: 'idle' };
  let content: SearchState<Results> = { state: 'idle' };
  let results: HTMLElement;
  let titleFocusGeneration = 0;
  let contentFocusGeneration = 0;
  const titleTask = queryTask<Results>((value) => {
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
  let mediaTitleRevision = 0;
  let mediaContentRevision = 0;
  const bookSearchSnapshotRevisionFor = referenceRevision<BookTitleSearchSnapshot>();
  const snippetTitleRevisionFor = arrayRevision<SnippetSummary>(
    (left, right) => left.id === right.id && left.key === right.key && left.title === right.title
  );
  const snippetContentRevisionFor = arrayRevision<SnippetSummary>(
    (left, right) =>
      left.key === right.key && left.title === right.title && left.revision === right.revision
  );
  const contentBooksRevisionFor = arrayRevision<ShelfBook>(
    (left, right) =>
      left.key === right.key &&
      left.bookId === right.bookId &&
      left.isPlaceholder === right.isPlaceholder &&
      left.title === right.title &&
      left.contentHash === right.contentHash &&
      left.lastBookModified === right.lastBookModified
  );
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
        if (!mounted || (!captionsChanged && !metadataChanged)) return;
        const next = advanceMediaSearchRevisions(
          { titles: mediaTitleRevision, content: mediaContentRevision },
          captionsChanged,
          metadataChanged
        );
        mediaTitleRevision = next.titles;
        mediaContentRevision = next.content;
      });
    }
    return runtime;
  }
  const contentTask = queryTask<Results>((value) => {
    content = value;
  });
  $: owner = $localUser?.id ?? null;
  $: eligible = $snippetItems.filter(
    (item) => !item.trashedAt && (!snippetMembers || snippetMembers.includes(snippetKey(item.id)))
  );
  $: queryWithinLimit = librarySearchQueryWithinLimit(query);
  $: scopePlan = librarySearchScopePlan(searchScope);
  $: resultPlan = searchResultPlan(filter);
  $: bookSearchSnapshotRevision =
    resultPlan.titles && scopePlan.books ? bookSearchSnapshotRevisionFor(bookSearchSnapshot) : 0;
  $: snippetTitleRevision =
    resultPlan.titles && scopePlan.snippets ? snippetTitleRevisionFor(eligible) : 0;
  $: snippetContentRevision =
    resultPlan.content && scopePlan.snippets ? snippetContentRevisionFor(eligible) : 0;
  $: contentBooksRevision =
    resultPlan.content && scopePlan.books ? contentBooksRevisionFor(books) : 0;
  $: availableFilters = scopePlan.dictionary
    ? filters
    : filters.filter((item) => item.id !== 'dictionary');
  // Scope can also change through URL history/parent state, not only chooseScope().
  // Never retain a hidden Dictionary filter when the new source family excludes it.
  $: if (!scopePlan.dictionary && filter === 'dictionary') filter = 'all';
  $: nextTitleSignature = resultPlan.titles
    ? JSON.stringify([
        query,
        owner,
        searchScope,
        scopePlan.books ? bookSearchSnapshotRevision : 0,
        scopePlan.snippets ? snippetTitleRevision : 0,
        videoLearningEnabled && searchScope === 'everything' ? mediaTitleRevision : 0
      ])
    : 'inactive';
  $: nextContentSignature = resultPlan.content
    ? JSON.stringify([
        query,
        owner,
        searchScope,
        scopePlan.books ? contentBooksRevision : 0,
        scopePlan.snippets ? snippetContentRevision : 0,
        videoLearningEnabled && searchScope === 'everything' ? mediaContentRevision : 0
      ])
    : 'inactive';
  $: if (mounted && nextTitleSignature !== titleSignature) {
    titleSignature = nextTitleSignature;
    refreshTitles();
  }
  $: if (mounted && nextContentSignature !== contentSignature) {
    contentSignature = nextContentSignature;
    refreshContent();
  }
  $: visibleTitles = (titles.value?.rows ?? []).slice(0, filter === 'all' ? 2 : titleLimit);
  $: visibleContent = (content.value?.rows ?? []).slice(0, filter === 'all' ? 2 : contentLimit);
  function openSnippet(item: SnippetSummary, hit?: SnippetHit) {
    const params = new URLSearchParams({ id: item.id, returnTo });
    if (hit) params.set('locator', JSON.stringify(hit.locator));
    void goto(resolve(`/snippets?${params}`));
  }
  function openRow(row: SearchRow) {
    const target = row.target;
    if (target.kind === 'book') openBook(target.book, target.locator);
    else if (target.kind === 'snippet') openSnippet(target.snippet, target.hit);
    else openVideo(target.key, target.time, target.track);
  }
  function openVideo(key: string, time?: number, track?: string) {
    const params = new URLSearchParams({ media: key });
    if (time !== undefined) params.set('time', String(time));
    if (track) params.set('track', track);
    void goto(resolve(`/videos?${params}`));
  }
  function startTitles() {
    const plan = librarySearchScopePlan(searchScope);
    const selectedBookCorpus = plan.books ? [...books] : [],
      selectedBookSnapshot = bookSearchSnapshot,
      selectedSnippets = plan.snippets ? [...eligible] : [],
      selectedOwner = owner,
      selectedQuery = query,
      runVideos = videoLearningEnabled && searchScope === 'everything';
    titleTask.start(async (signal, publish) => {
      const guard = () => {
        signal.throwIfAborted();
        if (selectedOwner !== (localProfileUser()?.id ?? null))
          throw new DOMException('Account changed', 'AbortError');
      };
      let snippetScope: ReturnType<typeof scope> | undefined,
        snippetRows: SearchRow[] = [],
        snippetFailed = 0;
      if (plan.snippets && selectedSnippets.length) {
        try {
          snippetScope = scope();
        } catch {
          snippetFailed = 1;
        }
      }
      const refreshSnippetRows = () => {
        if (!snippetScope) return;
        const admitted = scopedSnippetTitleRows(
          selectedSnippets,
          selectedQuery,
          snippetScope.guard
        );
        snippetRows = admitted.rows;
        if (admitted.failed) {
          snippetFailed = 1;
          snippetScope = undefined;
        }
      };
      // Metadata stays local and independent of dictionary initialization and
      // expensive body projection. Query the immutable Book snapshot only after
      // this task owns the debounced generation; never scan the corpus in the
      // synchronous input/reactive path.
      let selectedBooks: ShelfBook[] = [],
        selectedBookMatchText: Record<string, readonly import('./book-title-match-text').BookTitleMatchContext[]> =
          {};
      if (plan.books) {
        const index = queryBookTitleSearchSnapshot(
          selectedBookSnapshot,
          foldSearch(selectedQuery.trim())
        );
        selectedBooks = selectedBookCorpus.filter((book) => index.matchedKeys.has(book.key));
        selectedBookMatchText = index.textByBook;
      }
      const bookRows = bookTitleRows(selectedBooks, selectedBookMatchText, selectedQuery);
      refreshSnippetRows();
      guard();
      publish({
        state: 'loading',
        value: {
          rows: sortTitleRows([...bookRows, ...snippetRows], selectedQuery),
          failed: snippetFailed,
          truncated: false
        }
      });
      let videoRows: SearchRow[] = [],
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
          videoRows = videoTitleRows(result.hits, selectedQuery);
        } catch (error) {
          if (signal.aborted) throw error;
          guard();
          videoFailed = 1;
        }
      }
      guard();
      refreshSnippetRows();
      publish({
        state: 'ready',
        value: {
          rows: sortTitleRows([...bookRows, ...videoRows, ...snippetRows], selectedQuery),
          failed: snippetFailed + videoFailed,
          truncated: videoTruncated
        }
      });
    });
  }
  function startContent() {
    const plan = librarySearchScopePlan(searchScope);
    const selectedBooks = plan.books ? [...books] : [],
      selectedSnippets = plan.snippets ? [...eligible] : [],
      needle = query,
      selectedOwner = owner,
      runVideos = videoLearningEnabled && searchScope === 'everything',
      selectedBooksById = new Map(
        selectedBooks.flatMap((book) => (book.bookId ? [[book.bookId, book] as const] : []))
      );
    contentTask.start((signal, publish) => {
      const guard = () => {
        signal.throwIfAborted();
        if (selectedOwner !== (localProfileUser()?.id ?? null))
          throw new DOMException('Account changed', 'AbortError');
      };
      // Display order is Books, Videos, Snippets. Admission is independent;
      // no source waits for a sibling's imports, descriptors or database reads.
      const sources: SearchSource<SearchRow>[] = [];
      if (plan.books && selectedBooks.length)
        sources.push({
          start: (signal, receive) =>
            searchBookContents(
              needle,
              selectedBooks,
              selectedOwner,
              signal,
              (batch) => receive({ ...batch, rows: bookContentRows(batch.hits, selectedBooksById) }),
              { progress: false }
            )
        });
      if (runVideos)
        sources.push({
          start: async (signal, receive) => {
            const media = await mediaRuntime();
            signal.throwIfAborted();
            const result = await media.search.searchVideoTranscripts(
              media.store,
              media.search.mediaScope(selectedOwner),
              needle,
              signal,
              (batch) =>
                receive({
                  rows: videoContentRows(batch.hits),
                  busy: batch.scanned < batch.total,
                  failed: batch.failed,
                  truncated: batch.truncated
                }),
              { progress: false }
            );
            receive({
              rows: videoContentRows(result.hits),
              busy: false,
              failed: result.failed,
              truncated: result.truncated
            });
          }
        });
      if (plan.snippets && selectedSnippets.length)
        sources.push({
          start: (_signal, receive) => {
            let latest = { rows: [] as SearchRow[], failed: 0, truncated: false };
            return searchBodies(
              needle,
              selectedSnippets.map((item) => item.id),
              scope(),
              (batch) => {
                latest = {
                  rows: snippetContentRows(batch.hits, selectedSnippets),
                  failed: batch.failed,
                  truncated: batch.truncated
                };
                receive({ ...batch, rows: latest.rows });
              },
              {
                progress: false,
                invalidated: () =>
                  receive({
                    ...latest,
                    busy: false,
                    failed: Math.max(1, latest.failed)
                  })
              }
            );
          }
        });
      return startSearchSources(sources, signal, publish, guard);
    });
  }

  function refreshTitles() {
    titleFocusGeneration++;
    titleTask.stop();
    titles = { state: 'idle' };
    titleLimit = 30;
    if (!resultPlan.titles || !query.trim() || !queryWithinLimit) return;
    startTitles();
  }
  function refreshContent() {
    contentFocusGeneration++;
    contentTask.stop();
    content = { state: 'idle' };
    contentLimit = 30;
    if (!resultPlan.content || !query.trim() || !queryWithinLimit) return;
    startContent();
  }
  async function choose(value: SearchResultFilter) {
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
    const admitted = kind === 'titles' ? titleFocusGeneration : contentFocusGeneration;
    const before = kind === 'titles' ? titleLimit : contentLimit;
    if (kind === 'titles') titleLimit += 30;
    else contentLimit += 30;
    await tick();
    const current = kind === 'titles' ? titleFocusGeneration : contentFocusGeneration;
    if (admitted !== current || !mounted) return;
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
  {#if !queryWithinLimit && filter !== 'dictionary'}<p role="alert">
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
              aria-describedby={`search-title-detail-${encodeURIComponent(row.id)}`}
              onclick={() => openRow(row)}
            >
              <span class="type-icon" aria-hidden="true"
                >{#if row.kind === 'Book'}<BookOpen
                    size={20}
                  />{:else if row.kind === 'Video'}<Video size={20} />{:else}<FileText
                    size={20}
                  />{/if}</span
              >
              <span class="row-copy"
                ><strong><SearchExcerpt text={row.title} match={row.titleMatch} /></strong><small
                  id={`search-title-detail-${encodeURIComponent(row.id)}`}
                  >{row.kind}{#if row.detail}{' · '}<SearchExcerpt
                      text={row.detail}
                      match={row.detailMatch}
                    />{/if}</small
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
              onclick={() => openRow(row)}
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
