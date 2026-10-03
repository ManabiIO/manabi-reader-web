/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import {
  BridgeAuthority,
  ImportTransfer,
  IMPORT_CHUNK_BYTES,
  MAX_COVER_IMPORT_BYTES,
  importChunkRequestId
} from '../../apps/web/src/platform/bridge-contract.ts';
const output = mkdtempSync(join(tmpdir(), 'native-cover-selection-'));
const require = createRequire(import.meta.url);
function bundle(path) {
  const outfile = join(output, `${path.split('/').at(-1)}.cjs`);
  buildSync({
    entryPoints: [resolve(`apps/web/src/${path}.ts`)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    tsconfig: 'apps/web/tsconfig.json',
    logLevel: 'silent'
  });
  return require(outfile);
}
const { selectNativeLibraryCover } = bundle('native-library/cover-selection');
const { NativeLibraryService } = bundle('native-library/service');
const { coverOverride } = bundle('lib/library/cover-override');
process.on('exit', () => rmSync(output, { recursive: true, force: true }));
const png = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4);
const file = (bytes = png, type = 'image/png') => new File([bytes], 'cover.png', { type });
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const tick = () => new Promise((r) => setImmediate(r));
function raster({
  width = 1200,
  height = 1800,
  decode,
  encoded = 'data:image/webp;base64,AQID'
} = {}) {
  let closed = 0,
    draws = 0,
    decodes = 0;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage: () => {
        draws++;
      }
    }),
    toDataURL: () => encoded
  };
  globalThis.document = {
    createElement(name) {
      assert.equal(name, 'canvas');
      return canvas;
    }
  };
  globalThis.createImageBitmap = async () => {
    decodes++;
    if (decode) await decode;
    return {
      width,
      height,
      close: () => {
        closed++;
      }
    };
  };
  return {
    canvas,
    get closed() {
      return closed;
    },
    get draws() {
      return draws;
    },
    get decodes() {
      return decodes;
    }
  };
}
function owner() {
  const controller = new AbortController();
  let current = true;
  return {
    key: 'session:0',
    signal: controller.signal,
    assertCurrent() {
      if (!current) throw new Error('account changed');
    },
    abort: () => controller.abort(),
    change: () => {
      current = false;
    }
  };
}
function library() {
  const hash = 'ab'.repeat(32);
  const book = {
    key: 'book:1',
    bookId: 1,
    contentHash: hash,
    canonicalTitle: 'A book',
    title: 'A book',
    organizationKey: `content:${hash}`,
    organizationAliases: [`content:${hash}`, 'book:1'],
    lastBookModified: 10,
    imagePath: '',
    isPlaceholder: false,
    characters: 10,
    progress: 0,
    lastBookOpen: 0,
    lastBookmarkModified: 0,
    direction: 'unknown'
  };
  const data = {
    tree: [{ kind: 'book', id: book.key, book }],
    organization: { version: 1, books: {}, collections: [] },
    sources: []
  };
  const writes = [];
  let serial = 0;
  const service = new NativeLibraryService(
    {
      load: async () => structuredClone(data),
      write: async (action, targets, expected, authority) => {
        authority.signal.throwIfAborted();
        authority.assertCurrent();
        writes.push({ action, targets, expected });
      }
    },
    () => `opaque_${++serial}`
  );
  return { service, data, book, writes };
}
async function selection(f, authority) {
  const state = await f.service.state({}, authority);
  return { token: state.token, key: state.items[0].key, type: 'image/png' };
}
function picker({ bytes = png, type = 'image/png', pick, command, read } = {}) {
  let scope = { session: 'session_123', epoch: 0 },
    closed = 0,
    offset = 0;
  const calls = [];
  return {
    calls,
    get closed() {
      return closed;
    },
    change() {
      scope = { ...scope, epoch: scope.epoch + 2 };
    },
    dependencies: {
      scope: () => scope,
      pick:
        pick ??
        (async () => ({
          canceled: false,
          assets: [{ name: 'cover.png', uri: 'content://picker/private-image', mimeType: type }]
        })),
      file: () => ({
        size: bytes.length,
        open: () => ({
          readBytes(size) {
            read?.();
            const value = bytes.slice(offset, offset + size);
            offset += value.length;
            return value;
          },
          close() {
            closed++;
          }
        })
      }),
      command: async (method, payload) => {
        calls.push({ method, payload });
        return command?.(method, payload);
      }
    }
  };
}
const target = { token: 'selection_123', key: 'book_key_123' };

