/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const appRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { ZipWriter, ZipReader, BlobWriter, BlobReader, TextWriter, TextReader, configure } =
  appRequire('@zip.js/zip.js');
configure({ useWebWorkers: false });
const root = new URL('../../apps/web/src/', import.meta.url);
const types = {
  DATA: 'data',
  PROGRESS: 'bookmark',
  STATISTICS: 'statistic',
  READING_GOALS: 'readingGoal',
  AUDIOBOOK: 'audioBook',
  SUBTITLE: 'subtitle'
};
const storage = { BACKUP: 'backup', BROWSER: 'browser' };
const abort = (signal) => signal?.throwIfAborted();

// Isolate delivery from reader/UI imports. Archive bytes use the real ZIP codec;
// existing browser backup journeys qualify the full production wire format.
class StorageFixture {
  constructor(_window, storageType) {
    this.storageType = storageType;
    this.rootFiles = new Map();
  }
  static reportProgress() {}
  static completeStep() {}
  static getProgressFileName() {
    return 'progress.json';
  }
  isCacheDisabled() {
    return false;
  }
  startContext(context, signal) {
    this.currentContext = context;
    this.sanitizedTitle = context.title;
    this.cancelSignal = signal;
  }
  async addDataToZip(name, data, writer) {
    abort(this.cancelSignal);
    writer ??= new ZipWriter(new BlobWriter('application/zip'));
    await writer.add(name, data instanceof Blob ? new BlobReader(data) : new TextReader(data));
    return writer;
  }
}
function load(name, dependencies, globals = {}) {
  const output = ts.transpileModule(readFileSync(new URL(name, root), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  });
  const module = { exports: {} };
  runInNewContext(output.outputText, {
    module,
    exports: module.exports,
    Blob,
    File,
    URL,
    setTimeout,
    require: (name) => {
      if (name in dependencies) return dependencies[name];
      return new Proxy(
        {},
        {
          get: (_object, property) => {
            if (property === '__esModule') return false;
            throw new Error(`Unexpected dependency ${name}.${String(property)}`);
          }
        }
      );
    },
    ...globals
  });
  return module.exports;
}
function fixture() {
  const timers = [],
    clicks = [],
    revoked = [];
  const document = {
    createElement: () => {
      const a = { click: () => clicks.push({ download: a.download, href: a.href }) };
      return a;
    }
  };
  const dependencies = {
    '$lib/data/storage/handler/base-handler': { BaseStorageHandler: StorageFixture },
    '$lib/functions/replication/replication-error': { throwIfAborted: abort },
    '$lib/data/storage/storage-types': { StorageKey: storage, StorageDataType: types },
    '$lib/functions/replication/replication-progress': { replicationProgress$: { next() {} } },
    '$lib/functions/replication/error-handler': {
      handleErrorDuringReplication(error, prefix) {
        if (error.name === 'AbortError') throw error;
        return prefix + error.message;
      }
    }
  };
  const { BackupStorageHandler } = load(
    'lib/data/storage/handler/backup-handler.ts',
    dependencies,
    {
      setTimeout: (callback, delay = 0) => {
        timers.push({ callback, delay });
        return timers.length;
      },
      URL: {
        createObjectURL: () => 'blob:test-archive',
        revokeObjectURL: (value) => revoked.push(value)
      }
    }
  );
  const { replicateData } = load(
    'lib/functions/replication/replicator.ts',
    {
      ...dependencies,
      '$lib/data/storage/handler/backup-handler': { BackupStorageHandler }
    },
    { document }
  );
  const handler = new BackupStorageHandler({}, storage.BACKUP);
  const controller = new AbortController();
  handler.startContext({ id: 1, title: 'Selected book' }, controller.signal);
  return { handler, controller, document, timers, clicks, revoked, replicateData };
}
async function entries(blob) {
  const reader = new ZipReader(new BlobReader(blob));
  try {
    return Object.fromEntries(
      await Promise.all(
        (await reader.getEntries()).map(async (entry) => [
          entry.filename,
          JSON.parse(await entry.getData(new TextWriter()))
        ])
      )
    );
  } finally {
    await reader.close();
  }
}

