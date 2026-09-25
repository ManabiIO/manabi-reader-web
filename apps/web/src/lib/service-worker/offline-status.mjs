/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export const OFFLINE_STATUS_REQUEST = 'manabi-reader:offline-status:v1';

/**
 * @typedef {'ready'|'incomplete'|'unavailable'|'preparing'|'unsupported'|'unknown'} OfflineState
 * @typedef {{state: OfflineState, updateWaiting: boolean}} OfflineStatus
 */

/**
 * Inspect only this generation's required shell. No fetches, book reads, cache
 * repair, or persisted "ready" flag. Readiness is a snapshot, not a backup.
 * @param {CacheStorage} storage
 * @param {string} name
 * @param {Set<string>} assets
 * @returns {Promise<{state: 'ready'|'incomplete'|'unavailable', required: number, cached: number}>}
 */
export async function inspectOfflineShell(storage, name, assets) {
  const required = assets.size;
  let cached = 0;
  try {
    // Opening a missing cache would create it; do not do so just for diagnostics.
    if (!required || !(await storage.keys()).includes(name)) {
      return { state: 'incomplete', required, cached };
    }
    const cache = await storage.open(name);
    // Bound simultaneous response handles and avoid loading any response bodies.
    const urls = [...assets];
    for (let i = 0; i < urls.length; i += 8) {
      const present = await Promise.all(
        urls.slice(i, i + 8).map(async (url) => {
          const response = await cache.match(url);
          return !!response && response.status === 200 && !response.redirected;
        })
      );
      cached += present.filter(Boolean).length;
    }
    return { state: cached === required ? 'ready' : 'incomplete', required, cached };
  } catch {
    return { state: 'unavailable', required, cached };
  }
}

/**
 * Query the exact deployment's active worker, including on the first document
 * which it intentionally does not claim. Old workers may not speak this
 * protocol: timeout is "unknown", never a false success. No registration,
 * update, skipWaiting, reload, or persistent-storage permission is triggered.
 * @param {ServiceWorkerContainer|undefined} container
 * @param {string} scope
 * @param {{signal?: AbortSignal, timeoutMs?: number}} options
 * @returns {Promise<OfflineStatus>}
 */
export function getOfflineStatus(container, scope, { signal, timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let updateWaiting = false;
    /** @type {MessageChannel|undefined} */
    let channel;
    /** @param {OfflineState} state */
    const finish = (state) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      channel?.port1.close();
      channel?.port2.close();
      resolve({ state, updateWaiting });
    };
    const abort = () => finish('unknown');
    // Bound discovery as well as the MessageChannel reply.
    const timer = globalThis.setTimeout(
      () => finish('unknown'),
      Number.isFinite(timeoutMs) ? Math.max(1, Math.min(10000, timeoutMs)) : 3000
    );
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) return abort();

    void (async () => {
      try {
        if (!container || typeof container.getRegistration !== 'function') {
          finish('unsupported');
          return;
        }
        const expectedScope = new URL(scope);
        if (expectedScope.search || expectedScope.hash || !expectedScope.pathname.endsWith('/')) {
          finish('unknown');
          return;
        }
        const registration = await container.getRegistration(expectedScope.href);
        if (settled) return;
        if (!registration) {
          // Absence can mean a failed/blocked install, not ongoing work.
          finish('unknown');
          return;
        }
        if (registration.scope !== expectedScope.href) {
          finish('unknown');
          return;
        }
        updateWaiting = !!registration.waiting;
        const worker = registration.active;
        if (!worker || worker.state !== 'activated') {
          const installing = registration.installing?.state;
          const preparing =
            worker?.state === 'activating' ||
            ['parsed', 'installing', 'installed'].includes(installing ?? '') ||
            registration.waiting?.state === 'installed';
          finish(preparing ? 'preparing' : 'unknown');
          return;
        }
        if (worker.scriptURL !== new URL('service-worker.js', expectedScope).href) {
          finish('unknown');
          return;
        }
        channel = new MessageChannel();
        channel.port1.onmessageerror = () => finish('unknown');
        channel.port1.onmessage = ({ data }) => {
          if (
            registration.active !== worker ||
            worker.state !== 'activated' ||
            !data ||
            data.type !== OFFLINE_STATUS_REQUEST ||
            data.scope !== expectedScope.href ||
            typeof data.version !== 'string' ||
            !data.version ||
            !['ready', 'incomplete', 'unavailable'].includes(data.state) ||
            !Number.isSafeInteger(data.required) ||
            !Number.isSafeInteger(data.cached) ||
            data.required < 0 ||
            data.cached < 0 ||
            data.cached > data.required ||
            (data.state === 'ready' && (!data.required || data.required !== data.cached)) ||
            (data.state === 'incomplete' && data.required > 0 && data.required === data.cached)
          ) {
            finish('unknown');
            return;
          }
          // Installation may complete during the cache scan.
          updateWaiting = !!registration.waiting;
          finish(data.state);
        };
        worker.postMessage({ type: OFFLINE_STATUS_REQUEST }, [channel.port2]);
      } catch {
        finish('unavailable');
      }
    })();
  });
}
