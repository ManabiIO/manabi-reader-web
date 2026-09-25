<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { CaretLeft, CaretRight, X } from 'phosphor-svelte';

  export let enabled = false;
  export let contentEl: HTMLElement | undefined;
  export let verticalMode = false;
  export let visibleLines: 1 | 3 = 1;
  export let dimming = 0.28;
  export let epoch = 0;

  let lines: DOMRect[] = [];
  let active = 0;
  let aperture: DOMRect | undefined;
  let observer: ResizeObserver | undefined;
  let frame = 0;
  let observedScrollHost: HTMLElement | undefined;

  $: if (contentEl !== observedScrollHost) {
    observedScrollHost?.removeEventListener('scroll', schedule);
    observedScrollHost = contentEl;
    observedScrollHost?.addEventListener('scroll', schedule, { passive: true });
  }

  $: if (enabled && contentEl && epoch >= 0) {
    observer?.disconnect();
    observer = new ResizeObserver(schedule);
    observer.observe(contentEl);
    schedule();
  }
  $: if (!enabled) {
    observer?.disconnect();
    aperture = undefined;
  }

  onMount(() => {
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    window.visualViewport?.addEventListener('resize', schedule, { passive: true });
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
    };
  });
  onDestroy(() => {
    observedScrollHost?.removeEventListener('scroll', schedule);
    observer?.disconnect();
    cancelAnimationFrame(frame);
  });

  function schedule() {
    if (!enabled || !contentEl) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(measure);
  }

  function measure() {
    if (!contentEl || !enabled) return;
    const candidates: { rect: DOMRect; vertical: boolean }[] = [];
    const modes = new WeakMap<Element, boolean>();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const ownerDocument = contentEl.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    if (!ownerWindow) return;
    const frameRect = ownerWindow.frameElement?.getBoundingClientRect();
    const offsetLeft = frameRect?.left ?? 0;
    const offsetTop = frameRect?.top ?? 0;
    const roots = Array.from(contentEl.children).filter((element) => {
      const rect = element.getBoundingClientRect();
      const left = rect.left + offsetLeft;
      const right = rect.right + offsetLeft;
      const top = rect.top + offsetTop;
      const bottom = rect.bottom + offsetTop;
      return right > 0 && left < viewport.width && bottom > 0 && top < viewport.height;
    });
    for (const root of roots) {
      const walker = ownerDocument.createTreeWalker(root, 4);
      let node: Node | null;
      let inspected = 0;
      while ((node = walker.nextNode()) && inspected++ < 4000) {
        if (!node.textContent?.trim()) continue;
        const parent = node.parentElement;
        if (
          !parent ||
          parent.closest('script,style,template,rt,rp,rtc,[hidden],[aria-hidden="true"]')
        )
          continue;
        let vertical = modes.get(parent);
        if (vertical === undefined) {
          const writingMode = ownerWindow.getComputedStyle(parent).writingMode;
          vertical = writingMode.startsWith('vertical') || writingMode.startsWith('sideways');
          modes.set(parent, vertical);
        }
        const range = ownerDocument.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.width < 1 || rect.height < 1) continue;
          const left = rect.left + offsetLeft;
          const top = rect.top + offsetTop;
          const right = rect.right + offsetLeft;
          const bottom = rect.bottom + offsetTop;
          if (right <= 0 || left >= viewport.width || bottom <= 0 || top >= viewport.height)
            continue;
          candidates.push({
            rect: new DOMRect(left, top, rect.width, rect.height),
            vertical
          });
          if (candidates.length >= 600) break;
        }
        if (candidates.length >= 600) break;
      }
      if (candidates.length >= 600) break;
    }
    if (!candidates.length) {
      aperture = undefined;
      return;
    }
    const groups: { rects: DOMRect[]; vertical: boolean; start: number; end: number }[] = [];
    for (const { rect, vertical } of candidates) {
      const start = vertical ? rect.left : rect.top;
      const end = vertical ? rect.right : rect.bottom;
      const group = groups.find(
        (item) =>
          item.vertical === vertical &&
          Math.min(item.end, end) - Math.max(item.start, start) >=
            Math.min(item.end - item.start, end - start) * 0.35
      );
      if (group) {
        group.rects.push(rect);
        group.start = Math.min(group.start, start);
        group.end = Math.max(group.end, end);
      } else groups.push({ rects: [rect], vertical, start, end });
    }
    lines = groups
      .map((group) => union(group.rects))
      .sort((a, b) => (verticalMode ? b.right - a.right : a.top - b.top));
    const center = verticalMode ? viewport.width / 2 : viewport.height / 2;
    active = Math.min(Math.max(active, 0), lines.length - 1);
    if (!aperture) {
      active = lines.reduce((best, line, index) => {
        const axis = verticalMode ? (line.left + line.right) / 2 : (line.top + line.bottom) / 2;
        const prior = lines[best];
        const priorAxis = verticalMode
          ? (prior.left + prior.right) / 2
          : (prior.top + prior.bottom) / 2;
        return Math.abs(axis - center) < Math.abs(priorAxis - center) ? index : best;
      }, 0);
    }
    updateAperture();
  }

  function updateAperture() {
    if (!lines.length) return;
    const half = Math.floor(visibleLines / 2);
    aperture = union(
      lines.slice(Math.max(0, active - half), Math.min(lines.length, active + half + 1))
    );
  }

  function move(direction: -1 | 1) {
    active = Math.min(Math.max(active + direction, 0), lines.length - 1);
    updateAperture();
  }

  function union(rects: DOMRect[]): DOMRect {
    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    const right = Math.max(...rects.map((rect) => rect.right));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    return new DOMRect(left, top, right - left, bottom - top);
  }
