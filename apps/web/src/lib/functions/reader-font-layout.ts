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
  const trackedFaces = new Set<FontFace>();
  const trackLoadingFaces = () => {
    if (!fonts || disposed) return;
    fonts.forEach((face) => {
      if (face.status !== 'loading' || trackedFaces.has(face)) return;
      trackedFaces.add(face);
      // Safari/WebKit can leave FontFaceSet.ready/status or loadingdone stuck
      // while the selected face itself completes. Follow the used face directly.
      void face.loaded.then(settle, settle);
    });
  };
  const onLoading = () => {
    trackLoadingFaces();
    queueMicrotask(trackLoadingFaces);
  };
  fonts?.addEventListener('loading', onLoading);
  fonts?.addEventListener('loadingdone', settle);
  fonts?.addEventListener('loadingerror', settle);
  // Flush the applied styles before sampling ready and the faces it triggered.
  element.getBoundingClientRect();
  trackLoadingFaces();
  if (fonts) void fonts.ready.then(settle, settle);
  else settle();
  return () => {
    disposed = true;
    clearTimeout(timer);
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    fonts?.removeEventListener('loading', onLoading);
    fonts?.removeEventListener('loadingdone', settle);
    fonts?.removeEventListener('loadingerror', settle);
  };
}