test('normal web and native cover inputs share a bounded raster pipeline and release bitmaps', async () => {
  const state = raster();
  for (const input of [
    file(),
    file(Uint8Array.of(255, 216, 255, 1), 'image/jpeg'),
    file(Uint8Array.of(82, 73, 70, 70, 1, 2, 3, 4, 87, 69, 66, 80), 'image/webp')
  ])
    assert.equal(await coverOverride(input), 'data:image/webp;base64,AQID');
  assert.equal(state.closed, 3);
  assert.equal(state.draws, 3);
  assert.equal(state.canvas.width, 0);
  assert.equal(state.canvas.height, 0);
});
test('SVG, HTML, forged raster MIME, empty, oversized bytes and mismatched image types fail before decode', async () => {
  const state = raster();
  for (const input of [
    file('<svg><script>native()</script></svg>', 'image/svg+xml'),
    file('<html>native()</html>', 'text/html'),
    file('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    file(png, 'image/jpeg'),
    file(new Uint8Array()),
    file(new Uint8Array(MAX_COVER_IMPORT_BYTES + 1))
  ])
    await assert.rejects(coverOverride(input));
  assert.equal(state.decodes, 0);
});
test('oversized decoded dimensions, pixels and encoding reject and clean up', async () => {
  for (const size of [
    { width: 8193, height: 1 },
    { width: 4097, height: 4097 },
    { width: 0, height: 1 },
    { width: Infinity, height: 2 },
    { encoded: 'data:image/webp;base64,' + 'A'.repeat(512 * 1024) },
    { encoded: 'data:image/svg+xml;base64,AQID' }
  ]) {
    const state = raster(size);
    await assert.rejects(coverOverride(file()));
    assert.equal(state.closed, 1);
  }
});
test('cancelled bitmap decoding rejects immediately and closes a late result without drawing', async () => {
  const decode = deferred();
  const state = raster({ decode: decode.promise });
  const authority = owner();
  const pending = coverOverride(file(), authority);
  await tick();
  authority.abort();
  await assert.rejects(pending, /cancelled/);
  decode.resolve();
  await tick();
  assert.equal(state.closed, 1);
  assert.equal(state.draws, 0);
});
test('cover selection sends only bounded chunks and opaque admission, never the native picker URI', async () => {
  const f = picker({ bytes: new Uint8Array(IMPORT_CHUNK_BYTES + 7) });
  assert.equal(
    await selectNativeLibraryCover(f.dependencies, target, new AbortController().signal),
    true
  );
  assert.deepEqual(
    f.calls.map((call) => call.method),
    ['import.begin', 'import.chunk', 'import.chunk', 'import.commit']
  );
  assert.equal(f.calls[1].payload.sequence, 0);
  assert.equal(f.calls[2].payload.sequence, 1);
  assert.ok(f.calls.every((call) => JSON.stringify(call).length < 768 * 1024));
  assert.ok(!JSON.stringify(f.calls).includes('content://'));
  assert.equal(f.closed, 1);
});
test('picker cancellation is a no-op and account ABA while picking never sends bytes', async () => {
  const cancelled = picker({ pick: async () => ({ canceled: true }) });
  assert.equal(
    await selectNativeLibraryCover(cancelled.dependencies, target, new AbortController().signal),
    false
  );
  assert.deepEqual(cancelled.calls, []);
  const wait = deferred();
  const f = picker({ pick: () => wait.promise });
  const pending = selectNativeLibraryCover(f.dependencies, target, new AbortController().signal);
  f.change();
  wait.resolve({
    canceled: false,
    assets: [{ name: 'cover.png', uri: 'local', mimeType: 'image/png' }]
  });
  await assert.rejects(pending, /account changed/);
  assert.deepEqual(f.calls, []);
});
test('wrong MIME/size reject before begin and scope is checked again after native reads', async () => {
  for (const input of [
    { type: 'image/svg+xml' },
    { bytes: new Uint8Array(MAX_COVER_IMPORT_BYTES + 1) }
  ]) {
    const f = picker(input);
    await assert.rejects(
      selectNativeLibraryCover(f.dependencies, target, new AbortController().signal)
    );
    assert.deepEqual(f.calls, []);
  }
  const f = picker({ read: () => f.change() });
  await assert.rejects(
    selectNativeLibraryCover(f.dependencies, target, new AbortController().signal),
    /account changed/
  );
  assert.deepEqual(
    f.calls.map((call) => call.method),
    ['import.begin']
  );
  assert.equal(f.closed, 1);
});
test('unknown commit is not replayed and cleanup targets only its own transfer', async () => {
  const f = picker({
    command: async (method) => {
      if (method === 'import.commit') throw new Error('unknown saved outcome');
    }
  });
  await assert.rejects(
    selectNativeLibraryCover(f.dependencies, target, new AbortController().signal),
    /unknown/
  );
  assert.equal(f.calls.filter((call) => call.method === 'import.commit').length, 1);
  const cancel = f.calls.at(-1);
  assert.equal(cancel.method, 'import.cancel');
  assert.equal(cancel.payload.transferId, f.calls[0].payload.transferId);
  assert.equal(f.closed, 1);
});
test('cancellation during a pending save sends targeted cancel without waiting for acknowledgement', async () => {
  const saving = deferred();
  const f = picker({
    command: async (method) => (method === 'import.commit' ? saving.promise : undefined)
  });
  const abort = new AbortController();
  const pending = selectNativeLibraryCover(f.dependencies, target, abort.signal);
  await tick();
  abort.abort();
  assert.equal(f.calls.at(-1).method, 'import.cancel');
  saving.resolve();
  await assert.rejects(pending, /reconcile/i);
  assert.equal(f.calls.filter((call) => call.method === 'import.cancel').length, 1);
});
test('cover transfer validates metadata and byte cap, preserves tombstones and scopes targeted cancellation', () => {
  const transfer = new ImportTransfer();
  const scope = { session: 'session_123', epoch: 0 };
  for (const input of [
    { ...target, type: 'image/svg+xml' },
    { ...target, type: 'image/png', uri: 'file://secret' }
  ])
    assert.throws(() => transfer.beginCover(scope, 'cover_123', 'cover.png', 1, input));
  assert.throws(() =>
    transfer.beginCover(scope, 'cover_123', 'cover.png', MAX_COVER_IMPORT_BYTES + 1, {
      ...target,
      type: 'image/png'
    })
  );
  transfer.beginCover(scope, 'cover_123', 'cover.png', 1, { ...target, type: 'image/png' });
  transfer.retire({ ...scope, epoch: 2 }, 'cover_123');
  transfer.retire(scope, 'old_cover_123');
  transfer.chunk(scope, 'cover_123', 0, Uint8Array.of(1));
  assert.deepEqual(transfer.commit(scope, 'cover_123').cover, { ...target, type: 'image/png' });
  transfer.beginCover(scope, 'new_cover_123', 'cover.png', 1, { ...target, type: 'image/png' });
  transfer.retire(scope, 'cover_123');
  transfer.retire(scope, 'cover_123');
  transfer.chunk(scope, 'new_cover_123', 0, Uint8Array.of(2));
  assert.equal(transfer.commit(scope, 'new_cover_123').size, 1);
  assert.throws(
    () =>
      transfer.beginCover({ ...scope, epoch: 2 }, 'cover_123', 'cover.png', 1, {
        ...target,
        type: 'image/png'
      }),
    /already been used/
  );
});
test('cover mutation uses existing presentation storage, preserves baselines and consumes admission once', async () => {
  raster();
  const f = library(),
    authority = owner();
  const selected = await selection(f, authority);
  assert.deepEqual(await f.service.replaceCover(selected, file(), authority), { saved: true });
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0].action.change, { cover: 'data:image/webp;base64,AQID' });
  assert.equal(f.writes[0].targets[0].organizationKey, f.book.organizationKey);
  assert.ok(Object.hasOwn(f.writes[0].expected, f.book.organizationKey));
  await assert.rejects(f.service.replaceCover(selected, file(), authority), /expired/);
});
test('unseen, provider-only, placeholder and hashless copies cannot acquire cover write admission', async () => {
  for (const mutate of [
    (book) => {
      book.bookId = undefined;
    },
    (book) => {
      book.isPlaceholder = true;
    },
    (book) => {
      book.contentHash = undefined;
      book.organizationKey = 'book:1';
    }
  ]) {
    const f = library(),
      authority = owner();
    mutate(f.book);
    const state = await f.service.state({}, authority);
    assert.equal(state.items[0].canChangeCover, false);
    assert.throws(
      () =>
        f.service.admitCover(
          { token: state.token, key: state.items[0].key, type: 'image/png' },
          authority
        ),
      /Re-import/
    );
    assert.equal(f.writes.length, 0);
  }
  const f = library(),
    authority = owner();
  const selected = await selection(f, authority);
  assert.throws(() => f.service.admitCover({ ...selected, key: 'unseen' }, authority), /expired/);
});
test('replaced numeric identity, account ABA and cancellation during rasterization never persist', async () => {
  for (const event of ['book', 'account', 'cancel']) {
    const wait = deferred();
    raster({ decode: wait.promise });
    const f = library(),
      authority = owner();
    const selected = await selection(f, authority);
    const pending = f.service.replaceCover(selected, file(), authority);
    const rejected = assert.rejects(pending);
    await tick();
    if (event === 'book') f.book.contentHash = 'cd'.repeat(32);
    if (event === 'account') authority.change();
    if (event === 'cancel') authority.abort();
    wait.resolve();
    await rejected;
    assert.equal(f.writes.length, 0);
  }
});
test('cover commits retain duplicate and unknown outcome receipts instead of replaying saves', async () => {
  raster();
  const f = library(),
    authority = owner(),
    selected = await selection(f, authority);
  const transfer = new ImportTransfer();
  const scope = { session: 'session_123', epoch: 0 };
  const host = new BridgeAuthority(
    () => scope,
    async (request) => {
      const payload = request.payload;
      if (request.method === 'import.begin')
        return transfer.beginCover(
          scope,
          payload.transferId,
          payload.name,
          payload.size,
          payload.cover
        );
      if (request.method === 'import.chunk')
        return transfer.chunk(
          scope,
          payload.transferId,
          payload.sequence,
          new Uint8Array(Buffer.from(payload.data, 'base64'))
        );
      const uploaded = transfer.commit(scope, payload.transferId);
      await f.service.replaceCover(
        uploaded.cover,
        new File(uploaded.chunks, uploaded.name, { type: uploaded.cover.type }),
        authority
      );
      throw new Error('Saved but acknowledgement was lost');
    },
    new AbortController().signal,
    transfer
  );
  const request = (method, id, payload) => ({ version: 1, ...scope, method, id, payload });
  const id = 'cover_receipt_123';
  await host.request(
    request('import.begin', 'begin_receipt_123', {
      transferId: id,
      name: 'cover.png',
      size: png.length,
      cover: selected
    })
  );
  const chunk = request('import.chunk', importChunkRequestId(id, 0), {
    transferId: id,
    sequence: 0,
    data: Buffer.from(png).toString('base64')
  });
  assert.equal((await host.request(chunk)).ok, true);
  assert.equal((await host.request(chunk)).ok, true);
  const commit = request('import.commit', 'commit_receipt_123', { transferId: id });
  assert.equal((await host.request(commit)).outcome, 'unknown');
  assert.equal((await host.request(commit)).outcome, 'unknown');
  assert.equal(f.writes.length, 1);
});
test('native wiring keeps picker native, targets cancellation and revalidates final reader records', () => {
  const root = 'apps/web/src/';
  const native = readFileSync(root + 'platform/RuntimeProvider.native.tsx', 'utf8');
  const dom = readFileSync(root + 'platform/reader-runtime.dom.tsx', 'utf8');
  const repository = readFileSync(root + 'native-library/dom-service.ts', 'utf8');
  const ui = readFileSync(root + 'native-library/index.tsx', 'utf8');
  assert.match(native, /selectNativeLibraryCover/);
  assert.match(native, /multiple: false/);
  assert.match(dom, /state\.transfer\.retire\(scope\(\), payload\.transferId\)/);
  assert.match(dom, /state\.coverSave\?\.id === payload\.transferId/);
  assert.match(dom, /await library\.replaceCover/);
  assert.match(repository, /await readAdmittedBook\(\s*db/);
  assert.match(ui, /Choose cover image/);
  assert.match(ui, /coverOperation\.current\?\.abort\(\)/);
  assert.doesNotMatch(dom, /DocumentPicker|expo-file-system/);
});
