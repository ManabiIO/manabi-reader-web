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
  let errorPoll: ReturnType<typeof setTimeout> | undefined;
  let errorPollUntil = 0;

  const settle = () => {
    if (disposed) return;
    clearTimeout(deadlineTimer);
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    frame = view.requestAnimationFrame(() => {
      frame = undefined;
      if (!disposed && element.isConnected) notify();
    });
  };

  const deadlineTimer = setTimeout(settle, deadlineMs);
  const fonts = document.fonts;
  const trackedFaces = new Set<FontFace>();
  const transientErrorFaces = new Set<FontFace>();

  const trackLoadingFace = (face: FontFace) => {
    if (trackedFaces.has(face)) return;
    trackedFaces.add(face);
    void face.loaded.then(settle, settle);
  };

  const normalizedFamily = (face: FontFace) => face.family.replace(/^['"]|['"]$/g, '');

  const scheduleTransientErrorPoll = () => {
    if (disposed || errorPoll !== undefined) return;
    errorPollUntil = Math.max(errorPollUntil, Date.now() + Math.max(30000, deadlineMs * 4));
    errorPoll = setTimeout(pollTransientErrors, 100);
  };

  function pollTransientErrors() {
    errorPoll = undefined;
    if (disposed) return;

    let pending = false;
    for (const face of [...transientErrorFaces]) {
      if (face.status === 'loaded') {
        transientErrorFaces.delete(face);
        settle();
      } else if (face.status === 'loading') {
        transientErrorFaces.delete(face);
        trackLoadingFace(face);
      } else if (face.status === 'error') {
        pending = true;
      } else {
        transientErrorFaces.delete(face);
      }
    }

    if (pending && Date.now() < errorPollUntil) {
      errorPoll = setTimeout(pollTransientErrors, 100);
    }
  }

  const trackPendingFaces = () => {
    if (!fonts || disposed) return;
    const activeFamilies = view.getComputedStyle(element).fontFamily;

    fonts.forEach((face) => {
      if (face.status === 'loading') {
        trackLoadingFace(face);
      } else if (
        face.status === 'error' &&
        activeFamilies.includes(normalizedFamily(face))
      ) {
        // WebKit can expose a selected face as "error" while its real HTTP
        // response is still pending, then flip directly to "loaded" without a
        // FontFaceSet loadingdone event. Poll only the family this reader uses;
        // do not load or probe fallback faces.
        transientErrorFaces.add(face);
        scheduleTransientErrorPoll();
      }
    });
  };

  const onLoading = () => {
    trackPendingFaces();
    queueMicrotask(trackPendingFaces);
  };
  const onLoadingError = () => {
    trackPendingFaces();
    settle();
  };

  fonts?.addEventListener('loading', onLoading);
  fonts?.addEventListener('loadingdone', settle);
  fonts?.addEventListener('loadingerror', onLoadingError);

  // Flush the applied styles before sampling ready and the faces it triggered.
  element.getBoundingClientRect();
  trackPendingFaces();
  if (fonts) void fonts.ready.then(settle, settle);
  else settle();

  return () => {
    disposed = true;
    clearTimeout(deadlineTimer);
    if (errorPoll !== undefined) clearTimeout(errorPoll);
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    fonts?.removeEventListener('loading', onLoading);
    fonts?.removeEventListener('loadingdone', settle);
    fonts?.removeEventListener('loadingerror', onLoadingError);
  };
}
