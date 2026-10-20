/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { ImportTransfer, IMPORT_CHUNK_BYTES } from '../../apps/web/src/platform/bridge-contract.ts';
import {
  BACKGROUND_IMPORT_MAX_BYTES,
  isNativeBackgroundImage,
  isNativeBackgroundResource,
  isNativeBackgroundState,
  parseBackgroundSlot
} from '../../apps/web/src/native-settings/background-contract.ts';
const compiled = await build({
  entryPoints: ['apps/web/src/native-settings/background-selection.ts'],
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
const { selectNativeBackground } = module.exports;
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function fixture({
  bytes = new Uint8Array(IMPORT_CHUNK_BYTES + 7).fill(42),
  pick,
  read,
  command,
  size = bytes.length
} = {}) {
  let owner = { session: 'background_session', epoch: 0 },
    offset = 0,
    closed = 0;
  const calls = [];
  const deps = {
    scope: () => owner,
    pick:
      pick ??
      (async () => ({
        canceled: false,
        assets: [{ name: 'wallpaper.png', uri: 'content://private/background' }]
      })),
    file: () => ({
      size,
      open: () => ({
        readBytes: async (n) => {
          await read?.();
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
test('native background picker streams exact bytes with a frozen target slot and never sends a URI', async () => {
  const f = fixture(),
    abort = new AbortController();
  assert.equal(
    await selectNativeBackground(f.deps, { target: 'library', mode: 'dark' }, abort.signal),
    true
  );
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ['import.begin', 'import.chunk', 'import.chunk', 'import.commit']
  );
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].payload.background)), {
    target: 'library',
    mode: 'dark',
    type: 'image/png'
  });
  assert.equal(f.calls[0].payload.font, undefined);
  assert.equal(f.calls[0].payload.cover, undefined);
  assert.doesNotMatch(JSON.stringify(f.calls), /content:\/\/|private\/background/);
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
    await selectNativeBackground(
      cancelled.deps,
      { target: 'library', mode: 'dark' },
      new AbortController().signal
    ),
    false
  );
  assert.equal(cancelled.calls.length, 0);
  const waiting = deferred(),
    f = fixture({ pick: () => waiting.promise });
  const operation = selectNativeBackground(
    f.deps,
    { target: 'library', mode: 'dark' },
    new AbortController().signal
  );
  f.change();
  waiting.resolve({ canceled: false, assets: [{ name: 'image.png', uri: 'private' }] });
  await assert.rejects(operation, /account changed/);
  assert.equal(f.calls.length, 0);
});
test('empty, oversized, unsupported and short files fail without replaying a commit', async () => {
  for (const options of [
    { size: 0 },
    { size: BACKGROUND_IMPORT_MAX_BYTES + 1 },
    { size: 100, bytes: new Uint8Array(1) },
    { pick: async () => ({ canceled: false, assets: [{ name: 'not-font.html', uri: 'private' }] }) }
  ]) {
    const f = fixture(options);
    await assert.rejects(
      selectNativeBackground(
        f.deps,
        { target: 'library', mode: 'dark' },
        new AbortController().signal
      )
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
  const saving = selectNativeBackground(f.deps, { target: 'library', mode: 'dark' }, abort.signal);
  await started.promise;
  abort.abort();
  pending.resolve();
  await assert.rejects(saving, /interrupted/);
  assert.equal(f.calls.filter((c) => c.method === 'import.commit').length, 1);
  assert.equal(f.calls.filter((c) => c.method === 'import.cancel').length, 1);
  assert.equal(f.calls.at(-1).payload.transferId, f.calls[0].payload.transferId);
  assert.equal(f.closed, 1);
});
test('background transfer inherits sequence, scope, limits and one-shot identity without becoming a book, font or cover', () => {
  const transfer = new ImportTransfer(),
    scope = { session: 'background_session', epoch: 1 };
  const target = { target: 'reader', mode: 'light', type: 'image/png' };
  transfer.beginBackground(scope, 'background_transfer', 'image.png', 2, target);
  target.mode = 'dark';
  assert.throws(
    () => transfer.chunk({ ...scope, epoch: 3 }, 'background_transfer', 0, new Uint8Array(2)),
    /expired/
  );
  assert.throws(() => transfer.commit(scope, 'background_transfer'), /incomplete/);
  transfer.chunk(scope, 'background_transfer', 0, Uint8Array.of(1, 2));
  const result = transfer.commit(scope, 'background_transfer');
  assert.equal(result.background.mode, 'light');
  assert.equal(result.font, undefined);
  assert.equal(result.cover, undefined);
  assert.throws(
    () => transfer.beginBackground(scope, 'background_transfer', 'image.png', 2, target),
    /already been used/
  );
  assert.throws(
    () =>
      new ImportTransfer().beginBackground(
        scope,
        'other_transfer',
        'image.png',
        BACKGROUND_IMPORT_MAX_BYTES + 1,
        target
      ),
    /8 MB/
  );
});

for (const reason of ['abort', 'account']) {
  test(`pending async background read retires on ${reason} before sending any bytes`, async () => {
    const started = deferred(),
      pending = deferred(),
      abort = new AbortController();
    const f = fixture({
      read: () => {
        started.resolve();
        return pending.promise;
      }
    });
    const saving = selectNativeBackground(
      f.deps,
      { target: 'library', mode: 'dark' },
      abort.signal
    );
    await started.promise;
    if (reason === 'abort') abort.abort();
    else f.change();
    pending.resolve();
    await assert.rejects(saving);
    assert.equal(
      f.calls.filter((call) => ['import.chunk', 'import.commit'].includes(call.method)).length,
      0
    );
    assert.equal(f.closed, 1);
    assert.equal(
      f.calls.filter((call) => call.method === 'import.cancel').length,
      reason === 'abort' ? 1 : 0
    );
  });
}

test('background contract rejects paths, wrong modes, duplicate metadata slots and oversized resources', () => {
  for (const slot of [
    null,
    { target: ['library'], mode: 'light' },
    { target: 'library', mode: 'auto' },
    { target: 'library', mode: 'light', uri: 'file:///private' }
  ])
    assert.throws(() => parseBackgroundSlot(slot));
  const image = { uri: 'data:image/png;base64,AAAA', width: 10, height: 20 };
  assert.ok(isNativeBackgroundImage(image));
  for (const changed of [
    { uri: 'https://example.test/wallpaper' },
    { uri: 'data:image/svg+xml;base64,AAAA' },
    { width: 2049 },
    { height: 0 },
    { uri: 'data:image/png;base64,' + 'A'.repeat(524292) }
  ])
    assert.equal(isNativeBackgroundImage({ ...image, ...changed }), false);
  assert.ok(isNativeBackgroundResource({ target: 'reader', mode: 'dark', image, fade: 0.4 }));
  assert.equal(
    isNativeBackgroundResource({ target: 'reader', mode: 'dark', image, fade: NaN }),
    false
  );
  const slots = ['library', 'reader'].flatMap((target) =>
    ['light', 'dark'].map((mode) => ({ target, mode, present: false, name: '' }))
  );
  assert.ok(isNativeBackgroundState({ slots }));
  assert.equal(isNativeBackgroundState({ slots: [slots[0], slots[0], slots[2], slots[3]] }), false);
});
