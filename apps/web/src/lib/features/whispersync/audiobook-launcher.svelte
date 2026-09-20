<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { BookmarkManager } from '$lib/components/book-reader/types'

  export let bookId: number
  export let bookTitle: string
  export let htmlContent: string
  export let layoutKey: string | number
  export let bookmarkManager: BookmarkManager | undefined
  export let onFollow: () => void

  let Panel: typeof import('./audiobook-panel.svelte').default | undefined
  let open = false
  let loading = false
  let failed = false
  let disposed = false
  let trigger: HTMLButtonElement
  let selectionHint: Range | undefined

  onDestroy(() => { disposed = true })

  async function show() {
    if (loading) return
    const selection = window.getSelection()
    const root = document.querySelector('.book-content')
    if (selection?.rangeCount && !selection.isCollapsed && root?.contains(selection.getRangeAt(0).startContainer)) {
      selectionHint = selection.getRangeAt(0).cloneRange()
    }
    if (Panel) { open = true; return }
    loading = true
    failed = false
    try {
      const module = await import('./audiobook-panel.svelte')
      if (disposed) return
      Panel = module.default
      open = true
    } catch {
      if (!disposed) failed = true
    } finally {
      if (!disposed) loading = false
    }
  }
</script>

<button
  bind:this={trigger}
  data-ui-overlay="audiobook-launcher"
  type="button"
  class="h-full px-2"
  aria-haspopup="dialog"
  aria-expanded={open}
  aria-busy={loading}
  disabled={loading}
  on:click={show}
  title={failed ? 'Could not load the audiobook player. Select to retry.' : 'Local audiobook and subtitle playback'}
>{loading ? 'Loading audio…' : failed ? 'Retry audiobook' : 'Audiobook'}</button>
{#if failed}<span class="sr-only" role="alert">The audiobook player could not be loaded. Try again.</span>{/if}

{#if Panel}
  <svelte:component
    this={Panel}
    bind:open
    {bookId}
    {bookTitle}
    {htmlContent}
    {layoutKey}
    {bookmarkManager}
    {onFollow}
    {selectionHint}
    returnFocus={() => trigger?.focus()}
  />
{/if}
