<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    projectResource,
    rangeAt,
    resolveLocator,
    type ReaderLocator
  } from '$lib/reader-location';
  import type { ReaderAnnotation } from '$lib/data/database/books-db/versions/v7/books-db-v7';

  export let contentEl: HTMLElement | undefined;
  export let annotations: ReaderAnnotation[] = [];
  export let active: ReaderLocator | undefined;
  export let bookKey = '';
  export let epoch = 0;

  type PaintedRange = { range: Range; kind: 'saved' | 'active'; color: string };
  type Box = {
    left: number;
    top: number;
    width: number;
    height: number;
    kind: 'saved' | 'active';
    color: string;
  };
  let ranges: PaintedRange[] = [];
  let boxes: Box[] = [];
  let generation = 0;
  let frame = 0;
  let observer: ResizeObserver | undefined;
  let observedScrollHost: HTMLElement | undefined;

  $: if (contentEl !== observedScrollHost) {
    observedScrollHost?.removeEventListener('scroll', schedule);
    observedScrollHost = contentEl;
    observedScrollHost?.addEventListener('scroll', schedule, { passive: true });
  }

  $: if (contentEl && bookKey && epoch >= 0) {
    annotations;
    active;
    void resolveVisible();
  }

  onMount(() => {
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  });
  onDestroy(() => {
    generation += 1;
    observedScrollHost?.removeEventListener('scroll', schedule);
    observer?.disconnect();
    cancelAnimationFrame(frame);
  });

  async function resolveVisible() {
    const host = contentEl;
    if (!host) return;
    const run = ++generation;
    observer?.disconnect();
    observer = new ResizeObserver(schedule);
    observer.observe(host);
    const visible = host.matches('[data-manabi-spine-index]')
      ? host
      : host.querySelector<HTMLElement>('[data-manabi-spine-index]');
    const sections = visible ? [visible] : (Array.from(host.children) as HTMLElement[]);
    const resolved: PaintedRange[] = [];
    for (const section of sections) {
      const spineIndex = visible
        ? Number(section.dataset.manabiSpineIndex)
        : Array.prototype.indexOf.call(host.children, section);
      const targets: { locator: ReaderLocator; kind: 'saved' | 'active'; color: string }[] = [];
      for (const annotation of annotations) {
        if (annotation.deletedAt || annotation.kind === 'bookmark') continue;
        for (const locator of annotation.targets) {
          if (locator.resource.spineIndex === spineIndex)
            targets.push({ locator, kind: 'saved', color: annotation.color ?? 'yellow' });
        }
      }
      if (active?.resource.spineIndex === spineIndex)
        targets.push({ locator: active, kind: 'active', color: 'blue' });
      if (!targets.length) continue;
      const projected = projectResource(section, targets[0].locator.resource);
      for (const target of targets) {
        const offsets = await resolveLocator(target.locator, projected, bookKey);
        if (run !== generation) return;
        if (!offsets) continue;
        const range = rangeAt(projected, offsets.start, offsets.end);
        if (range) resolved.push({ range, kind: target.kind, color: target.color });
      }
    }
    if (run !== generation) return;
    ranges = resolved;
    schedule();
  }

  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(paint);
  }

  function paint() {
    const next: Box[] = [];
    for (const item of ranges) {
      const frameElement = item.range.startContainer.ownerDocument?.defaultView?.frameElement;
      const frameRect = frameElement?.getBoundingClientRect();
      const offsetLeft = frameRect?.left ?? 0;
      const offsetTop = frameRect?.top ?? 0;
      for (const rect of item.range.getClientRects()) {
        const left = rect.left + offsetLeft;
        const top = rect.top + offsetTop;
        const right = rect.right + offsetLeft;
        const bottom = rect.bottom + offsetTop;
        if (
          rect.width < 1 ||
          rect.height < 1 ||
          right <= 0 ||
          bottom <= 0 ||
          left >= innerWidth ||
          top >= innerHeight
        )
          continue;
        next.push({
          left,
          top,
          width: rect.width,
          height: rect.height,
          kind: item.kind,
          color: item.color
        });
        if (next.length >= 500) break;
      }
      if (next.length >= 500) break;
    }
    boxes = next;
  }
</script>

{#each boxes as box}
  <div
    class:active={box.kind === 'active'}
    class="reader-highlight"
    style:left={`${box.left}px`}
    style:top={`${box.top}px`}
    style:width={`${box.width}px`}
    style:height={`${box.height}px`}
    style:--highlight-color={box.color === 'blue'
      ? 'rgba(61, 139, 230, .36)'
      : box.color === 'green'
        ? 'rgba(80, 181, 116, .32)'
        : box.color === 'pink'
          ? 'rgba(226, 103, 151, .31)'
          : box.color === 'purple'
            ? 'rgba(151, 111, 214, .31)'
            : 'rgba(242, 191, 62, .34)'}
    aria-hidden="true"
  ></div>
{/each}

<style>
  .reader-highlight {
    position: fixed;
    z-index: 10;
    pointer-events: none;
    background: var(--highlight-color);
    border-radius: 0.12rem;
    mix-blend-mode: multiply;
  }
  .reader-highlight.active {
    outline: 1px solid rgb(61 139 230 / 0.7);
  }
  @media (forced-colors: active) {
    .reader-highlight {
      background: transparent;
      outline: 2px solid Highlight;
      mix-blend-mode: normal;
    }
  }
</style>
