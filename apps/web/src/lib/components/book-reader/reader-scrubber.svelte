<script lang="ts">
  import { browser } from '$app/environment';
  import { createEventDispatcher } from 'svelte';
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

  $: if (browser && rawHtml && open) {
    const root = document.createElement('div');
    root.innerHTML = rawHtml;
    resources = projectPublication(root, manifest);
    lengths = resources.map((resource) => Math.max(1, codePointLength(resource.text)));
    total = lengths.reduce((sum, length) => sum + length, 0);
    value = 0;
    let before = 0;
    for (let i = 0; i < resources.length; i += 1) {
      if (current?.resource.spineIndex === i) {
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
  async function choose() {
    const selected = target();
    if (!selected || !bookKey) return;
    dispatch('select', await makeLocator(bookKey, selected.resource, selected.offset));
  }
</script>

<Sheet.Root {open} onOpenChange={(next) => (open = next)}>
  <Sheet.Content
    side="bottom"
    showCloseButton
    class="writing-horizontal-tb mx-auto max-w-3xl rounded-t-3xl"
  >
    <Sheet.Header>
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
        oninput={updatePreview}
        onchange={choose}
        onkeydown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            open = false;
          }
        }}
      />
    </div>
  </Sheet.Content>
</Sheet.Root>
