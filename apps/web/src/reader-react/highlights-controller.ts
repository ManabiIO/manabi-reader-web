/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { projectResource, rangeAt, resolveLocator, type ReaderLocator } from '$lib/reader-location';
import type { ReaderAnnotation } from '$lib/data/database/books-db/versions/v7/books-db-v7';
import { clipReaderHighlightRect } from '../lib/components/book-reader/reader-highlight-geometry';
import { ReaderController } from './controller';

export interface HighlightsProps {
  contentEl: HTMLElement | undefined;
  annotations?: ReaderAnnotation[];
  active: ReaderLocator | undefined;
  bookKey?: string;
  epoch?: number;
}

export function createHighlights(
  props: HighlightsProps,
  emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();

  let contentEl: HTMLElement | undefined = props.contentEl;
  let annotations: ReaderAnnotation[] = props.annotations !== undefined ? props.annotations : [];
  let active: ReaderLocator | undefined = props.active;
  let bookKey = props.bookKey !== undefined ? props.bookKey : '';
  let epoch = props.epoch !== undefined ? props.epoch : 0;
  type PaintedRange = {
    range: Range;
    kind: 'saved' | 'active';
    color: string;
  };
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
  let turnObserver: MutationObserver | undefined;
  let observedTurnHost: Element | undefined;
  let observedScrollHost: HTMLElement | undefined;
  __readerController.effect(
    () => [contentEl],
    () => {
      if (contentEl !== observedScrollHost) {
        observedScrollHost?.removeEventListener('scroll', schedule);
        __readerController.changed((observedScrollHost = contentEl));
        observedScrollHost?.addEventListener('scroll', schedule, { passive: true });
      }
    }
  );
  __readerController.effect(
    () => [contentEl, bookKey, epoch, annotations, active],
    () => {
      if (contentEl && bookKey && epoch >= 0) {
        annotations;
        active;
        void resolveVisible();
      }
    }
  );
  __readerController.onMount(() => {
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  });
  __readerController.onDestroy(() => {
    __readerController.changed((generation += 1));
    observedScrollHost?.removeEventListener('scroll', schedule);
    observer?.disconnect();
    turnObserver?.disconnect();
    cancelAnimationFrame(frame);
  });
  function observeTurnTransform(range?: Range) {
    const frameElement = range?.startContainer.ownerDocument?.defaultView?.frameElement;
    const root = frameElement?.getRootNode();
    const turnHost =
      root && typeof root === 'object' && 'host' in root ? (root as ShadowRoot).host : undefined;
    if (turnHost === observedTurnHost) return;
    turnObserver?.disconnect();
    __readerController.changed((observedTurnHost = turnHost));
    if (!turnHost) return;
    __readerController.changed((turnObserver = new MutationObserver(schedule)));
    // Foliate publishes one host attribute on every animated page-turn frame.
    // Watching that signal keeps top-level highlight geometry attached to text
    // while its iframe's ancestor sheet is translating.
    turnObserver.observe(turnHost, {
      attributes: true,
      attributeFilter: ['data-turn-progress']
    });
  }
  async function resolveVisible() {
    const host = contentEl;
    if (!host) return;
    const run = __readerController.changed(++generation);
    observer?.disconnect();
    __readerController.changed((observer = new ResizeObserver(schedule)));
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
      const targets: {
        locator: ReaderLocator;
        kind: 'saved' | 'active';
        color: string;
      }[] = [];
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
    __readerController.changed((ranges = resolved));
    observeTurnTransform(resolved[0]?.range);
    schedule();
  }
  function schedule() {
    cancelAnimationFrame(frame);
    __readerController.changed((frame = requestAnimationFrame(paint)));
  }
  function paint() {
    const saved: Box[] = [];
    const activeBoxes: Box[] = [];
    // Resolve the active search/lookup target first so a dense page of saved
    // highlights cannot consume the geometry budget before the user's target.
    const ordered = [
      ...ranges.filter((item) => item.kind === 'active'),
      ...ranges.filter((item) => item.kind === 'saved')
    ];
    let painted = 0;
    for (const item of ordered) {
      const ownerDocument = item.range.startContainer.ownerDocument;
      const frameElement = ownerDocument?.defaultView?.frameElement as HTMLElement | null;
      const frameRect = frameElement?.getBoundingClientRect();
      const offsetLeft = frameRect?.left ?? 0;
      const offsetTop = frameRect?.top ?? 0;
      const hostRect =
        contentEl?.ownerDocument === ownerDocument ? contentEl.getBoundingClientRect() : undefined;
      const target = item.kind === 'active' ? activeBoxes : saved;
      for (const rect of item.range.getClientRects()) {
        const clipped = clipReaderHighlightRect(rect, {
          offsetLeft,
          offsetTop,
          localClip: hostRect,
          outerClip: frameRect,
          viewportWidth: innerWidth,
          viewportHeight: innerHeight
        });
        if (!clipped) continue;
        target.push({ ...clipped, kind: item.kind, color: item.color });
        painted += 1;
        if (painted >= 500) break;
      }
      if (painted >= 500) break;
    }
    // Saved colors are the base layer; active geometry is always last/on top.
    __readerController.changed((boxes = [...saved, ...activeBoxes]));
  }

  const api = {
    controller: __readerController,
    observeTurnTransform,
    resolveVisible,
    schedule,
    paint,
    get contentEl() {
      return contentEl;
    },
    set contentEl(nextValue: typeof contentEl) {
      if (Object.is(contentEl, nextValue)) return;
      contentEl = nextValue;
      __readerController.invalidate();
    },
    get annotations() {
      return annotations;
    },
    set annotations(nextValue: typeof annotations) {
      if (Object.is(annotations, nextValue)) return;
      annotations = nextValue;
      __readerController.invalidate();
    },
    get active() {
      return active;
    },
    set active(nextValue: typeof active) {
      if (Object.is(active, nextValue)) return;
      active = nextValue;
      __readerController.invalidate();
    },
    get bookKey() {
      return bookKey;
    },
    set bookKey(nextValue: typeof bookKey) {
      if (Object.is(bookKey, nextValue)) return;
      bookKey = nextValue;
      __readerController.invalidate();
    },
    get epoch() {
      return epoch;
    },
    set epoch(nextValue: typeof epoch) {
      if (Object.is(epoch, nextValue)) return;
      epoch = nextValue;
      __readerController.invalidate();
    },
    get ranges() {
      return ranges;
    },
    set ranges(nextValue: typeof ranges) {
      if (Object.is(ranges, nextValue)) return;
      ranges = nextValue;
      __readerController.invalidate();
    },
    get boxes() {
      return boxes;
    },
    set boxes(nextValue: typeof boxes) {
      if (Object.is(boxes, nextValue)) return;
      boxes = nextValue;
      __readerController.invalidate();
    },
    get generation() {
      return generation;
    },
    set generation(nextValue: typeof generation) {
      if (Object.is(generation, nextValue)) return;
      generation = nextValue;
      __readerController.invalidate();
    },
    get frame() {
      return frame;
    },
    set frame(nextValue: typeof frame) {
      if (Object.is(frame, nextValue)) return;
      frame = nextValue;
      __readerController.invalidate();
    },
    get observer() {
      return observer;
    },
    set observer(nextValue: typeof observer) {
      if (Object.is(observer, nextValue)) return;
      observer = nextValue;
      __readerController.invalidate();
    },
    get turnObserver() {
      return turnObserver;
    },
    set turnObserver(nextValue: typeof turnObserver) {
      if (Object.is(turnObserver, nextValue)) return;
      turnObserver = nextValue;
      __readerController.invalidate();
    },
    get observedTurnHost() {
      return observedTurnHost;
    },
    set observedTurnHost(nextValue: typeof observedTurnHost) {
      if (Object.is(observedTurnHost, nextValue)) return;
      observedTurnHost = nextValue;
      __readerController.invalidate();
    },
    get observedScrollHost() {
      return observedScrollHost;
    },
    set observedScrollHost(nextValue: typeof observedScrollHost) {
      if (Object.is(observedScrollHost, nextValue)) return;
      observedScrollHost = nextValue;
      __readerController.invalidate();
    },
    updateProps(next: Record<string, unknown>) {
      if ('contentEl' in next) api.contentEl = next.contentEl as typeof contentEl;
      if ('annotations' in next) api.annotations = next.annotations as typeof annotations;
      if ('active' in next) api.active = next.active as typeof active;
      if ('bookKey' in next) api.bookKey = next.bookKey as typeof bookKey;
      if ('epoch' in next) api.epoch = next.epoch as typeof epoch;
    }
  };
  return api;
}
