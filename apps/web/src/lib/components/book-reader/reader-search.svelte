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
    browser &&
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
    selection.invalidate();
  }

  onMount(() => {
    worker = new Worker(new URL('../../reader-search-worker.ts', import.meta.url), {
      type: 'module'
    });
    worker.onmessage = (event: MessageEvent) => {
      const value = event.data;
      if (value.requestId !== requestId || value.bookGeneration !== bookGeneration) return;
      if (value.type === 'batch') hits = [...hits, ...value.hits];
      if (value.type === 'done') {
        searching = false;
        total = value.total;
        truncated = value.truncated;
      }
    };
    if (open && query) schedule();
    return () => worker?.terminate();
  });
  onDestroy(() => {
    cancel();
    selection.dispose();
  });

  function cancel() {
    selection.invalidate();
    if (debounce) clearTimeout(debounce);
    debounce = undefined;
    worker?.postMessage({ type: 'cancel', requestId });
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
    if (!open || !query.trim() || composing || !worker) return;
    const id = requestId;
    searching = true;
    debounce = setTimeout(() => {
      worker?.postMessage({
        type: 'search',
        requestId: id,
        bookGeneration,
        query,
        matchCase,
        resources: resources.map(({ resource, text }) => ({ resource, text }))
      });
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
    selectionError = '';
    void selection.run(
      () => makeLocator(key, projected, hit.start, hit.end),
      () => open && bookKey === key && bookGeneration === generation,
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
        class="min-h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        type="search"
        aria-label="Search within book"
        placeholder="Search this book"
        bind:value={query}
        on:input={(event) => {
          query = event.currentTarget.value;
          if (!composing) schedule();
        }}
        on:compositionstart={() => {
          composing = true;
          cancel();
        }}
        on:compositionend={() => {
          composing = false;
          schedule();
        }}
      />
      <label class="flex items-center gap-1.5 text-sm"
        ><input type="checkbox" bind:checked={matchCase}
          on:change={(event) => {
            matchCase = event.currentTarget.checked;
            schedule();
          }} />Match case</label
      >
    </div>
    <p class="my-4 shrink-0 text-sm text-muted-foreground" aria-live="polite">
      {#if searching}Searching…{:else if query.trim()}{truncated ? 'More than ' : ''}{total} results{:else}Enter
        a word or phrase.{/if}
    </p>
    {#if selectionError}<p role="alert" class="mb-3 text-sm text-destructive">
        {selectionError}
      </p>{/if}
    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
