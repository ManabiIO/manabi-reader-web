import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  registerReaderServiceWorker,
  isShellAsset,
  isPackagedFont
} from '../../apps/web/src/lib/service-worker/reader-service-worker.mjs';

const origin = 'https://reader.example';
const url = (path) => `${origin}${path}`;
const body = (response) => response.text();

function makeHarness({ scope = url('/'), version = 'new', ...overrides } = {}) {
  const handlers = new Map();
  const caches = new Map();
  const removed = [];
  const fetched = [];
  const precached = [];
  let fetchImpl = async (request) => new Response(`network:${request.url ?? request}`);
  let failWrite = false;
  let failOpen = false;
  class MemoryCache {
    entries = new Map();
    key(request) {
      return new URL(typeof request === 'string' ? request : request.url, scope).href;
    }
    async match(request) {
      return this.entries.get(this.key(request))?.clone();
    }
    async put(request, response) {
      if (failWrite) throw new Error('QuotaExceededError');
      this.entries.set(this.key(request), response.clone());
    }
    async delete(request) {
      return this.entries.delete(this.key(request));
    }
    async keys() {
      return [...this.entries.keys()].map((key) => new Request(key));
    }
    async addAll(keys) {
      precached.push(...keys);
      for (const key of keys) await this.put(key, new Response(`shell:${key}`));
    }
  }
  const storage = {
    async open(name) {
      if (failOpen) throw new Error('SecurityError');
      if (!caches.has(name)) caches.set(name, new MemoryCache());
      return caches.get(name);
    },
    async keys() {
      return [...caches.keys()];
    },
    async delete(name) {
      removed.push(name);
      return caches.delete(name);
    },
    async match() {
      throw new Error('Unscoped cache lookup is forbidden');
    }
  };
  const worker = {
    registration: { scope },
    caches: storage,
    addEventListener(type, fn) {
      handlers.set(type, fn);
    },
    skipWaiting() {
      throw new Error('Premature worker activation');
    },
    clients: {
      claim() {
        throw new Error('Premature client claim');
      }
    },
    async fetch(request) {
      fetched.push(request.url ?? request);
      return fetchImpl(request);
    }
  };
  const config = {
    build: [new URL('app.js', scope).href],
    files: [new URL('fonts/default.woff2', scope).href],
    prerendered: [scope, new URL('b', scope).href],
    version,
    userFontsCacheName: 'userFonts',
    ...overrides
  };
  registerReaderServiceWorker(worker, config);
  const prefix = `manabi-reader:${encodeURIComponent(scope)}:`;
  return {
    worker,
    config,
    storage,
    caches,
    removed,
    fetched,
    precached,
    prefix,
    shell: `${prefix}shell:${version}`,
    fonts: `${prefix}remote-fonts:${version}`,
    packagedFonts: `${prefix}packaged-fonts:v1`,
    staticFonts: `${prefix}static-fonts:${version}`,
    setFetch(fn) {
      fetchImpl = fn;
    },
    setFailWrite(value) {
      failWrite = value;
    },
    setFailOpen(value) {
      failOpen = value;
    },
    async event(type) {
      const promises = [];
      handlers.get(type)({
        waitUntil(promise) {
          promises.push(promise);
        }
      });
      await Promise.all(promises);
    },
    request(path, init = {}) {
      let response;
      handlers.get('fetch')({
        request: typeof path === 'string' ? new Request(new URL(path, scope), init) : path,
        respondWith(promise) {
          assert.equal(response, undefined);
          response = promise;
        }
      });
      return response;
    }
  };
}

test('activation only deletes obsolete namespaced shell/font generations', async () => {
  const h = makeHarness();
  const otherScope = `manabi-reader:${encodeURIComponent(url('/other/'))}:shell:old`;
  const keep = [
    h.shell,
    h.fonts,
    h.packagedFonts,
    'userFonts',
    'build:old',
    'other:old',
    'foreign-app',
    'manabitan-dictionaries',
    `${h.prefix}dictionary:old`,
    otherScope
  ];
  const discard = [`${h.prefix}shell:old`, `${h.prefix}remote-fonts:old`];
  for (const name of [...keep, ...discard]) await h.storage.open(name);
  await h.event('activate');
  assert.deepEqual(h.removed.sort(), discard.sort());
  assert.deepEqual((await h.storage.keys()).sort(), keep.sort());
});

test('installation never skips waiting or claims existing tabs', async () => {
  const h = makeHarness();
  await h.event('install');
  await h.event('activate');
  assert.deepEqual(h.precached.sort(), [url('/'), url('/b'), url('/app.js')].sort());
});

test('archive, dictionary and WASM assets are not mandatory shell entries', async () => {
  const h = makeHarness({
    files: [
      '/dict.ZIP?download=1',
      '/dictionaries/preset.bin',
      '/dictionary-archives/jiten.zip',
      '/manabitan/worker.js',
      '/sqlite.wasm',
      '/book.epub',
      '/backup.htmlz',
      '/dict.sqlite3',
      '/dict.db',
      '/%64ictionaries/entries.bin',
      '/%2E%2E%2Fdictionaries/data',
      '/%ff',
      '/icon.png'
    ]
  });
  await h.event('install');
  assert.deepEqual(
    h.precached.filter((p) => ![url('/'), url('/b'), url('/app.js')].includes(p)),
    [url('/icon.png')]
  );
});

