/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Keep enough room for at least one enlarged control between pinned bars. */
export function stickyPanelInsets(height: number, header: number, footer: number) {
  const top = Math.max(0, header);
  const bottom = Math.max(0, footer);
  const enabled = [height, top, bottom].every(Number.isFinite) && height - top - bottom >= 160;
  return { enabled, top: enabled ? top + 8 : 8, bottom: enabled ? bottom + 8 : 8 };
}

/** One scroll owner, with measured occlusion insets instead of a nested flex scroller.
 * Falls back to normal document flow when enlarged chrome would consume the viewport. */
export function stickyPanel(node: HTMLElement) {
  const scroll = node.closest<HTMLElement>(
    '[data-slot="sheet-content"], [data-slot="dialog-content"]'
  );
  const header = node.querySelector<HTMLElement>('[data-sticky-header]');
  const footer = node.querySelector<HTMLElement>('[data-sticky-footer]');
  if (!scroll || !header || !footer) return {};
  const originalTop = scroll.style.scrollPaddingTop;
  const originalBottom = scroll.style.scrollPaddingBottom;
  let appliedTop = '';
  let appliedBottom = '';
  let frame = 0;
  let disposed = false;

  function reveal(target: HTMLElement) {
    if (!scroll || header?.contains(target) || footer?.contains(target)) return;
    const visible = scroll.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    const top = visible.top + scroll.clientTop + parseFloat(appliedTop);
    const bottom = visible.top + scroll.clientTop + scroll.clientHeight - parseFloat(appliedBottom);
    // Prefer the start of a control taller than the usable area. Never oscillate
    // trying to make both ends of an oversized textarea visible at the same time.
    if (rect.top < top) scroll.scrollTop += rect.top - top;
    else if (rect.bottom > bottom)
      scroll.scrollTop += rect.height > bottom - top ? rect.top - top : rect.bottom - bottom;
  }

  function measure() {
    frame = 0;
    if (disposed || !scroll || !header || !footer || !node.isConnected) return;
    const insets = stickyPanelInsets(scroll.clientHeight, header.offsetHeight, footer.offsetHeight);
    node.dataset.stickyChrome = String(insets.enabled);
    appliedTop = `${insets.top}px`;
    appliedBottom = `${insets.bottom}px`;
    scroll.style.scrollPaddingTop = appliedTop;
    scroll.style.scrollPaddingBottom = appliedBottom;
    const focused = node.ownerDocument.activeElement;
    if (focused instanceof HTMLElement && node.contains(focused)) reveal(focused);
  }

  function schedule() {
    if (disposed) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(measure);
  }

  function focused(event: FocusEvent) {
    if (!(event.target instanceof HTMLElement)) return;
    // Run after the browser's native focus scroll, not before it.
    schedule();
  }

  const observer = new ResizeObserver(schedule);
  observer.observe(scroll);
  observer.observe(header);
  observer.observe(footer);
  node.addEventListener('focusin', focused);
  measure();
  return {
    destroy() {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      node.removeEventListener('focusin', focused);
      delete node.dataset.stickyChrome;
      if (scroll.style.scrollPaddingTop === appliedTop) scroll.style.scrollPaddingTop = originalTop;
      if (scroll.style.scrollPaddingBottom === appliedBottom)
        scroll.style.scrollPaddingBottom = originalBottom;
    }
  };
}
