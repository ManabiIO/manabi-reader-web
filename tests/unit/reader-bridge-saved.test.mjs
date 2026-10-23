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
globalThis.document = document;
// The source manifest, ZIP reader, content comparison, connection validator and
// DB transactions are production code. Only account/HTTP/store entrypoints are controlled.
const compiled = await build({
  stdin: {
    contents: `export * from './apps/web/src/lib/manabi/reader-bridge-saved.ts';
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
    const bytes = await entry.getData(new Uint8ArrayWriter());
    contents[role] = bytes;
    files.push({
      id: role,
      role,
      name: entry.filename.split('/').at(-1),
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
    nextRead;
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
        return Promise.resolve(db);
      }
    },
    captureLibraryOperation(owner) {
      if (owner !== 'alice') throw new IntegrationError('account_changed');
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
      version: 1,
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
      check: (signal, owner = 'alice', revision = record.revision) =>
        api.checkSavedDriveReaderConnection(owner, record.id, revision, signal),
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

test('saved pair reopens through genuine preview and content comparison without persistence', async () =>
  fixture(async (f) => {
    const before = await snapshot(f.db);
    const { preview, comparison } = await f.check();
    assert.equal(preview.projection.snapshot.binding, f.record.binding);
    assert.equal(comparison.matches, true);
    assert.equal(f.api.captureReaderBridgeLocalBook(comparison).snapshot.book.id, 1);
    assert.equal(f.api.captureDriveReaderPreview(preview).selection.folder, 'folder');
    assert.equal(await snapshot(f.db), before);
    assert.equal(f.calls.length, 5);
  }));
test('same progress/statistics file IDs may advance versions, digests and values without acknowledging them', async () =>
  fixture(async (f) => {
    const resume = f.manifest.files.find((file) => file.role === 'resume');
    const value = JSON.parse(new TextDecoder().decode(f.bodies.resume));
    value.progress = 0.5;
    value.exploredCharCount = 36;
    value.lastBookmarkModified++;
    f.bodies.resume = new TextEncoder().encode(JSON.stringify(value));
    resume.name = `progress_1_11_${value.lastBookmarkModified}_0.5.json`;
    resume.version = '2';
    resume.md5 = createHash('md5').update(f.bodies.resume).digest('hex');
    resume.size = f.bodies.resume.byteLength;
    const day = f.manifest.files.find((file) => file.role === 'statistics');
    const history = JSON.parse(new TextDecoder().decode(f.bodies.statistics));
    history[0].readingTime = 120;
    history[0].lastStatisticModified++;
    f.bodies.statistics = new TextEncoder().encode(JSON.stringify(history));
    day.name = day.name.replace('1790212589356', String(history[0].lastStatisticModified));
    day.version = '2';
    day.size = f.bodies.statistics.byteLength;
    day.md5 = createHash('md5').update(f.bodies.statistics).digest('hex');
    f.manifest.revision = 'b'.repeat(64);
    const before = await snapshot(f.db);
    const { preview } = await f.check();
    assert.equal(preview.projection.values.resume.progress, 0.5);
    assert.equal(preview.projection.values['statistics/2026-09-23'].readingTime, 120);
    assert.equal(await snapshot(f.db), before);
    assert.equal(
      (await f.db.get('readerBridgeConnection', f.record.id)).descriptor.source.observedRevision,
      'a'.repeat(64)
    );
  }));
for (const [label, mutate] of [
  [
    'stale revision',
    async (f) => {
      f.record.revision = crypto.randomUUID();
    }
  ],
  [
    'restored hint',
    async (f) => {
      f.record.state = 'restored';
    }
  ],
  [
    'removed record',
    async (f) => {
      await f.db.delete('readerBridgeConnection', f.record.id);
    }
  ],
  [
    'foreign saved account',
    async (f) => {
      await f.db.put('readerBridgeConnection', { ...f.record, accountId: 'bob' });
    }
  ],
  [
    'local UUID reuse',
    async (f) => {
      await f.db.put('readerLocalIdentity', { bookId: 1, uuid: crypto.randomUUID() });
    }
  ],
  [
    'duplicated local UUID',
    async (f) => {
      await f.db.put('readerLocalIdentity', { bookId: 2, uuid: f.descriptor.local.identity });
    }
  ],
  [
    'foreign ownership',
    async (f) => {
      await f.db.put('readerBookScope', { bookId: 1, accountId: 'bob' });
    }
  ],
  [
    'missing ownership',
    async (f) => {
      await f.db.delete('readerBookScope', 1);
    }
  ],
  [
    'foreign library owner',
    async (f) => {
      await f.db.put('data', { ...(await f.db.get('data', 1)), libraryOwner: 'bob' });
    }
  ]
])
  test(`saved check rejects ${label} before network`, async () =>
    fixture(async (f) => {
      await mutate(f);
      if (label === 'restored hint') await f.db.put('readerBridgeConnection', f.record);
      const before = await snapshot(f.db);
      await assert.rejects(f.check(), { code: 'changed' });
      assert.equal(f.calls.length, 0);
      assert.equal(await snapshot(f.db), before);
    }));
for (const [label, mutate] of [
  [
    'reconnected provider generation',
    (f) => {
      f.manifest.generation = crypto.randomUUID();
    }
  ],
  [
    'replacement package ID',
    (f) => {
      f.manifest.files.find((file) => file.role === 'book').id = 'replacement';
    }
  ],
  [
    'replacement progress ID',
    (f) => {
      f.manifest.files.find((file) => file.role === 'resume').id = 'replacement';
    }
  ],
  [
    'replacement statistics ID',
    (f) => {
      f.manifest.files.find((file) => file.role === 'statistics').id = 'replacement';
    }
  ],
  [
    'removed progress file',
    (f) => {
      f.manifest.files = f.manifest.files.filter((file) => file.role !== 'resume');
    }
  ],
  [
    'changed package version',
    (f) => {
      f.manifest.files.find((file) => file.role === 'book').version = '2';
    }
  ],
  [
    'changed package digest',
    (f) => {
      f.manifest.files.find((file) => file.role === 'book').md5 = 'b'.repeat(32);
    }
  ],
  [
    'changed local content',
    async (f) => {
      await f.db.put('data', {
        ...(await f.db.get('data', 1)),
        elementHtml: '<p>Replaced content</p>'
      });
    }
  ]
])
  test(`saved check refuses ${label}`, async () =>
    fixture(async (f) => {
      await mutate(f);
      const before = await snapshot(f.db);
      await assert.rejects(f.check(), { code: 'changed' });
      assert.equal(await snapshot(f.db), before);
    }));
for (const [label, mutate] of [
  [
    'removal',
    async (f) => {
      await f.db.delete('readerBridgeConnection', f.record.id);
    }
  ],
  [
    'relink',
    async (f) => {
      await f.db.put('readerBridgeConnection', { ...f.record, revision: crypto.randomUUID() });
    }
  ],
  [
    'silent descriptor edit',
    async (f) => {
      await f.db.put('readerBridgeConnection', {
        ...f.record,
        descriptor: { ...f.descriptor, title: 'Changed' }
      });
    }
  ],
  [
    'local UUID replacement',
    async (f) => {
      await f.db.put('readerLocalIdentity', { bookId: 1, uuid: crypto.randomUUID() });
    }
  ],
  [
    'local content replacement',
    async (f) => {
      await f.db.put('data', { ...(await f.db.get('data', 1)), elementHtml: '<p>Replaced</p>' });
    }
  ]
])
  test(`saved check revalidates ${label} during source downloads`, async () =>
    fixture(async (f) => {
      f.nextRead(() => mutate(f));
      await assert.rejects(f.check(), { code: 'changed' });
    }));
test('wrong account and pre-cancelled checks never read cloud state', async () =>
  fixture(async (f) => {
    await assert.rejects(f.check(undefined, 'bob'), { code: 'account_changed' });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(f.check(controller.signal), { name: 'AbortError' });
    assert.equal(f.calls.length, 0);
  }));
test('cancellation during source access discards the reopened pair', async () =>
  fixture(async (f) => {
    const controller = new AbortController();
    f.nextRead(() => controller.abort());
    const before = await snapshot(f.db);
    await assert.rejects(f.check(controller.signal), { name: 'AbortError' });
    assert.equal(await snapshot(f.db), before);
  }));
test('account revocation during source access discards the reopened pair', async () =>
  fixture(async (f) => {
    f.nextRead(() => f.revoke());
    const before = await snapshot(f.db);
    await assert.rejects(
      f.check(),
      (error) => error.code === 'account_changed' || error.name === 'AbortError'
    );
    assert.equal(await snapshot(f.db), before);
  }));
test('valid restored evidence IDs cannot be reopened as active pairs', async () =>
  fixture(async (f) => {
    const restored = { ...f.record, id: 'recovery:' + 'a'.repeat(64), state: 'restored' };
    await f.db.put('readerBridgeConnection', restored);
    const before = await snapshot(f.db);
    await assert.rejects(
      f.api.checkSavedDriveReaderConnection('alice', restored.id, restored.revision),
      { code: 'changed' }
    );
    assert.equal(f.calls.length, 0);
    assert.equal(await snapshot(f.db), before);
  }));

test.after(() => {
  dom.window.close();
  delete globalThis.document;
});
