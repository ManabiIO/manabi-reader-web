/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Notify layout after the browser settles fonts actually used by this document.
 * No font enumeration, synthetic probe text, or eager loading of fallback faces.
 * The deadline keeps reading usable on a slow/unavailable font host. A later
 * font completion can notify again, but teardown invalidates every queued callback.
 */
export function observeReaderFontLayout(
  element: HTMLElement,
  notify: () => void,
  deadlineMs = 1500
): () => void {
  const document = element.ownerDocument;
  const view = document.defaultView;
  if (!view) return () => {};
  let disposed = false;
  let frame: number | undefined;
  const settle = () => {
    if (disposed) return;
    clearTimeout(timer);
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    frame = view.requestAnimationFrame(() => {
      frame = undefined;
      if (!disposed && element.isConnected) notify();
    });
  };
  const timer = setTimeout(settle, deadlineMs);
  const fonts = document.fonts;
  fonts?.addEventListener('loadingdone', settle);
  fonts?.addEventListener('loadingerror', settle);
  // Flush the applied styles before sampling ready; a stale ready promise taken
  // before layout may precede the font requests for the new book section.
  element.getBoundingClientRect();
  if (fonts) void fonts.ready.then(settle, settle);
  else settle();
  return () => {
    disposed = true;
    clearTimeout(timer);
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    fonts?.removeEventListener('loadingdone', settle);
    fonts?.removeEventListener('loadingerror', settle);
  };
}
