/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { clearTimeout, setTimeout } from 'node:timers';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(
  new URL('../../apps/web/src/lib/functions/replication/replicator.ts', import.meta.url),
  'utf8'
);
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

function loadFixture({
  reusable,
  preflightError,
  countMode = false,
  persistenceError,
  persistenceResult = true,
  persistenceNeverSettles = false
} = {}) {
  const events = [];
  const progress = [];
  const changed = [];
  let persistCalls = 0;
  const contentHash = 'a'.repeat(64);
  const BaseStorageHandler = class {
    static reportProgress(value = 1) {
      progress.push(['progress', value]);
    }
    static completeStep() {
      progress.push(['complete']);
    }
  };
  const loaders = {
    epub: async () => {
      events.push('load');
      return {
        title: 'Parsed title',
        elementHtml: '<p>book</p>',
        styleSheet: '',
        blobs: {},
        coverImage: new Blob(['cover'], { type: 'image/png' }),
        hasThumb: true,
        characters: 12,
        lastBookModified: 1,
        lastBookOpen: 0
      };
    },
    txt: async () => {
      throw new Error('unexpected txt loader');
    },
    htmlz: async () => {
      throw new Error('unexpected htmlz loader');
    }
  };
  const dependencies = {
    '$lib/data/storage/handler/backup-handler': { BackupStorageHandler: class {} },
    '$lib/data/storage/handler/base-handler': {
      BaseStorageHandler,
      FilePrefix: { AUDIO_BOOK: 'audioBook_', SUBTITLE: 'subtitles_' }
    },
    '$lib/data/window/navigator/storage': {
      storage: {
        async persist() {
          persistCalls++;
          if (persistenceError) throw persistenceError;
          if (persistenceNeverSettles) return new Promise(() => {});
          return persistenceResult;
        }
      }
    },
    '$lib/data/storage/storage-types': {
      StorageDataType: {
        DATA: 'data',
        PROGRESS: 'progress',
        STATISTICS: 'statistics',
        READING_GOALS: 'goals',
        AUDIOBOOK: 'audio',
        SUBTITLE: 'subtitle'
      },
      StorageKey: { BROWSER: 'browser', BACKUP: 'backup' }
    },
    '$lib/data/store': {
      database: { dataListChanged$: { next: (value) => changed.push(value) } }
    },
    '$lib/functions/file-loaders/epub/load-epub': { __esModule: true, default: loaders.epub },
    '$lib/functions/file-loaders/htmlz/load-htmlz': { __esModule: true, default: loaders.htmlz },
    '$lib/functions/file-loaders/txt/load-txt': { __esModule: true, default: loaders.txt },
    '$lib/manabi/sources': {
      sha256: async () => {
        events.push('hash');
        return contentHash;
      }
    },
    '$lib/functions/replication/error-handler': {
      handleErrorDuringReplication(error, prefix) {
        return `${prefix}${error instanceof Error ? error.message : String(error)}`;
      }
    },
    '$lib/functions/replication/replication-error': {
      throwIfAborted(signal) {
        signal?.throwIfAborted();
      }
    },
    '$lib/functions/replication/replication-progress': {
      replicationProgress$: { next: (value) => progress.push(['event', value]) }
    }
  };
  const exports = {};
  runInNewContext(
    code,
    {
      exports,
      File,
      Blob,
      URL,
      setTimeout,
      clearTimeout,
      document: {},
      require(name) {
        if (name in dependencies) return dependencies[name];
        throw new Error(`Unexpected dependency: ${name}`);
      }
    },
    { filename: 'replicator.ts' }
  );
  const handler = {
    storageType: 'browser',
    isCacheDisabled: () => false,
    clearData: () => assert.fail('cache should stay enabled'),
    async findReusableBookByContentHash(hash, signal) {
      events.push('preflight');
      signal?.throwIfAborted();
      assert.equal(hash, contentHash);
      if (preflightError) throw preflightError;
      return reusable;
    },
    startContext(context) {
      events.push('context');
      assert.equal(context.title, 'Parsed title');
    },
    async saveBook(book) {
      events.push('save');
      assert.equal(book.contentHash, contentHash);
      return 9;
    },
    async saveCover() {
      events.push('cover');
    }
  };
  const fileCountData = countMode ? {} : undefined;
  const document = {
    createElement(name) {
      assert.equal(name, 'a');
      return { href: '', rel: '', download: '', click() {} };
    }
  };
  return {
    importData: exports.importData,
    replicateData: exports.replicateData,
    handler,
    document,
    file: new File(['exact bytes'], 'book.epub', { type: 'application/epub+zip' }),
    signal: new AbortController().signal,
    fileCountData,
    events,
    progress,
    changed,
    contentHash,
    persistCalls: () => persistCalls
  };
}

