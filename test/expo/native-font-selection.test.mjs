/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import {
  ImportTransfer,
  IMPORT_CHUNK_BYTES,
  MAX_IMPORT_BYTES
} from '../../apps/web/src/platform/bridge-contract.ts';
const compiled = await build({
  entryPoints: ['apps/web/src/native-settings/font-selection.ts'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node'
});
const module = { exports: {} };
vm.runInNewContext(compiled.outputFiles[0].text, {
  module,
  exports: module.exports,
  btoa: (value) => Buffer.from(value, 'binary').toString('base64')
});
const { selectNativeUserFont } = module.exports;
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function fixture({
  bytes = new Uint8Array(IMPORT_CHUNK_BYTES + 7).fill(42),
  pick,
  command,
  size = bytes.length
} = {}) {
  let owner = { session: 'font_session', epoch: 0 },
    offset = 0,
    closed = 0;
  const calls = [];
  const deps = {
    scope: () => owner,
    pick:
      pick ??
      (async () => ({
        canceled: false,
        assets: [{ name: 'face.woff2', uri: 'content://private/font' }]
      })),
    file: () => ({
      size,
      open: () => ({
        readBytes: (n) => {
          const value = bytes.slice(offset, offset + n);
          offset += value.length;
          return value;
        },
        close: () => closed++
      })
    }),
    command: async (method, payload) => {
      calls.push({ method, payload });
      return command?.(method, payload);
    }
  };
  return {
    deps,
    calls,
    get closed() {
      return closed;
    },
    change: () => (owner = { ...owner, epoch: owner.epoch + 2 })
  };
}
test('native font picker streams exact bytes with a frozen font name and never sends a URI', async () => {
  const f = fixture(),
    abort = new AbortController();
  assert.equal(await selectNativeUserFont(f.deps, { name: ' Custom ' }, abort.signal), true);
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ['import.begin', 'import.chunk', 'import.chunk', 'import.commit']
  );
  assert.equal(f.calls[0].payload.font.name, 'Custom');
  assert.equal(f.calls[0].payload.cover, undefined);
  assert.doesNotMatch(JSON.stringify(f.calls), /content:\/\/|private\/font/);
  const bytes = Buffer.concat(
    f.calls
      .filter((c) => c.method === 'import.chunk')
      .map((c) => Buffer.from(c.payload.data, 'base64'))
  );
  assert.equal(bytes.length, IMPORT_CHUNK_BYTES + 7);
  assert.ok(bytes.every((byte) => byte === 42));
  assert.equal(f.closed, 1);
});
test('picker cancellation and account ABA never start a transfer', async () => {
  const cancelled = fixture({ pick: async () => ({ canceled: true }) });
  assert.equal(
    await selectNativeUserFont(cancelled.deps, { name: 'Custom' }, new AbortController().signal),
    false
  );
  assert.equal(cancelled.calls.length, 0);
  const waiting = deferred(),
    f = fixture({ pick: () => waiting.promise });
  const operation = selectNativeUserFont(f.deps, { name: 'Custom' }, new AbortController().signal);
  f.change();
  waiting.resolve({ canceled: false, assets: [{ name: 'f.woff', uri: 'private' }] });
  await assert.rejects(operation, /account changed/);
  assert.equal(f.calls.length, 0);
});
test('empty, oversized, unsupported and short files fail without replaying a commit', async () => {
  for (const options of [
    { size: 0 },
    { size: MAX_IMPORT_BYTES + 1 },
    { size: 100, bytes: new Uint8Array(1) },
    { pick: async () => ({ canceled: false, assets: [{ name: 'not-font.html', uri: 'private' }] }) }
  ]) {
    const f = fixture(options);
    await assert.rejects(
      selectNativeUserFont(f.deps, { name: 'Custom' }, new AbortController().signal)
    );
    assert.equal(f.calls.filter((c) => c.method === 'import.commit').length, 0);
  }
});
test('closing during commit sends only a matching cancel and surfaces reconciliation without replay', async () => {
  const pending = deferred(),
    started = deferred();
  const abort = new AbortController();
  const f = fixture({
    command: async (method) => {
      if (method === 'import.commit') {
        started.resolve();
        await pending.promise;
      }
    }
  });
  const saving = selectNativeUserFont(f.deps, { name: 'Custom' }, abort.signal);
  await started.promise;
  abort.abort();
  pending.resolve();
  await assert.rejects(saving, /interrupted/);
  assert.equal(f.calls.filter((c) => c.method === 'import.commit').length, 1);
  assert.equal(f.calls.filter((c) => c.method === 'import.cancel').length, 1);
  assert.equal(f.calls.at(-1).payload.transferId, f.calls[0].payload.transferId);
  assert.equal(f.closed, 1);
});
test('font transfer inherits exact sequence, scope and one-shot identity admission without becoming a book or cover', () => {
  const transfer = new ImportTransfer(),
    scope = { session: 'font_session', epoch: 1 };
  const target = { name: 'Face' };
  transfer.beginFont(scope, 'font_transfer', 'face.otf', 2, target);
  target.name = 'Changed';
  assert.throws(
    () => transfer.chunk({ ...scope, epoch: 3 }, 'font_transfer', 0, new Uint8Array(2)),
    /expired/
  );
  assert.throws(() => transfer.commit(scope, 'font_transfer'), /incomplete/);
  transfer.chunk(scope, 'font_transfer', 0, Uint8Array.of(1, 2));
  const result = transfer.commit(scope, 'font_transfer');
  assert.equal(result.font.name, 'Face');
  assert.equal(result.cover, undefined);
  assert.throws(
    () => transfer.beginFont(scope, 'font_transfer', 'face.otf', 2, { name: 'Face' }),
    /already been used/
  );
  assert.throws(
    () => new ImportTransfer().beginFont(scope, 'other_transfer', 'file.txt', 2, { name: 'Face' }),
    /WOFF/
  );
});
