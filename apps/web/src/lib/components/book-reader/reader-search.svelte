<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
  import { browser } from '$app/environment';
  import * as Sheet from '$lib/components/ui/sheet';
  import { Button } from '$lib/components/ui/button';
  import { XIcon } from 'phosphor-svelte';
  import SearchExcerpt from '$lib/components/search-excerpt.svelte';
  import CloseButton from '$lib/components/ui/close-button.svelte';
  import {
    codePointLength,
    makeLocator,
    projectPublication,
    type ProjectedResource,
    type PublicationManifest,
    type ReaderLocator
  } from '$lib/reader-location';
  import { ReaderPanelSelection } from '$lib/reader-panel-selection';
  import type { ReaderSearchHit } from '$lib/reader-search-worker';

  export let open = false;
  export let rawHtml = '';
  export let manifest: PublicationManifest | undefined;
  export let bookKey = '';
  export let bookTitle = '';

  const dispatch = createEventDispatcher<{ select: ReaderLocator }>();
  let worker: Worker | undefined;
  let mounted = false;
  let searchError = '';
  let queryError = '';
  let requestId = 0;
  let bookGeneration = 0;
  let resources: ProjectedResource[] = [];
  let query = '';
  let matchCase = false;
  let composing = false;
  let inputElement: HTMLInputElement | undefined;
  let resultsElement: HTMLDivElement | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let hits: ReaderSearchHit[] = [];
  let visibleCount = 50;
  let revealingResults = false;
  let focusFrame = 0;
  let searching = false;
  let total = 0;
  let truncated = false;
  let projectedHtml = '';
  let projectedManifest: PublicationManifest | undefined;
  let projectedBookKey = '';
  let selectionError = '';
  const selection = new ReaderPanelSelection();

  $: if (
    browser &&
    open &&
    (rawHtml !== projectedHtml || manifest !== projectedManifest || bookKey !== projectedBookKey)
  ) {
    projectedHtml = rawHtml;
    projectedManifest = manifest;
    projectedBookKey = bookKey;
    const root = document.createElement('div');
    root.innerHTML = rawHtml;
    resources = rawHtml ? projectPublication(root, manifest) : [];
    bookGeneration += 1;
    cancel();
    hits = [];
    total = 0;
    if (open && query) schedule();
  }

  $: if (open) schedule();
  else {
    cancel();
    composing = false;
  }

  onMount(() => {
    mounted = true;
    if (open && query) schedule();
  });
  onDestroy(() => {
    mounted = false;
    if (focusFrame) cancelAnimationFrame(focusFrame);
    cancel();
    worker?.terminate();
    selection.dispose();
  });

  function failSearch() {
    cancel();
    worker?.terminate();
    worker = undefined;
    hits = [];
    total = 0;
    truncated = false;
    if (open) searchError = 'Search could not finish. Please try again.';
  }

  function ensureWorker() {
    if (worker) return true;
    try {
      const next = new Worker(new URL('../../reader-search-worker.ts', import.meta.url), {
        type: 'module'
      });
      worker = next;
      next.onmessage = (event: MessageEvent) => {
        if (worker !== next || !open) return;
        const value = event.data;
        if (value.requestId !== requestId || value.bookGeneration !== bookGeneration) return;
        if (value.type === 'error') {
          failSearch();
          return;
        }
        if (value.type === 'batch') hits = [...hits, ...value.hits];
        if (value.type === 'done') {
          searching = false;
          total = value.total;
          truncated = value.truncated;
        }
      };
      next.onerror = (event) => {
        // Consume the handled worker failure; keep a retry path instead of an
        // endless spinner. A terminated worker cannot reset its replacement.
        event.preventDefault();
        if (worker === next) failSearch();
      };
      next.onmessageerror = () => {
        if (worker === next) failSearch();
      };
      return true;
    } catch {
      failSearch();
      return false;
    }
  }

  function cancel() {
    selection.invalidate();
    if (debounce) clearTimeout(debounce);
    debounce = undefined;
    try {
      worker?.postMessage({ type: 'cancel', requestId });
    } catch {
      worker?.terminate();
      worker = undefined;
    }
    requestId += 1;
    searching = false;
  }

  function schedule() {
    cancel();
    hits = [];
    total = 0;
    truncated = false;
    visibleCount = 50;
    selectionError = '';
    searchError = '';
    queryError = '';
    if (!mounted || !open || !query.trim() || composing) return;
    // Match the worker's code-point limit; UTF-16 length rejects valid Japanese
    // supplementary characters. A validation error is not a failed worker.
    if (codePointLength(query) > 512) {
      queryError = 'Use a search of 512 characters or fewer.';
      return;
    }
    if (!ensureWorker()) return;
    const id = requestId;
    searching = true;
    debounce = setTimeout(() => {
      try {
        worker?.postMessage({
          type: 'search',
          requestId: id,
          bookGeneration,
          query,
          matchCase,
          resources: resources.map(({ resource, text }) => ({ resource, text }))
        });
      } catch {
        failSearch();
      }
    }, 160);
  }

  function clearSearch() {
    query = '';
    composing = false;
    schedule();
    inputElement?.focus({ preventScroll: true });
  }

  function revealResult(button: HTMLButtonElement) {
    cancelAnimationFrame(focusFrame);
    const id = requestId;
    // Native focus scrolling completes before we reveal a tall row's match.
    // The callback may not scroll after a new query, dismissal or focus move.
    focusFrame = requestAnimationFrame(() => {
      if (!mounted || !open || id !== requestId || !button.isConnected) return;
      if (document.activeElement !== button) return;
      const scroller = button.closest<HTMLElement>('[data-search-scroll]');
      const match = button.querySelector<HTMLElement>('mark');
      const target =
        scroller && match && button.offsetHeight > scroller.clientHeight ? match : button;
      target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    });
  }

  async function showMore(event: MouseEvent) {
    const trigger = event.currentTarget;
    if (!(trigger instanceof HTMLElement) || revealingResults) return;
    const id = requestId;
    const firstNew = visibleCount;
    trigger.focus({ preventScroll: true });
    // Keep the final-batch trigger connected until focus reaches the new row.
    // Otherwise the modal's focus recovery can run before this tick completes.
    revealingResults = true;
    visibleCount += 50;
    try {
      await tick();
      if (!mounted || !open || id !== requestId || document.activeElement !== trigger) return;
      const next = resultsElement?.querySelectorAll<HTMLButtonElement>('button[data-search-result]')[
        firstNew
      ];
      next?.focus({ preventScroll: true });
    } finally {
      revealingResults = false;
    }
  }

  function select(hit: ReaderSearchHit) {
    const projected = resources.find(
      ({ resource }) =>
        resource.spineIndex === hit.resource.spineIndex && resource.href === hit.resource.href
    );
    if (!projected || !bookKey || !open) return;
    const key = bookKey;
    const generation = bookGeneration;
    const html = rawHtml;
    const publication = manifest;
    selectionError = '';
    void selection.run(
      () => makeLocator(key, projected, hit.start, hit.end),
      () =>
        open &&
        bookKey === key &&
        bookGeneration === generation &&
        rawHtml === html &&
        manifest === publication,
      (locator) => dispatch('select', locator),
      () => (selectionError = 'Could not open this result. Please try again.')
    );
  }
