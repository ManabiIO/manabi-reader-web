<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { readerHTML } from './presentation';
  import { passages, resolveLocator, type SnippetDocument, type SnippetLocator } from './document';
  import { saveProgress, touchReading } from './reading-state';
  import type { SnippetScope } from './scope';
  export let document: SnippetDocument;
  export let selectedScope: SnippetScope;
  export let locator: SnippetLocator | undefined = undefined;
  let host: HTMLElement,
    notice = '',
    fontSize = 20,
    vertical = false,
    ready = false,
    pendingPosition: SnippetLocator | undefined,
    timer: ReturnType<typeof setTimeout> | undefined;
  $: html = readerHTML(document.content);
  const cssEscape = (id: string) => CSS.escape(id);
  function capture() {
    selectedScope.guard();
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!host.contains(range.commonAncestorContainer)) return;
    const fragment = range.cloneContents();
    const wrapper = window.document.createElement('div');
    wrapper.append(fragment);
    window.dispatchEvent(
      new CustomEvent('manabi-capture-snippet', {
        detail: {
          html: wrapper.innerHTML,
          title: document.title.text,
          item: `snippet:${document.id}`,
          owner: selectedScope.owner === 'local' ? null : selectedScope.owner.slice(8)
        }
      })
    );
  }
  function position() {
    if (!host || !ready) return;
    const blocks = passages(document.content),
      candidates = Array.from(
        host.querySelectorAll<HTMLElement>(
          'p[data-id],h1[data-id],h2[data-id],h3[data-id],h4[data-id],h5[data-id],h6[data-id],pre[data-id]'
        )
      );
    const at =
      candidates.find((node) => {
        const r = node.getBoundingClientRect();
        const frame = host.getBoundingClientRect();
        return vertical
          ? r.right > Math.max(0, frame.left) && r.left < Math.min(innerWidth, frame.right)
          : r.bottom > 80 && r.top < innerHeight;
      }) ?? candidates[0];
    const block = blocks.find((x) => x.blockId === at?.dataset.id);
    if (!block) return;
    const value: SnippetLocator = {
      blockId: block.blockId,
      quote: block.text.slice(0, 80),
      before: '',
      offset: 0,
      revision: document.revision
    };
    pendingPosition = value;
  }
  function commitPosition() {
    const value = pendingPosition;
    pendingPosition = undefined;
    if (value) void saveProgress(document.id, value, selectedScope).catch(() => undefined);
  }
  function schedule() {
    position();
    clearTimeout(timer);
    timer = setTimeout(commitPosition, 600);
  }
  onMount(() => {
    let alive = true;
    void tick().then(() => {
      if (!alive) return;
      const resolved = locator ? resolveLocator(document, locator) : null;
      if (resolved) {
        const target = host.querySelector<HTMLElement>(
          `[data-id="${cssEscape(resolved.blockId)}"]`
        );
        target?.scrollIntoView({ block: 'center' });
        target?.classList.add('snippet-match');
      } else if (locator)
        notice = 'The saved passage changed. Showing the current snippet instead.';
      void touchReading(document.id, selectedScope).catch(() => undefined);
      ready = true; // Do not overwrite the saved position merely by opening a result or resizing.
    });
    window.addEventListener('scroll', schedule, { passive: true });
    host.addEventListener('scroll', schedule, { passive: true });
    return () => {
      alive = false;
      clearTimeout(timer);
      commitPosition(); // Keep the last deliberate scroll when the reader closes before the debounce.
      window.removeEventListener('scroll', schedule);
      host?.removeEventListener('scroll', schedule);
    };
  });
</script>

<div class="reading-tools" role="toolbar" aria-label="Snippet reading controls">
  <Button
    variant="ghost"
    size="sm"
    onclick={() => (fontSize = Math.max(14, fontSize - 2))}
    aria-label="Smaller text">A−</Button
  >
  <Button
    variant="ghost"
    size="sm"
    onclick={() => (fontSize = Math.min(36, fontSize + 2))}
    aria-label="Larger text">A+</Button
  >
  <Button variant="ghost" size="sm" aria-pressed={vertical} onclick={() => (vertical = !vertical)}
    >Vertical reading</Button
  >
  <Button variant="ghost" size="sm" onclick={capture}>Save selection to snippet…</Button>
</div>
{#if notice}<p role="status">{notice}</p>{/if}
<article
  bind:this={host}
  class:vertical
  lang="ja"
  class="snippet-reading"
  style:font-size={`${fontSize}px`}
  aria-label="Snippet content"
>
  <!-- The closed document renderer escapes every text/attribute and admits only schema-owned tags. -->
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html html}
</article>

<style>
  .reading-tools {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    padding-block: 0.6rem;
    border-block: 1px solid var(--border);
  }
  .snippet-reading {
    max-width: 38em;
    margin: 1.5rem auto;
    line-height: 2.05;
    overflow-wrap: anywhere;
    font-family: var(--reader-font-family, serif);
  }
  .snippet-reading.vertical {
    writing-mode: vertical-rl;
    height: min(68vh, 40rem);
    max-width: 100%;
    overflow: auto;
    margin-inline: auto;
  }
  .snippet-reading :global(p) {
    margin-block: 0.8em;
  }
  .snippet-reading :global(h1),
  .snippet-reading :global(h2),
  .snippet-reading :global(h3) {
    font-size: 1.4em;
    font-weight: 650;
    margin-block: 1em 0.5em;
  }
  .snippet-reading :global(ul),
  .snippet-reading :global(ol) {
    padding-inline-start: 1.5em;
  }
  .snippet-reading :global(ul) {
    list-style: disc;
  }
  .snippet-reading :global(ol) {
    list-style: decimal;
  }
  .snippet-reading :global(blockquote) {
    padding-inline-start: 1em;
    border-inline-start: 3px solid var(--border);
  }
  .snippet-reading :global(rt) {
    font-size: 0.5em;
  }
  .snippet-reading :global(pre) {
    white-space: pre-wrap;
    padding: 1em;
    background: var(--muted);
    border-radius: 0.5rem;
  }
  .snippet-reading :global(a) {
    text-decoration: underline;
  }
  .snippet-reading :global(.snippet-match) {
    background: var(--muted);
    outline: 1px solid var(--border);
    border-radius: 0.35em;
  }
  .snippet-reading :global(hr) {
    border-color: var(--border);
    margin-block: 1em;
  }
</style>
