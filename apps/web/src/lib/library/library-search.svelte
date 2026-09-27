<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { localProfileUser, localUser } from '$lib/manabi/client';
  import { readerBookKeyFor } from '$lib/reader-identity';
  import type { ContentHit } from './content-search';
  import type { ShelfBook } from './view-model';
  import type { ReaderLocator } from '../reader-location';
  import BookCover from './book-cover.svelte';
  import { creatorLine } from './book-metadata';

  export let query = '';
  export let books: ShelfBook[] = [];
  export let matches: ShelfBook[] = [];
  export let openBook: (book: ShelfBook, locator?: ReaderLocator) => void;
  let mounted = false,
    serial = 0,
    searching = false,
    failed = 0,
    scanned = 0,
    truncated = false;
  let worker: Worker | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let hits: ContentHit[] = [],
    error = '',
    signature = '',
    metadataLimit = 30;
  $: owner = $localUser?.id ?? null;
  $: saved = [
    ...new Map(
      books.filter((book) => book.bookId && !book.isPlaceholder).map((book) => [book.bookId, book])
    ).values()
  ];
  $: nextSignature = JSON.stringify([
    query,
    owner,
    saved.map((book) => [book.bookId, book.contentHash, book.lastBookModified])
  ]);
  $: if (mounted && signature !== nextSignature) {
    signature = nextSignature;
    schedule();
  }
  $: groups = saved.flatMap((book) => {
    const found = hits.filter((hit) => hit.bookId === book.bookId);
    return found.length ? [{ book, hits: found }] : [];
  });
  function stop() {
    serial++;
    clearTimeout(timer);
    worker?.terminate();
    worker = undefined;
  }
  function schedule() {
    stop();
    hits = [];
    error = '';
    failed = 0;
    scanned = 0;
    truncated = false;
    metadataLimit = 30;
    searching = !!query.trim() && !!saved.length;
    if (!searching) return;
    if ([...query].length > 512) {
      searching = false;
      error = 'Use a search of 512 characters or fewer.';
      return;
    }
    const run = serial,
      selected = [...saved],
      currentOwner = owner,
      needle = query;
    timer = setTimeout(() => {
      void start(run, selected, currentOwner, needle);
    }, 100);
  }
  async function start(
    run: number,
    selected: ShelfBook[],
    currentOwner: string | null,
    needle: string
  ) {
    try {
      // Small identity lookups only. No book markup or content hashing on the UI thread.
      const descriptors = [];
      for (const book of selected) {
        if (run !== serial || !mounted || currentOwner !== (localProfileUser()?.id ?? null)) return;
        descriptors.push({
          id: book.bookId!,
          key: await readerBookKeyFor(book.bookId!, book.contentHash)
        });
      }
      if (run !== serial || !mounted || currentOwner !== (localProfileUser()?.id ?? null)) return;
      const active = new Worker(new URL('./library-content-search-worker.ts', import.meta.url), {
        type: 'module'
      });
      worker = active;
      const fail = () => {
        if (run !== serial || worker !== active) return;
        searching = false;
        error = 'Content search could not finish. Book matches are still available.';
        active.terminate();
        worker = undefined;
      };
      active.onerror = fail;
      active.onmessageerror = fail;
      active.onmessage = ({ data }) => {
        if (
          run !== serial ||
          worker !== active ||
          data.requestId !== run ||
          currentOwner !== (localProfileUser()?.id ?? null)
        )
          return;
        if (data.type === 'batch') hits = [...hits, ...data.hits];
        else if (data.type === 'progress') {
          scanned = data.scanned;
          failed = data.failed;
        } else if (data.type === 'done') {
          searching = false;
          truncated = data.truncated;
          scanned = data.scanned;
          failed = data.failed;
          active.terminate();
          worker = undefined;
        } else if (data.type === 'error') fail();
      };
      active.postMessage({
        type: 'search',
        requestId: run,
        books: descriptors,
        owner: currentOwner,
        query: needle
      });
    } catch {
      if (run === serial && mounted) {
        searching = false;
        error = 'Content search could not start. Book matches are still available.';
        worker?.terminate();
        worker = undefined;
      }
    }
  }
  function choose(book: ShelfBook, hit?: ContentHit) {
    stop();
    searching = false;
    openBook(book, hit?.locator);
  }
  onMount(() => {
    mounted = true;
    return () => {
      mounted = false;
      stop();
    };
  });
