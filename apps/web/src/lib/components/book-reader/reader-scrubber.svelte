<script lang="ts">
  import { browser } from '$app/environment';
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { ReaderPanelSelection } from '$lib/reader-panel-selection';
  import * as Sheet from '$lib/components/ui/sheet';
  import {
    codePointLength,
    makeLocator,
    projectPublication,
    type ProjectedResource,
    type PublicationManifest,
    type ReaderLocator
  } from '$lib/reader-location';

  export let open = false;
  export let rawHtml = '';
  export let manifest: PublicationManifest | undefined;
  export let bookKey = '';
  export let current: ReaderLocator | undefined;

  const dispatch = createEventDispatcher<{ select: ReaderLocator }>();
  let resources: ProjectedResource[] = [];
  let lengths: number[] = [];
  let total = 0;
  let value = 0;
  let preview = 'Start of book';
  let selectionError = '';
  const selection = new ReaderPanelSelection();

  $: if (!open) selection.invalidate();
  onDestroy(() => selection.dispose());

  $: if (browser && open) {
    selection.invalidate();
    selectionError = '';
    const root = document.createElement('div');
    root.innerHTML = rawHtml;
    resources = rawHtml ? projectPublication(root, manifest) : [];
    lengths = resources.map((resource) => Math.max(1, codePointLength(resource.text)));
    total = lengths.reduce((sum, length) => sum + length, 0);
    value = 0;
    let before = 0;
    for (let i = 0; i < resources.length; i += 1) {
      if (
        current?.resource.spineIndex === resources[i].resource.spineIndex &&
        current.resource.href === resources[i].resource.href
      ) {
        value = total
          ? Math.round(((before + Math.min(current.start, lengths[i])) / total) * 1000)
          : 0;
        break;
      }
      before += lengths[i];
    }
    updatePreview();
  }

  function target() {
    if (!resources.length) return undefined;
    let position = (total * value) / 1000;
    for (let i = 0; i < resources.length; i += 1) {
      const length = lengths[i];
      if (position <= length || i === resources.length - 1) {
        const resource = resources[i];
        const offset = Math.min(codePointLength(resource.text), Math.max(0, Math.floor(position)));
        return { resource, offset, index: i };
      }
      position -= length;
    }
    return undefined;
  }
  function updatePreview() {
    const selected = target();
    preview = selected
      ? `Section ${selected.index + 1} of ${resources.length} · approximately ${Math.round(value / 10)}%`
      : 'Start of book';
  }
  function choose() {
    const selected = target();
    if (!selected || !bookKey || !open) return;
    const key = bookKey;
    const projected = resources;
    selectionError = '';
    void selection.run(
      () => makeLocator(key, selected.resource, selected.offset),
      () => open && bookKey === key && resources === projected,
      (locator) => dispatch('select', locator),
      () => (selectionError = 'Could not open this position. Please try again.')
    );
  }
</script>

<Sheet.Root {open} onOpenChange={(next) => (open = next)}>
  <Sheet.Content
    side="bottom"
    showCloseButton
    class="writing-horizontal-tb mx-auto max-w-3xl rounded-t-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
  >
    <Sheet.Header class="p-0">
      <Sheet.Title>Browse Book</Sheet.Title>
      <Sheet.Description
        >Preview a position, then release to open it. Your saved reading position stays put until
        you continue there.</Sheet.Description
      >
    </Sheet.Header>
    <div class="my-6 grid gap-3">
      <label for="reader-scrubber" class="text-sm">{preview}</label>
      <input
        id="reader-scrubber"
        type="range"
        min="0"
        max="1000"
        step="1"
        bind:value
        aria-label="Book position"
        aria-valuetext={preview}
        class="h-11 w-full accent-primary"
        disabled={!resources.length || !bookKey}
        oninput={(event) => {
          // Svelte's input listener runs before bind:value updates.
          value = event.currentTarget.valueAsNumber;
          selectionError = '';
          updatePreview();
        }}
        onchange={choose}
        onkeydown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            open = false;
          }
        }}
      />
    </div>
    {#if selectionError}<p role="alert" class="text-sm text-destructive">
        {selectionError}
      </p>{/if}
  </Sheet.Content>
</Sheet.Root>