</script>

{#if enabled}
  {#if aperture}
    {@const padding = 5}
    <div
      class="guide-dim"
      style:height={`${Math.max(0, aperture.top - padding)}px`}
      style:--guide-dim={dimming}
    ></div>
    <div
      class="guide-dim"
      style:top={`${aperture.bottom + padding}px`}
      style:--guide-dim={dimming}
    ></div>
    <div
      class="guide-dim"
      style:top={`${Math.max(0, aperture.top - padding)}px`}
      style:bottom={`${Math.max(0, innerHeight - aperture.bottom - padding)}px`}
      style:width={`${Math.max(0, aperture.left - padding)}px`}
      style:--guide-dim={dimming}
    ></div>
    <div
      class="guide-dim"
      style:top={`${Math.max(0, aperture.top - padding)}px`}
      style:bottom={`${Math.max(0, innerHeight - aperture.bottom - padding)}px`}
      style:left={`${aperture.right + padding}px`}
      style:--guide-dim={dimming}
    ></div>
  {/if}
  <div
    class="guide-controls writing-horizontal-tb fixed bottom-4 left-4 z-20 flex items-center gap-1 rounded-full border border-border bg-background p-1 shadow-sm"
  >
    <Button
      variant="ghost"
      size="icon"
      class="size-11"
      aria-label="Previous line"
      disabled={!lines.length || active === 0}
      onclick={() => move(-1)}><CaretLeft aria-hidden="true" /></Button
    >
    <span class="min-w-14 text-center text-xs text-muted-foreground"
      >Line {lines.length ? active + 1 : 0}</span
    >
    <Button
      variant="ghost"
      size="icon"
      class="size-11"
      aria-label="Next line"
      disabled={!lines.length || active === lines.length - 1}
      onclick={() => move(1)}><CaretRight aria-hidden="true" /></Button
    >
    <Button
      variant="ghost"
      class="min-h-11 px-3 text-xs"
      aria-label="Visible lines"
      onclick={() => {
        visibleLines = visibleLines === 1 ? 3 : 1;
        updateAperture();
      }}>{visibleLines} {visibleLines === 1 ? 'line' : 'lines'}</Button
    >
    <label class="sr-only" for="line-guide-dimming">Line Guide dimming</label>
    <input
      id="line-guide-dimming"
      class="w-16 accent-primary"
      type="range"
      min="0.1"
      max="0.6"
      step="0.05"
      bind:value={dimming}
      aria-label="Line Guide dimming"
    />
    <Button
      variant="ghost"
      size="icon"
      class="size-11"
      aria-label="Close Line Guide"
      onclick={() => (enabled = false)}><X aria-hidden="true" /></Button
    >
  </div>
{/if}

<style>
  .guide-dim {
    position: fixed;
    inset: 0;
    z-index: 11;
    pointer-events: none;
    background: rgb(0 0 0 / var(--guide-dim));
  }
  @media (forced-colors: active) {
    .guide-dim {
      background: transparent;
      border: 2px solid Highlight;
    }
  }
</style>
