/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** One page-settlement listener per Contents panel. Dismissal, a newer choice,
 * or teardown revokes both the listener and an already scheduled callback.
 * The reader's existing page-change debounce remains 200ms; this does not
 * claim that an untagged renderer event is a navigation acknowledgement. */
export function createChapterNavigation(
  events: EventTarget,
  eventName: string,
  navigate: (reference: string) => void,
  close: () => void
) {
  let generation = 0;
  let disposed = false;
  let cancelPending: (() => void) | undefined;

  function cancel() {
    generation += 1;
    cancelPending?.();
    cancelPending = undefined;
  }

  function select(reference: string, closeOnArrival: boolean, waitForPageChange: boolean) {
    if (disposed) return;
    cancel();
    const selection = generation;
    if (closeOnArrival && waitForPageChange) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const listener = () => {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => {
          if (disposed || generation !== selection) return;
          cancel();
          close();
        }, 200);
      };
      events.addEventListener(eventName, listener);
      cancelPending = () => {
        events.removeEventListener(eventName, listener);
        if (timer !== undefined) clearTimeout(timer);
      };
    }
    // Enroll before dispatch: a cached chapter can publish synchronously.
    try {
      navigate(reference);
    } catch (error) {
      if (generation === selection) cancel();
      throw error;
    }
    if (closeOnArrival && !waitForPageChange && !disposed && generation === selection) {
      cancel();
      close();
    }
  }

  return {
    select,
    cancel,
    dispose() {
      disposed = true;
      cancel();
    }
  };
}
