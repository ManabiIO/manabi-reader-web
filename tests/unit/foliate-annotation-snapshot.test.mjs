/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileFunction } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const root = new URL('../../apps/web/src/lib/', import.meta.url);
let database;
let profile;
const modules = new Map();

function load(url) {
  const key = url.href;
  if (modules.has(key)) return modules.get(key);
  const { outputText, diagnostics } = ts.transpileModule(readFileSync(url, 'utf8'), {
    fileName: fileURLToPath(url),
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true
  });
  assert.equal(diagnostics.length, 0);
  const module = { exports: {} };
  modules.set(key, module.exports);
  compileFunction(outputText, ['require', 'module', 'exports'])(
    (name) => {
      if (name === '$lib/data/store') return { database };
      if (name === 'svelte/store') return { get: () => ({ status: 'ready' }) };
      if (name === '$lib/manabi/client') return { account: {}, localProfileUser: () => profile };
      if (name === '$lib/reader-location') return load(new URL('reader-location.ts', root));
      throw new Error(`Unexpected dependency: ${name}`);
    },
    module,
    module.exports
  );
  return module.exports;
}

const localBook = 'local:11111111-1111-4111-8111-111111111111';
const locator = (bookKey = localBook) => ({
  version: 1,
  bookKey,
  resource: { href: 'chapter.xhtml', spineIndex: 0, sectionId: 'ttu-epub-0' },
  projectionVersion: 2,
  resourceDigest: 'a'.repeat(64),
  start: 1,
  end: 1,
  quote: '',
  prefix: '前',
  suffix: '後'
});

function databaseGate() {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const puts = [];
  let dbReads = 0;
  const tx = {
    objectStore: (name) => ({
      get: async () => undefined,
      put: async (value) => {
        if (name === 'readerAnnotation') puts.push(globalThis.structuredClone(value));
      }
    }),
    done: Promise.resolve()
  };
  const db = {
    transaction: () => tx,
    get: async () => undefined
  };
  database = {};
  Object.defineProperty(database, 'db', {
    configurable: true,
    get() {
      dbReads += 1;
      return pending;
    }
  });
  return { release: () => release(db), puts, dbReads: () => dbReads };
}

test('annotation save snapshots locator and draft values before database suspension', async () => {
  profile = undefined;
  const gate = databaseGate();
  modules.clear();
  const { saveReaderAnnotation } = load(new URL('reader-annotations.ts', root));
  const target = locator();
  const draft = { bookKey: localBook, kind: 'bookmark', targets: [target], label: 'Original' };
  const saving = saveReaderAnnotation(draft, null);
  assert.equal(gate.dbReads(), 1);

  draft.bookKey = 'local:22222222-2222-4222-8222-222222222222';
  draft.kind = 'highlight';
  draft.label = 'Mutated';
  target.resource.href = 'other.xhtml';
  target.resource.spineIndex = 9;
  target.start = 99;
  target.end = 100;

  gate.release();
  const saved = await saving;
  assert.equal(gate.puts.length, 1);
  assert.equal(saved.bookKey, localBook);
  assert.equal(saved.kind, 'bookmark');
  assert.equal(saved.label, 'Original');
  assert.equal(saved.targets[0].resource.href, 'chapter.xhtml');
  assert.equal(saved.targets[0].resource.spineIndex, 0);
  assert.equal(saved.targets[0].start, 1);
  assert.deepEqual(gate.puts[0], saved);
});

test('unsupported future locator projections reject before database access', async () => {
  profile = undefined;
  const gate = databaseGate();
  modules.clear();
  const { saveReaderAnnotation } = load(new URL('reader-annotations.ts', root));
  const target = { ...locator(), projectionVersion: 999 };
  await assert.rejects(
    saveReaderAnnotation({ bookKey: localBook, kind: 'bookmark', targets: [target] }, null),
    /invalid reading location/i
  );
  assert.equal(gate.dbReads(), 0);
});

test('portable annotation validation rejects unsupported locator projections', () => {
  profile = undefined;
  database = {};
  modules.clear();
  const { validateImportedAnnotation } = load(new URL('reader-annotations.ts', root));
  const annotation = {
    id: '33333333-3333-4333-8333-333333333333',
    bookKey: localBook,
    kind: 'bookmark',
    targets: [{ ...locator(), projectionVersion: 999 }],
    createdAt: '2026-09-28T12:00:00.000Z',
    modifiedAt: '2026-09-28T12:00:00.000Z',
    revision: 1
  };
  assert.throws(() => validateImportedAnnotation(annotation), /invalid reading location/i);
});

test('annotation import refuses an ID collision across different books', async () => {
  profile = undefined;
  const existingBook = localBook;
  const incomingBook = 'local:44444444-4444-4444-8444-444444444444';
  const id = '55555555-5555-4555-8555-555555555555';
  const annotation = (bookKey) => ({
    id,
    bookKey,
    kind: 'bookmark',
    targets: [locator(bookKey)],
    createdAt: '2026-09-28T12:00:00.000Z',
    modifiedAt: '2026-09-28T12:00:00.000Z',
    revision: 1
  });
  const existing = annotation(existingBook);
  let conflicts = 0;
  const tx = {
    objectStore: (name) => ({
      get: async () => (name === 'readerAnnotation' ? existing : undefined),
      put: async () => {
        if (name === 'readerConflict') conflicts += 1;
      }
    }),
    abort: () => {},
    done: Promise.resolve()
  };
  database = {
    db: Promise.resolve({
      transaction: () => tx
    })
  };
  modules.clear();
  const { importReaderAnnotations } = load(new URL('reader-annotations.ts', root));
  await assert.rejects(
    importReaderAnnotations(
      JSON.stringify({
        format: 'manabi-reader-annotations',
        version: 1,
        annotations: [annotation(incomingBook)]
      }),
      null
    ),
    /another book/i
  );
  assert.equal(conflicts, 0);
});
