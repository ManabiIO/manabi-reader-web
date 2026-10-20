/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import * as fakeIndexedDB from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';
import { Buffer, atob, btoa } from 'node:buffer';

const { outputFiles } = await build({
  entryPoints: ['apps/web/src/lib/appearance/backgrounds.ts'],
  tsconfig: 'apps/web/tsconfig.json',
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser'
});
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6KeAAAAAASUVORK5CYII=',
  'base64'
);
const old = {
  light: {
    revision: 'light-before',
    name: 'light.png',
    dataUrl: 'data:image/png;base64,' + png.toString('base64')
  },
  dark: {
    revision: 'dark-before',
    name: 'dark.png',
    dataUrl: 'data:image/png;base64,' + png.toString('base64')
  }
};
const request = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
async function fixture(t) {
  const factory = new fakeIndexedDB.IDBFactory();
  const opening = factory.open('manabi-reader-appearance', 1);
  opening.onupgradeneeded = () => opening.result.createObjectStore('backgrounds');
  const db = await request(opening);
  await request(
    db.transaction('backgrounds', 'readwrite').objectStore('backgrounds').put(old, 'reader')
  );
  const images = [],
    canvases = [],
    module = { exports: {} };
  let decode = (image) => queueMicrotask(() => image.onload?.());
  let encode = (callback) => queueMicrotask(() => callback(new Blob([png], { type: 'image/png' })));
  runInNewContext(outputFiles[0].text, {
    ...fakeIndexedDB,
    indexedDB: factory,
    module,
    exports: module.exports,
    Blob,
    File,
    DOMException,
    AbortController,
    Uint8Array,
    DataView,
    crypto: webcrypto,
    atob,
    btoa,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    Image: class {
      constructor() {
        this.naturalWidth = 1;
        this.naturalHeight = 1;
        images.push(this);
      }
      set src(value) {
        this.url = value;
        if (value) decode(this);
      }
      get src() {
        return this.url;
      }
    },
    document: {
      createElement(tag) {
        assert.equal(tag, 'canvas');
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage() {} }),
          toBlob: (callback) => encode(callback)
        };
        canvases.push(canvas);
        return canvas;
      }
    }
  });
  const api = module.exports;
  let state;
  const stop = api.backgrounds.subscribe((value) => (state = value));
  const life = new AbortController();
  let current = true;
  const authority = {
    signal: life.signal,
    assertCurrent() {
      if (!current) throw new Error('Reader lifetime changed');
    }
  };
  const originalPut = fakeIndexedDB.IDBObjectStore.prototype.put;
  const originalGet = fakeIndexedDB.IDBObjectStore.prototype.get;
  t.after(() => {
    stop();
    db.close();
    fakeIndexedDB.IDBObjectStore.prototype.put = originalPut;
    fakeIndexedDB.IDBObjectStore.prototype.get = originalGet;
  });
  return {
    api,
    authority,
    life,
    images,
    canvases,
    state: () => state.reader,
    retire: () => {
      current = false;
    },
    decode: (callback) => {
      decode = callback;
    },
    encode: (callback) => {
      encode = callback;
    },
    file: () => new File([png], 'new.png', { type: 'image/png' }),
    read: () => request(db.transaction('backgrounds').objectStore('backgrounds').get('reader')),
    afterPut(callback) {
      fakeIndexedDB.IDBObjectStore.prototype.put = function (...args) {
        const result = originalPut.apply(this, args);
        if (this.name === 'backgrounds') callback(result, this.transaction);
        return result;
      };
    },
    afterGet(callback) {
      fakeIndexedDB.IDBObjectStore.prototype.get = function (...args) {
        const result = originalGet.apply(this, args);
        if (this.name === 'backgrounds')
          result.addEventListener('success', callback, { once: true });
        return result;
      };
    }
  };
}

test('guarded background replacement and removal retain the original database and independent mode slots', async (t) => {
  const f = await fixture(t);
  await f.api.chooseBackground('reader', 'light', f.file(), f.authority);
  let saved = await f.read();
  assert.equal(saved.light.name, 'new.png');
  assert.notEqual(saved.light.revision, old.light.revision);
  assert.deepEqual(saved.dark, old.dark);
  assert.equal(f.canvases[0].width, 0);
  assert.equal(f.images[0].src, '');
  await f.api.removeBackground('reader', 'light', f.authority);
  saved = await f.read();
  assert.deepEqual(saved, { dark: old.dark });
  await f.api.removeBackgrounds('reader', f.authority);
  assert.equal(await f.read(), undefined);
});

