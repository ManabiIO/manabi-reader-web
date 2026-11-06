/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Device connectivity is a hint, never evidence of server reachability or sync. */
export function observeBrowserConnectivity(
  publish: (online: boolean) => void,
  environment: { window: Window; document: Document; navigator: Navigator }
) {
  let previous: boolean | undefined;
  const update = (online: boolean) => {
    if (online === previous) return;
    previous = online;
    publish(online);
  };
  const sample = () => {
    try {
      const online = environment.navigator.onLine;
      if (typeof online === 'boolean') update(online);
    } catch {
      // Restricted getters do not prove a connection or a disconnection.
    }
  };
  const offline = () => update(false);
  const visible = () => {
    if (environment.document.visibilityState === 'visible') sample();
  };
  environment.window.addEventListener('online', sample);
  environment.window.addEventListener('offline', offline);
  environment.window.addEventListener('focus', sample);
  environment.document.addEventListener('visibilitychange', visible);
  sample();
  return () => {
    environment.window.removeEventListener('online', sample);
    environment.window.removeEventListener('offline', offline);
    environment.window.removeEventListener('focus', sample);
    environment.document.removeEventListener('visibilitychange', visible);
  };
}
