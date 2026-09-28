/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { structuredClone, crypto } = globalThis;

// Execute the complete production reading-state module. Only the asynchronous
// database/provider boundaries are controlled, to settle replies after a move.
const dir = await mkdtemp(join(tmpdir(), 'snippet-reading-ownership-'));
const fixturePath = join(dir, 'fixture.mjs');
await writeFile(
  fixturePath,
  `
export const memory = {record: undefined, states: new Map(), reads: [], writes: [], beforeRead: null, beforeWrite: null, beforeMutate: null};
export const locationKey = l => JSON.stringify([l.source.owner, l.source.id, l.source.root, l.fileId]);
export const getRecord = async () => structuredClone(memory.record);
export const mutateRecord = async (_owner, _id, guard, change) => {
  if (memory.beforeMutate) await memory.beforeMutate();
  guard();
  const next = change(structuredClone(memory.record));
  memory.record = structuredClone(next);
  return next;
};
export const sha256 = async value => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex');
export const librarySource = async source => ({
  state: async key => {
    memory.reads.push(source.id);
    const result = structuredClone(memory.states.get(source.id + key) ?? {value: null, revision: '0'});
    if (memory.beforeRead) await memory.beforeRead(source);
    return result;
  },
  write: async (key, value, revision) => {
    memory.writes.push(source.id);
    if (memory.beforeWrite) await memory.beforeWrite(source);
    const current = memory.states.get(source.id + key) ?? {revision: '0'};
    if (current.revision !== revision) throw new Error('Provider revision conflict');
    const next = {value: structuredClone(value), revision: String(Number(revision) + 1)};
    memory.states.set(source.id + key, next);
    return structuredClone(next);
  }
});
`
);
await build({
  entryPoints: [resolve('apps/web/src/lib/snippets/reading-state.ts')],
  outfile: join(dir, 'reading.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'controlled-reading-boundaries',
      setup(b) {
        b.onResolve(
          { filter: /^(\.\.\/library\/catalog|\.\.\/manabi\/sources|\.\/database)$/ },
          () => ({ path: fixturePath, external: true })
        );
      }
    }
  ]
});
const { memory, locationKey } = await import(pathToFileURL(fixturePath).href);
const { syncReading, readingKey, saveProgress } = await import(
  pathToFileURL(join(dir, 'reading.mjs')).href
);
await rm(dir, { recursive: true, force: true });

const id = '0c51c1ce-fd58-4c74-af7f-77b6789b2c01';
const revision = '0c51c1ce-fd58-4c74-af7f-77b6789b2c02';
const from = {
  source: { owner: 'reader', id: 'from', root: 'root', provider: 'dropbox' },
  fileId: 'source-file',
  parent: 'root',
  name: 'study.manabi-snippet.json',
  token: 'source-token'
};
const to = {
  ...from,
  source: { ...from.source, id: 'to', provider: 'google' },
  fileId: 'destination-file',
  token: 'destination-token'
};
const locator = { blockId: 'p1', offset: 0, quote: '日本語', before: '', revision };
const selected = { owner: 'reader', guard() {} };
const key = await readingKey(id);
const state = (readAt = 100, quote = locator.quote) => ({
  format: 'manabi-snippet-reading',
  version: 1,
  id,
  readAt,
  locator: { ...locator, quote }
});
function relocate() {
  memory.record = {
    ...memory.record,
    primary: locationKey(to),
    destination: to,
    locations: [to],
    transfer: undefined
  };
}
beforeEach(() => {
  memory.record = structuredClone({
    owner: selected.owner,
    document: { id, revision },
    primary: locationKey(from),
    destination: from,
    locations: [from],
    readAt: 100,
    progress: locator,
    progressDirty: true
  });
  memory.states.clear();
  memory.reads = [];
  memory.writes = [];
  memory.beforeRead = memory.beforeWrite = memory.beforeMutate = null;
});