test('eligible exact reimport hashes and preflights without parsing or writing', async () => {
  const h = loadFixture({ reusable: 7 });
  const error = await h.importData(h.document, h.handler, [h.file], h.signal);
  assert.equal(error, '');
  assert.deepEqual(h.events, ['hash', 'preflight']);
  assert.deepEqual(h.changed, []);
  assert.equal(h.persistCalls(), 1);
  assert.equal(h.progress.filter(([kind]) => kind === 'complete').length, 3);
});

test('missing exact copy hashes before parser and reuses that digest for storage', async () => {
  const h = loadFixture();
  const error = await h.importData(h.document, h.handler, [h.file], h.signal);
  assert.equal(error, '');
  assert.deepEqual(h.events, ['hash', 'preflight', 'load', 'context', 'save', 'cover']);
  assert.equal(h.changed.length, 1);
  assert.equal(h.persistCalls(), 1);
});

test('preflight ambiguity/error stops before parser and preserves the import error', async () => {
  const failure = new Error('multiple exact histories');
  const h = loadFixture({ preflightError: failure });
  const error = await h.importData(h.document, h.handler, [h.file], h.signal);
  assert.match(error, /multiple exact histories/);
  assert.deepEqual(h.events, ['hash', 'preflight']);
  assert.deepEqual(h.changed, []);
});

test('character-count mode still parses without hashing or identity preflight', async () => {
  const h = loadFixture({ reusable: 7, countMode: true });
  const error = await h.importData(h.document, h.handler, [h.file], h.signal, h.fileCountData);
  assert.equal(error, '');
  assert.deepEqual(h.events, ['load']);
  assert.equal(h.fileCountData['book.epub'], 12);
  assert.deepEqual(h.changed, []);
  assert.equal(h.persistCalls(), 0, 'character-count mode should not request durable storage');
});

test('persistent-storage denial never blocks the book import', async () => {
  const h = loadFixture({ persistenceError: new Error('permission denied') });
  const error = await h.importData(h.document, h.handler, [h.file], h.signal);
  assert.equal(error, '');
  assert.deepEqual(h.events, ['hash', 'preflight', 'load', 'context', 'save', 'cover']);
  assert.equal(h.persistCalls(), 1);
});

test('a pending browser permission prompt never blocks the book import', async () => {
  const h = loadFixture({ persistenceNeverSettles: true });
  const completed = Promise.race([
    h.importData(h.document, h.handler, [h.file], h.signal),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('book import waited for persistent-storage permission')), 250)
    )
  ]);
  assert.equal(await completed, '');
  assert.deepEqual(h.events, ['hash', 'preflight', 'load', 'context', 'save', 'cover']);
  assert.equal(h.persistCalls(), 1);
});

test('multiple imports in one page lifetime request persistent storage only once', async () => {
  const h = loadFixture();
  assert.equal(await h.importData(h.document, h.handler, [h.file], h.signal), '');
  assert.equal(await h.importData(h.document, h.handler, [h.file], h.signal), '');
  assert.equal(h.persistCalls(), 1, 'Firefox could otherwise prompt on every import');
});

test('empty imports do not request persistent storage', async () => {
  const h = loadFixture();
  assert.equal(await h.importData(h.document, h.handler, [], h.signal), '');
  assert.equal(h.persistCalls(), 0);
});

test('background replication without book data does not request persistent storage', async () => {
  const h = loadFixture();
  const source = {
    storageType: 'backup',
    isCacheDisabled: () => false,
    clearData: () => assert.fail('source cache should stay enabled'),
    startContext() {}
  };
  const target = {
    ...h.handler,
    startContext() {}
  };
  assert.equal(
    await h.replicateData(
      source,
      target,
      false,
      [{ title: 'Progress only', imagePath: '' }],
      [],
      h.signal
    ),
    ''
  );
  assert.equal(
    h.persistCalls(),
    0,
    'progress/statistics-only background work must not cause a persistence prompt'
  );
});

test('book replication with no selected contexts does not request persistent storage', async () => {
  const h = loadFixture();
  const source = {
    storageType: 'backup',
    isCacheDisabled: () => false,
    clearData: () => assert.fail('source cache should stay enabled')
  };
  assert.equal(
    await h.replicateData(source, h.handler, false, [], ['data'], h.signal),
    ''
  );
  assert.equal(h.persistCalls(), 0);
});
