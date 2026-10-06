/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import 'fake-indexeddb/auto';
import { openDB, deleteDB } from 'idb';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  DOMParser: dom.window.DOMParser
});
const output = mkdtempSync(join(tmpdir(), 'native-catalog-dom-'));
process.on('exit', () => rmSync(output, { recursive: true, force: true }));
// Exercise the real public feed/download, catalog storage wrapper and guarded IDB read.
// Only app-singleton wiring, the BrowserStorageHandler base and the heavy EPUB importer
// are adapters here; the existing importer/browser suites own parser/write qualification.
const modules = {
  store: `export const database={get db(){return Promise.resolve(globalThis.catalogFixture.db)}}; const value={getValue:()=> 'new'}; export const replicationSaveBehavior$=value,statisticsMergeMode$=value,readingGoalsMergeMode$=value;`,
  persistence: `export const integrationDB=async()=>({getAll:async()=>globalThis.catalogFixture.links});`,
  scope: `export function captureLibraryOperation(){ const f=globalThis.catalogFixture; const profileId=f.profile; const generation=f.generation; return {profileId,signal:f.controller.signal,stop(){f.stops++},assertCurrent(){f.controller.signal.throwIfAborted();if(f.generation!==generation||f.profile!==profileId)throw new Error('profile changed')}}; }`,
  source: `export async function sha256(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}`,
  handler: `export class BrowserStorageHandler { updateSettings(){} async saveBook(book){const f=globalThis.catalogFixture;f.baseSaves++;const saved={...book,id:7};await f.db.put('data',saved);return 7;} }`,
  importer: `export async function importData(document,handler,files,signal){const f=globalThis.catalogFixture;f.imports++;return f.importer(handler,files[0],signal);}`,
  service: `export class NativeCatalogService { constructor(repository){Object.assign(this,repository)} }`
};
const outfile = join(output, 'catalog.cjs');
await build({
  entryPoints: ['apps/web/src/native-library/catalog-dom.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  tsconfig: 'apps/web/tsconfig.json',
  logLevel: 'silent',
  plugins: [
    {
      name: 'dom-singleton-adapters',
      setup(b) {
        b.onResolve(
          {
            filter:
              /(?:^|\/)(?:store|persistence|operation-scope|sources|browser-handler|replicator|catalog-service)$/
          },
          ({ path }) => {
            const key = path.endsWith('/data/store')
              ? 'store'
              : path.endsWith('/manabi/persistence')
                ? 'persistence'
                : path.endsWith('/operation-scope')
                  ? 'scope'
                  : path.endsWith('/manabi/sources')
                    ? 'source'
                    : path.endsWith('/browser-handler')
                      ? 'handler'
                      : path.endsWith('/replicator')
                        ? 'importer'
                        : path.endsWith('/catalog-service')
                          ? 'service'
                          : undefined;
            return key ? { path: key, namespace: 'fixture' } : undefined;
          }
        );
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents: modules[path],
          loader: 'js',
          resolveDir: process.cwd()
        }));
      }
    }
  ]
});
const { createNativeCatalogService, NATIVE_CATALOG_ORIGIN } = require(outfile);
async function moduleBundle(path, name) {
  const outfile = join(output, name + '.cjs');
  await build({
    entryPoints: [resolve(path)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    tsconfig: 'apps/web/tsconfig.json',
    logLevel: 'silent'
  });
  return require(outfile);
}
const { loadEditorsPicks, downloadEditorsPick } = await moduleBundle(
  'apps/web/src/lib/library/editors-picks.ts',
  'network'
);
const { readAdmittedBook } = await moduleBundle(
  'apps/web/src/lib/data/database/books-db/admitted-book-read.ts',
  'read'
);
const bytes = Uint8Array.of(0x50, 0x4b, 3, 4, 1, 2, 3, 4);
const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
  .map((x) => x.toString(16).padStart(2, '0'))
  .join('');
const pick = {
  id: 'urn:book:1',
  title: 'Public title',
  author: 'Author',
  summary: '',
  bookUrl: NATIVE_CATALOG_ORIGIN + '/static/reader/books/library/book.epub'
};
const stored = (extra = {}) => ({
  id: 7,
  title: 'Saved title',
  contentHash: hash,
  lastBookModified: 10,
  elementHtml: '<p>Original content</p>',
  ...extra
});
let serial = 0;
async function fixture(t) {
  const name = `catalog-${++serial}`;
  const db = await openDB(name, 1, {
    upgrade(db) {
      db.createObjectStore('data', { keyPath: 'id' });
      db.createObjectStore('readerBookScope', { keyPath: 'bookId' });
      db.createObjectStore('readerLocalIdentity', { keyPath: 'bookId' });
    }
  });
  const controller = new AbortController();
  const f = {
    db,
    links: [],
    profile: null,
    generation: 0,
    controller,
    imports: 0,
    baseSaves: 0,
    stops: 0,
    importer: async (handler, _file, signal) => {
      const reused = await handler.findReusableBookByContentHash(hash, signal);
      if (reused === undefined) await handler.saveBook(stored());
      return '';
    }
  };
  globalThis.catalogFixture = f;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, pick.bookUrl);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    return new Response(bytes);
  };
  const authority = {
    key: 'session:0',
    signal: controller.signal,
    assertCurrent() {
      controller.signal.throwIfAborted();
      if (f.generation !== 0) throw new Error('account ABA');
    }
  };
  t.after(async () => {
    controller.abort();
    db.close();
    await deleteDB(name);
    globalThis.fetch = originalFetch;
    delete globalThis.catalogFixture;
  });
  return { ...f, f, authority, repo: createNativeCatalogService() };
}
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

