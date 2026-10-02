/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  groupLineRects,
  visibleLineRects,
  type MeasuredLine,
  type LineRect
} from '../lib/components/book-reader/line-guide-geometry';
import { ReaderController } from './controller';
export interface LineGuideProps {
  enabled?: boolean;
  contentEl: HTMLElement | undefined;
  verticalMode?: boolean;
  visibleLines?: 1 | 3;
  dimming?: number;
  epoch?: number;
}

export function createLineGuide(
  props: LineGuideProps,
  emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();

  let enabled = props.enabled !== undefined ? props.enabled : false;
  let contentEl: HTMLElement | undefined = props.contentEl;
  let verticalMode = props.verticalMode !== undefined ? props.verticalMode : false;
  let visibleLines: 1 | 3 = props.visibleLines !== undefined ? props.visibleLines : 1;
  let dimming = props.dimming !== undefined ? props.dimming : 0.28;
  let epoch = props.epoch !== undefined ? props.epoch : 0;
  let lines: DOMRect[] = [];
  let measuredLines: MeasuredLine[] = [];
  let active = 0;
  let aperture: DOMRect | undefined;
  let observer: ResizeObserver | undefined;
  let frame = 0;
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
    () => [enabled, contentEl, epoch],
    () => {
      if (enabled && contentEl && epoch >= 0) {
        observer?.disconnect();
        __readerController.changed((observer = new ResizeObserver(schedule)));
        observer.observe(contentEl);
        schedule();
      }
    }
  );
  __readerController.effect(
    () => [enabled, observer],
    () => {
      if (!enabled) {
        observer?.disconnect();
        __readerController.changed((aperture = undefined));
      }
    }
  );
  __readerController.onMount(() => {
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    window.visualViewport?.addEventListener('resize', schedule, { passive: true });
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
    };
  });
  __readerController.onDestroy(() => {
    observedScrollHost?.removeEventListener('scroll', schedule);
    observer?.disconnect();
    cancelAnimationFrame(frame);
  });
  function schedule() {
    if (!enabled || !contentEl) return;
    cancelAnimationFrame(frame);
    __readerController.changed((frame = requestAnimationFrame(measure)));
  }
  function measure() {
    if (!contentEl || !enabled) return;
    const candidates: {
      rect: DOMRect;
      vertical: boolean;
    }[] = [];
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
      __readerController.changed((aperture = undefined));
      return;
    }
    __readerController.changed((measuredLines = groupLineRects(candidates)));
    __readerController.changed(
      (lines = measuredLines.map(
        ({ rect }) =>
          new DOMRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top)
      ))
    );
    const center = verticalMode ? viewport.width / 2 : viewport.height / 2;
    __readerController.changed((active = Math.min(Math.max(active, 0), lines.length - 1)));
    if (!aperture) {
      __readerController.changed(
        (active = lines.reduce((best, line, index) => {
          const axis = verticalMode ? (line.left + line.right) / 2 : (line.top + line.bottom) / 2;
          const prior = lines[best];
          const priorAxis = verticalMode
            ? (prior.left + prior.right) / 2
            : (prior.top + prior.bottom) / 2;
          return Math.abs(axis - center) < Math.abs(priorAxis - center) ? index : best;
        }, 0))
      );
    }
    updateAperture();
  }
  function updateAperture() {
    if (!lines.length) return;
    __readerController.changed(
      (aperture = union(visibleLineRects(measuredLines, active, visibleLines)))
    );
  }
  function move(direction: -1 | 1) {
    __readerController.changed(
      (active = Math.min(Math.max(active + direction, 0), lines.length - 1))
    );
    updateAperture();
  }
  function union(rects: LineRect[]): DOMRect {
    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    const right = Math.max(...rects.map((rect) => rect.right));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    return new DOMRect(left, top, right - left, bottom - top);
  }

  const api = {
    controller: __readerController,
    schedule,
    measure,
    updateAperture,
    move,
    union,
    get enabled() {
      return enabled;
    },
    set enabled(nextValue: typeof enabled) {
      if (Object.is(enabled, nextValue)) return;
      enabled = nextValue;
      __readerController.invalidate();
    },
    get contentEl() {
      return contentEl;
    },
    set contentEl(nextValue: typeof contentEl) {
      if (Object.is(contentEl, nextValue)) return;
      contentEl = nextValue;
      __readerController.invalidate();
    },
    get verticalMode() {
      return verticalMode;
    },
    set verticalMode(nextValue: typeof verticalMode) {
      if (Object.is(verticalMode, nextValue)) return;
      verticalMode = nextValue;
      __readerController.invalidate();
    },
    get visibleLines() {
      return visibleLines;
    },
    set visibleLines(nextValue: typeof visibleLines) {
      if (Object.is(visibleLines, nextValue)) return;
      visibleLines = nextValue;
      __readerController.invalidate();
    },
    get dimming() {
      return dimming;
    },
    set dimming(nextValue: typeof dimming) {
      if (Object.is(dimming, nextValue)) return;
      dimming = nextValue;
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
    get lines() {
      return lines;
    },
    set lines(nextValue: typeof lines) {
      if (Object.is(lines, nextValue)) return;
      lines = nextValue;
      __readerController.invalidate();
    },
    get measuredLines() {
      return measuredLines;
    },
    set measuredLines(nextValue: typeof measuredLines) {
      if (Object.is(measuredLines, nextValue)) return;
      measuredLines = nextValue;
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
    get aperture() {
      return aperture;
    },
    set aperture(nextValue: typeof aperture) {
      if (Object.is(aperture, nextValue)) return;
      aperture = nextValue;
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
    get frame() {
      return frame;
    },
    set frame(nextValue: typeof frame) {
      if (Object.is(frame, nextValue)) return;
      frame = nextValue;
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
      if ('enabled' in next) api.enabled = next.enabled as typeof enabled;
      if ('contentEl' in next) api.contentEl = next.contentEl as typeof contentEl;
      if ('verticalMode' in next) api.verticalMode = next.verticalMode as typeof verticalMode;
      if ('visibleLines' in next) api.visibleLines = next.visibleLines as typeof visibleLines;
      if ('dimming' in next) api.dimming = next.dimming as typeof dimming;
      if ('epoch' in next) api.epoch = next.epoch as typeof epoch;
    }
  };
  return api;
}
