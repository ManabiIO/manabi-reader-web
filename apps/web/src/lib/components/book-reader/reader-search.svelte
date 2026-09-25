<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import { browser } from '$app/environment';
  import * as Sheet from '$lib/components/ui/sheet';
  import { Button } from '$lib/components/ui/button';
  import {
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
  let requestId = 0;
  let bookGeneration = 0;
  let resources: ProjectedResource[] = [];
  let query = '';
  let matchCase = false;
  let composing = false;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let hits: ReaderSearchHit[] = [];
  let visibleCount = 50;
  let searching = false;
  let total = 0;
  let truncated = false;
  let projectedHtml = '';
  let projectedManifest: PublicationManifest | undefined;
  let projectedBookKey = '';
  let selectionError = '';
  const selection = new ReaderPanelSelection();

  $: if (
    browser && open &&
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
    if (!mounted || !open || !query.trim() || composing || !ensureWorker()) return;
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
      () => open && bookKey === key && bookGeneration === generation && rawHtml === html && manifest === publication,
      (locator) => dispatch('select', locator),
      () => (selectionError = 'Could not open this result. Please try again.')
    );
  }
</script>

<Sheet.Root {open} onOpenChange={(value) => (open = value)}>
  <Sheet.Content
    side="left"
    showCloseButton
    class="writing-horizontal-tb p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] data-[side=left]:w-full data-[side=left]:sm:max-w-md"
  >
    <Sheet.Header class="shrink-0 p-0">
      <Sheet.Title>Search Book</Sheet.Title>
      <Sheet.Description>Find text in {bookTitle || 'this book'}.</Sheet.Description>
    </Sheet.Header>
    <div class="mt-5 flex shrink-0 flex-wrap items-center gap-3">
      <input
        class="min-h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-base text-foreground sm:text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        type="search"
        aria-label="Search within book"
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
      <label class="flex min-h-11 items-center gap-2 text-sm"
        ><input type="checkbox" class="size-4 accent-primary" bind:checked={matchCase}
          on:change={(event) => {
            matchCase = event.currentTarget.checked;
            schedule();
          }} />Match case</label
      >
    </div>
    <p class="my-4 shrink-0 text-sm text-muted-foreground" aria-live="polite">
      {#if searchError}Search unavailable.{:else if composing}Finish entering text to search.{:else if searching}Searching…{:else if query.trim()}{truncated ? 'At least ' : ''}{total} results{:else}Enter
        a word or phrase.{/if}
    </p>
    {#if searchError}
      <div class="mb-3 grid shrink-0 gap-2">
        <p role="alert" class="text-sm text-destructive">{searchError}</p>
        <Button variant="secondary" onclick={schedule}>Retry Search</Button>
      </div>
    {/if}
    {#if selectionError}<p role="alert" class="mb-3 text-sm text-destructive">
        {selectionError}
      </p>{/if}
    <!-- The sheet owns scrolling. A nested flex scroller can collapse to zero
         when a long title or enlarged text fills a short viewport. -->
    <div class="shrink-0" aria-label="Search results">
      {#each hits.slice(0, visibleCount) as hit, index (`${hit.resource.spineIndex}:${hit.start}:${index}`)}
        <button
          type="button"
          class="min-h-14 w-full border-b border-border px-2 py-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          on:click={() => select(hit)}
        >
          <span class="block text-xs text-muted-foreground"
            >Section {hit.resource.spineIndex + 1}</span
          >
          <span class="mt-1 block break-words text-sm">{hit.excerpt}</span>
        </button>
      {/each}
      {#if hits.length > visibleCount}
        <Button variant="ghost" class="my-2 min-h-11 w-full" onclick={() => (visibleCount += 50)}
          >Show more results</Button
        >
      {/if}
    </div>
  </Sheet.Content>
</Sheet.Root>
