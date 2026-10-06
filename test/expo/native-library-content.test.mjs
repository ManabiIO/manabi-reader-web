/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
const output = mkdtempSync(join(tmpdir(), 'native-library-content-'));
const require = createRequire(import.meta.url);
function bundle(path, name) {
  const outfile = join(output, `${name}.cjs`);
  buildSync({
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
const { NativeLibraryContentSearchService } = bundle(
  'apps/web/src/native-library/content-search-service.ts',
  'service'
);
const { NativeContentSearchController } = bundle(
  'apps/web/src/native-library/content-search-controller.ts',
  'controller'
);
const { NativeLibraryService } = bundle('apps/web/src/native-library/service.ts', 'library');
const { projectSearchBook, findContent } = bundle(
  'apps/web/src/lib/library/content-search.ts',
  'matching'
);
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const hash = 'a'.repeat(64);
const book = (id = 1, extra = {}) => ({
  key: `book:${id}`,
  bookId: id,
  organizationKey: `content:${hash}`,
  organizationAliases: [`book:${id}`],
  title: `Saved ${id}`,
  canonicalTitle: `Saved ${id}`,
  imagePath: '',
  characters: 1000,
  lastBookModified: 10,
  lastBookOpen: 1,
  progress: 0.1,
  lastBookmarkModified: 1,
  isPlaceholder: false,
  direction: 'unknown',
  contentHash: hash,
  ...extra
});
const locator = (extra = {}) => ({
  version: 1,
  bookKey: `content:${hash}`,
  resource: { href: 'chapter.xhtml', spineIndex: 0, sectionId: 'section' },
  projectionVersion: 2,
  resourceDigest: 'b'.repeat(64),
  start: 3,
  end: 4,
  quote: '本',
  prefix: '私は',
  suffix: 'です',
  ...extra
});
const hit = (extra = {}) => ({
  bookId: 1,
  locator: locator(),
  excerpt: '私は本です',
  excerptMatch: { start: 2, end: 3 },
  ...extra
});
function setup(t, options = {}) {
  let serial = 0,
    time = 100,
    scope = 'session:1';
  const controller = new AbortController();
  const searches = [],
    validated = [];
  const authority = {
    key: scope,
    signal: controller.signal,
    assertCurrent() {
      if (scope !== authority.key) throw new Error('stale owner');
    }
  };
  const repository = {
    async books(view, owner) {
      owner.assertCurrent();
      await options.waitBooks?.promise;
      return options.books ?? [book()];
    },
    async search(query, books, owner, receive) {
      const run = { query, books, owner, receive, stops: 0 };
      searches.push(run);
      return () => {
        run.stops++;
      };
    },
    async validate(book, location, owner) {
      await options.waitValidate?.promise;
      owner.signal.throwIfAborted();
      owner.assertCurrent();
      validated.push({ book, location });
      return {
        bookId: book.bookId,
        contentHash: book.contentHash,
        title: book.canonicalTitle,
        lastBookModified: book.lastBookModified,
        readerBookKey: location.bookKey
      };
    }
  };
  const service = new NativeLibraryContentSearchService(
    repository,
    () => `opaque_${++serial}`,
    () => time
  );
  t.after(() => service.dispose());
  return {
    service,
    authority,
    searches,
    validated,
    cancel: () => controller.abort(),
    changeScope: (value) => {
      scope = value;
    },
    tick: (amount) => {
      time += amount;
    }
  };
}
test('strict requests bound queries, page sizes and reject arbitrary files, locators and account data', async (t) => {
  const f = setup(t);
  for (const payload of [
    { query: '' },
    { query: 'x'.repeat(513) },
    { query: '本', owner: 'other' },
    { query: '本', view: { url: 'https://example.test' } },
    { query: '本', view: { query: 'override' } },
    { query: '本', view: { source: 'x'.repeat(129) } }
  ])
    assert.throws(() => f.service.start(payload, f.authority));
  const result = f.service.start({ query: '本' }, f.authority);
  await flush();
  for (const payload of [
    { token: result.token, limit: 31 },
    { token: result.token, offset: -1 },
    { token: result.token, offset: 301 },
    { token: result.token, locator: locator() }
  ])
    assert.throws(() => f.service.read(payload, f.authority));
  await assert.rejects(
    f.service.admitOpen({ token: result.token, hit: 'unknown', locator: locator() }, f.authority)
  );
});
test('the original worker results expose only bounded native excerpts and opaque handles', async (t) => {
  const f = setup(t);
  const started = f.service.start({ query: '本' }, f.authority);
  await flush();
  f.searches[0].receive({ hits: [hit()], busy: false, failed: 0, truncated: false });
  const result = f.service.read({ token: started.token }, f.authority);
  assert.equal(result.status, 'ready');
  assert.equal(result.total, 1);
  assert.deepEqual(result.items[0].match, { start: 2, end: 3 });
  const encoded = JSON.stringify(result);
  for (const secret of [
    'content:',
    'resourceDigest',
    'chapter.xhtml',
    'organizationAliases',
    'locator',
    'accountId'
  ])
    assert.ok(!encoded.includes(secret), secret);
  const admitted = await f.service.admitOpen(
    { token: result.token, hit: result.items[0].key },
    f.authority
  );
  assert.deepEqual(admitted.locator, locator());
  assert.equal(admitted.identity.readerBookKey, `content:${hash}`);
  await assert.rejects(
    f.service.admitOpen({ token: result.token, hit: result.items[0].key }, f.authority),
    /expired/
  );
});
test('partial results, failures, truncation, paging and hit tokens remain stable across worker batches', async (t) => {
  const f = setup(t);
  const started = f.service.start({ query: '本' }, f.authority);
  await flush();
  const hits = Array.from({ length: 305 }, (_, index) =>
    hit({ locator: locator({ start: index, end: index + 1 }) })
  );
  f.searches[0].receive({ hits: hits.slice(0, 1), busy: true, failed: 0, truncated: false });
  const first = f.service.read({ token: started.token }, f.authority).items[0].key;
  f.searches[0].receive({ hits, busy: false, failed: 2, truncated: false });
  const result = f.service.read({ token: started.token }, f.authority);
  assert.equal(result.items.length, 30);
  assert.equal(result.total, 300);
  assert.equal(result.failed, 2);
  assert.equal(result.truncated, true);
  assert.equal(result.items[0].key, first);
  assert.equal(f.service.read({ token: result.token, offset: 270 }, f.authority).items.length, 30);
});
test('replacement query cancellation, account revocation, expiry and disposal terminate the active worker', async (t) => {
  const f = setup(t);
  const old = f.service.start({ query: '古い' }, f.authority);
  await flush();
  const next = f.service.start({ query: '新しい' }, f.authority);
  await flush();
  assert.equal(f.searches[0].stops, 1);
  f.service.cancel({ token: old.token }, f.authority);
  assert.equal(f.service.read({ token: next.token }, f.authority).query, '新しい');
  f.tick(600001);
  assert.throws(() => f.service.read({ token: next.token }, f.authority), /expired/);
  f.cancel();
  assert.equal(f.searches[1].stops, 1);
  assert.throws(() => f.service.start({ query: '本' }, f.authority));
});
test('cancelled pending load cannot launch a worker or retain an old query', async (t) => {
  const waitBooks = deferred();
  const f = setup(t, { waitBooks });
  const result = f.service.start({ query: '本' }, f.authority);
  f.service.cancel({ token: result.token }, f.authority);
  waitBooks.resolve();
  await flush();
  assert.equal(f.searches.length, 0);
  assert.throws(() => f.service.read({ token: result.token }, f.authority), /expired/);
});
test('cancellation during passage validation cannot authorize opening', async (t) => {
  const waitValidate = deferred();
  const f = setup(t, { waitValidate });
  const result = f.service.start({ query: '本' }, f.authority);
  await flush();
  f.searches[0].receive({ hits: [hit()], busy: false, failed: 0, truncated: false });
  const row = f.service.read({ token: result.token }, f.authority).items[0];
  const opening = f.service.admitOpen({ token: result.token, hit: row.key }, f.authority);
  f.service.cancel({ token: result.token }, f.authority);
  waitValidate.resolve();
  await assert.rejects(opening);
  assert.equal(f.validated.length, 0);
});
test('only available imported copies are forwarded to the canonical source and malformed hits are withheld', async (t) => {
  const f = setup(t, {
    books: [book(), book(2, { isPlaceholder: true }), book(3, { bookId: undefined })]
  });
  const result = f.service.start({ query: '本' }, f.authority);
  await flush();
  assert.deepEqual(
    f.searches[0].books.map((book) => book.bookId),
    [1]
  );
  f.searches[0].receive({
    hits: [
      hit({ bookId: 2 }),
      hit({ excerptMatch: { start: -1, end: 3 } }),
      hit({ locator: locator({ start: -1 }) }),
      hit()
    ],
    busy: false,
    failed: 0,
    truncated: false
  });
  const read = f.service.read({ token: result.token }, f.authority);
  assert.equal(read.total, 1);
  assert.equal(read.failed, 3);
});
test('repository failure produces a safe error without leaking source paths', async (t) => {
  const waitBooks = deferred();
  const f = setup(t, { waitBooks });
  const result = f.service.start({ query: '本' }, f.authority);
  waitBooks.reject(new Error('private file /other-account/source'));
  await flush();
  const read = f.service.read({ token: result.token }, f.authority);
  assert.equal(read.status, 'error');
  assert.ok(!JSON.stringify(read).includes('/other-account'));
});
test('scope helper preserves collection filters but does not apply metadata search to passage candidates', async () => {
  const books = [
    book(),
    book(2, { title: 'A different title', canonicalTitle: 'A different title' }),
    book(3, { isPlaceholder: true })
  ];
  const data = {
    tree: books.map((book) => ({ kind: 'book', id: book.key, book })),
    organization: {
      version: 1,
      collections: [{ id: 'chosen', name: 'Chosen', members: ['book:2'] }],
      books: {}
    },
    sources: []
  };
  const service = new NativeLibraryService({
    load: async () => structuredClone(data),
    write: async () => {}
  });
  const authority = { key: 'scope', signal: new AbortController().signal, assertCurrent() {} };
  assert.deepEqual(
    (await service.searchBooks({ query: 'will not match any title' }, authority)).map(
      (book) => book.bookId
    ),
    [1, 2]
  );
  const selected = await service.searchBooks({ collection: 'chosen' }, authority);
  assert.deepEqual(
    selected.map((book) => book.bookId),
    [2]
  );
  const old = structuredClone(books[0]);
  books[0].contentHash = 'b'.repeat(64);
  await assert.rejects(service.validateSearchBook(old, authority), /changed/);
  service.dispose();
});
test('canonical projection preserves Japanese matching, hidden/ruby exclusions and exact passage coordinates', async () => {
  const resources = projectSearchBook(
    '<section id="a"><p>先頭😀<ruby>学校<rt>がっこう</rt></ruby> カタカナ ＡＢＣ</p><p hidden>秘密</p></section>'
  );
  const source = { id: 1, key: `content:${hash}` };
  const found = await findContent(resources, 'ｶﾀｶﾅ', source);
  assert.equal(found.hits.length, 1);
  assert.equal(found.hits[0].locator.quote, 'カタカナ');
  assert.equal(
    found.hits[0].excerpt.slice(found.hits[0].excerptMatch.start, found.hits[0].excerptMatch.end),
    'カタカナ'
  );
  assert.equal((await findContent(resources, 'abc', source)).hits[0].locator.quote, 'ＡＢＣ');
  assert.equal((await findContent(resources, '秘密', source)).hits.length, 0);
  assert.equal((await findContent(resources, 'がっこう', source)).hits.length, 0);
  assert.deepEqual(await findContent(resources, '学校', source, () => true), {
    hits: [],
    truncated: false
  });
});
const response = (token, extra = {}) => ({
  token,
  query: '本',
  status: 'ready',
  items: [
    {
      key: 'hit',
      bookId: 1,
      title: 'Saved',
      section: 1,
      excerpt: '本',
      match: { start: 0, end: 1 }
    }
  ],
  total: 1,
  offset: 0,
  limit: 30,
  failed: 0,
  truncated: false,
  ...extra
});
test('native controller cancels delayed old starts without replacing newer results', async (t) => {
  const one = deferred(),
    two = deferred(),
    calls = [];
  let starts = 0;
  const controller = new NativeContentSearchController(
    async (method, payload) => {
      calls.push({ method, payload });
      if (method === 'library.content.start') return ++starts === 1 ? one.promise : two.promise;
      return null;
    },
    () => {}
  );
  t.after(() => controller.dispose());
  const old = controller.start('one', {}),
    next = controller.start('two', {});
  two.resolve(response('new'));
  await next;
  one.resolve(response('old'));
  await old;
  assert.equal(controller.state.result.token, 'new');
  assert.ok(
    calls.some((call) => call.method === 'library.content.cancel' && call.payload.token === 'old')
  );
});
test('native controller prevents duplicate opens and stale navigation after cancel/unmount', async (t) => {
  const waitOpen = deferred(),
    calls = [],
    navigation = [];
  const controller = new NativeContentSearchController(
    async (method, payload) => {
      calls.push({ method, payload });
      return method === 'library.content.start'
        ? response('search')
        : method === 'open'
          ? waitOpen.promise
          : null;
    },
    () => {}
  );
  t.after(() => controller.dispose());
  await controller.start('本', {});
  const row = controller.state.result.items[0];
  const opening = controller.open(row, (id) => navigation.push(id));
  await controller.open(row, (id) => navigation.push(id));
  assert.equal(calls.filter((call) => call.method === 'open').length, 1);
  assert.deepEqual(calls.find((call) => call.method === 'open').payload, {
    bookId: 1,
    librarySearchToken: 'search',
    librarySearchHit: 'hit'
  });
  controller.cancel();
  waitOpen.resolve({ bookId: 1 });
  await opening;
  assert.deepEqual(navigation, []);
});
test('native controller survives effect replay and rejects late page reads', async (t) => {
  const page = deferred();
  const controller = new NativeContentSearchController(
    async (method) =>
      method === 'library.content.start'
        ? response('search')
        : method === 'library.content.read'
          ? page.promise
          : null,
    () => {}
  );
  t.after(() => controller.dispose());
  controller.dispose();
  controller.activate();
  await controller.start('本', {});
  const reading = controller.load(0);
  controller.cancel();
  page.resolve(response('search'));
  await reading;
  assert.equal(controller.state.result, undefined);
});
test('native UI explicitly submits IME text, cancels drafts/view changes and retains metadata search', () => {
  const ui = readFileSync('apps/web/src/native-library/content-search.tsx', 'utf8');
  const library = readFileSync('apps/web/src/native-library/index.tsx', 'utf8');
  assert.match(ui, /onSubmitEditing=\{submit\}/);
  assert.match(ui, /controller\.start\(input\.value, view\)/);
  assert.match(ui, /controller\.cancel\(\)/);
  assert.match(ui, /usePathname/);
  assert.match(ui, /accessibilityLabel=\{`Open passage/);
  assert.match(library, /Search books, authors, or series/);
  assert.match(library, /NativeLibraryContentSearch/);
  const dom = readFileSync('apps/web/src/native-library/content-search-dom.ts', 'utf8');
  assert.match(
    dom,
    /import \{ searchBookContents \} from '\.\.\/lib\/search\/book-content-source'/
  );
  assert.match(dom, /readerBookKeyFor\(identity.bookId, identity.contentHash\)/);
  assert.match(dom, /snapshotReaderLocator\(locator, readerBookKey\)/);
});