test('DOM catalog adapter reuses owned content and exact canonical identity without invoking importer or replacing saved progress', async (t) => {
  const { f, db, repo, authority } = await fixture(t);
  const book = stored({ lastBookOpen: 500, customData: 'preserved' });
  await db.put('data', book);
  const result = await repo.prepare(pick, authority);
  assert.deepEqual(result, {
    bookId: 7,
    contentHash: hash,
    readerBookKey: `content:${hash}`,
    title: 'Saved title',
    lastBookModified: 10
  });
  assert.deepEqual(await db.get('data', 7), book);
  assert.equal(f.imports, 0);
  assert.equal(f.baseSaves, 0);
  assert.equal(f.stops, 1);
});

test('original catalog ownership lookup rejects foreign, source-bound and ambiguous matching copies', async (t) => {
  const { f, db, repo, authority } = await fixture(t);
  for (const scenario of ['durable', 'links', 'scope', 'source', 'duplicate']) {
    await db.clear('data');
    await db.clear('readerBookScope');
    f.links = [];
    await db.put(
      'data',
      stored(
        scenario === 'durable'
          ? { libraryOwner: 'other-user' }
          : scenario === 'source'
            ? { storageSource: { id: 'remote' } }
            : {}
      )
    );
    if (scenario === 'links') f.links = [{ bookId: 7, owner: 'other-user', contentHash: hash }];
    if (scenario === 'scope')
      await db.put('readerBookScope', { bookId: 7, accountId: 'other-user' });
    if (scenario === 'duplicate') await db.put('data', stored({ id: 8 }));
    await assert.rejects(
      repo.prepare(pick, authority),
      /unavailable|another account|connected library|Several local copies/
    );
    assert.equal(f.imports, 0);
    assert.equal(f.baseSaves, 0);
  }
});

test('a matching copy arriving in importer preflight records its exact ID without saving or duplicating it', async (t) => {
  const { f, db, repo, authority } = await fixture(t);
  f.importer = async (handler) => {
    const book = stored({ id: 12, lastBookOpen: 200 });
    await db.put('data', book);
    assert.equal(await handler.findReusableBookByContentHash(hash), 12);
    return '';
  };
  const result = await repo.prepare(pick, authority);
  assert.equal(result.bookId, 12);
  assert.equal(f.imports, 1);
  assert.equal(f.baseSaves, 0);
  assert.equal(await db.count('data'), 1);
  assert.equal((await db.get('data', 12)).lastBookOpen, 200);
});

test('catalog import cancellation before storage leaves nothing; cancellation after commit keeps copy but denies reader admission', async (t) => {
  const { f, db, repo, authority } = await fixture(t);
  const waiting = deferred(),
    began = deferred();
  f.importer = async (_handler, _file, signal) => {
    began.resolve();
    await waiting.promise;
    signal.throwIfAborted();
    return '';
  };
  const pending = repo.prepare(pick, authority);
  const rejected = assert.rejects(pending);
  await began.promise;
  f.controller.abort();
  waiting.resolve();
  await rejected;
  assert.equal(await db.count('data'), 0);
});
test('a committed catalog copy survives late cancellation without opening or pretending rollback', async (t) => {
  const { f, db, repo, authority } = await fixture(t);
  f.importer = async (handler) => {
    await handler.saveBook(stored());
    f.controller.abort();
    return '';
  };
  await assert.rejects(repo.prepare(pick, authority));
  assert.equal(await db.count('data'), 1);
  assert.equal((await db.get('data', 7)).contentHash, hash);
});

test('actual canonical reader transaction rejects replaced content, profile ownership and aborted authority after catalog preparation', async (t) => {
  const { f, db, repo, authority } = await fixture(t);
  await db.put('data', stored());
  const expected = await repo.prepare(pick, authority);
  const readAuthority = { ...authority, profileId: null };
  await db.put('data', stored({ contentHash: 'b'.repeat(64) }));
  await assert.rejects(readAdmittedBook(db, expected, readAuthority), /changed/);
  await db.put('data', stored());
  await db.put('readerBookScope', { bookId: 7, accountId: 'foreign-profile' });
  await assert.rejects(readAdmittedBook(db, expected, readAuthority), /another account/);
  await db.clear('readerBookScope');
  f.controller.abort();
  await assert.rejects(readAdmittedBook(db, expected, readAuthority));
});

