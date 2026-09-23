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

  $: if (
    browser &&
    rawHtml &&
    (rawHtml !== projectedHtml || manifest !== projectedManifest || bookKey !== projectedBookKey)
  ) {
    projectedHtml = rawHtml;
    projectedManifest = manifest;
    projectedBookKey = bookKey;
    const root = document.createElement('div');
    root.innerHTML = rawHtml;
    resources = projectPublication(root, manifest);
    bookGeneration += 1;
    cancel();
    hits = [];
    total = 0;
    if (open && query) schedule();
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
    return () => worker?.terminate();
  });
  onDestroy(() => {
    if (debounce) clearTimeout(debounce);
    worker?.terminate();
  });

  function cancel() {
    if (debounce) clearTimeout(debounce);
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
    if (!query.trim() || composing || !worker) return;
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

  async function select(hit: ReaderSearchHit) {
    const projected = resources.find(
      ({ resource }) =>
        resource.spineIndex === hit.resource.spineIndex && resource.href === hit.resource.href
    );
    if (!projected || !bookKey) return;
    dispatch('select', await makeLocator(bookKey, projected, hit.start, hit.end));
  }
</script>

<Sheet.Root {open} onOpenChange={(value) => (open = value)}>
  <Sheet.Content
    side="left"
    showCloseButton
    class="writing-horizontal-tb data-[side=left]:w-full data-[side=left]:sm:max-w-md"
  >
    <Sheet.Header>
      <Sheet.Title>Search Book</Sheet.Title>
      <Sheet.Description>Find text in {bookTitle || 'this book'}.</Sheet.Description>
    </Sheet.Header>
    <div class="mt-5 flex items-center gap-3">
      <input
        class="min-h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        type="search"
        aria-label="Search within book"
        placeholder="Search this book"
        bind:value={query}
        on:input={() => !composing && schedule()}
        on:compositionstart={() => (composing = true)}
        on:compositionend={() => {
          composing = false;
          schedule();
        }}
      />
      <label class="flex items-center gap-1.5 text-sm"
        ><input type="checkbox" bind:checked={matchCase} on:change={schedule} />Match case</label
      >
    </div>
    <p class="my-4 text-sm text-muted-foreground" aria-live="polite">
      {#if searching}Searching…{:else if query.trim()}{truncated ? 'More than ' : ''}{total} results{:else}Enter
        a word or phrase.{/if}
    </p>
    <div class="max-h-[calc(100dvh-13rem)] overflow-y-auto">
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