</script>

<div class="library-search" aria-label="Library search results">
  <section aria-labelledby="library-book-matches">
    <h2 id="library-book-matches">Books <span>{matches.length}</span></h2>
    <p class="description">Titles, authors, series and collections</p>
    {#each matches.slice(0, metadataLimit) as book (book.key)}
      <button class="book-match" onclick={() => choose(book)} aria-label={`Read ${book.title}`}>
        <span class="cover"
          ><BookCover
            imagePath={book.imagePath}
            title={book.title}
            author={creatorLine(book.creators)}
            identity={book.key}
            direction={book.direction}
          /></span
        >
        <span class="book-label"
          ><strong>{book.title}</strong>{#if creatorLine(book.creators)}<span
              >{creatorLine(book.creators)}</span
            >{/if}</span
        >
      </button>
    {:else}<p class="description">No matching book metadata.</p>{/each}
    {#if matches.length > metadataLimit}<Button
        variant="ghost"
        onclick={() => (metadataLimit += 30)}>Show more books</Button
      >{/if}
  </section>
  <section aria-labelledby="library-content-matches">
    <h2 id="library-content-matches">Content</h2>
    <p class="description">
      Searches books saved in this browser. Connected books are not downloaded automatically.
    </p>
    <p role="status" aria-live="polite" class="description">
      {#if searching}Searching content… {scanned} of {saved.length} books checked.
      {:else if truncated}Showing up to 24 passages per book and 300 overall. Refine your search for
        more specific results.
      {:else if !saved.length}Save a book to this browser to search its content.
      {:else if !hits.length && !error}No content matches.{:else if !error}{hits.length} matching passages.{/if}
    </p>
    {#if error}<p role="alert">{error}</p>
      <Button variant="secondary" onclick={schedule}>Retry content search</Button>{/if}
    {#if failed}<p class="description">
        {failed} books could not be searched. Other results remain available.
      </p>{/if}
    {#each groups as group (group.book.key)}
      <div class="content-group">
        <h3>{group.book.title}</h3>
        {#each group.hits as hit, index (`${hit.locator.resource.spineIndex}:${hit.locator.start}:${index}`)}
          <button
            class="passage"
            onclick={() => choose(group.book, hit)}
            aria-label={`Open passage in ${group.book.title}: ${hit.locator.quote}`}
          >
            <span class="excerpt">{hit.excerpt}</span><span class="description"
              >Section {hit.locator.resource.spineIndex + 1}</span
            >
          </button>
        {/each}
      </div>
    {/each}
  </section>
</div>

<style>
  .library-search {
    display: grid;
    gap: 2rem;
    max-width: 64rem;
    margin-inline: auto;
  }
  section {
    min-width: 0;
  }
  h2 {
    font-size: 1.2rem;
    font-weight: 650;
    margin-bottom: 0.25rem;
  }
  h2 span {
    color: var(--muted-foreground);
    font-size: 0.9rem;
    font-weight: 400;
  }
  h3 {
    font-weight: 600;
    margin: 0.75rem 0.75rem 0.25rem;
    overflow-wrap: anywhere;
  }
  .description {
    font-size: 0.875rem;
    color: var(--muted-foreground);
    margin-bottom: 0.75rem;
  }
  .book-match,
  .passage {
    display: flex;
    align-items: center;
    gap: 1rem;
    width: 100%;
    min-height: 44px;
    padding: 0.75rem;
    text-align: start;
    border-radius: 0.75rem;
  }
  .book-match:hover,
  .passage:hover {
    background: var(--muted);
  }
  button:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  .cover {
    width: 2.75rem;
    height: 4rem;
    flex-shrink: 0;
  }
  .book-label {
    display: grid;
    gap: 0.25rem;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .book-label > span {
    color: var(--muted-foreground);
    font-size: 0.875rem;
  }
  .content-group {
    padding-block: 0.5rem;
  }
  .passage {
    align-items: flex-start;
    flex-direction: column;
    gap: 0.35rem;
  }
  .excerpt {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.7;
  }
  .passage .description {
    margin: 0;
  }
</style>
