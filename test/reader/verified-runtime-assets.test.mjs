/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  loadVerifiedRuntimeAsset,
  verifiedRuntimeCacheName
} from '../../apps/web/src/lib/service-worker/verified-runtime-assets.mjs';
const scope = 'https://reader.example/reader/';
const url = new URL('engine/runtime.js', scope).href;
const sha = (value) => createHash('sha256').update(value).digest('hex');
function storage() {
  const caches = new Map();
  return {
    caches,
    async open(name) {
      if (!caches.has(name)) {
        const rows = new Map();
        caches.set(name, {
          rows,
          async match(key) {
            return rows.get(String(key))?.clone();
          },
          async put(key, response) {
            rows.set(String(key), response.clone());
          }
        });
      }
      return caches.get(name);
    }
  };
}
test('first-page verified tools reopen offline without a controlling worker', async () => {
  const cache = storage(),
    value = 'export const ready=true;',
    expected = { sha256: sha(value), bytes: Buffer.byteLength(value) };
  let fetched = 0;
  const first = await loadVerifiedRuntimeAsset(scope, url, expected, {
    storage: cache,
    fetch: async () => {
      fetched++;
      return new Response(value);
    }
  });
  const offline = await loadVerifiedRuntimeAsset(scope, url, expected, {
    storage: cache,
    fetch: async () => {
      throw new Error('offline');
    }
  });
  assert.equal(new TextDecoder().decode(first), value);
  assert.deepEqual(first, offline);
  assert.equal(fetched, 1);
  const response = await (await cache.open(verifiedRuntimeCacheName(scope))).match(url);
  assert.equal(response.headers.get('Content-Type'), 'text/javascript');
});
test('failed integrity never replaces a recoverable prior copy', async () => {
  const cache = storage(),
    owned = await cache.open(verifiedRuntimeCacheName(scope));
  await owned.put(url, new Response('prior'));
  const expected = { sha256: sha('replacement'), bytes: 11 };
  await assert.rejects(
    loadVerifiedRuntimeAsset(scope, url, expected, {
      storage: cache,
      fetch: async () => new Response('wrong')
    }),
    /integrity/
  );
  assert.equal(await (await owned.match(url)).text(), 'prior');
  const recovered = await loadVerifiedRuntimeAsset(scope, url, expected, {
    storage: cache,
    fetch: async () => new Response('replacement')
  });
  assert.equal(new TextDecoder().decode(recovered), 'replacement');
});
test('scopes, URL forms and byte budgets cannot be widened by callers', async () => {
  const expected = { sha256: sha('good'), bytes: 4 };
  let fetched = 0;
  for (const target of [
    'https://other.example/runtime.js',
    scope + '../other.js',
    url + '?v=1',
    url + '#a',
    scope + 'book.epub'
  ])
    await assert.rejects(
      loadVerifiedRuntimeAsset(scope, target, expected, {
        fetch: async () => {
          fetched++;
          return new Response('good');
        }
      }),
      /Invalid/
    );
  assert.equal(fetched, 0);
  await assert.rejects(
    loadVerifiedRuntimeAsset(scope, url, { ...expected, maximumBytes: 3 }),
    /Invalid/
  );
  assert.notEqual(
    verifiedRuntimeCacheName(scope),
    verifiedRuntimeCacheName('https://reader.example/other/')
  );
});
test('aborted and over-budget streams are drained without publishing partial data', async () => {
  const cache = storage(),
    controller = new AbortController();
  let canceled = false;
  const response = new Response(
    new ReadableStream({
      pull(stream) {
        stream.enqueue(new Uint8Array([1, 2, 3]));
      },
      cancel() {
        canceled = true;
      }
    })
  );
  await assert.rejects(
    loadVerifiedRuntimeAsset(
      scope,
      url,
      { sha256: sha('x'), bytes: 1 },
      { storage: cache, fetch: async () => response }
    ),
    /budget/
  );
  assert.equal(canceled, true);
  assert.equal(await (await cache.open(verifiedRuntimeCacheName(scope))).match(url), undefined);
  controller.abort();
  let fetched = false;
  await assert.rejects(
    loadVerifiedRuntimeAsset(
      scope,
      url,
      { sha256: sha('x'), bytes: 1 },
      {
        signal: controller.signal,
        fetch: async () => {
          fetched = true;
        }
      }
    ),
    { name: 'AbortError' }
  );
  assert.equal(fetched, false);
});
test('owner cancellation retires a blocked cache open without starting a network request', async () => {
  const controller = new AbortController();
  let fetched = false,
    release;
  const pending = loadVerifiedRuntimeAsset(
    scope,
    url,
    { sha256: sha('good'), bytes: 4 },
    {
      signal: controller.signal,
      storage: {
        open: () =>
          new Promise((resolve) => {
            release = resolve;
          })
      },
      fetch: async () => {
        fetched = true;
        return new Response('good');
      }
    }
  );
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  controller.abort();
  await rejected;
  assert.equal(fetched, false);
  release(undefined);
});

test('cache denial does not discard verified online resources', async () => {
  const value = 'good';
  const result = await loadVerifiedRuntimeAsset(
    scope,
    url,
    { sha256: sha(value), bytes: 4 },
    {
      storage: {
        async open() {
          throw new Error('denied');
        }
      },
      fetch: async () => new Response(value)
    }
  );
  assert.equal(new TextDecoder().decode(result), value);
});

test('owner cancellation retires a blocked resource body and never publishes partial bytes', async () => {
  for (const cached of [false, true]) {
    const controller = new AbortController();
    let started,
      release,
      cancelled = false,
      writes = 0,
      network = 0;
    const reading = new Promise((resolve) => {
      started = resolve;
    });
    const response = new Response(
      new ReadableStream(
        {
          start(stream) {
            release = () => stream.close();
          },
          pull() {
            started();
          },
          cancel() {
            cancelled = true;
          }
        },
        { highWaterMark: 0 }
      )
    );
    const pending = loadVerifiedRuntimeAsset(
      scope,
      url,
      { sha256: sha('good'), bytes: 4 },
      {
        signal: controller.signal,
        storage: {
          open: async () => ({
            match: async () => (cached ? response : undefined),
            put: async () => {
              writes++;
            }
          })
        },
        fetch: async () => {
          network++;
          return response;
        }
      }
    );
    const settled = pending.then(
      () => 'unexpected success',
      (error) => error.name
    );
    let timer;
    try {
      await reading;
      controller.abort();
      assert.equal(
        await Promise.race([
          settled,
          new Promise((resolve) => {
            timer = setTimeout(() => resolve('still blocked after abort'), 100);
          })
        ]),
        'AbortError'
      );
      assert.equal(cancelled, true);
      assert.equal(writes, 0);
      assert.equal(network, cached ? 0 : 1);
    } finally {
      clearTimeout(timer);
      if (!cancelled) release();
      await settled;
    }
  }
});
