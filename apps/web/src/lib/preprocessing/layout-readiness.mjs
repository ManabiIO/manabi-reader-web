/** @license BSD-3-Clause */
/** Bounded geometry admission for the actual mounted chapter. Failed images
 * count as settled; a stalled image is an opening error, never an endless
 * hidden chapter. Fonts get the same fallback grace as observeReaderFontLayout:
 * an optional/slow font must not prevent reading with the browser's fallback.
 * The renderer keeps observing late font completion and restores its anchor.
 * Every listener/timer belongs to this opening. */
export async function waitForChapterLayout(root, signal, timeoutMs = 15000, fontGraceMs = 1500) {
  signal.throwIfAborted();
  const cleanups = [];
  let timer;
  try {
    const aborted = new Promise((_, reject) => {
      const stop = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', stop, { once: true });
      cleanups.push(() => signal.removeEventListener('abort', stop));
      timer = setTimeout(
        () => reject(new Error('Chapter resources took too long to prepare.')),
        timeoutMs
      );
    });
    const images = Array.from(root.querySelectorAll('img')).filter(
      (image) => image.src && !image.complete
    );
    // Flush newly mounted annotation styles before sampling the font set. Its
    // ready promise can remain pending beyond a successful HTTP response in
    // WebKit; waiting for it without a fallback kept whole chapters inert.
    root.getBoundingClientRect();
    const fonts = root.ownerDocument.fonts;
    const fontReadiness = fonts
      ? new Promise((resolve) => {
          const fallback = setTimeout(resolve, fontGraceMs);
          cleanups.push(() => clearTimeout(fallback));
          void fonts.ready.then(resolve, resolve);
        })
      : Promise.resolve();
    const readiness = Promise.all([
      fontReadiness,
      ...images.map(
        (image) =>
          new Promise((resolve) => {
            const settled = () => resolve();
            image.addEventListener('load', settled, { once: true });
            image.addEventListener('error', settled, { once: true });
            cleanups.push(() => {
              image.removeEventListener('load', settled);
              image.removeEventListener('error', settled);
            });
            if (image.complete) settled();
          })
      )
    ]);
    await Promise.race([readiness, aborted]);
    signal.throwIfAborted();
  } finally {
    clearTimeout(timer);
    for (const cleanup of cleanups) cleanup();
  }
}
