/** @license BSD-3-Clause */
/** A search source owns its timer, cancellation and publication lifetime. */
export function queryTask(receive) {
  let generation = 0;
  let timer;
  let controller;
  let cleanup;
  const retire = (dispose) => {
    try {
      dispose?.();
    } catch {
      // Retirement must not prevent another query or sibling task from stopping.
    }
  };
  function stop() {
    generation++;
    globalThis.clearTimeout(timer);
    const active = controller;
    const dispose = cleanup;
    controller = undefined;
    cleanup = undefined;
    active?.abort();
    retire(dispose);
  }
  function start(work, delay = 100) {
    stop();
    const admitted = generation;
    const active = (controller = new AbortController());
    const publish = (state) => {
      if (admitted === generation && !active.signal.aborted) receive(state);
    };
    publish({ state: 'loading' });
    // A receiver may clear or replace the query while handling loading.
    if (admitted !== generation || active.signal.aborted) return;
    timer = globalThis.setTimeout(async () => {
      if (admitted !== generation || active.signal.aborted) return;
      try {
        const dispose = await work(active.signal, publish);
        if (typeof dispose === 'function') {
          if (admitted !== generation || active.signal.aborted) retire(dispose);
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
