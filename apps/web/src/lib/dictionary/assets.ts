/* SPDX-License-Identifier: GPL-3.0-or-later */
import { base } from '$app/paths';
import lock from './runtime-lock.json';
import type { Runtime } from './api';

interface Asset { path: string; bytes: number; sha256: string }
interface Manifest { package: string; apiVersion: number; revision: string; assets: Asset[] }
const limits = { assets: 1024, total: 100 * 1024 * 1024, file: 32 * 1024 * 1024 };
export const runtimePath = `${base}/vendor/manabitan/${lock.revision}/`;
export const archivePath = `${base}/dictionary-archives/`;

async function readBounded(response: Response, maximum: number, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.ok || response.redirected || !response.body) throw new Error(`Dictionary asset fetch failed (${response.status})`);
  const reader = response.body.getReader(); const chunks: Uint8Array<ArrayBuffer>[] = []; let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) throw new Error('Dictionary asset exceeds its size limit');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const output = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}
async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) => n.toString(16).padStart(2, '0')).join('');
}
function validateManifest(value: unknown): Manifest {
  if (!value || typeof value !== 'object') throw new Error('Invalid dictionary runtime manifest');
  const m = value as Manifest;
  if (m.package !== 'manabitan-web' || m.apiVersion !== lock.apiVersion || m.revision !== lock.revision ||
      !Array.isArray(m.assets) || !m.assets.length || m.assets.length > limits.assets) throw new Error('Dictionary runtime version mismatch');
  const names = new Set<string>(); let total = 0;
  for (const a of m.assets) {
    if (!a || typeof a.path !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(a.path) || a.path.split('/').some((p) => !p || p === '.' || p === '..') ||
        names.has(a.path) || !Number.isSafeInteger(a.bytes) || a.bytes < 0 || a.bytes > limits.file || !/^[a-f0-9]{64}$/.test(a.sha256)) throw new Error('Unsafe dictionary asset manifest');
    total += a.bytes; names.add(a.path);
  }
  if (total > limits.total || !['web/client.js', 'web/scanner.js', 'web/render.js', 'web/presets.js', 'css/structured-content.css'].every((p) => names.has(p))) throw new Error('Incomplete dictionary runtime manifest');
  return m;
}

/** Deliberate first-use installation. No dictionaries or books enter this cache. */
export async function loadRuntime(signal: AbortSignal, progress: (message: string) => void): Promise<Runtime> {
  if (!navigator.locks || !navigator.storage?.getDirectory || !globalThis.caches) throw new Error('This browser does not provide the persistent storage required by built-in dictionaries. Extension mode remains available.');
  const root = new URL(runtimePath, location.origin);
  const cacheName = `manabi-reader-runtime:${root.href}`;
  await navigator.locks.request(`${cacheName}:install`, { signal }, async () => {
    signal.throwIfAborted();
    const cache = await caches.open(cacheName);
    const manifestURL = new URL('manifest.json', root);
    const response = await cache.match(manifestURL) ?? await fetch(manifestURL, { signal, credentials: 'omit', redirect: 'error' });
    const bytes = await readBounded(response, 256 * 1024, signal);
    const manifest = validateManifest(JSON.parse(new TextDecoder().decode(bytes)));
    let next = 0, complete = 0;
    const tasks = Array.from({ length: 4 }, async () => {
      while (next < manifest.assets.length) {
        signal.throwIfAborted();
        const asset = manifest.assets[next++]; const url = new URL(asset.path, root);
        let cached = await cache.match(url);
        let body: Uint8Array<ArrayBuffer> | undefined;
        if (cached) {
          body = await readBounded(cached, asset.bytes, signal);
          if (body.length !== asset.bytes || await sha256(body) !== asset.sha256) { await cache.delete(url); cached = undefined; }
        }
        if (!cached) {
          const fresh = await fetch(url, { signal, credentials: 'omit', redirect: 'error' });
          const headers = new Headers(fresh.headers);
          body = await readBounded(fresh, asset.bytes, signal);
          if (body.length !== asset.bytes || await sha256(body) !== asset.sha256) throw new Error(`Dictionary asset verification failed: ${asset.path}`);
          headers.delete('content-encoding'); headers.delete('content-length');
          await cache.put(url, new Response(body, { status: 200, headers }));
        }
        complete += 1; progress(`Preparing offline dictionary tools: ${complete}/${manifest.assets.length}`);
      }
    });
    // Drain every worker before releasing installation ownership on failure.
    const results = await Promise.allSettled(tasks);
    const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failure) throw failure.reason;
    signal.throwIfAborted();
    await cache.put(manifestURL, new Response(bytes, { headers: { 'Content-Type': 'application/json' } }));
    await cache.put(new URL('.complete.json', root), new Response(JSON.stringify({ revision: lock.revision })));
  });
  signal.throwIfAborted();
  const client = await import(/* @vite-ignore */ new URL('web/client.js', root).href);
  const scanner = await import(/* @vite-ignore */ new URL('web/scanner.js', root).href);
  const renderer = await import(/* @vite-ignore */ new URL('web/render.js', root).href);
  const presets = await import(/* @vite-ignore */ new URL('web/presets.js', root).href);
  signal.throwIfAborted();
  if (client.ManabiTanWebClient?.apiVersion !== lock.apiVersion || typeof scanner.createReaderScanner !== 'function' || typeof renderer.renderDictionaryResults !== 'function') throw new Error('Incompatible ManabiTan runtime API');
  if (!document.querySelector('link[data-manabitan-style]')) {
    const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = new URL('css/structured-content.css', root).href;
    style.dataset.manabitanStyle = ''; document.head.append(style);
  }
  return { Client: client.ManabiTanWebClient, createScanner: scanner.createReaderScanner,
    render: renderer.renderDictionaryResults, presets, offlineReady: !!navigator.serviceWorker?.controller };
}
