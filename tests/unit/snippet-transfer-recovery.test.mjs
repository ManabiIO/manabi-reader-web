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
const { structuredClone } = globalThis;

// Exercise the production resume path with its complete saved journal. File,
// permission and transaction boundaries are controlled; no real source is deleted.
const dir = await mkdtemp(join(tmpdir(), 'snippet-transfer-recovery-'));
const fixturePath = join(dir, 'fixture.mjs');
await writeFile(
  fixturePath,
  `
export const memory = {record: undefined, journal: undefined, destination: undefined, removeError: null, readError: null, capabilityError: null, writable: true, reads: 0, removes: 0, writes: 0, finishes: 0, capabilityReads: 0};
export const recordKey = (owner, id) => JSON.stringify([owner, id]);
export const locationKey = l => JSON.stringify([l.source.owner, l.source.id, l.source.root, l.fileId]);
export const getRecord = async () => structuredClone(memory.record);
export const integrationDB = async () => ({get: async () => structuredClone(memory.journal)});
export const exclusive = async (_name, work) => work();
export const putTransfer = async (value, guard) => {guard();memory.journal = structuredClone(value);};
export const beginTransfer = async () => {throw new Error('Resume must not create another journal');};
export const finishTransfer = async (operation, guard, change) => {
  guard();assertOwner(operation);
  memory.record = {...change(structuredClone(memory.record)),transfer: undefined};
  memory.journal = {...memory.journal,phase: 'complete'};
  memory.finishes++;
};
function assertOwner(operation) {
  if (memory.record.transfer !== operation.id) throw new Error('Transfer ownership changed');
}
export const capability = async () => {
  memory.capabilityReads++;
  if (memory.capabilityError) throw memory.capabilityError;
  return {write: memory.writable};
};
export const readDocument = async (_source, _id, guard) => {
  guard();memory.reads++;
  if (memory.readError) throw memory.readError;
  return structuredClone(memory.destination);
};
export const removeDocument = async (_location, _document, guard) => {
  guard();memory.removes++;
  if (memory.removeError) throw memory.removeError;
};
export const writeDocument = async () => {memory.writes++;throw new Error('Resume must not upload again');};
export const moveWithinSource = writeDocument;
export const prepareDestination = writeDocument;
export const sameSource = () => false;
export const flushRecord = async () => {};
export const reloadSnippets = async () => {};
export const snippetLock = (owner, id) => owner+id;
export const scope = () => ({owner: 'reader',guard() {}});
export const syncReading = async () => {};
`
);
await build({
  entryPoints: [resolve('apps/web/src/lib/snippets/transfers.ts')],
  outfile: join(dir, 'transfers.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'controlled-transfer-boundaries',
      setup(b) {
        b.onResolve(
          {
            filter:
              /^(\.\.\/manabi\/persistence|\.\/database|\.\/storage|\.\/service|\.\/reading-state)$/
          },
          () => ({ path: fixturePath, external: true })
        );
      }
    }
  ]
});
const { memory, locationKey, recordKey } = await import(pathToFileURL(fixturePath).href);
const { resumeTransfer } = await import(pathToFileURL(join(dir, 'transfers.mjs')).href);
await rm(dir, { recursive: true, force: true });
const selected = { owner: 'reader', guard() {} };
const id = 'b6e242fe-61c6-4676-b1df-afbc737d9d01';
const moveId = 'b6e242fe-61c6-4676-b1df-afbc737d9d02';
const document = {
  id,
  revision: 'b6e242fe-61c6-4676-b1df-afbc737d9d03',
  content: { type: 'doc', content: [{ type: 'paragraph' }] }
};
const from = {
  source: { owner: null, id: 'local', root: '', provider: 'local' },
  fileId: 'study.manabi-snippet.json',
  parent: '',
  name: 'study.manabi-snippet.json',
  token: 'source-token'
};
const to = {
  ...from,
  source: { owner: 'reader', id: 'cloud', root: 'root', provider: 'google' },
  fileId: 'destination-file',
  parent: 'root',
  token: 'destination-token'
};
const codeError = (code) => Object.assign(new Error(code), { code });
beforeEach(() => {
  memory.record = structuredClone({
    owner: selected.owner,
    document,
    primary: locationKey(from),
    destination: from,
    locations: [from],
    transfer: moveId
  });
  memory.journal = structuredClone({
    key: recordKey(selected.owner, moveId),
    owner: selected.owner,
    id: moveId,
    snippetId: id,
    document,
    from,
    to,
    copied: to,
    phase: 'copied',
    attempted: true
  });
  memory.destination = structuredClone({ document, location: to });
  memory.removeError = memory.readError = memory.capabilityError = null;
  memory.writable = true;
  memory.reads = memory.removes = memory.writes = memory.finishes = memory.capabilityReads = 0;
});
function assertPending() {
  assert.equal(memory.finishes, 0);
  assert.equal(memory.record.transfer, moveId);
  assert.equal(memory.journal.phase, 'copied');
  assert.equal(memory.writes, 0);
}

