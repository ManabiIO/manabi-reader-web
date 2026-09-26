<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Headphones, SpinnerGap } from 'phosphor-svelte';
  import type { BookmarkManager } from '$lib/components/book-reader/types';

  export let bookId: number;
  export let bookTitle: string;
  export let htmlContent: string;
  export let contentRoot: HTMLElement | undefined = undefined;
  export let layoutKey: string | number;
  export let bookmarkManager: BookmarkManager | undefined;
  export let onFollow: () => void;

  let Panel: typeof import('./audiobook-panel.svelte').default | undefined;
  let open = false;
  let loading = false;
  let failed = false;
  let disposed = false;
  let trigger: HTMLButtonElement;
  let selectionHint: Range | undefined;

  onDestroy(() => {
    disposed = true;
  });

  async function show() {
    if (loading) return;
    // Capture before the modal takes focus or lazy loading changes selection.
    const selection = contentRoot?.ownerDocument.getSelection() ?? window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
    const root = contentRoot ?? document.querySelector('.book-content');
    if (range && !range.collapsed && root?.contains(range.startContainer))
      selectionHint = range.cloneRange();
    if (Panel) {
      open = true;
      return;
    }
    loading = true;
    failed = false;
    try {
      const module = await import('./audiobook-panel.svelte');
      if (disposed) return;
      Panel = module.default;
      open = true;
    } catch {
      if (!disposed) failed = true;
    } finally {
      if (!disposed) loading = false;
    }
  }
</script>

<button
  bind:this={trigger}
  type="button"
  class="flex size-11 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
  aria-label={loading ? 'Loading audio…' : failed ? 'Retry audiobook' : 'Audiobook'}
  aria-haspopup="dialog"
  aria-expanded={open}
  aria-busy={loading}
  disabled={loading}
  on:click={show}
  title={failed
    ? 'Could not load the audiobook player. Select to retry.'
    : 'Local audiobook and subtitle playback'}
  >{#if loading}<SpinnerGap class="size-5 animate-spin" aria-hidden="true" />{:else}<Headphones
      class="size-5"
      aria-hidden="true"
    />{/if}</button
>
{#if failed}<span class="sr-only" role="alert"
    >The audiobook player could not be loaded. Try again.</span
  >{/if}

{#if Panel}
  <svelte:component
    this={Panel}
    bind:open
    {bookId}
    {bookTitle}
    {htmlContent}
    {contentRoot}
    {layoutKey}
    {bookmarkManager}
    {onFollow}
    bind:selectionHint
    returnFocus={() => trigger?.focus()}
  />
{/if}