test('DOM adapter captures profile/account before any suspended download and rejects A→B→A', async (t) => {
  const { f, repo, authority } = await fixture(t),
    waiting = deferred();
  globalThis.fetch = async () => {
    await waiting.promise;
    return new Response(bytes);
  };
  const opening = repo.prepare(pick, authority);
  const rejected = assert.rejects(opening, /changed|ABA/);
  f.profile = 'second-profile';
  f.generation++;
  f.profile = null;
  f.generation++;
  waiting.resolve();
  await rejected;
  assert.equal(f.imports, 0);
  assert.equal(f.stops, 1);
});

const index =
  '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>All Books</title><link rel="subsection" href="/static/reader/books/opds/feeds/all.xml"/></entry></feed>';
const entry = (url = '/static/reader/books/library/book.epub', id = 'id:1') =>
  `<entry><id>${id}</id><title>Title</title><link rel="http://opds-spec.org/acquisition" type="application/epub+zip" href="${url}"/></entry>`;
test('existing public feed restricts paths/origins/credentials and retains omit credentials, redirect refusal and bound signals', async (t) => {
  const originalFetch = globalThis.fetch,
    calls = [];
  const controller = new AbortController();
  globalThis.fetch = async (url, options) => {
    calls.push([url, options]);
    return new Response(
      calls.length === 1
        ? index
        : `<feed xmlns="http://www.w3.org/2005/Atom">${entry()}${entry('https://evil.test/static/reader/books/library/book.epub', 'id:2')}${entry('https://user:secret@manabi.io/static/reader/books/library/book.epub', 'id:3')}${entry('/static/reader/books/library/%2e%2e/private.epub', 'id:4')}</feed>`
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const result = await loadEditorsPicks(NATIVE_CATALOG_ORIGIN, controller.signal);
  assert.equal(result.length, 1);
  assert.equal(result[0].bookUrl, pick.bookUrl);
  for (const [url, options] of calls) {
    assert.ok(url.startsWith(NATIVE_CATALOG_ORIGIN + '/static/reader/books/opds/'));
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal(options.signal, controller.signal);
  }
});

test('existing downloader refuses partial, oversized and non-EPUB bodies and cancels rejected response streams', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  for (const [status, length, data, pattern] of [
    [206, '8', bytes, /complete response/],
    [200, String(80 * 1024 * 1024 + 1), bytes, /too large/],
    [200, '4', Uint8Array.of(1, 2, 3, 4), /not a valid EPUB/]
  ]) {
    let cancelled = false;
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(data);
      },
      cancel() {
        cancelled = true;
      }
    });
    globalThis.fetch = async () =>
      new Response(stream, { status, headers: { 'content-length': length } });
    if (status === 200 && length === '4') globalThis.fetch = async () => new Response(data);
    await assert.rejects(downloadEditorsPick(pick), pattern);
    if (status !== 200 || Number(length) > bytes.length) assert.equal(cancelled, true);
  }
});

test('new adapter calls existing catalog/import/storage/admitted-read implementations and never creates a second database owner', () => {
  const source = readFileSync('apps/web/src/native-library/catalog-dom.ts', 'utf8');
  for (const existing of [
    'loadEditorsPicks(NATIVE_CATALOG_ORIGIN',
    'downloadEditorsPick(pick, signal)',
    'extends EditorsPickStorageHandler',
    'importData(document, handler, [file], signal)',
    'validateEditorsPickCopy(id, digest, owner, signal)',
    'readAdmittedBook(db, identity'
  ])
    assert.ok(source.includes(existing), existing);
  assert.doesNotMatch(
    source,
    /indexedDB\.open|openDB\(|fetch\(|credentials:|document\.cookie|DocumentPicker/
  );
});

for (const replacement of [{ storageSource: 'connected-folder' }, { elementHtml: '' }])
  test(
    'catalog adapter validates catalog eligibility on the actual admitted record after a preflight race: ' +
      Object.keys(replacement)[0],
    async (t) => {
      const { f, db, repo, authority } = await fixture(t);
      await db.put('data', stored());
      let reads = 0;
      f.db = new Proxy(db, {
        get(target, key) {
          if (key === 'get')
            return async (...args) => {
              const book = await target.get(...args);
              if (++reads === 2) await target.put('data', { ...book, ...replacement });
              return book;
            };
          const value = target[key];
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
      await assert.rejects(repo.prepare(pick, authority), /catalog copy changed/);
      assert.equal(f.imports, 0);
      assert.equal(f.baseSaves, 0);
      assert.deepEqual(await db.get('data', 7), stored(replacement));
    }
  );
