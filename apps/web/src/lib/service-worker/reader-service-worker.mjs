/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/// <reference lib="webworker" />

import { inspectOfflineShell, OFFLINE_STATUS_REQUEST } from './offline-status.mjs';

/**
 * Register Reader's static application-shell worker. Cache ownership includes
 * the registration scope, not just the product name: two deployments can share
 * an origin. Dictionaries and imported books have a separate storage lifecycle.
 *
 * @param {ServiceWorkerGlobalScope} worker
 * @param {{build: string[], files: string[], prerendered: string[], version: string,
 * userFontsCacheName: string, lazyAssets?: string[]}} config
 */
export function registerReaderServiceWorker(worker, config) {
  const scope = new URL(worker.registration.scope);
  const prefix = `manabi-reader:${encodeURIComponent(scope.href)}:`;
  const shellPrefix = `${prefix}shell:`;
  const fontsPrefix = `${prefix}remote-fonts:`;
  const staticFontsPrefix = `${prefix}static-fonts:`;
  const shellName = `${shellPrefix}${config.version}`;
  const fontsName = `${fontsPrefix}${config.version}`;
  const staticFontsName = `${staticFontsPrefix}${config.version}`;
  // Content-hashed packaged fonts keep working offline across shell upgrades.
  // This is separate from imported user-font and dictionary storage.
  const packagedFontsName = `${prefix}packaged-fonts:v1`;
  const storage = worker.caches;
  const lazyAssets = new Set((config.lazyAssets ?? []).map((path) => new URL(path, scope).href));

  /** @param {URL} url */
  const inScope = (url) => url.origin === scope.origin && url.pathname.startsWith(scope.pathname);

  // SvelteKit's build list is content-hashed; public/static files are not.
  // Only immutable built URLs may survive upgrades in the stable cache.
  const immutableFontAssets = new Set(
    config.build
      .map((path) => new URL(path, scope))
      .filter((url) => inScope(url) && isPackagedFont(url))
      .map((url) => url.href)
  );
  const fontAssets = new Set(
    [...config.build, ...config.files]
      .map((path) => new URL(path, scope))
      .filter((url) => inScope(url) && isPackagedFont(url))
      .map((url) => url.href)
  );
  const shellAssets = new Set(
    [...config.build, ...config.files, ...config.prerendered]
      .map((path) => new URL(path, scope))
      .filter((url) => inScope(url) && isShellAsset(url) && !lazyAssets.has(url.href))
      .map((url) => url.href)
  );
  const pages = new Set(config.prerendered.map((path) => new URL(path, scope).href));
  const immutableAssets = new Set(config.build.map((path) => new URL(path, scope).href));

  worker.addEventListener('install', (event) => {
    // Do not skipWaiting: an old tab must keep its own shell and worker version.
    // Required resources still commit atomically. Mutable HTML/static paths must
    // not be seeded from a fresh but older HTTP-cache response. Redirected login
    // or error pages are not a valid offline shell.
    const requests = [...shellAssets].map(
      (url) =>
        new Request(url, {
          cache: immutableAssets.has(url) ? 'default' : 'reload',
          redirect: 'error',
          credentials: 'same-origin'
        })
    );
    event.waitUntil(storage.open(shellName).then((cache) => cache.addAll(requests)));
  });

  /** @type {ReturnType<typeof inspectOfflineShell>|undefined} */
  let inspection;
  worker.addEventListener('message', (event) => {
    if (event.data?.type !== OFFLINE_STATUS_REQUEST || !event.ports[0]) return;
    // Only an in-scope page may ask. The response contains shell counts only,
    // never book data, account state, URLs from caches, or permission changes.
    const source = event.source;
    try {
      if (!source || !('url' in source) || !inScope(new URL(source.url))) return;
    } catch {
      return;
    }
    inspection ??= inspectOfflineShell(storage, shellName, shellAssets).finally(() => {
      inspection = undefined;
    });
    event.waitUntil(
      inspection
        .then((status) => {
          try {
            event.ports[0].postMessage({
              type: OFFLINE_STATUS_REQUEST,
              scope: scope.href,
              version: config.version,
              ...status
            });
          } finally {
            event.ports[0].close();
          }
        })
        .catch(() => {
          // The requesting page may already have closed or timed out.
        })
    );
  });

  worker.addEventListener('activate', (event) => {
    // Do not claim existing uncontrolled clients or remove legacy unscoped caches:
    // there is no reliable way to establish that those belong to this deployment.
    event.waitUntil(
      storage
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter(
                (key) =>
                  (key.startsWith(shellPrefix) && key !== shellName) ||
                  (key.startsWith(fontsPrefix) && key !== fontsName) ||
                  (key.startsWith(staticFontsPrefix) && key !== staticFontsName)
              )
              .map((key) => storage.delete(key))
          )
        )
        .then(async () => {
          // Keep unchanged content hashes, retire only this scope's obsolete
          // packaged assets. An optional-cache failure cannot block activation.
          try {
            const cache = await storage.open(packagedFontsName);
            const keys = await cache.keys();
            await Promise.all(
              keys
                .filter((key) => !immutableFontAssets.has(key.url))
                .map((key) => cache.delete(key))
            );
          } catch {
            /* Best-effort optional font cache. */
          }
        })
    );
  });

  worker.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET' || request.headers.has('range')) return;
    const url = new URL(request.url);
    if (!['http:', 'https:'].includes(url.protocol)) return;
    // Preserve the browser's only-if-cached semantics. Never synthesize a fetch
    // with incompatible request mode/cache settings.
    if (request.cache === 'only-if-cached') return;

    if (url.origin === scope.origin && url.pathname.startsWith('/userfonts/')) {
      event.respondWith(readUserFont(url.origin + url.pathname));
      return;
    }
    if (inScope(url)) {
      const key = new URL(url);
      key.hash = '';
      const withoutSearch = new URL(key);
      withoutSearch.search = '';
      // Book IDs/settings can live in page query parameters; static assets may
      // only match the exact shell URL, never an arbitrary query variant.
      if (pages.has(withoutSearch.href)) key.search = '';
      if (shellAssets.has(key.href)) {
        event.respondWith(readShell(request, key.href));
        return;
      }

      // Only exact URLs present in this build's asset manifest are cacheable.
      // Do not cache arbitrary font-shaped URLs, query variants or remote fonts.
      if (fontAssets.has(key.href)) {
        event.respondWith(readPackagedFont(request, key.href));
        return;
      }

      const relativePath = url.pathname.slice(scope.pathname.length);
      if (relativePath.startsWith('userfonts/')) {
        event.respondWith(readUserFont(withoutSearch.href));
        return;
      }
      // Historical reader links used /b/123. Anchor to this registration's root.
      const legacyBook = /^b\/(\d+)\/?$/.exec(relativePath);
      if (legacyBook) {
        const target = new URL('b', scope);
        target.search = url.search;
        target.searchParams.set('id', legacyBook[1]);
        event.respondWith(Promise.resolve(Response.redirect(target.href, 302)));
      }
      return;
    }

    // Preserve the existing optional Google Fonts stylesheet cache, but do not
    // capture arbitrary cross-origin resources or dictionary downloads.
    if (url.origin === 'https://fonts.googleapis.com' && /^\/css2?$/.test(url.pathname)) {
      event.respondWith(readRemoteFont(request));
    }
  });

  /** @param {Request} request @param {string} key */
  async function readShell(request, key) {
    try {
      const cache = await storage.open(shellName);
      const response = await cache.match(key);
      if (response) return response;
    } catch {
      // A storage failure should not prevent an otherwise usable online shell.
    }
    // Never store a new deployment's HTML in an older shell generation.
    return worker.fetch(request);
  }

  /** @param {string} key */
  async function readUserFont(key) {
    try {
      const cache = await storage.open(config.userFontsCacheName);
      const response = await cache.match(key);
      if (response) return response;
    } catch {
      // Preserve the historical fallback without searching unrelated caches.
    }
    // A missing imported face must fail so CSS can select the system fallback.
    // Redirecting to an unrelated Latin-only face misrepresents the font as loaded.
    return new Response(null, { status: 404 });
  }

  /** @param {Request} request @param {string} key */
  async function readPackagedFont(request, key) {
    /** @type {Cache|undefined} */
    let cache;
    try {
      cache = await storage.open(
        immutableFontAssets.has(key) ? packagedFontsName : staticFontsName
      );
      const cached = await cache.match(key);
      if (cached) return cached;
    } catch {
      /* Reading online still works when browser storage is unavailable. */
    }
    let response;
    try {
      response = await worker.fetch(request);
    } catch {
      // A face absent from optional storage must fail as a resource, not as
      // rejected worker work. CSS can use its system fallback. Never cache the
      // failure or pretend another font is this face; online retries stay valid.
      return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    if (cache && response.status === 200 && response.type !== 'opaque' && !response.redirected) {
      try {
        await cache.put(key, response.clone());
      } catch {
        /* Quota failures must not hide a usable font response. */
      }
    }
    return response;
  }

  /** @param {Request} request */
  async function readRemoteFont(request) {
    /** @type {Cache|undefined} */
    let cache;
    try {
      cache = await storage.open(fontsName);
    } catch {
      /* Best-effort font cache. */
    }
    try {
      const response = await worker.fetch(request);
      if (response.ok && response.type !== 'opaque' && cache) {
        try {
          await cache.put(request, response.clone());
          const keys = await cache.keys();
          // Bound optional stylesheet caching, not dictionary or user-font data.
          await Promise.all(
            keys.slice(0, Math.max(0, keys.length - 32)).map((key) => cache.delete(key))
          );
        } catch {
          /* Quota/write failures must not hide a usable network response. */
        }
      }
      if (!response.ok && cache) {
        const cached = await cache.match(request).catch(() => undefined);
        if (cached) return cached;
      }
      return response;
    } catch (error) {
      const cached = cache && (await cache.match(request).catch(() => undefined));
      if (cached) return cached;
      throw error;
    }
  }
}

/** @param {URL} url */
export function isShellAsset(url) {
  let path;
  try {
    path = decodeURIComponent(url.pathname).toLowerCase();
  } catch {
    return false;
  }
  return (
    !/(?:^|\/)(?:dictionaries|dictionary-archives|manabitan)(?:\/|$)/.test(path) &&
    !/\.(?:zip|epub|htmlz|sqlite3?|db|wasm|woff2?|ttf|otf)$/.test(path)
  );
}

/** @param {URL} url */
export function isPackagedFont(url) {
  if (url.search || url.hash) return false;
  let path;
  try {
    path = decodeURIComponent(url.pathname).toLowerCase();
  } catch {
    return false;
  }
  return (
    /\.(?:woff2?|ttf|otf)$/.test(path) &&
    !/(?:^|\/)(?:userfonts|dictionaries|dictionary-archives|manabitan)(?:\/|$)/.test(path)
  );
}