test('explicit lazy runtime asset list is excluded even under hashed build paths', async () => {
  const h = makeHarness({
    build: ['/app.js', '/_app/immutable/worker-123.js'],
    lazyAssets: ['/_app/immutable/worker-123.js']
  });
  await h.event('install');
  assert.ok(!h.precached.some((p) => p.includes('worker-123')));
});

test('install only accepts same-origin assets within the registration scope', async () => {
  const h = makeHarness({
    scope: url('/reader/'),
    files: ['/elsewhere/a.js', 'https://cdn.example/b.js', '/reader/icon.png']
  });
  await h.event('install');
  assert.ok(h.precached.every((p) => p.startsWith(url('/reader/'))));
});

test('shell responses are pinned to the active generation rather than network HTML', async () => {
  const h = makeHarness();
  await h.event('install');
  assert.equal(await body(await h.request('/')), `shell:${url('/')}`);
  assert.equal(h.fetched.length, 0);
});

test('offline navigation query parameters use only the current shell', async () => {
  const h = makeHarness();
  await h.event('install');
  h.setFetch(async () => {
    throw new Error('offline');
  });
  assert.equal(await body(await h.request('/b?id=21&position=7')), `shell:${url('/b')}`);
});

test('unrelated caches cannot poison shell responses', async () => {
  const h = makeHarness();
  await (await h.storage.open('foreign-app')).put(url('/app.js'), new Response('poison'));
  assert.equal(await body(await h.request('/app.js')), `network:${url('/app.js')}`);
});

test('missing shell entry is fetched but never written into the old generation', async () => {
  const h = makeHarness();
  await h.request('/b');
  assert.equal((await h.storage.open(h.shell)).entries.size, 0);
});

test('explicit user-font cache cannot read a foreign cache with the same path', async () => {
  const h = makeHarness();
  await (
    await h.storage.open('foreign-app')
  ).put(url('/userfonts/mine.woff2'), new Response('foreign'));
  let response = await h.request('/userfonts/mine.woff2');
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('location'), null);
  await (
    await h.storage.open('userFonts')
  ).put(url('/userfonts/mine.woff2'), new Response('owned'));
  response = await h.request('/userfonts/mine.woff2');
  assert.equal(await body(response), 'owned');
});

test('user-font fallback and historical book links honor the registration scope', async () => {
  const h = makeHarness({ scope: url('/reader/') });
  const font = await h.request('/reader/userfonts/missing.ttf');
  assert.equal(font.status, 404);
  assert.equal(font.headers.get('location'), null);
  const book = await h.request('/reader/b/123?position=8&id=old');
  assert.equal(book.headers.get('location'), url('/reader/b?position=8&id=123'));
  assert.equal(h.request('/other/b/123'), undefined);
  assert.equal(h.request('/reader/nested/b/123'), undefined);
});

test('POST, range, unrelated-origin, unrecognized and only-if-cached requests pass through', () => {
  const h = makeHarness();
  assert.equal(h.request('/app.js', { method: 'POST' }), undefined);
  assert.equal(h.request('/app.js', { headers: { range: 'bytes=0-99' } }), undefined);
  assert.equal(h.request('/app.js', { cache: 'only-if-cached', mode: 'same-origin' }), undefined);
  assert.equal(h.request('https://another.example/app.js'), undefined);
  assert.equal(h.request('https://reader.example:444/app.js'), undefined);
  assert.equal(h.request('/dict.zip'), undefined);
  assert.equal(h.request('/app.js?v=unrecognized'), undefined);
  assert.equal(h.request('https://fonts.googleapis.com/not-css'), undefined);
});

test('successful remote-font response is cached in the owned cache for offline use', async () => {
  const h = makeHarness();
  const font = 'https://fonts.googleapis.com/css2?family=Noto';
  assert.equal(await body(await h.request(font)), `network:${font}`);
  h.setFetch(async () => {
    throw new Error('offline');
  });
  assert.equal(await body(await h.request(font)), `network:${font}`);
});

test('remote-font HTTP errors do not overwrite a known-good stylesheet', async () => {
  const h = makeHarness();
  const font = 'https://fonts.googleapis.com/css?family=Noto';
  await h.request(font);
  h.setFetch(async () => new Response('server error', { status: 503 }));
  assert.equal(await body(await h.request(font)), `network:${font}`);
  assert.equal(await body(await (await h.storage.open(h.fonts)).match(font)), `network:${font}`);
});

test('font-cache write failures never turn a successful network response into an error', async () => {
  const h = makeHarness();
  h.setFailWrite(true);
  assert.equal((await h.request('https://fonts.googleapis.com/css?family=Noto')).status, 200);
});

test('cache-unavailable online shell/font responses remain usable', async () => {
  const h = makeHarness();
  h.setFailOpen(true);
  assert.equal((await h.request('/app.js')).status, 200);
  assert.equal((await h.request('https://fonts.googleapis.com/css?family=Noto')).status, 200);
});

