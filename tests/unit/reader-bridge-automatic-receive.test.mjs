/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { compileFunction } from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const dom = new JSDOM('<!doctype html><title>Saved reader connections</title>');
const { document } = dom.window;
const { crypto, indexedDB } = globalThis;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
let lockAvailable = true,
  leaseCalls = 0;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    locks: {
      request(name, options, work) {
        assert.equal(options.mode, 'exclusive');
        assert.equal(options.ifAvailable, true);
        leaseCalls++;
        return Promise.resolve().then(() => work(lockAvailable ? { name } : null));
      }
    }
  }
});
globalThis.document = document;
// The source manifest, ZIP reader, content comparison, connection validator and
// DB transactions are production code. Only account/HTTP/store entrypoints are controlled.
const compiled = await build({
  stdin: {
    contents: `export * from './apps/web/src/lib/manabi/reader-bridge-automatic-receive.ts';
      export { setDriveReaderAutomaticReceive } from './apps/web/src/lib/manabi/reader-bridge-local.ts';
      export { previewDriveReaderBridge, captureDriveReaderPreview } from './apps/web/src/lib/manabi/reader-bridge-source.ts';
      export { captureReaderBridgeLocalBook } from './apps/web/src/lib/manabi/reader-bridge-local-book.ts';
      export { createBooksDb } from './apps/web/src/lib/data/database/books-db/factory.ts';
      export { encodeBook } from './apps/web/src/lib/data/database/books-db/book-binary.ts';
      export { prepareReaderImportContent } from './apps/web/src/lib/manabi/reader-import-content.ts';`,
    resolveDir: root,
    loader: 'ts'
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  alias: { $lib: root + 'apps/web/src/lib' },
  plugins: [
    {
      name: 'saved-connection-boundary',
      setup(builder) {
        builder.onResolve({ filter: /^\.\/(client|operation-scope)$/ }, (args) => ({
          path: args.path,
          namespace: 'boundary'
        }));
        builder.onResolve({ filter: /^\.\.\/data\/store$/ }, (args) => ({
          path: args.path,
          namespace: 'boundary'
        }));
        builder.onLoad({ filter: /.*/, namespace: 'boundary' }, () => ({
          contents:
            'export const { request, IntegrationError, captureLibraryOperation, database } = harness;',
          loader: 'js'
        }));
      }
    }
  ]
});
const { ZipReader, Uint8ArrayReader, Uint8ArrayWriter, configure } = await import(
  require.resolve('@zip.js/zip.js')
);
configure({ useWebWorkers: false });
const zip = new ZipReader(
  new Uint8ArrayReader(
    new Uint8Array(
      await readFile(new URL('../fixtures/yatsu/complete-local-backup-v11.zip', import.meta.url))
    )
  ),
  { useWebWorkers: false }
);
const contents = {},
  files = [];
let title;
try {
  for (const entry of await zip.getEntries()) {
    const match = entry.filename.match(/(?:^|\/)(bookdata|progress|statistics)_[^/]+$/);
    if (!match) continue;
    const role = { bookdata: 'book', progress: 'resume', statistics: 'statistics' }[match[1]];
    title = entry.filename.split('/').at(-2);
    let bytes = await entry.getData(new Uint8ArrayWriter());
    // Exercise the supported common reading fields against a real book package.
    // Yatsu layout/dictionary fields remain a separately asserted review hold.
    if (role !== 'book') {
      const value = JSON.parse(new TextDecoder().decode(bytes));
      if (role === 'resume') {
        for (const key of [
          'targetSectionIndex',
          'targetSectionId',
          'sourceViewMode',
          'sourceReaderLayoutKey',
          'sourceBookCharCount'
        ])
          delete value[key];
        value.progress = 0.25;
        value.exploredCharCount = 18;
      } else for (const row of value) delete row.dictionaryPopupOpenCount;
      bytes = new TextEncoder().encode(JSON.stringify(value));
    }
    contents[role] = bytes;
    files.push({
      id: role,
      role,
      name:
        role === 'resume'
          ? entry.filename
              .split('/')
              .at(-1)
              .replace(/_0\.json$/, '_0.25.json')
          : entry.filename.split('/').at(-1),
      version: '1',
      parents: ['folder'],
      mime: 'application/octet-stream',
      size: bytes.byteLength,
      md5: createHash('md5').update(bytes).digest('hex')
    });
  }
} finally {
  await zip.close();
}
const selection = {
  owner: 'alice',
  connection: '00000000-0000-4000-8000-000000000001',
  root: 'root',
  folder: 'folder',
  profile: 'yatsu-1-11'
};
const initialManifest = () => ({
  profile: selection.profile,
  generation: '00000000-0000-4000-8000-000000000002',
  revision: 'a'.repeat(64),
  folder: {
    id: 'folder',
    name: title,
    parents: ['root'],
    version: '1',
    mime: 'application/vnd.google-apps.folder'
  },
  files: structuredClone(files),
  ignoredFiles: 0
});
async function fixture(work) {
  const controller = new AbortController();
  let active = true,
    held = 0,
    db,
    nextRead,
    everyRead,
    databaseOverride;
  const manifest = initialManifest(),
    bodies = structuredClone(contents),
    calls = [];
  class IntegrationError extends Error {
    constructor(code) {
      super(code);
      this.code = code;
    }
  }
  const harness = {
    IntegrationError,
    database: {
      get db() {
        return Promise.resolve(databaseOverride ?? db);
      }
    },
    captureLibraryOperation(owner) {
      if (owner != null && owner !== 'alice') throw new IntegrationError('account_changed');
      held++;
      return {
        profileId: 'alice',
        signal: controller.signal,
        assertCurrent() {
          if (!active) throw new IntegrationError('account_changed');
        },
        stop() {
          held--;
        }
      };
    },
    async request(path, options) {
      calls.push({ path, options });
      assert.equal(options.method, undefined, 'Saved checks must not write to Drive');
      assert.equal(options.userId, 'alice');
      const url = new URL(path, 'https://test.invalid/');
      assert.ok(url.pathname.startsWith('/connections/' + selection.connection + '/'));
      assert.equal(url.searchParams.get('root'), 'root');
      assert.equal(url.searchParams.get('folder'), 'folder');
      assert.equal(url.searchParams.get('profile'), selection.profile);
      await everyRead?.(calls.length);
      if (nextRead) {
        const hook = nextRead;
        nextRead = undefined;
        await hook();
      }
      if (url.pathname.endsWith('/reader-bridge/')) return structuredClone(manifest);
      assert.ok(url.pathname.endsWith('/reader-bridge-file/'));
      assert.equal(url.searchParams.get('generation'), manifest.generation);
      assert.equal(url.searchParams.get('revision'), manifest.revision);
      const file = manifest.files.find((value) => value.id === url.searchParams.get('id'));
      assert.ok(file);
      return bodies[file.role].slice().buffer;
    }
  };
  const module = { exports: {} };
  compileFunction(compiled.outputFiles[0].text, ['require', 'module', 'exports', 'harness'])(
    require,
    module,
    module.exports,
    harness
  );
  const api = module.exports;
  const name = 'saved-reader-' + crypto.randomUUID();
  db = await api.createBooksDb(name);
  try {
    const preview = await api.previewDriveReaderBridge(selection);
    const prepared = api.captureDriveReaderPreview(preview);
    const raw = api.prepareReaderImportContent(prepared.content, document);
    await db.put(
      'data',
      await api.encodeBook({
        ...raw,
        id: 1,
        characters: preview.characters,
        lastBookModified: 1,
        lastBookOpen: 1,
        hasThumb: false
      })
    );
    const identity = '00000000-0000-4000-8000-000000000003';
    await db.put('readerLocalIdentity', { bookId: 1, uuid: identity });
    await db.put('readerBookScope', { bookId: 1, accountId: 'alice' });
    const descriptor = {
      accountId: 'alice',
      binding: preview.projection.snapshot.binding,
      title,
      fingerprint: preview.projection.snapshot.fingerprint,
      characters: preview.characters,
      local: { bookId: 1, identity },
      source: {
        provider: 'google',
        connection: selection.connection,
        generation: manifest.generation,
        root: 'root',
        folder: 'folder',
        packageId: preview.packageId,
        profile: selection.profile,
        observedRevision: manifest.revision,
        files: manifest.files.map(({ role, id, version, md5 }) => ({ role, id, version, md5 }))
      }
    };
    const record = {
      id: crypto.randomUUID(),
      version: 3,
      automaticChecks: true,
      automaticReceive: true,
      revision: crypto.randomUUID(),
      accountId: 'alice',
      binding: descriptor.binding,
      bookId: 1,
      state: 'linked',
      descriptor
    };
    await db.put('readerBridgeConnection', record);
    calls.length = 0;
    await work({
      db,
      api,
      record,
      descriptor,
      manifest,
      bodies,
      calls,
      receive: (signal, owner = 'alice', revision = record.revision) =>
        api.receiveSavedDriveReaderChanges(owner, record.id, revision, signal),
      everyRead: (hook) => {
        everyRead = hook;
      },
      databaseOverride: (value) => {
        databaseOverride = value;
      },
      nextRead: (hook) => {
        nextRead = hook;
      },
      revoke() {
        active = false;
        controller.abort();
      }
    });
    assert.equal(held, 0, 'Account subscriptions leaked');
  } finally {
    db.close();
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
  }
}
const snapshot = async (db) => {
  const names = Array.from(db.objectStoreNames),
    tx = db.transaction(names);
  const rows = await Promise.all(names.map((name) => tx.objectStore(name).getAll()));
  await tx.done;
  return JSON.stringify(rows, (_key, value) =>
    value instanceof ArrayBuffer ? Array.from(new Uint8Array(value)) : value
  );
};

const updateRemote = (f, role, transform) => {
  const value = JSON.parse(new TextDecoder().decode(f.bodies[role]));
  transform(value);
  f.bodies[role] = new TextEncoder().encode(JSON.stringify(value));
  const file = f.manifest.files.find((row) => row.role === role);
  file.version = String(Number(file.version) + 1);
  file.md5 = createHash('md5').update(f.bodies[role]).digest('hex');
  file.size = f.bodies[role].byteLength;
  if (role === 'resume')
    file.name = `progress_1_11_${value.lastBookmarkModified}_${value.progress}.json`;
  f.manifest.revision = createHash('sha256').update(JSON.stringify(f.manifest.files)).digest('hex');
};
const reading = async (db) =>
  JSON.stringify(
    await Promise.all(
      ['bookmark', 'readerStatistic', 'readerStatisticMigration', 'lastModified'].map((name) =>
        db.getAll(name)
      )
    )
  );
const property = (object, key) => {
  const value = Reflect.get(object, key);
  return typeof value === 'function' ? value.bind(object) : value;
};

test('safe additions are received under the reader lease and acknowledged without repeated no-op journals', async () =>
  fixture(async (f) => {
    const leases = leaseCalls;
    const result = await f.receive();
    assert.equal(result.state, 'received');
    assert.ok(Number.isFinite(Date.parse(result.observedAt)));
    assert.equal(leaseCalls, leases + 1);
    assert.ok((await f.db.get('bookmark', 1)).progress > 0);
    assert.ok((await f.db.count('readerStatistic')) > 0);
    const before = await snapshot(f.db);
    assert.equal((await f.receive()).state, 'unchanged');
    assert.equal(await snapshot(f.db), before);
    assert.equal(leaseCalls, leases + 1, 'Unchanged check acquired an unnecessary write lease');
  }));

test('initial equal copies establish agreement once before receiving a later remote-only change', async () =>
  fixture(async (f) => {
    await f.db.put('bookmark', {
      ...JSON.parse(new TextDecoder().decode(f.bodies.resume)),
      dataId: 1
    });
    const days = JSON.parse(new TextDecoder().decode(f.bodies.statistics));
    for (const day of days)
      await f.db.put('readerStatistic', {
        ...day,
        bookKey: `local:${f.descriptor.local.identity}`
      });
    const before = await reading(f.db);
    assert.equal((await f.receive()).state, 'unchanged');
    assert.equal(await reading(f.db), before);
    assert.equal(await f.db.count('readerBridgeJournal'), 1);
    assert.equal((await f.receive()).state, 'unchanged');
    assert.equal(await f.db.count('readerBridgeJournal'), 1);
    updateRemote(f, 'resume', (value) => {
      value.progress = 0.5;
      value.lastBookmarkModified++;
    });
    assert.equal((await f.receive()).state, 'received');
    assert.equal((await f.db.get('bookmark', 1)).progress, 0.5);
  }));

test('remote-only changes use the agreed baseline while preserving local-only days', async () =>
  fixture(async (f) => {
    await f.receive();
    const firstDay = (await f.db.getAll('readerStatistic'))[0];
    await f.db.put('readerStatistic', { ...firstDay, dateKey: '2026-10-17', readingTime: 4321 });
    updateRemote(f, 'resume', (value) => {
      value.progress = 0.3;
      value.lastBookmarkModified++;
    });
    assert.equal((await f.receive()).state, 'received');
    assert.equal((await f.db.get('bookmark', 1)).progress, 0.3);
    assert.equal(
      (await f.db.get('readerStatistic', [firstDay.bookKey, '2026-10-17'])).readingTime,
      4321
    );
    const entries = await f.db.getAll('readerBridgeJournal');
    assert.equal(entries.filter((row) => row.phase === 'accepted').length, 1);
    assert.equal(entries.filter((row) => row.phase === 'superseded').length, 1);
    const before = await snapshot(f.db);
    assert.equal((await f.receive()).state, 'unchanged');
    assert.equal(await snapshot(f.db), before);
  }));

test('a changed local position is preserved while the remote remains at the baseline', async () =>
  fixture(async (f) => {
    await f.receive();
    const bookmark = await f.db.get('bookmark', 1);
    await f.db.put('bookmark', {
      ...bookmark,
      progress: 0.9,
      lastBookmarkModified: bookmark.lastBookmarkModified + 1
    });
    const before = await snapshot(f.db);
    assert.equal((await f.receive()).state, 'unchanged');
    assert.equal(await snapshot(f.db), before);
  }));

for (const scenario of ['both-changed', 'missing-row', 'missing-file', 'pending-recovery'])
  test(`${scenario} waits for review without changing data or adding a journal`, async () =>
    fixture(async (f) => {
      await f.receive();
      if (scenario === 'both-changed') {
        const bookmark = await f.db.get('bookmark', 1);
        await f.db.put('bookmark', { ...bookmark, progress: 0.9 });
        updateRemote(f, 'resume', (value) => {
          value.progress = 0.3;
          value.lastBookmarkModified++;
        });
      } else if (scenario === 'missing-row') {
        updateRemote(f, 'statistics', (days) => {
          days.splice(0, 1);
        });
      } else if (scenario === 'missing-file') {
        f.manifest.files = f.manifest.files.filter((row) => row.role !== 'resume');
        f.manifest.revision = 'c'.repeat(64);
      } else {
        const entry = (await f.db.getAll('readerBridgeJournal'))[0];
        await f.db.put('readerBridgeJournal', {
          ...entry,
          id: crypto.randomUUID(),
          phase: 'restored',
          entry: { ...entry.entry, phase: 'uncertain' }
        });
      }
      const before = await snapshot(f.db);
      assert.equal((await f.receive()).state, 'review');
      assert.equal(await snapshot(f.db), before);
    }));

for (const mode of ['disabled', 'forgotten', 'replacement'])
  test(`${mode} consent committed before local application prevents automatic receipt`, async () =>
    fixture(async (f) => {
      let changed = false;
      f.everyRead(async (count) => {
        if (count !== 7) return;
        changed = true;
        if (mode === 'forgotten') await f.db.delete('readerBridgeConnection', f.record.id);
        else
          await f.db.put('readerBridgeConnection', {
            ...f.record,
            ...(mode === 'disabled'
              ? { automaticReceive: false }
              : { revision: crypto.randomUUID() })
          });
      });
      const before = await reading(f.db);
      assert.equal((await f.receive()).state, 'review');
      assert.ok(changed, 'Test did not reach precommit revocation');
      assert.equal(await reading(f.db), before);
      assert.equal(
        (await f.db.getAll('readerBridgeJournal')).filter((row) => row.phase === 'accepted').length,
        0
      );
    }));

test('cancellation after a successful bookmark put aborts reading writes and acceptance together', async () =>
  fixture(async (f) => {
    const controller = new AbortController();
    let wrote = false;
    f.databaseOverride(
      new Proxy(f.db, {
        get(target, key) {
          if (key !== 'transaction') return property(target, key);
          return (...args) => {
            const tx = target.transaction(...args);
            if (args[1] !== 'readwrite' || !args[0].includes('bookmark')) return tx;
            return new Proxy(tx, {
              get(transaction, name) {
                if (name !== 'objectStore') return property(transaction, name);
                return (storeName) => {
                  const store = transaction.objectStore(storeName);
                  if (storeName !== 'bookmark') return store;
                  return new Proxy(store, {
                    get(object, method) {
                      if (method !== 'put') return property(object, method);
                      return async (...values) => {
                        const result = await object.put(...values);
                        wrote = true;
                        controller.abort();
                        return result;
                      };
                    }
                  });
                };
              }
            });
          };
        }
      })
    );
    const before = await reading(f.db);
    await assert.rejects(f.receive(controller.signal), { name: 'AbortError' });
    assert.ok(wrote);
    assert.equal(await reading(f.db), before);
    assert.equal(
      (await f.db.getAll('readerBridgeJournal')).filter((row) => row.phase === 'accepted').length,
      0
    );
  }));

test('disabled consent makes no network request and an occupied reader lease prevents journal creation', async () =>
  fixture(async (f) => {
    await f.db.put('readerBridgeConnection', { ...f.record, automaticReceive: false });
    assert.equal((await f.receive()).state, 'review');
    assert.equal(f.calls.length, 0);
    await f.db.put('readerBridgeConnection', f.record);
    const before = await snapshot(f.db);
    lockAvailable = false;
    try {
      await assert.rejects(f.receive(), /book is open/);
    } finally {
      lockAvailable = true;
    }
    assert.equal(await snapshot(f.db), before);
  }));

test('unsupported Yatsu layout information stays for review instead of being discarded', async () =>
  fixture(async (f) => {
    updateRemote(f, 'resume', (value) => {
      value.targetSectionIndex = 1;
    });
    const before = await snapshot(f.db);
    assert.equal((await f.receive()).state, 'review');
    assert.equal(await snapshot(f.db), before);
  }));

test('an account change during remote reads aborts without writing', async () =>
  fixture(async (f) => {
    const before = await snapshot(f.db);
    f.nextRead(() => f.revoke());
    await assert.rejects(
      f.receive(),
      (error) => error.name === 'AbortError' || error.code === 'account_changed'
    );
    assert.equal(await snapshot(f.db), before);
  }));

test.after(() => {
  dom.window.close();
  delete globalThis.document;
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else delete globalThis.navigator;
});
