/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, renameSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import 'fake-indexeddb/auto';
import { openDB, deleteDB, unwrap } from 'idb';

const output = mkdtempSync(join(tmpdir(), 'native-book-export-'));
process.on('exit', () => {
  const trash = join(homedir(), '.Trash');
  mkdirSync(trash, { recursive: true });
  renameSync(output, join(mkdtempSync(join(trash, 'native-book-export-')), 'output'));
});
const require = createRequire(import.meta.url);
function bundle(name) {
  const outfile = join(output, name.split('/').at(-1) + '.cjs');
  buildSync({
    entryPoints: [resolve('apps/web/src', name + '.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    tsconfig: 'apps/web/tsconfig.json',
    logLevel: 'silent'
  });
  return require(outfile);
}
const { readNativeExportBook } = bundle('native-library/export-records');
const { NativeBookExportService } = bundle('native-library/export-service');
const { saveNativeBookExport } = bundle('native-library/export-selection');
const { bytesToBase64, base64ToBytes } = bundle('platform/transfer-encoding');
const { ensureBooksSchema } = bundle('lib/data/database/books-db/schema');
const { EXPORT_CHUNK_BYTES } = bundle('native-library/export-contract');
const hash = 'ab'.repeat(32),
  key = `content:${hash}`;
const expected = {
  bookId: 1,
  contentHash: hash,
  readerBookKey: key,
  title: 'Book',
  lastBookModified: 42
};
const original = {
  id: 1,
  contentHash: hash,
  title: 'Book',
  lastBookModified: 42,
  elementHtml: '<p>日本語</p>',
  blobs: {
    'image.png': {
      format: 'reader-bytes-v1',
      type: 'image/png',
      bytes: new Uint8Array([1, 2, 3]).buffer
    }
  }
};
const history = {
  title: 'Book',
  dateKey: '2026-10-20',
  charactersRead: 12,
  readingTime: 4,
  lastStatisticModified: 43
};
const parts = ['data', 'bookmark', 'statistic', 'audioBook', 'subtitle'];
async function storage(t) {
  const name = `export-${crypto.randomUUID()}`;
  const db = await openDB(name, 13, {
    upgrade(db, _old, _new, tx) {
      ensureBooksSchema(unwrap(db), unwrap(tx));
    }
  });
  t.after(async () => {
    db.close();
    await deleteDB(name);
  });
  await db.put('data', original);
  await db.put('bookmark', {
    dataId: 1,
    exploredCharCount: 10,
    progress: 0.4,
    lastBookmarkModified: 41,
    completion: { finished: true }
  });
  await db.put('statistic', history);
  await db.put('audioBook', { title: 'Book', playbackPosition: 3, lastAudioBookModified: 40 });
  await db.put('subtitle', {
    title: 'Book',
    subtitleData: { name: 'book.srt', subtitles: [] },
    lastSubtitleDataModified: 40
  });
  const controller = new AbortController();
  const authority = {
    profileId: 'alice',
    key: 'owner',
    signal: controller.signal,
    assertCurrent() {
      controller.signal.throwIfAborted();
    }
  };
  return {
    db,
    controller,
    authority,
    read: (selection = expected, selected = parts) =>
      readNativeExportBook(db, selection, selected, authority)
  };
}
test('export reads real byte records, progress, migrated history and media for the admitted copy', async (t) => {
  const f = await storage(t);
  const result = await f.read();
  assert.equal(result.book.elementHtml, original.elementHtml);
  assert.deepEqual(
    [...new Uint8Array(await result.book.blobs['image.png'].arrayBuffer())],
    [1, 2, 3]
  );
  assert.equal(result.progress.completion.finished, true);
  assert.deepEqual(result.statistics, [history]);
  assert.equal(result.audioBook.playbackPosition, 3);
  assert.equal(result.subtitle.subtitleData.name, 'book.srt');
  assert.deepEqual((await f.read(expected, ['data'])).statistics, undefined);
});
test('export rejects numeric-ID reuse, placeholders, expired authority and another profile', async (t) => {
  const f = await storage(t);
  await assert.rejects(
    f.read({
      ...expected,
      contentHash: 'cd'.repeat(32),
      readerBookKey: `content:${'cd'.repeat(32)}`
    }),
    /changed/
  );
  await f.db.put('data', { ...original, elementHtml: '' });
  await assert.rejects(f.read(expected, ['data']), /available imported/);
  await f.db.put('data', { ...original, libraryOwner: 'bob' });
  await assert.rejects(f.read(), /another account/);
  await f.db.put('data', original);
  await f.db.put('readerBookScope', { bookId: 1, accountId: 'bob' });
  await assert.rejects(f.read(expected, ['data']), /another account/);
  f.controller.abort();
  await assert.rejects(f.read(expected, ['data']), { name: 'AbortError' });
});
test('legacy UUID must match in migration and final export read', async (t) => {
  const f = await storage(t),
    uuid = crypto.randomUUID();
  await f.db.put('data', { ...original, contentHash: undefined });
  await f.db.put('readerLocalIdentity', { bookId: 1, uuid });
  const identity = { ...expected, contentHash: undefined, readerBookKey: `local:${uuid}` };
  assert.equal((await f.read(identity)).statistics[0].charactersRead, 12);
  await f.db.put('readerLocalIdentity', { bookId: 1, uuid: crypto.randomUUID() });
  await assert.rejects(f.read(identity), /changed/);
  await assert.rejects(f.read({ ...identity, readerBookKey: undefined }), /Refresh the Library/);
});
test('same-title media and ambiguous or conflicting history require an explicit narrower export', async (t) => {
  const f = await storage(t);
  await f.db.put('data', { ...original, id: 2, contentHash: 'cd'.repeat(32) });
  await assert.rejects(f.read(), /cannot be assigned/);
  await assert.rejects(f.read(expected, ['statistic']), /Older statistics/);
  assert.equal((await f.read(expected, ['data', 'bookmark'])).progress.progress, 0.4);
  await f.db.put('readerStatisticMigration', {
    title: 'Book',
    state: 'identity-conflict',
    bookKey: key
  });
  await assert.rejects(f.read(expected, ['statistic']), /Older statistics/);
});
test('legacy migration never assigns title rows or UUIDs to another profile', async (t) => {
  const f = await storage(t);
  await f.db.put('data', { ...original, id: 2, contentHash: undefined, libraryOwner: 'bob' });
  await assert.rejects(f.read(expected, ['statistic']), /another account/);
  assert.equal(await f.db.get('readerLocalIdentity', 2), undefined);
  assert.equal(await f.db.count('readerStatistic'), 0);
  assert.equal(await f.db.get('readerStatisticMigration', 'Book'), undefined);
});
test('content history shared with another profile is rejected even without legacy rows', async (t) => {
  const f = await storage(t);
  await f.db.clear('statistic');
  await f.db.put('readerStatistic', { ...history, bookKey: key });
  await f.db.put('data', {
    ...original,
    id: 2,
    contentHash: hash.toUpperCase(),
    libraryOwner: 'bob'
  });
  await assert.rejects(f.read(expected, ['statistic']), /another account/);
});
test('account cancellation during the read discards the final transaction result', async (t) => {
  const f = await storage(t);
  const get = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function (...args) {
    const request = get.apply(this, args);
    if (this.name === 'bookmark')
      request.addEventListener('success', () => f.controller.abort(), { once: true });
    return request;
  };
  t.after(() => {
    IDBObjectStore.prototype.get = get;
  });
  await assert.rejects(f.read(expected, ['bookmark']), { name: 'AbortError' });
});

const flush = () => new Promise((resolve) => setImmediate(resolve));
function transfer(
  t,
  bytes = new Uint8Array(EXPORT_CHUNK_BYTES + 19).map((_, index) => index % 251)
) {
  const controller = new AbortController();
  const authority = {
    key: 'session:1',
    signal: controller.signal,
    assertCurrent() {
      controller.signal.throwIfAborted();
    }
  };
  let stops = 0,
    count = 0;
  const service = new NativeBookExportService(() => `export_token_${++count}`);
  const archive = {
    blob: new Blob([bytes]),
    filename: 'ttu-reader-export-10-20-2026-12-01-02.zip'
  };
  t.after(() => service.dispose());
  return {
    service,
    controller,
    authority,
    bytes,
    archive,
    get stops() {
      return stops;
    },
    start: (prepare = async () => archive) => service.start(1, authority, () => stops++, prepare)
  };
}
test('one owner retains a completed Blob, serves bounded ordered chunks, and releases on cancellation', async (t) => {
  const f = transfer(t),
    initial = f.start();
  assert.equal(initial.phase, 'preparing');
  assert.throws(() => f.start(), /current export/);
  await flush();
  const status = f.service.status({ token: initial.token }, f.authority);
  assert.equal(status.size, f.bytes.length);
  assert.equal('blob' in status, false);
  const first = await f.service.chunk({ token: initial.token, offset: 0 }, f.authority);
  assert.deepEqual(
    base64ToBytes(first.data, EXPORT_CHUNK_BYTES),
    f.bytes.slice(0, EXPORT_CHUNK_BYTES)
  );
  await assert.rejects(
    f.service.chunk({ token: initial.token, offset: 1 }, f.authority),
    /out of range/
  );
  assert.throws(
    () => f.service.status({ token: initial.token }, { ...f.authority, key: 'other' }),
    /expired/
  );
  f.service.cancel({ token: initial.token }, f.authority);
  assert.equal(f.stops, 1);
  const next = f.start();
  f.service.cancel({ token: initial.token }, f.authority);
  assert.equal(f.service.status({ token: next.token }, f.authority).phase, 'preparing');
  f.controller.abort();
  assert.equal(f.service.active, false);
  assert.equal(f.stops, 2);
});
test('late preparation cannot publish after account retirement; partial failure exposes no archive', async (t) => {
  const f = transfer(t);
  let finish;
  f.start(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await flush();
  f.controller.abort();
  finish(f.archive);
  await flush();
  assert.equal(f.service.active, false);
  const second = transfer(t),
    started = second.start(async () => {
      throw new Error('Book 2 changed');
    });
  await flush();
  assert.equal(second.service.status({ token: started.token }, second.authority).phase, 'error');
  await assert.rejects(
    second.service.chunk({ token: started.token, offset: 0 }, second.authority),
    /unavailable/
  );
});

test('an idle export expires and releases its owner exactly once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = transfer(t),
    { token } = f.start();
  await flush();
  t.mock.timers.tick(9 * 60 * 1000);
  assert.equal(f.service.status({ token }, f.authority).phase, 'ready');
  t.mock.timers.tick(9 * 60 * 1000);
  assert.equal(f.service.active, true);
  t.mock.timers.tick(60 * 1000);
  assert.equal(f.service.active, false);
  assert.equal(f.stops, 1);
  assert.throws(() => f.service.status({ token }, f.authority), /expired/);
  f.service.dispose();
  assert.equal(f.stops, 1);
});

function destination(t, options = {}) {
  const f = transfer(t);
  let scope = { session: 'session', epoch: 1 },
    writes = 0,
    deleted = 0,
    closes = 0,
    reads = 0;
  let saved = new Uint8Array(0);
  const controller = new AbortController();
  const calls = [],
    messages = [],
    files = [];
  const deps = {
    scope: () => scope,
    wait: flush,
    async pickDirectory() {
      if (options.picker) return options.picker();
      return {
        createFile(name) {
          files.push(name);
          return {
            name,
            get size() {
              return saved.length;
            },
            openWrite() {
              return {
                async writeBytes(bytes) {
                  writes++;
                  const next = new Uint8Array(saved.length + bytes.length);
                  next.set(saved);
                  next.set(bytes, saved.length);
                  saved = next;
                  if (options.onWrite)
                    await options.onWrite({
                      controller,
                      changeScope: () => {
                        scope = { ...scope, epoch: 2 };
                      }
                    });
                },
                close() {
                  closes++;
                }
              };
            },
            openRead() {
              let offset = 0;
              return {
                async readBytes(length) {
                  reads++;
                  const bytes = saved.slice(offset, offset + Math.min(length, 17003));
                  offset += bytes.length;
                  if (options.corrupt && bytes.length) bytes[0] ^= 1;
                  return bytes;
                },
                close() {
                  closes++;
                }
              };
            },
            delete() {
              deleted++;
              if (options.cleanupFails) throw new Error('provider refused');
              saved = new Uint8Array(0);
            }
          };
        }
      };
    },
    async command(method, payload) {
      calls.push({ method, payload });
      if (method === 'library.export.start') return f.start();
      if (method === 'library.export.status') return f.service.status(payload, f.authority);
      if (method === 'library.export.chunk') {
        const value = await f.service.chunk(payload, f.authority);
        return options.badOffset ? { ...value, offset: 13 } : value;
      }
      if (method === 'library.export.cancel') return f.service.cancel(payload, f.authority);
      throw new Error(method);
    }
  };
  return {
    f,
    calls,
    files,
    messages,
    controller,
    get saved() {
      return saved;
    },
    get counts() {
      return { writes, deleted, closes, reads };
    },
    run: () =>
      saveNativeBookExport(
        deps,
        { token: 'library-token', keys: ['book-key'], parts },
        controller.signal,
        (message) => messages.push(message)
      )
  };
}
test('system destination receives a unique ZIP and exact bytes are verified through short reads before success', async (t) => {
  const f = destination(t),
    result = await f.run();
  assert.equal(result.filename, f.files[0]);
  assert.match(result.filename, /export_token_1\.zip$/);
  assert.deepEqual(f.saved, f.f.bytes);
  assert.equal(f.counts.writes, 2);
  assert.equal(f.counts.closes, 2);
  assert.equal(f.counts.deleted, 0);
  assert.ok(f.counts.reads > 2);
  assert.equal(f.f.service.active, false);
  assert.equal(f.calls.filter((call) => call.method === 'library.export.start').length, 1);
  assert.equal(f.calls.filter((call) => call.method === 'library.export.chunk').length, 4);
});
test('picker cancellation does not consume selection or create a destination file', async (t) => {
  const f = destination(t, { picker: () => null });
  assert.equal(await f.run(), null);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.files, []);
});
for (const [label, options, message] of [
  ['verification failure', { corrupt: true }, /could not be verified/],
  ['out-of-order bridge reply', { badOffset: true }, /out of order/],
  [
    'account departure during write',
    { onWrite: ({ changeScope }) => changeScope() },
    /account changed/
  ],
  ['cancellation during write', { onWrite: ({ controller }) => controller.abort() }, /abort/i]
])
  test(`${label} removes only this new partial file, closes handles and never reports success`, async (t) => {
    const f = destination(t, options);
    await assert.rejects(f.run(), message);
    assert.equal(f.counts.deleted, 1);
    assert.equal(f.saved.length, 0);
    assert.ok(f.counts.closes >= 1);
  });
test('failed partial-file cleanup explicitly names the unverified file', async (t) => {
  const f = destination(t, { corrupt: true, cleanupFails: true });
  await assert.rejects(f.run(), {
    name: 'ExportCleanupError',
    message: /incomplete file.*could not be removed/
  });
  assert.equal(f.f.service.active, false);
});
test('Hermes decoder is bounded, canonical and round-trips all padding sizes', () => {
  for (const length of [1, 2, 3, 4, 101, EXPORT_CHUNK_BYTES]) {
    const bytes = Uint8Array.from({ length }, (_, i) => i % 256);
    assert.deepEqual(base64ToBytes(bytesToBase64(bytes), length), bytes);
  }
  for (const input of ['', 'Zg=', '=AAA', 'Zh==', 'Zm9=', 'AAAA\n', '!AAA', '===='])
    assert.throws(() => base64ToBytes(input, 20), /invalid|noncanonical/);
  assert.throws(() => base64ToBytes('AAAA', 1), /too large/);
});
