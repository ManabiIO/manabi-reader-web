/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import 'fake-indexeddb/auto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

const require = createRequire(import.meta.url);
async function load(entry, edition, extra = {}) {
  const output = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    tsconfig: 'apps/web/tsconfig.json',
    define: {
      'process.env.EXPO_PUBLIC_READER_EDITION': JSON.stringify(edition),
      'process.env.EXPO_PUBLIC_READER_NAME': 'undefined',
      'process.env.EXPO_PUBLIC_READER_STORAGE_NAMESPACE': 'undefined',
      ...extra
    }
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', output.outputFiles[0].text)(
    module,
    module.exports,
    require
  );
  return module.exports;
}
class MemoryStorage {
  rows = new Map();
  get length() {
    return this.rows.size;
  }
  key(index) {
    return [...this.rows.keys()][index] ?? null;
  }
  getItem(key) {
    return this.rows.get(key) ?? null;
  }
  setItem(key, value) {
    this.rows.set(key, value);
  }
  removeItem(key) {
    this.rows.delete(key);
  }
}
const entry = 'apps/web/src/runtime/edition-storage.ts';

test('each edition owns separate preferences while backups retain their logical keys', async () => {
  const physical = new MemoryStorage();
  physical.setItem('theme', 'old development preference');
  physical.setItem('flashcards.setting', 'unrelated app');
  const open = (await load(entry, 'manabitan')).editionStorage(physical);
  const privateApp = (await load(entry, 'manabi')).editionStorage(physical);
  assert.equal(open.getItem('theme'), null);
  assert.equal(privateApp.getItem('theme'), null);
  open.setItem('theme', 'light');
  privateApp.setItem('theme', 'dark');
  open.setItem('pageTurnEffect', 'slide');
  assert.equal(open.getItem('theme'), 'light');
  assert.equal(privateApp.getItem('theme'), 'dark');
  assert.equal(physical.getItem('manabitan-reader-v1:theme'), 'light');
  assert.equal(physical.getItem('manabi-reader-v1:theme'), 'dark');
  const logicalBackup = Object.fromEntries(
    Array.from({ length: open.length }, (_, i) => {
      const key = open.key(i);
      return [key, open.getItem(key)];
    })
  );
  assert.deepEqual(logicalBackup, { theme: 'light', pageTurnEffect: 'slide' });
  open.clear();
  assert.equal(open.length, 0);
  assert.equal(privateApp.getItem('theme'), 'dark');
  assert.equal(physical.getItem('theme'), 'old development preference');
  assert.equal(physical.getItem('flashcards.setting'), 'unrelated app');
  for (const [key, value] of Object.entries(logicalBackup)) privateApp.setItem(key, value);
  assert.equal(privateApp.getItem('pageTurnEffect'), 'slide');
  assert.equal(open.getItem('pageTurnEffect'), null);
});

test('default authoritative books databases coexist without reading or upgrading the other edition', async () => {
  const priorIDB = globalThis.indexedDB,
    priorRange = globalThis.IDBKeyRange;
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
  const connections = [];
  try {
    const factory = 'apps/web/src/lib/data/database/books-db/factory.ts';
    const open = await (await load(factory, 'manabitan')).createBooksDb();
    connections.push(open);
    const privateApp = await (await load(factory, 'manabi')).createBooksDb();
    connections.push(privateApp);
    assert.equal(open.name, 'manabitan-reader-v1:books');
    assert.equal(privateApp.name, 'manabi-reader-v1:books');
    await open.put('statistic', {
      title: 'Open reader book',
      dateKey: '2026-11-05',
      readingTime: 60
    });
    assert.equal((await open.getAll('statistic')).length, 1);
    assert.deepEqual(await privateApp.getAll('statistic'), []);
    await privateApp.put('statistic', {
      title: 'Private reader book',
      dateKey: '2026-11-05',
      readingTime: 120
    });
    assert.equal((await open.getAll('statistic'))[0].title, 'Open reader book');
  } finally {
    for (const db of connections) db.close();
    globalThis.indexedDB = priorIDB;
    globalThis.IDBKeyRange = priorRange;
  }
});

test('edition identity and resource names are fixed at build time', async () => {
  const open = await load('apps/web/src/runtime/edition.ts', 'manabitan');
  const privateApp = await load('apps/web/src/runtime/edition.ts', 'manabi');
  assert.equal(open.readerName, 'Manabitan Reader');
  assert.equal(privateApp.readerName, 'Manabi Reader for Web');
  assert.notEqual(open.storageName('ttu-userfonts'), privateApp.storageName('ttu-userfonts'));
  assert.equal(open.logicalStorageKey(privateApp.storageName('theme')), null);
  await assert.rejects(
    load('apps/web/src/runtime/edition.ts', 'unknown'),
    /Unknown Reader edition/
  );
  await assert.rejects(
    load('apps/web/src/runtime/edition.ts', 'manabi', {
      'process.env.EXPO_PUBLIC_READER_STORAGE_NAMESPACE': JSON.stringify('../invalid')
    }),
    /Invalid Reader storage namespace/
  );
});

test('Reader media, profile and search consumers share only their edition database', async () => {
  const idb = new IDBFactory();
  const { MediaStore } = await load('apps/web/src/lib/media/store.ts', 'manabitan');
  const publicFactory = (await load('apps/web/src/runtime/reader-media-store.ts', 'manabitan'))
    .createReaderMediaStore;
  const privateFactory = (await load('apps/web/src/runtime/reader-media-store.ts', 'manabi'))
    .createReaderMediaStore;
  const legacy = new MediaStore(idb, 'manabi-media-v1');
  const publicMedia = publicFactory(idb),
    publicSearch = publicFactory(idb),
    privateMedia = privateFactory(idb);
  try {
    await legacy.putLocal('guest', 'fixture', 'same-id', 'untouched development data');
    await publicMedia.putLocal('guest', 'fixture', 'same-id', 'public media');
    assert.equal(await publicSearch.local('guest', 'fixture', 'same-id'), 'public media');
    assert.equal(await privateMedia.local('guest', 'fixture', 'same-id'), undefined);
    await privateMedia.putLocal('guest', 'fixture', 'same-id', 'private media');
    assert.equal(await publicSearch.local('guest', 'fixture', 'same-id'), 'public media');
    assert.equal(await legacy.local('guest', 'fixture', 'same-id'), 'untouched development data');
    assert.deepEqual((await idb.databases()).map((database) => database.name).sort(), [
      'manabi-media-v1',
      'manabi-reader-v1:manabi-media-v1',
      'manabitan-reader-v1:manabi-media-v1'
    ]);
  } finally {
    await Promise.all(
      [legacy, publicMedia, publicSearch, privateMedia].map((store) => store.close())
    );
  }
});
