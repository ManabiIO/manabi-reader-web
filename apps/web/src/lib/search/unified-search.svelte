<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { BookOpen, FileText } from '@lucide/svelte';
  import { localUser } from '../manabi/client';
  import { snippetItems, scope } from '../snippets/service';
  import { snippetKey, type SnippetHit } from '../snippets/document';
  import { searchBodies } from '../snippets/search';
  import { foldSearch } from '../library/search-normalization';
  import { creatorLine } from '../library/book-metadata';
  import type { ShelfBook } from '../library/view-model';
  import type { ReaderLocator } from '../reader-location';
  import type { SnippetSummary } from '../snippets/summary';
  import SearchExcerpt from '../components/search-excerpt.svelte';
  import DictionarySearch from './dictionary-search.svelte';
  import { searchBookContents, type BookSearchBatch } from './book-content-source';
  import { queryTask, type SearchState } from './query-task.mjs';
  export let query = '';
  export let books: ShelfBook[] = [];
  export let matches: ShelfBook[] = [];
  export let snippetMembers: string[] | undefined = undefined;
  export let returnTo = '/manage';
  export let openBook: (book: ShelfBook, locator?: ReaderLocator) => void;
  export let onquery: (query: string) => void;
  type Filter = 'all' | 'dictionary' | 'titles' | 'content';
  interface Row {
    id: string;
    kind: 'Book' | 'Snippet';
    title: string;
    label: string;
    detail?: string;
    excerpt?: string;
    match?: { start: number; end: number };
    open: () => void;
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
  let titles: SearchState<Row[]> = { state: 'idle' };
  let content: SearchState<ContentResults> = { state: 'idle' };
  let results: HTMLElement;
  let focusGeneration = 0;
  const titleTask = queryTask<Row[]>((value) => {
    titles = value;
  });
  const contentTask = queryTask<ContentResults>((value) => {
    content = value;
  });
  $: owner = $localUser?.id ?? null;
  $: eligible = $snippetItems.filter(
    (item) => !item.trashedAt && (!snippetMembers || snippetMembers.includes(snippetKey(item.id)))
  );
  $: nextSignature = JSON.stringify([
    query,
    owner,
    filter,
    books.map((book) => [book.key, book.contentHash, book.lastBookModified]),
    matches.map((book) => [book.key, book.title]),
    eligible.map((item) => [item.key, item.revision])
  ]);
  $: if (mounted && nextSignature !== signature) {
    signature = nextSignature;
    start();
  }
  $: visibleTitles = (titles.value ?? []).slice(0, filter === 'all' ? 2 : titleLimit);
  $: visibleContent = (content.value?.rows ?? []).slice(0, filter === 'all' ? 2 : contentLimit);
  function openSnippet(item: SnippetSummary, hit?: SnippetHit) {
    const params = new URLSearchParams({ id: item.id, returnTo });
    if (hit) params.set('locator', JSON.stringify(hit.locator));
    void goto(resolve(`/snippets?${params}`));
  }
  function mix<T>(a: T[], b: T[]): T[] {
    const result: T[] = [];
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
      if (index < a.length) result.push(a[index]);
      if (index < b.length) result.push(b[index]);
    }
    return result;
  }
  function startTitles() {
    const selectedBooks = [...matches],
      selectedSnippets = [...eligible],
      needle = foldSearch(query.trim());
    titleTask.start(async (signal, publish) => {
      const selected = scope();
      // Metadata stays local and independent of dictionary initialization and
      // expensive body projection. Do not normalize the editable query to kana.
      const bookRows: Row[] = selectedBooks.map((book) => ({
        id: `book:${book.key}`,
        kind: 'Book',
        title: book.title,
        label: `Read ${book.title}`,
        detail: creatorLine(book.creators),
        open: () => openBook(book)
      }));
      const snippetRows: Row[] = selectedSnippets
        .filter((item) => foldSearch(item.title).includes(needle))
        .map((item) => ({
          id: `snippet:${item.key}`,
          kind: 'Snippet',
          title: item.title,
          label: `Read snippet ${item.title}`,
          open: () => openSnippet(item)
        }));
      signal.throwIfAborted();
      selected.guard();
      publish({ state: 'ready', value: mix(bookRows, snippetRows) });
    }, 0);
  }
  function startContent() {
    const selectedBooks = [...books],
      selectedSnippets = [...eligible],
      needle = query,
      selectedOwner = owner;
    contentTask.start(async (signal, publish) => {
      const selected = scope();
      let bookBatch: BookSearchBatch = { hits: [], busy: true, failed: 0, truncated: false };
      let snippetHits = new Map<string, SnippetHit[]>(),
        snippetBusy = true,
        snippetFailed = 0,
        snippetTruncated = false;
      let stopBooks: (() => void) | undefined, stopSnippets: (() => void) | undefined;
      const stop = () => {
        stopBooks?.();
        stopSnippets?.();
        signal.removeEventListener('abort', stop);
      };
      signal.addEventListener('abort', stop, { once: true });
      const update = () => {
        if (signal.aborted) return;
        selected.guard();
        const bookRows: Row[] = bookBatch.hits.flatMap((hit) => {
          const book = selectedBooks.find((item) => item.bookId === hit.bookId);
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
        const snippetRows: Row[] = selectedSnippets.flatMap((item) =>
          (snippetHits.get(item.id) ?? []).map((hit) => ({
            id: `snippet:${item.key}:${hit.locator.blockId}:${hit.locator.offset}`,
            kind: 'Snippet' as const,
            title: item.title,
            label: `Open passage in ${item.title}: ${hit.locator.quote}`,
            detail: hit.reading ? 'Furigana match' : undefined,
            excerpt: hit.excerpt,
            open: () => openSnippet(item, hit)
          }))
        );
        publish({
          state: bookBatch.busy || snippetBusy ? 'loading' : 'ready',
          value: {
            rows: mix(bookRows, snippetRows),
            failed: bookBatch.failed + snippetFailed,
            truncated: bookBatch.truncated || snippetTruncated
          }
        });
      };
      try {
        stopSnippets = searchBodies(
          needle,
          selectedSnippets.map((item) => item.id),
          selected,
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
        update();
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
      titleTask.stop();
      contentTask.stop();
    };
  });
</script>

<div class="unified-search" aria-label="Library search results" bind:this={results}>
  <nav aria-label="Search result type" class="filters">
    {#each filters as item}<button
        type="button"
        data-search-filter={item.id}
        aria-pressed={filter === item.id}
        onclick={() => void choose(item.id)}>{item.label}</button
      >{/each}
  </nav>
  {#if filter === 'all' || filter === 'dictionary'}<DictionarySearch
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
      {#if titles.state === 'error'}<p class="note" role="status">
          {titles.error} <button type="button" onclick={startTitles}>Retry titles</button>
        </p>{/if}
      <ul aria-label="Title results">
        {#each visibleTitles as row (row.id)}<li>
            <button
              type="button"
              class="result-row"
              data-search-row="titles"
              aria-label={row.label}
              onclick={row.open}
            >
              <span class="type-icon" aria-hidden="true"
                >{#if row.kind === 'Book'}<BookOpen size={20} />{:else}<FileText
                    size={20}
                  />{/if}</span
              >
              <span class="row-copy"
                ><strong>{row.title}</strong><small
                  >{row.kind}{row.detail ? ` · ${row.detail}` : ''}</small
                ></span
              >
            </button>
          </li>{/each}
      </ul>
      {#if titles.state === 'ready' && !visibleTitles.length}<p class="note">
          No matching titles.
        </p>{/if}
      {#if filter === 'titles' && (titles.value?.length ?? 0) > titleLimit}<button
          type="button"
          onclick={() => void more('titles')}>Show more titles</button
        >{/if}
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
                >{#if row.kind === 'Book'}<BookOpen size={20} />{:else}<FileText
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
        Searches saved books and snippets without downloading cloud content.
      </p>
    </section>
  {/if}
</div>

<style>
  .unified-search {
    display: grid;
    gap: 1.75rem;
    max-width: 64rem;
    margin-inline: auto;
  }
  .filters {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--background);
    padding-block: 0.4rem;
  }
  button {
    min-height: 44px;
    padding: 0.65rem 0.85rem;
    border-radius: 0.7rem;
  }
  .filters button {
    border-radius: 99px;
    border: 1px solid transparent;
  }
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
    gap: 1rem;
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
    gap: 0.9rem;
    align-items: center;
    width: 100%;
    text-align: start;
    padding: 0.9rem;
  }
  .result-row:hover {
    background: var(--muted);
  }
  .type-icon {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 2.5rem;
    height: 2.5rem;
    background: var(--muted);
    border-radius: 0.65rem;
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
    .unified-search {
      gap: 1.25rem;
    }
    header {
      gap: 0.2rem;
    }
    header button {
      font-size: 0.8rem;
    }
  }
</style>
