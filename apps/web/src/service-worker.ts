/// <reference lib="webworker" />

import { build, files, prerendered, version } from '$service-worker';
import { userFontsCacheName } from '$lib/data/fonts';

const worker = self as unknown as ServiceWorkerGlobalScope;
const scopePath = new URL(worker.registration.scope).pathname;
const prefix = `manabi-reader-web:${scopePath}:build:`;
const cacheName = `${prefix}${version}`;
const fallback = `${scopePath}404.html`;
const assets = [...new Set([...build, ...files, ...prerendered, fallback])].filter(
  (path) => path.startsWith(scopePath) && !path.includes('/api/') && !path.includes('/accounts/')
);
const assetPaths = new Set(assets);

worker.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(cacheName).then(async (cache) => {
      await cache.addAll(assets);
      await worker.skipWaiting();
    })
  );
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Manabi also serves a homepage and other apps on this origin. Never delete
      // their caches, nor upstream user-imported fonts.
      for (const key of await caches.keys()) {
        if (key.startsWith(prefix) && key !== cacheName) await caches.delete(key);
      }
      await worker.clients.claim();
    })()
  );
});

worker.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== worker.location.origin) return;

  // Existing imported fonts are virtual, local cache entries. Preserve their
  // old URLs without intercepting any other root-level application requests.
  if (url.pathname.startsWith('/userfonts/') || url.pathname.startsWith(`${scopePath}userfonts/`)) {
    event.respondWith(
      caches
        .open(userFontsCacheName)
        .then(
          async (cache) => (await cache.match(url.pathname)) ?? new Response(null, { status: 404 })
        )
    );
    return;
  }
  if (!url.pathname.startsWith(scopePath)) return;
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

  if (assetPaths.has(url.pathname)) {
    event.respondWith(
      caches
        .open(cacheName)
        .then(async (cache) => (await cache.match(url.pathname)) ?? fetch(request))
    );
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
          return await fetch(request, { signal: controller.signal });
        } catch {
          const cache = await caches.open(cacheName);
          return (
            (await cache.match(fallback)) ??
            new Response('Reader is not yet available offline.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain' }
            })
          );
        } finally {
          clearTimeout(timeout);
        }
      })()
    );
  }
  // No dynamic request caching: account/API responses and provider credentials
  // are never intercepted, even while a Reader page controls the client.
});