test('a non-browser destination receives the actual completed ZIP exactly once without a download', async () => {
  const f = fixture(),
    received = [];
  const progress = { dataId: 1, progress: 0.45, completion: { finished: true } };
  await f.handler.saveProgress(progress);
  await f.handler.createExportZip(f.document, false, async (archive) => received.push(archive));
  assert.equal(received.length, 1);
  assert.match(received[0].filename, /^ttu-reader-export-[\d-]+\.zip$/);
  assert.deepEqual(await entries(received[0].blob), { 'Selected book/progress.json': progress });
  assert.deepEqual(f.clicks, []);
  assert.deepEqual(f.timers, []);
  await f.handler.createExportZip(f.document, false, async (archive) => received.push(archive));
  assert.equal(received.length, 1);
});

test('ordinary web delivery retains its filename and URL cleanup without clearing a newer archive', async () => {
  const f = fixture();
  await f.handler.saveProgress({ dataId: 1 });
  await f.handler.createExportZip(f.document, false);
  await f.handler.saveProgress({ dataId: 2 });
  f.timers.find((timer) => timer.delay === 0).callback();
  assert.equal(f.clicks.length, 1);
  assert.match(f.clicks[0].download, /^ttu-reader-export-[\d-]+\.zip$/);
  assert.deepEqual(await entries((await f.handler.finishExportZip()).blob), {
    'Selected book/progress.json': { dataId: 2 }
  });
  f.timers.find((timer) => timer.delay === 10000).callback();
  assert.deepEqual(f.revoked, ['blob:test-archive']);
});

test('cancellation during ZIP finalization suppresses delivery and cannot consume a later export', async () => {
  const f = fixture();
  let finish;
  f.handler.exportZipWriter = {
    close: () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  };
  const pending = f.handler.createExportZip(
    f.document,
    false,
    async () => assert.fail('Canceled export escaped'),
    f.controller.signal
  );
  f.controller.abort();
  f.handler.startContext({ title: 'Later book' }, new AbortController().signal);
  await f.handler.saveProgress({ dataId: 2 });
  finish(new Blob(['old archive']));
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(await entries((await f.handler.finishExportZip()).blob), {
    'Later book/progress.json': { dataId: 2 }
  });
});

test('canceling a queued browser download suppresses its click, and destination failure is not replayed', async () => {
  const f = fixture();
  await f.handler.saveProgress({ dataId: 1 });
  await f.handler.createExportZip(f.document, false, undefined, f.controller.signal);
  f.controller.abort();
  f.timers.find((timer) => timer.delay === 0).callback();
  assert.deepEqual(f.clicks, []);
  const g = fixture();
  await g.handler.saveProgress({ dataId: 1 });
  await assert.rejects(
    g.handler.createExportZip(g.document, false, async () => {
      throw new Error('No destination');
    }),
    /No destination/
  );
  assert.equal(await g.handler.finishExportZip(), undefined);
});

test('finalization uses its own cancellation scope rather than a prior book context', async () => {
  const f = fixture();
  await f.handler.saveProgress({ dataId: 1 });
  f.controller.abort();
  const current = new AbortController();
  const archive = await f.handler.finishExportZip(false, current.signal);
  assert.deepEqual(await entries(archive.blob), { 'Selected book/progress.json': { dataId: 1 } });
});

test('replication never delivers a partial ZIP to a new destination and retains successful contents', async () => {
  for (const fail of [false, true]) {
    const f = fixture(),
      received = [];
    const source = new StorageFixture({}, storage.BROWSER);
    source.getFilenameForRecentCheck = async () => undefined;
    source.getProgress = async () => {
      if (fail && source.currentContext.id === 2) throw new Error('Second book unavailable');
      return { dataId: source.currentContext.id, progress: 0.4 };
    };
    source.getCover = async () => undefined;
    const error = await f.replicateData(
      source,
      f.handler,
      false,
      [
        { id: 1, title: 'First' },
        { id: 2, title: 'Second' }
      ],
      [types.PROGRESS],
      f.controller.signal,
      async (archive) => received.push(archive)
    );
    if (fail) {
      assert.match(error, /Second book unavailable/);
      assert.equal(received.length, 0);
      assert.equal(await f.handler.finishExportZip(), undefined);
    } else {
      assert.equal(error, '');
      assert.equal(received.length, 1);
      assert.deepEqual(await entries(received[0].blob), {
        'First/progress.json': { dataId: 1, progress: 0.4 },
        'Second/progress.json': { dataId: 2, progress: 0.4 }
      });
    }
    assert.deepEqual(f.clicks, []);
  }
});
