/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Observe width without mutating layout during ResizeObserver delivery.
 * Height-only notifications from a responsive grid must not feed its sizing loop. */
export function observeElementWidth(node: HTMLElement, changed: (width: number) => void) {
  const view = node.ownerDocument.defaultView;
  if (!view) return () => {};
  let frame: number | undefined;
  let lastWidth: number | undefined;
  let disposed = false;

  function measure() {
    frame = undefined;
    if (disposed || !node.isConnected) return;
    const width = node.clientWidth;
    if (width === lastWidth) return;
    lastWidth = width;
    changed(width);
  }

  function schedule() {
    if (disposed || frame !== undefined) return;
    frame = view!.requestAnimationFrame(measure);
  }

  const observer = new ResizeObserver(schedule);
  observer.observe(node);
  schedule();
  return () => {
    disposed = true;
    observer.disconnect();
    if (frame !== undefined) view.cancelAnimationFrame(frame);
  };
}