test('resuming after successful local deletion completes without another upload', async () => {
  memory.removeError = new DOMException('File already removed', 'NotFoundError');
  await resumeTransfer(id, selected);
  assert.equal(memory.finishes, 1);
  assert.equal(memory.record.primary, locationKey(to));
  assert.equal(memory.record.document.id, id);
  assert.equal(memory.record.transfer, undefined);
  assert.equal(memory.journal.phase, 'complete');
  assert.equal(memory.capabilityReads, 1);
  assert.equal(memory.writes, 0);
  assert.equal(memory.reads, 2);
});

test('a confirmed provider not_found still resumes interrupted cleanup', async () => {
  memory.journal.from.source = { ...from.source, owner: 'reader', provider: 'dropbox' };
  memory.removeError = codeError('not_found');
  await resumeTransfer(id, selected);
  assert.equal(memory.finishes, 1);
  assert.equal(memory.capabilityReads, 1);
  assert.equal(memory.writes, 0);
});

test('missing local file is not completion when write permission was revoked', async () => {
  memory.removeError = new DOMException('File already removed', 'NotFoundError');
  memory.writable = false;
  await assert.rejects(resumeTransfer(id, selected), { name: 'NotFoundError' });
  assertPending();
});

test('permission errors must not be treated as file deletion', async () => {
  memory.removeError = new DOMException('Permission revoked', 'NotAllowedError');
  await assert.rejects(resumeTransfer(id, selected), { name: 'NotAllowedError' });
  assertPending();
  assert.equal(memory.capabilityReads, 0);
});

test('a disconnected local root preserves the transfer journal', async () => {
  memory.removeError = new DOMException('File already removed', 'NotFoundError');
  memory.capabilityError = new Error('Folder no longer connected');
  await assert.rejects(resumeTransfer(id, selected), /no longer connected/);
  assertPending();
});

test('cloud sources do not interpret arbitrary DOM exceptions as deletion evidence', async () => {
  memory.journal.from.source = { ...from.source, owner: 'reader', provider: 'google' };
  memory.removeError = new DOMException('Unrelated missing resource', 'NotFoundError');
  await assert.rejects(resumeTransfer(id, selected), { name: 'NotFoundError' });
  assertPending();
  assert.equal(memory.capabilityReads, 0);
});

test('a missing destination can never authorize source cleanup', async () => {
  memory.readError = new DOMException('Destination disappeared', 'NotFoundError');
  await assert.rejects(resumeTransfer(id, selected), { name: 'NotFoundError' });
  assertPending();
  assert.equal(memory.removes, 0);
});

test('a changed original remains a conflict even when the destination is intact', async () => {
  memory.removeError = codeError('conflict');
  await assert.rejects(resumeTransfer(id, selected), /conflict/);
  assertPending();
  assert.equal(memory.capabilityReads, 0);
});