test('a retired queued background operation cannot decode, save or publish an error into its replacement', async (t) => {
  const f = await fixture(t),
    started = deferred(),
    release = deferred();
  f.encode((callback) => {
    started.resolve();
    void release.promise.then(() => callback(new Blob([png], { type: 'image/png' })));
  });
  const first = f.api.chooseBackground('reader', 'light', f.file());
  await started.promise;
  const second = f.api.removeBackgrounds('reader', f.authority);
  const rejected = assert.rejects(second, { name: 'AbortError' });
  f.life.abort();
  release.resolve();
  await first;
  await rejected;
  const saved = await f.read();
  assert.equal(saved.light.name, 'new.png');
  assert.deepEqual(saved.dark, old.dark);
  assert.equal(f.canvases.length, 1);
  assert.equal(f.state().light.busy, false);
  assert.equal(f.state().light.error, undefined);
});

test('aborting image decode immediately releases its image without replacing the saved slot', async (t) => {
  const f = await fixture(t),
    started = deferred();
  f.decode(() => started.resolve());
  const pending = f.api.chooseBackground('reader', 'light', f.file(), f.authority);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await started.promise;
  f.life.abort();
  await rejected;
  assert.deepEqual(await f.read(), old);
  assert.equal(f.images[0].src, '');
  assert.equal(f.images[0].onload, null);
  assert.equal(f.images[0].onerror, null);
  assert.equal(f.canvases.length, 0);
  assert.equal(f.state().light.busy, false);
  assert.equal(f.state().light.error, undefined);
});

test('reader replacement during canvas encoding rejects the prepared image and releases canvas memory', async (t) => {
  const f = await fixture(t),
    started = deferred(),
    release = deferred();
  f.encode((callback) => {
    started.resolve();
    void release.promise.then(() => callback(new Blob([png], { type: 'image/png' })));
  });
  const pending = f.api.chooseBackground('reader', 'light', f.file(), f.authority);
  const rejected = assert.rejects(pending, /Reader lifetime changed/);
  await started.promise;
  f.retire();
  release.resolve();
  await rejected;
  assert.deepEqual(await f.read(), old);
  assert.equal(f.canvases[0].width, 0);
  assert.equal(f.canvases[0].height, 0);
  assert.equal(f.images[0].src, '');
  assert.equal(f.state().light.error, undefined);
});

for (const both of [false, true])
  test(`background ${both ? 'all-mode' : 'single-mode'} removal rechecks ownership after its transaction read`, async (t) => {
    const f = await fixture(t);
    f.afterGet(() => f.retire());
    await assert.rejects(
      both
        ? f.api.removeBackgrounds('reader', f.authority)
        : f.api.removeBackground('reader', 'light', f.authority),
      /Reader lifetime changed/
    );
    assert.deepEqual(await f.read(), old);
    assert.equal(f.state().light.busy, false);
    assert.equal(f.state().light.error, undefined);
  });

test('abort after put success but before transaction commit preserves the previous image', async (t) => {
  const f = await fixture(t);
  f.afterPut((result) => result.addEventListener('success', () => f.life.abort(), { once: true }));
  await assert.rejects(f.api.chooseBackground('reader', 'light', f.file(), f.authority), {
    name: 'AbortError'
  });
  assert.deepEqual(await f.read(), old);
  assert.equal(f.state().light.error, undefined);
});

test('a committed background is retained when its native editor expires at transaction completion', async (t) => {
  const f = await fixture(t);
  f.afterPut((_result, tx) =>
    tx.addEventListener('complete', () => f.life.abort(), { once: true })
  );
  await f.api.chooseBackground('reader', 'light', f.file(), f.authority);
  assert.equal((await f.read()).light.name, 'new.png');
  assert.equal(f.state().light.busy, false);
  assert.equal(f.state().light.error, undefined);
});

test('ordinary storage failure remains visible and a later explicit browser retry can save', async (t) => {
  const f = await fixture(t);
  let fail = true;
  f.afterPut((result, tx) =>
    result.addEventListener(
      'success',
      () => {
        if (fail) tx.abort();
      },
      { once: true }
    )
  );
  await assert.rejects(f.api.chooseBackground('reader', 'light', f.file()), { name: 'AbortError' });
  assert.deepEqual(await f.read(), old);
  assert.match(f.state().light.error, /previous image has been kept/i);
  assert.equal(f.state().light.busy, false);
  fail = false;
  await f.api.chooseBackground('reader', 'light', f.file());
  assert.equal((await f.read()).light.name, 'new.png');
  assert.equal(f.state().light.error, undefined);
});