test('remote-font cache is bounded independently of user fonts and dictionaries', async () => {
  const h = makeHarness();
  const saved = await h.storage.open('userFonts');
  await saved.put(url('/userfonts/a'), new Response('saved'));
  for (let i = 0; i < 40; i++) await h.request(`https://fonts.googleapis.com/css?family=${i}`);
  assert.equal((await h.storage.open(h.fonts)).entries.size, 32);
  assert.equal(saved.entries.size, 1);
});

test('shell failure is surfaced instead of reporting a successful offline installation', async () => {
  const h = makeHarness();
  h.setFailWrite(true);
  await assert.rejects(h.event('install'), /Quota/);
});

test('archive classification is URL based, case insensitive and fails closed on invalid encoding', () => {
  assert.equal(isShellAsset(new URL(url('/archive.%7aip?download=1'))), false);
  assert.equal(isShellAsset(new URL(url('/invalid%zz'))), false);
  assert.equal(isShellAsset(new URL(url('/styles.css'))), true);
});

test('packaged fonts are fetched only on use and then work offline', async () => {
  const h = makeHarness();
  await h.event('install');
  assert.equal(
    h.precached.some((p) => /\.(woff2?|ttf|otf)$/.test(p)),
    false
  );
  assert.equal(h.fetched.length, 0);
  assert.equal(
    await body(await h.request('/fonts/default.woff2')),
    `network:${url('/fonts/default.woff2')}`
  );
  h.setFetch(async () => {
    throw new Error('offline');
  });
  assert.equal(
    await body(await h.request('/fonts/default.woff2')),
    `network:${url('/fonts/default.woff2')}`
  );
  assert.equal(h.fetched.length, 1);
});

test('font classification excludes imported fonts, dictionary assets and unknown URLs', () => {
  const h = makeHarness();
  for (const p of [
    '/fonts/unknown.woff2',
    '/fonts/default.woff2?x=1',
    '/other/font.ttf',
    'https://cdn.example/font.woff2'
  ])
    assert.equal(h.request(p), undefined);
  for (const p of [
    '/userfonts/a.woff2',
    '/manabitan/a.ttf',
    '/dictionaries/a.otf',
    '/font.woff2?x=1',
    '/%ff.woff2'
  ])
    assert.equal(isPackagedFont(new URL(url(p))), false);
  assert.equal(isPackagedFont(new URL(url('/_app/immutable/assets/Klee.ABC.woff2'))), true);
});

test('every packaged font format is excluded from the shell, case-insensitively', async () => {
  const h = makeHarness({ files: ['/a.WOFF', '/b.WOFF2', '/c.TTF', '/d.OTF', '/icon.png'] });
  await h.event('install');
  assert.deepEqual(
    h.precached.sort(),
    [url('/'), url('/b'), url('/app.js'), url('/icon.png')].sort()
  );
});

test('font error responses are not mistaken for usable cached font data', async () => {
  const h = makeHarness();
  h.setFetch(async () => new Response('missing', { status: 404 }));
  assert.equal((await h.request('/fonts/default.woff2')).status, 404);
  assert.equal((await h.storage.open(h.staticFonts)).entries.size, 0);
});

test('font quota failures preserve successful online font responses', async () => {
  const h = makeHarness();
  h.setFailWrite(true);
  assert.equal((await h.request('/fonts/default.woff2')).status, 200);
});

test('font-cache unavailability does not prevent online reading', async () => {
  const h = makeHarness();
  h.setFailOpen(true);
  assert.equal((await h.request('/fonts/default.woff2')).status, 200);
});

test('font upgrade pruning keeps unchanged hashes, user fonts and foreign scopes', async () => {
  const h = makeHarness({
    scope: url('/reader-web/'),
    build: [url('/reader-web/fonts/default.woff2')]
  });
  const cache = await h.storage.open(h.packagedFonts);
  await cache.put(url('/reader-web/fonts/default.woff2'), new Response('same'));
  await cache.put(url('/reader-web/fonts/old-hash.woff2'), new Response('obsolete'));
  const other = await h.storage.open('another-scope:packaged-fonts:v1');
  await other.put(url('/font.woff2'), new Response('foreign'));
  const user = await h.storage.open('userFonts');
  await user.put(url('/userfonts/font.woff2'), new Response('custom'));
  await h.event('activate');
  assert.equal(await body(await cache.match(url('/reader-web/fonts/default.woff2'))), 'same');
  assert.equal(await cache.match(url('/reader-web/fonts/old-hash.woff2')), undefined);
  assert.equal(other.entries.size, 1);
  assert.equal(user.entries.size, 1);
});

test('same-path static fonts are versioned so an upgrade cannot reuse old bytes', async () => {
  const h = makeHarness();
  h.setFetch(async () => new Response('old static font'));
  await h.request('/fonts/default.woff2');
  registerReaderServiceWorker(h.worker, { ...h.config, version: 'next' });
  h.setFetch(async () => new Response('new static font'));
  await h.event('activate');
  assert.equal(await body(await h.request('/fonts/default.woff2')), 'new static font');
});
