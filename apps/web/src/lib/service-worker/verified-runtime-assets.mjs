/** @license BSD-3-Clause */
const maximum = 128 * 1024 * 1024;
/** @param {string|URL} scope */
export function verifiedRuntimeCacheName(scope) {
  const root = new URL(scope);
  if (
    !['http:', 'https:'].includes(root.protocol) ||
    root.username ||
    root.password ||
    root.search ||
    root.hash ||
    !root.pathname.endsWith('/')
  )
    throw new TypeError('Invalid runtime cache scope');
  return `manabi-reader:${encodeURIComponent(root.href)}:verified-runtime:v1`;
}
/** Persist explicitly requested, hash-bound tools even on the first uncontrolled
 * page. This never installs dictionaries or creates an offline-ready flag.
 * @param {string|URL} scope
 * @param {string|URL} resource
 * @param {{sha256:string,bytes?:number,maximumBytes?:number}} expected
 * @param {{signal?:AbortSignal,storage?:CacheStorage,fetch?:typeof globalThis.fetch}} options */
export async function loadVerifiedRuntimeAsset(
  scope,
  resource,
  expected,
  { signal, storage = globalThis.caches, fetch = globalThis.fetch } = {}
) {
  const root = new URL(scope),
    url = new URL(resource, root),
    name = verifiedRuntimeCacheName(root);
  const limit = expected?.maximumBytes ?? maximum;
  if (
    url.origin !== root.origin ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(root.pathname) ||
    url.search ||
    url.hash ||
    !/\.(?:m?js|wasm|json)$/i.test(url.pathname) ||
    !/^[a-f0-9]{64}$/.test(expected?.sha256 ?? '') ||
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    limit > maximum ||
    (expected.bytes !== undefined &&
      (!Number.isSafeInteger(expected.bytes) || expected.bytes <= 0 || expected.bytes > limit))
  )
    throw new TypeError('Invalid verified runtime resource');
  const check = () => signal?.throwIfAborted();
  // CacheStorage has no AbortSignal API. Retire the caller promptly while an
  // already issued cache operation finishes only its validated optional bytes.
  const wait = (promise) =>
    !signal
      ? promise
      : new Promise((resolve, reject) => {
          const done = () => signal.removeEventListener('abort', aborted);
          const aborted = () => {
            done();
            reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
          };
          signal.addEventListener('abort', aborted, { once: true });
          Promise.resolve(promise).then(
            (value) => {
              done();
              resolve(value);
            },
            (error) => {
              done();
              reject(error);
            }
          );
          if (signal.aborted) aborted();
        });
  /** @param {Response} response */
  const read = async (response) => {
    if (!response.ok || response.redirected || !response.body)
      throw new Error('The local language tools are unavailable. Reconnect and retry.');
    const reader = response.body.getReader(),
      chunks = [];
    let length = 0;
    try {
      for (;;) {
        check();
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > limit || (expected.bytes !== undefined && length > expected.bytes))
          throw new Error('Language resource exceeds its verified byte budget');
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    check();
    const value = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      value.set(chunk, offset);
      offset += chunk.length;
    }
    const digest = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', value))]
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('');
    check();
    if ((expected.bytes !== undefined && length !== expected.bytes) || digest !== expected.sha256)
      throw new Error('Language resource integrity failed');
    return value;
  };
  check();
  let cache;
  try {
    cache = await wait(storage?.open(name));
  } catch {
    check(); /* Optional cache can be unavailable online. */
  }
  if (cache) {
    try {
      const saved = await wait(cache.match(url.href));
      if (saved) return await read(saved);
    } catch {
      check(); /* Retry a damaged optional copy from its exact verified URL. */
    }
  }
  const value = await read(
    await fetch(url.href, { credentials: 'omit', redirect: 'error', signal })
  );
  check();
  if (cache) {
    const path = url.pathname.toLowerCase();
    const mime = path.endsWith('.wasm')
      ? 'application/wasm'
      : path.endsWith('.json')
        ? 'application/json'
        : 'text/javascript';
    try {
      await wait(cache.put(url.href, new Response(value, { headers: { 'Content-Type': mime } })));
    } catch {
      /* A quota failure must not discard usable verified online bytes. */
    }
  }
  check();
  return value;
}