</script>

<Sheet.Root {open} onOpenChange={(value) => (open = value)}>
  <Sheet.Content
    side="left"
    showCloseButton={false}
    onEscapeKeydown={(event) => {
      // Escape first belongs to the input method's candidate/composition UI.
      // 229 covers engines that omit isComposing on the terminating key.
      if (composing || event.isComposing || event.keyCode === 229) event.preventDefault();
    }}
    onCloseAutoFocus={(event) => {
      // Search collapses the toolbar, so its menu item no longer exists.
      // Restore the surviving reader control instead of leaving focus on body.
      const controls = document.querySelector<HTMLButtonElement>('button[data-reader-controls]');
      if (controls) {
        event.preventDefault();
        controls.focus();
      }
    }}
    class="writing-horizontal-tb overflow-hidden p-0 data-[side=left]:w-full data-[side=left]:sm:max-w-md"
  >
    <div class="search-toolbar">
      <Sheet.Title>Search Book</Sheet.Title>
      <CloseButton aria-label="Close search" onclick={() => (open = false)} />
    </div>
    <div class="search-scroll" data-search-scroll>
      <Sheet.Description>Find text in {bookTitle || 'this book'}.</Sheet.Description>
      <div class="search-options">
        <div class="search-field" class:invalid={!!queryError}>
          <input
            bind:this={inputElement}
            type="search"
            dir="auto"
            autocapitalize="none"
            autocomplete="off"
            spellcheck={false}
            aria-label="Search within book"
            aria-invalid={queryError ? true : undefined}
            aria-describedby={queryError ? 'reader-search-query-error' : undefined}
            placeholder="Search this book"
            bind:value={query}
            on:input={(event) => {
              query = event.currentTarget.value;
              schedule();
            }}
            on:compositionstart={() => {
              composing = true;
              schedule();
            }}
            on:compositionend={(event) => {
              query = event.currentTarget.value;
              composing = false;
              schedule();
            }}
          />
          {#if query}
            <button
              type="button"
              class="clear-search"
              aria-label="Clear search"
              on:click={clearSearch}
            >
              <XIcon size={18} weight="bold" aria-hidden="true" />
            </button>
          {/if}
        </div>
        <label class="flex min-h-11 items-center gap-2 text-sm"
          ><input
            type="checkbox"
            class="size-4 accent-primary"
            bind:checked={matchCase}
            on:change={(event) => {
              matchCase = event.currentTarget.checked;
              schedule();
            }}
          />Match case</label
        >
      </div>
      <p
        class="my-4 shrink-0 text-sm text-muted-foreground"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {#if queryError}Search too long.{:else if searchError}Search unavailable.{:else if composing}Finish
          entering text to search.{:else if searching}Searching…{:else if query.trim()}{truncated
            ? 'At least '
            : ''}{total}
          {total === 1 ? 'result' : 'results'}{:else}Enter a word or phrase.{/if}
      </p>
      {#if queryError}
        <p id="reader-search-query-error" role="alert" class="mb-3 text-sm text-destructive">
          {queryError}
        </p>
      {:else if searchError}
        <div class="mb-3 grid shrink-0 gap-2">
          <p role="alert" class="text-sm text-destructive">{searchError}</p>
          <Button variant="secondary" onclick={schedule}>Retry Search</Button>
        </div>
      {/if}
      {#if selectionError}<p role="alert" class="mb-3 text-sm text-destructive">
          {selectionError}
        </p>{/if}
      <!-- Variable-height content has one scroll owner below a short toolbar.
           A long title must not scroll dismissal out of reach. -->
      {#if query.trim() && !composing && !searching && !queryError && !searchError && !hits.length}
        <div class="empty-search">
          <p>No matches in this book</p>
          <p>Try another spelling or a shorter phrase.</p>
        </div>
      {/if}
      <div bind:this={resultsElement} class="shrink-0" role="region" aria-label="Search results">
        {#each hits.slice(0, visibleCount) as hit, index (`${hit.resource.spineIndex}:${hit.start}:${index}`)}
          <button
            type="button"
            data-search-result
            class="search-result"
            on:focus={(event) => revealResult(event.currentTarget)}
            on:click={() => select(hit)}
          >
            <span class="result-location">
              <span>Section {hit.resource.spineIndex + 1}</span>
              <span>Match {index + 1}</span>
            </span>
            <span class="result-excerpt"
              ><SearchExcerpt text={hit.excerpt} match={hit.excerptMatch} /></span
            >
          </button>
        {/each}
        {#if hits.length > visibleCount || revealingResults}
          <Button variant="ghost" class="my-2 min-h-11 w-full" onclick={showMore}
            >Show more results</Button
          >
        {/if}
      </div>
    </div>
  </Sheet.Content>
</Sheet.Root>

<style>
  .search-toolbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 44px;
    align-items: center;
    gap: 16px;
    flex-shrink: 0;
    padding: 16px;
    border-block-end: 1px solid var(--border);
  }
  .search-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 1.25rem;
    padding-block-end: max(1.25rem, env(safe-area-inset-bottom));
  }
  .search-options {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    margin-block-start: 1.25rem;
    flex-shrink: 0;
  }
  .search-field {
    display: flex;
    align-items: center;
    flex: 1 1 12rem;
    min-width: 0;
    border: 1px solid var(--input);
    border-radius: 10px;
    background: var(--background);
    color: var(--foreground);
  }
  .search-field:focus-within {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  .search-field.invalid {
    border-color: var(--destructive);
  }
  .search-field input {
    flex: 1 1 auto;
    width: 100%;
    min-width: 0;
    min-height: 44px;
    padding: 0.5rem 0.75rem;
    background: transparent;
    color: inherit;
    font-size: 1rem;
    border: 0;
    border-radius: inherit;
    box-shadow: none;
    outline: none;
  }
  .search-field input:focus {
    box-shadow: none;
    outline: none;
  }
  .search-field input::-webkit-search-cancel-button {
    display: none;
    -webkit-appearance: none;
    appearance: none;
  }
  .clear-search {
    display: grid;
    place-items: center;
    flex: 0 0 44px;
    width: 44px;
    height: 44px;
    border-radius: 8px;
    color: var(--muted-foreground);
  }
  .clear-search:hover {
    background: var(--muted);
    color: var(--foreground);
  }
  .clear-search:focus-visible,
  .search-result:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: -2px;
  }
  .search-result {
    display: block;
    width: 100%;
    min-height: 56px;
    padding: 1rem 0.5rem;
    border-block-end: 1px solid var(--border);
    border-radius: 6px;
    text-align: start;
    color: var(--popover-foreground);
  }
  .search-result:hover {
    background: var(--muted);
  }
  .result-location {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.25rem 1rem;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .result-excerpt {
    display: block;
    margin-block-start: 0.4rem;
    font-size: 1rem;
    line-height: 1.65;
    overflow-wrap: anywhere;
  }
  .empty-search {
    padding-block: 1rem;
    flex-shrink: 0;
    font-size: 0.875rem;
    line-height: 1.6;
  }
  .empty-search p:first-child {
    font-weight: 600;
  }
  .empty-search p + p {
    margin-block-start: 0.35rem;
    color: var(--muted-foreground);
  }
  @media (forced-colors: active) {
    .search-field {
      border-color: FieldText;
    }
    .search-field:focus-within,
    .clear-search:focus-visible,
    .search-result:focus-visible {
      outline-color: Highlight;
    }
  }
</style>
