/** @license BSD-3-Clause */
/** A search source owns its timer, cancellation and publication lifetime. */
export function queryTask(receive) {
  let generation = 0;
  let timer;
  let controller;
  let cleanup;
  function stop() {
    generation++;
    clearTimeout(timer);
    controller?.abort();
    cleanup?.();
    cleanup = undefined;
  }
  function start(work, delay = 100) {
    stop();
    const admitted = generation;
    const active = (controller = new AbortController());
    const publish = (state) => {
      if (admitted === generation && !active.signal.aborted) receive(state);
    };
    publish({ state: 'loading' });
    timer = setTimeout(async () => {
      try {
        const dispose = await work(active.signal, publish);
        if (typeof dispose === 'function') {
          if (admitted !== generation || active.signal.aborted) dispose();
          else cleanup = dispose;
        }
      } catch (error) {
        if (!active.signal.aborted)
          publish({
            state: 'error',
            error: error instanceof Error ? error.message : 'Search could not finish.'
          });
      }
    }, delay);
  }
  return { start, stop };
}
