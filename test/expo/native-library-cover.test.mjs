/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import 'fake-indexeddb/auto';
import { openDB, deleteDB } from 'idb';
const output = mkdtempSync(join(tmpdir(), 'native-library-cover-'));
const require = createRequire(import.meta.url);
function bundle(name) {
  const outfile = join(output, `${name}.cjs`);
  buildSync({
    entryPoints: [resolve(`apps/web/src/native-library/${name}.ts`)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    tsconfig: 'apps/web/tsconfig.json',
    logLevel: 'silent'
  });
  return require(outfile);
}
const { NativeLibraryService } = bundle('service');
const { NativeLibraryCoverService } = bundle('cover-service');
const { NativeLibraryCoverController } = bundle('cover-controller');
const { renderNativeLibraryCover } = bundle('cover-dom');
const { readNativeLibrarySummaries } = bundle('cover-records');
const { nativeOwnedCards } = bundle('view-model');
const { validNativeLibraryCover, LIBRARY_COVER_MAX_BYTES } = bundle('cover-contract');
process.on('exit', () => rmSync(output, { recursive: true, force: true }));
const hash = 'ab'.repeat(32);
const uuid = '12345678-1234-4234-8234-123456789abc';
const png = 'data:image/png;base64,aGVsbG8=';
const jpeg = { uri: 'data:image/jpeg;base64,/9j/2Q==', width: 20, height: 30 };
const book = () => ({
  key: 'book:1',
  bookId: 1,
  organizationKey: `content:${hash}`,
  organizationAliases: [`content:${hash}`, 'book:1'],
  title: 'A book',
  canonicalTitle: 'A book',
  lastBookModified: 10,
  imagePath: png,
  contentHash: hash,
  isPlaceholder: false,
  characters: 100,
  progress: 0,
  lastBookOpen: 1,
  lastBookmarkModified: 0,
  direction: 'unknown'
});
const organization = () => ({ version: 1, books: {}, collections: [] });
function guard() {
  const abort = new AbortController();
  let current = true;
  return {
    key: 'session:0',
    signal: abort.signal,
    assertCurrent() {
      if (!current) throw new Error('owner changed');
    },
    abort: () => abort.abort(),
    change: () => {
      current = false;
    }
  };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { resolve, promise };
}
function targets() {
  return new Map([['opaque', { book: book(), readerBookKey: `content:${hash}` }]]);
}

test('cover DTO permits only bounded re-encoded raster bytes', () => {
  assert.equal(validNativeLibraryCover(jpeg), true);
  for (const image of [
    { ...jpeg, uri: 'https://provider.test/token' },
    { ...jpeg, uri: 'file:///private' },
    { ...jpeg, uri: 'data:image/svg+xml;base64,AAAA' },
    { ...jpeg, width: 241 },
    { ...jpeg, height: 361 },
    { ...jpeg, width: Infinity },
    { ...jpeg, path: '/private' },
    {
      ...jpeg,
      uri: 'data:image/jpeg;base64,' + Buffer.alloc(LIBRARY_COVER_MAX_BYTES + 1).toString('base64')
    },
    { ...jpeg, uri: 'data:image/jpeg;base64,A' }
  ])
    assert.equal(validNativeLibraryCover(image), false);
});
test('cover reads use independent latest-view admissions without consuming edit actions', async () => {
  let serial = 0,
    writes = 0;
  const g = guard();
  const data = {
    tree: [{ kind: 'book', id: 'book:1', book: book() }],
    organization: organization(),
    sources: [],
    coverIdentities: { 1: `content:${hash}` }
  };
  const library = new NativeLibraryService(
    {
      load: async () => data,
      write: async () => {
        writes++;
      },
      cover: async () => jpeg
    },
    () => `opaque-${++serial}`
  );
  const state = await library.state({}, g);
  assert.notEqual(state.coverToken, state.token);
  assert.equal(state.items[0].hasCover, true);
  assert.doesNotMatch(JSON.stringify(state), /data:image|content:|https:|file:|readerBookKey/);
  const read = { token: state.coverToken, key: state.items[0].key, request: 'request' };
  assert.deepEqual((await library.readCover(read, g)).image, jpeg);
  await library.action(
    {
      token: state.token,
      type: 'presentation',
      keys: [state.items[0].key],
      change: { title: 'Edited' }
    },
    g
  );
  assert.equal(writes, 1);
  assert.deepEqual((await library.readCover({ ...read, request: 'again' }, g)).image, jpeg);
  const next = await library.state({}, g);
  await assert.rejects(library.readCover(read, g), /expired/);
  await assert.rejects(library.readCover({ ...read, token: next.token }, g), /expired/);
  library.dispose();
});
test('forged fields, unseen books, stale profile/expiry and more than two jobs fail closed', async () => {
  let now = 0;
  const wait = deferred();
  const service = new NativeLibraryCoverService(
    async () => wait.promise,
    () => now
  );
  const g = guard();
  service.install('view', g.key, targets());
  for (const payload of [
    { token: 'view', key: 'opaque', request: 'x', url: 'https://bad' },
    { token: 'view', key: 'other', request: 'x' },
    { token: 'view', key: 'opaque', request: 'x'.repeat(129) },
    { token: 'view', key: 1, request: 'x' }
  ])
    await assert.rejects(service.read(payload, g));
  const a = service.read({ token: 'view', key: 'opaque', request: 'a' }, g);
  const b = service.read({ token: 'view', key: 'opaque', request: 'b' }, g);
  await assert.rejects(service.read({ token: 'view', key: 'opaque', request: 'c' }, g), /Too many/);
  assert.throws(() => service.cancel({ token: 'view', requests: ['a', 'b', 'c'] }, g));
  service.cancel({ token: 'view', requests: ['a'] }, g);
  wait.resolve(jpeg);
  assert.equal((await a).image, null);
  assert.deepEqual((await b).image, jpeg);
  now = 600001;
  await assert.rejects(service.read({ token: 'view', key: 'opaque', request: 'd' }, g), /expired/);
  service.install('new', g.key, targets());
  g.change();
  await assert.rejects(
    service.read({ token: 'new', key: 'opaque', request: 'e' }, g),
    /owner changed/
  );
});
test('refresh/disposal cancel old decode without letting old cancellation revoke a newer view', async () => {
  const wait = deferred(),
    g = guard();
  const service = new NativeLibraryCoverService(async () => wait.promise);
  service.install('old', g.key, targets());
  const pending = service.read({ token: 'old', key: 'opaque', request: 'old-request' }, g);
  service.install('new', g.key, targets());
  service.cancel({ token: 'old' }, g);
  wait.resolve(jpeg);
  assert.equal((await pending).image, null);
  assert.deepEqual(
    (await service.read({ token: 'new', key: 'opaque', request: 'new-request' }, g)).image,
    jpeg
  );
  service.dispose();
  await assert.rejects(
    service.read({ token: 'new', key: 'opaque', request: 'late' }, g),
    /expired/
  );
});
test('native viewport requests are lazy, capped, cached, cancelled and stale-response fenced', async () => {
  const reads = [],
    cancels = [],
    states = [];
  const controller = new NativeLibraryCoverController(
    (method, payload) => {
      if (method.endsWith('cancel')) {
        cancels.push(payload);
        return Promise.resolve({ cancelled: true });
      }
      const wait = deferred();
      reads.push({ ...payload, resolve: wait.resolve });
      return wait.promise;
    },
    (state) => states.push(state)
  );
  const keys = Array.from({ length: 60 }, (_, i) => `key-${i}`);
  controller.setView('view', keys);
  assert.equal(reads.length, 0);
  controller.viewport(keys);
  assert.equal(reads.length, 2);
  for (let i = 0; i < 12; i++) {
    const read = reads[i];
    read.resolve({ ...read, image: jpeg });
    await tick();
  }
  assert.equal(reads.length, 12);
  controller.viewport(keys);
  assert.equal(reads.length, 12, 'visible cache entries do not poll');
  controller.viewport(keys.slice(12));
  assert.equal(reads.length, 14);
  controller.setView('new', keys);
  assert.equal(states.at(-1).images.size, 0);
  assert.ok(cancels.some((x) => x.token === 'view' && !x.requests));
  reads[12].resolve({ ...reads[12], image: jpeg });
  reads[13].resolve({ ...reads[13], image: jpeg });
  await tick();
  assert.equal(states.at(-1).images.size, 0, 'old image cannot populate new token');
  assert.equal(reads[14].token, 'new');
  controller.setActive(false);
  assert.ok(cancels.some((x) => x.token === 'new' && x.requests?.length === 2));
  controller.dispose();
  for (const read of reads.slice(14)) read.resolve({ ...read, image: jpeg });
  await tick();
});
test('native cache never grows beyond 24 covers and malformed replies do not poll', async () => {
  let state,
    count = 0;
  const controller = new NativeLibraryCoverController(
    async (method, payload) => {
      if (method.endsWith('cancel')) return {};
      count++;
      return { ...payload, image: jpeg };
    },
    (next) => {
      state = next;
    }
  );
  const keys = Array.from({ length: 60 }, (_, i) => `book-${i}`);
  controller.setView('view', keys);
  for (let i = 0; i < 60; i += 6) {
    controller.viewport(keys.slice(i, i + 6));
    await tick();
    assert.ok(state.images.size <= 24);
  }
  assert.equal(count, 60);
  controller.dispose();
  let malformed = 0;
  const bad = new NativeLibraryCoverController(
    async () => {
      malformed++;
      return {};
    },
    () => {}
  );
  bad.setView('view', ['key']);
  bad.viewport(['key']);
  await tick();
  await tick();
  assert.equal(malformed, 1);
  bad.dispose();
});
async function dbFixture(t, extra = {}) {
  const name = `native-cover-${crypto.randomUUID()}`;
  const db = await openDB(name, 1, {
    upgrade(db) {
      db.createObjectStore('data', { keyPath: 'id' });
      db.createObjectStore('readerBookScope', { keyPath: 'bookId' });
      db.createObjectStore('readerLocalIdentity', { keyPath: 'bookId' });
    }
  });
  const row = {
    id: 1,
    title: 'A book',
    lastBookModified: 10,
    contentHash: hash,
    coverImage: png,
    elementHtml: '<p>Saved</p>',
    ...extra
  };
  await db.put('data', row);
  t.after(async () => {
    db.close();
    await deleteDB(name);
  });
  return { db, row };
}
test('real DB summary snapshot retains covers and legacy UUIDs without creating identities', async (t) => {
  const { db } = await dbFixture(t, { contentHash: undefined });
  const g = guard();
  let snapshot = await readNativeLibrarySummaries(db, g);
  assert.equal(snapshot.summaries[0].coverImage, png);
  assert.equal(snapshot.coverIdentities[1], undefined);
  assert.equal(await db.count('readerLocalIdentity'), 0);
  await db.put('readerLocalIdentity', { bookId: 1, uuid });
  snapshot = await readNativeLibrarySummaries(db, g);
  assert.equal(snapshot.coverIdentities[1], `local:${uuid}`);
  const owned = nativeOwnedCards(snapshot.summaries, [], [], [], null);
  assert.equal(owned.cards[0].imagePath, png);
  const damaged = nativeOwnedCards(
    [{ ...snapshot.summaries[0], coverImage: { format: 'bad' } }],
    [],
    [],
    [],
    null
  );
  assert.equal(damaged.cards[0].imagePath, '');
});
test('real guarded records reject numeric-ID replacement both before and during decode', async (t) => {
  const { db, row } = await dbFixture(t);
  const target = targets().get('opaque');
  const g = guard();
  let decoded = 0;
  const render = async () => {
    decoded++;
    return jpeg;
  };
  assert.deepEqual(
    await renderNativeLibraryCover(db, target, null, g, async () => organization(), render),
    jpeg
  );
  await db.put('data', { ...row, contentHash: 'cd'.repeat(32) });
  assert.equal(
    await renderNativeLibraryCover(db, target, null, g, async () => organization(), render),
    null
  );
  assert.equal(decoded, 1);
  await db.put('data', row);
  assert.equal(
    await renderNativeLibraryCover(
      db,
      target,
      null,
      g,
      async () => organization(),
      async () => {
        await db.put('data', { ...row, contentHash: 'ef'.repeat(32) });
        return jpeg;
      }
    ),
    null
  );
});
test('real guarded legacy UUID replacement, foreign ownership, cover edits and blur edits fail closed', async (t) => {
  const { db, row } = await dbFixture(t, { contentHash: undefined });
  await db.put('readerLocalIdentity', { bookId: 1, uuid });
  const target = { book: { ...book(), contentHash: undefined }, readerBookKey: `local:${uuid}` };
  const g = guard();
  let org = organization();
  const run = (raster = async () => jpeg) =>
    renderNativeLibraryCover(db, target, null, g, async () => org, raster);
  assert.deepEqual(await run(), jpeg);
  assert.equal(
    await run(async () => {
      await db.put('readerLocalIdentity', {
        bookId: 1,
        uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      });
      return jpeg;
    }),
    null
  );
  await db.put('readerLocalIdentity', { bookId: 1, uuid });
  await db.put('data', { ...row, libraryOwner: 'another-profile' });
  assert.equal(await run(), null);
  await db.put('data', row);
  await db.put('readerBookScope', { bookId: 1, accountId: 'another-profile' });
  assert.equal(await run(), null);
  await db.delete('readerBookScope', 1);
  assert.equal(
    await run(async () => {
      org.books['book:1'] = { coverBlur: true, modifiedAt: 1 };
      return jpeg;
    }),
    null
  );
  org = organization();
  assert.equal(
    await run(async () => {
      await db.put('data', { ...row, coverImage: 'data:image/png;base64,bmV3' });
      return jpeg;
    }),
    null
  );
});
test('owner changes and cancellation after asynchronous rasterization never publish image bytes', async (t) => {
  const { db } = await dbFixture(t),
    target = targets().get('opaque');
  for (const cancel of ['abort', 'change']) {
    const g = guard();
    await assert.rejects(
      renderNativeLibraryCover(
        db,
        target,
        null,
        g,
        async () => organization(),
        async () => {
          g[cancel]();
          return jpeg;
        }
      )
    );
  }
});
test('native cover module graph contains no DOM database/provider/file capability', () => {
  const result = buildSync({
    entryPoints: [
      'apps/web/src/native-library/cover.tsx',
      'apps/web/src/native-library/cover-controller.ts'
    ],
    bundle: true,
    write: false,
    outdir: output,
    platform: 'neutral',
    packages: 'external',
    metafile: true,
    tsconfig: 'apps/web/tsconfig.json',
    logLevel: 'silent'
  });
  for (const path of Object.keys(result.metafile.inputs))
    assert.doesNotMatch(
      path,
      /cover-dom|cover-records|cover-raster|data\/database|manabi\/|platform\/reader-runtime/
    );
  const source = readFileSync('apps/web/src/native-library/index.tsx', 'utf8');
  assert.match(source, /onViewableItemsChanged/);
  assert.match(source, /covers\.token === state\?\.coverToken && !loading/);
});

test('expired viewport admission refreshes once without polling failures or retired owners', async () => {
  let reads = 0,
    refreshes = 0;
  const controller = new NativeLibraryCoverController(
    async (method) => {
      if (method === 'library.cover.cancel') return { cancelled: true };
      reads++;
      throw new Error('This Library cover view expired.');
    },
    () => {},
    () => {
      refreshes++;
      controller.setView(`replacement-${refreshes}`, ['a', 'b']);
    }
  );
  controller.setView('idle-view', ['a', 'b']);
  controller.viewport(['a', 'b']);
  await tick();
  assert.equal(refreshes, 1, 'concurrent expiry failures share one refresh');
  assert.equal(reads, 4, 'each visible cover tried once on each of two admissions');
  await tick();
  assert.equal(refreshes, 1, 'a replacement failure does not poll or refresh itself');
  controller.viewport(['b']);
  await tick();
  assert.equal(refreshes, 1, 'cached fallback does not reread on identical visibility');
  controller.setView('next-user-view', ['a']);
  controller.viewport(['a']);
  await tick();
  assert.equal(refreshes, 2, 'a later user viewport can recover a new expired admission');
  controller.dispose();
  await tick();
  assert.equal(refreshes, 2, 'retired owners cannot refresh');
});
