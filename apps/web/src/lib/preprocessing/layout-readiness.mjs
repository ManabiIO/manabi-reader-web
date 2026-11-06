/** @license BSD-3-Clause */
/** Bounded geometry admission for the actual mounted chapter. Failed images
 * count as settled; a stalled resource is an opening error, never an endless
 * hidden chapter. Every listener/timer belongs to this opening. */
export async function waitForChapterLayout(root, signal, timeoutMs = 15000) {
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
    const readiness = Promise.all([
      root.ownerDocument.fonts?.ready,
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
