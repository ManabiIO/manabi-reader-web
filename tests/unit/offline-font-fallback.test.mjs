import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerReaderServiceWorker } from '../../apps/web/src/lib/service-worker/reader-service-worker.mjs';

function harness({ cacheDenied = false, immutable = true } = {}) {
  const scope = 'https://reader.example/reader-web/';
  const font = scope + 'font.woff2';
  const handlers = new Map();
  const entries = new Map();
  let fetches = 0;
  let network = async () => {
    throw new TypeError('Load failed');
  };
  registerReaderServiceWorker(
    {
      registration: { scope },
      addEventListener: (type, handler) => handlers.set(type, handler),
      caches: {
        async open() {
          if (cacheDenied) throw new DOMException('Denied', 'SecurityError');
          return {
            match: async (key) => entries.get(key)?.clone(),
            put: async (key, response) => entries.set(key, response.clone())
          };
        }
      },
      fetch(request) {
        fetches++;
        return network(request);
      }
    },
    {
      build: immutable ? [font] : [],
      files: immutable ? [] : [font],
      prerendered: [scope],
      version: 'test',
      userFontsCacheName: 'user-fonts'
    }
  );
  function request(url = font) {
    let response;
    handlers.get('fetch')({
      request: new Request(url),
      respondWith: (value) => {
        response = value;
      }
    });
    return response;
  }
  return { request, entries, scope, fetches: () => fetches, online: () => {
    network = async () => new Response('font bytes');
  } };
}

for (const immutable of [true, false]) {
  test(`uncached ${immutable ? 'immutable' : 'static'} font failure permits later online retry`, async () => {
    const h = harness({ immutable });
    const missing = await h.request();
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('cache-control'), 'no-store');
    assert.equal(h.entries.size, 0);
    h.online();
    assert.equal(await (await h.request()).text(), 'font bytes');
    assert.equal(h.entries.size, 1);
    assert.equal(await (await h.request()).text(), 'font bytes');
    assert.equal(h.fetches(), 2);
  });
}

test('denied optional cache and missing network still permit CSS fallback', async () => {
  const h = harness({ cacheDenied: true });
  assert.equal((await h.request()).status, 404);
  h.online();
  assert.equal(await (await h.request()).text(), 'font bytes');
  assert.equal(h.entries.size, 0);
});

test('font fallback does not disguise a missing mandatory shell resource', async () => {
  const h = harness();
  await assert.rejects(h.request(h.scope), /Load failed/);
});