test('a settled read cannot redirect the latest progress back to the old storage home', async () => {
  memory.beforeRead = async () => relocate();
  await assert.rejects(syncReading(id, selected), /storage.*changed/i);
  assert.deepEqual(memory.writes, []);
  assert.equal(memory.record.progressDirty, true);
  assert.equal(memory.record.progressToken, undefined);
  memory.beforeRead = null;
  await syncReading(id, selected);
  assert.deepEqual(memory.writes, ['to']);
  assert.equal(memory.record.progressDirty, false);
});

test('a late write acknowledgement does not clear progress awaiting the new destination', async () => {
  memory.beforeWrite = async () => relocate();
  await assert.rejects(syncReading(id, selected), /storage.*changed/i);
  assert.equal(memory.record.progressDirty, true);
  assert.equal(memory.record.progressToken, undefined);
  assert.equal(memory.record.stateCheckedAt, undefined);
  assert.equal(memory.states.has('to' + key), false);
  memory.beforeWrite = null;
  await syncReading(id, selected);
  assert.equal(memory.states.get('to' + key).value.readAt, 100);
});

test('a new move reservation fences an older source-state request before it writes', async () => {
  memory.beforeRead = async () => {
    memory.record.transfer = 'next-move';
  };
  await assert.rejects(syncReading(id, selected), /storage.*changed/i);
  assert.deepEqual(memory.writes, []);
  assert.equal(memory.record.progressDirty, true);
});

test('completed target transfer cannot acknowledge progress owned by its successor', async () => {
  memory.record.transfer = 'first-move';
  memory.beforeWrite = async () => {
    relocate();
    memory.record.transfer = 'second-move';
  };
  await assert.rejects(syncReading(id, selected, to), /storage.*changed/i);
  assert.equal(memory.record.transfer, 'second-move');
  assert.equal(memory.record.progressDirty, true);
  assert.equal(memory.record.progressToken, undefined);
});

test('a missing primary cannot be silently acknowledged as a saved position', async () => {
  memory.beforeRead = async () => {
    memory.record.locations[0].missing = true;
  };
  await assert.rejects(syncReading(id, selected), /storage.*changed/i);
  assert.deepEqual(memory.writes, []);
  assert.equal(memory.record.progressDirty, true);
});

test('remote adoption rechecks location ownership inside the local write transaction', async () => {
  memory.record.progressDirty = false;
  memory.states.set('from' + key, { value: state(200, '古い場所'), revision: '7' });
  memory.beforeMutate = async () => relocate();
  await assert.rejects(syncReading(id, selected), /storage.*changed/i);
  assert.equal(memory.record.progress.quote, locator.quote);
  assert.equal(memory.record.progressToken, undefined);
});

test('unchanged primary still adopts newer remote reading intent', async () => {
  memory.record.progressDirty = false;
  memory.states.set('from' + key, { value: state(200, '新しい位置'), revision: '7' });
  await syncReading(id, selected);
  assert.equal(memory.record.progress.quote, '新しい位置');
  assert.equal(memory.record.progressToken, '7');
  assert.deepEqual(memory.writes, []);
});

test('an active transfer can persist reading state to its verified destination', async () => {
  memory.record.transfer = 'first-move';
  await syncReading(id, selected, to);
  assert.equal(memory.states.get('to' + key).value.readAt, 100);
  assert.equal(memory.record.progressDirty, false);
});

test('a newer local reading intent remains dirty after an older upload acknowledgement', async () => {
  memory.beforeWrite = async () => saveProgress(id, { ...locator, quote: '次へ' }, selected);
  await syncReading(id, selected);
  assert.equal(memory.record.progress.quote, '次へ');
  assert.equal(memory.record.progressDirty, true);
});

test('document edits and provider token rotation do not invalidate the same storage home', async () => {
  memory.beforeRead = async () => {
    memory.record.document.revision = crypto.randomUUID();
    memory.record.locations[0].token = 'new-body-token';
  };
  await syncReading(id, selected);
  assert.equal(memory.record.progressDirty, false);
  assert.deepEqual(memory.writes, ['from']);
});

test('ordinary refresh defers to an active move instead of syncing the departing source', async () => {
  memory.record.transfer = 'first-move';
  await syncReading(id, selected);
  assert.deepEqual(memory.reads, []);
  assert.deepEqual(memory.writes, []);
  assert.equal(memory.record.progressDirty, true);
});
