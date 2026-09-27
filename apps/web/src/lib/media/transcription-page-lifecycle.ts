/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Hiding is the earliest reliable signal; a freeze cannot await freezable tasks.
 * Do not use blur (the tab can still be visible), unload, or automatic job replay.
 * Explicit targets keep lifecycle tests independent of a browser's focus heuristics.
 */
export function bindTranscriptionPageLifecycle(
  suspend: (immediate: boolean) => void,
  activate: () => void,
  page:
    | Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>
    | undefined = typeof document === 'undefined' ? undefined : document,
  host: Pick<Window, 'addEventListener' | 'removeEventListener'> | undefined = typeof window ===
  'undefined'
    ? undefined
    : window
): () => void {
  if (!page || !host) return () => {};
  const options = { capture: true };
  const visibility = () => {
    if (page.visibilityState === 'hidden') suspend(false);
    else activate();
  };
  const freeze = () => suspend(true);
  const show = () => {
    if (page.visibilityState === 'visible') activate();
  };
  page.addEventListener('visibilitychange', visibility, options);
  page.addEventListener('freeze', freeze, options);
  page.addEventListener('resume', show, options);
  host.addEventListener('pagehide', freeze, options);
  host.addEventListener('pageshow', show, options);
  visibility();
  return () => {
    page.removeEventListener('visibilitychange', visibility, options);
    page.removeEventListener('freeze', freeze, options);
    page.removeEventListener('resume', show, options);
    host.removeEventListener('pagehide', freeze, options);
    host.removeEventListener('pageshow', show, options);
  };
}
