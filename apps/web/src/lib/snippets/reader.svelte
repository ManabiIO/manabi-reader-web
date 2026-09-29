<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { readerHTML } from './presentation';
  import {
    displayTitle,
    passages,
    resolveLocator,
    type SnippetDocument,
    type SnippetLocator
  } from './document';
  import { saveProgress, syncReading, touchReading } from './reading-state';
  import { getRecord } from './database';
  import type { SnippetScope } from './scope';
  export let document: SnippetDocument;
  export let selectedScope: SnippetScope;
  export let locator: SnippetLocator | undefined = undefined;
  /** Explicit search/navigation locators must not be replaced by background reading-state hydration. */
  export let followRemotePosition = true;
  let host: HTMLElement,
    notice = '',
    fontSize = 20,
    vertical = false,
    ready = false,
    pendingPosition: SnippetLocator | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    intentTimer: ReturnType<typeof setTimeout> | undefined,
    appliedLocator = '',
    committedLocator = '',
    userScrollIntent = false,
    mountedAlive = false,
    restoreGeneration = 0,
    hydrating = false,
    lastHydration = 0;
  $: html = readerHTML(document.content);
  $: incomingLocator = locator ? JSON.stringify(locator) : '';
  // The signature equality guard stops restoration from re-entering this block.
  /* eslint-disable svelte/infinite-reactive-loop */
  $: if (ready && incomingLocator && incomingLocator !== appliedLocator) {
    // A newer remote cursor must not yank the view while the user is actively
    // scrolling. Their next durable position becomes authoritative instead.
    if (userScrollIntent || pendingPosition || incomingLocator === committedLocator)
      appliedLocator = incomingLocator;
    else void restore(locator, incomingLocator, followRemotePosition);
  }
  const cssEscape = (id: string) => CSS.escape(id);
  const locatorSignature = (value: SnippetLocator | undefined) =>
    value ? JSON.stringify(value) : '';

  async function restore(
    value: SnippetLocator | undefined,
    signature = locatorSignature(value),
    respectUserIntent = false
  ) {
    if (!value || !host) return;
    const generation = ++restoreGeneration;
    await tick();
    if (
      !mountedAlive ||
      generation !== restoreGeneration ||
      !host ||
      (respectUserIntent && (userScrollIntent || pendingPosition))
    )
      return;
    const resolved = resolveLocator(document, value);
    host
      .querySelectorAll('.snippet-match')
      .forEach((node) => node.classList.remove('snippet-match'));
    appliedLocator = signature;
    userScrollIntent = false;
    pendingPosition = undefined;
    clearTimeout(timer);
    clearTimeout(intentTimer);
    if (resolved) {
      const target = host.querySelector<HTMLElement>(`[data-id="${cssEscape(resolved.blockId)}"]`);
      target?.scrollIntoView({ block: 'center' });
      target?.classList.add('snippet-match');
      notice = '';
    } else notice = 'The saved passage changed. Showing the current snippet instead.';
  }
  /* eslint-enable svelte/infinite-reactive-loop */

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
          title: displayTitle(document),
          item: `snippet:${document.id}`,
          url: window.location.href,
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
    pendingPosition = {
      blockId: block.blockId,
      quote: block.text.slice(0, 80),
      before: '',
      offset: 0,
      revision: document.revision
    };
  }
  function commitPosition() {
    const value = pendingPosition;
    pendingPosition = undefined;
    userScrollIntent = false;
    clearTimeout(intentTimer);
    if (value) {
      // Keep the old parent locator acknowledged until the local write reaches
      // the summary. Otherwise it can be restored between commit and that write.
      committedLocator = locatorSignature(value);
      void saveProgress(document.id, value, selectedScope).catch(() => undefined);
    }
  }
  function schedule() {
    // Programmatic scrollIntoView, layout changes and resize restoration are not
    // reading intent. A user input must arm position capture first.
    if (!userScrollIntent) return;
    position();
    if (!pendingPosition) return;
    clearTimeout(timer);
    timer = setTimeout(commitPosition, 600);
  }
  function markUserScrollIntent(event: Event) {
    if (!ready) return;
    if (event instanceof KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('button,input,textarea,select,[contenteditable="true"]')
      )
        return;
      if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key))
        return;
    }
    if (event instanceof PointerEvent && event.target !== host) return;
    userScrollIntent = true;
    clearTimeout(intentTimer);
    // A gesture at the scroll boundary may never emit scroll. Do not let it
    // suppress remote hydration for the rest of this reader session.
    intentTimer = setTimeout(() => {
      if (!pendingPosition) userScrollIntent = false;
    }, 1200);
  }
  async function hydrateRemotePosition(force = false) {
    if (
      hydrating ||
      !mountedAlive ||
      !ready ||
      !followRemotePosition ||
      userScrollIntent ||
      pendingPosition ||
      (!force && Date.now() - lastHydration < 60_000)
    )
      return;
    hydrating = true;
    lastHydration = Date.now();
    try {
      await syncReading(document.id, selectedScope);
      selectedScope.guard();
      const latest = await getRecord(selectedScope.owner, document.id);
      selectedScope.guard();
      if (
        !mountedAlive ||
        !followRemotePosition ||
        userScrollIntent ||
        pendingPosition ||
        !latest?.progress
      )
        return;
      const signature = locatorSignature(latest.progress);
      if (signature !== appliedLocator) await restore(latest.progress, signature, true);
    } catch {
      // Retain the current view. Online/focus or an explicit refresh can retry.
    } finally {
      hydrating = false;
    }
  }
  onMount(() => {
    mountedAlive = true;
    void restore(locator).then(() => {
      if (!mountedAlive) return;
      void touchReading(document.id, selectedScope).catch(() => undefined);
      ready = true;
      // loadRoute already attempted a remote refresh; avoid immediately duplicating it.
      lastHydration = Date.now();
    });
    const onOnline = () => void hydrateRemotePosition(true);
    const onFocus = () => void hydrateRemotePosition(false);
    window.addEventListener('scroll', schedule, { passive: true });
    host.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('wheel', markUserScrollIntent, { passive: true });
    window.addEventListener('touchstart', markUserScrollIntent, { passive: true });
    window.addEventListener('keydown', markUserScrollIntent);
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onFocus);
    host.addEventListener('pointerdown', markUserScrollIntent, { passive: true });
    return () => {
      mountedAlive = false;
      restoreGeneration++;
      clearTimeout(timer);
      clearTimeout(intentTimer);
      commitPosition(); // Keep the last deliberate scroll when the reader closes before the debounce.
      window.removeEventListener('scroll', schedule);
      host?.removeEventListener('scroll', schedule);
      window.removeEventListener('wheel', markUserScrollIntent);
      window.removeEventListener('touchstart', markUserScrollIntent);
      window.removeEventListener('keydown', markUserScrollIntent);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onFocus);
      host?.removeEventListener('pointerdown', markUserScrollIntent);
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
