/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { compileFunction } from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
// Production manifest validation, bounded ZIP decoder, identity and projection.
// Only the account/HTTP boundary is substituted for deterministic race injection.
const compiled = await build({
  entryPoints: [root + 'apps/web/src/lib/manabi/reader-bridge-source.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  alias: { $lib: root + 'apps/web/src/lib' },
  plugins: [
    {
      name: 'reader-bridge-io',
      setup(builder) {
        builder.onResolve({ filter: /^\.\/(client|operation-scope)$/ }, (args) => ({
          path: args.path,
          namespace: 'bridge-io'
        }));
        builder.onLoad({ filter: /.*/, namespace: 'bridge-io' }, () => ({
          contents:
            'export const {request,IntegrationError,captureLibraryOperation}=bridgeHarness;',
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
const archive = new ZipReader(
  new Uint8ArrayReader(
    new Uint8Array(
      await readFile(new URL('../fixtures/yatsu/complete-local-backup-v11.zip', import.meta.url))
    )
  ),
  { useWebWorkers: false }
);
const contents = {},
  files = [];
let folderName;
try {
  for (const entry of await archive.getEntries()) {
    const match = entry.filename.match(/(?:^|\/)(bookdata|progress|statistics)_[^/]+$/);
    if (!match) continue;
    const role = { bookdata: 'book', progress: 'resume', statistics: 'statistics' }[match[1]];
    const name = entry.filename.split('/').at(-1);
    folderName = entry.filename.split('/').at(-2);
    const bytes = await entry.getData(new Uint8ArrayWriter());
    contents[role] = bytes;
    files.push({
      id: role,
      name,
      role,
      version: '1',
      parents: ['folder'],
      mime: 'application/octet-stream',
      size: bytes.byteLength,
      md5: createHash('md5').update(bytes).digest('hex')
    });
  }
} finally {
  await archive.close();
}
assert.equal(files.length, 3);
const selection = {
  owner: 'alice',
  connection: '00000000-0000-0000-0000-000000000001',
  root: 'root',
  folder: 'folder',
  profile: 'yatsu-1-11'
};
const manifest = () => ({
  profile: selection.profile,
  generation: '00000000-0000-0000-0000-000000000002',
  revision: 'a'.repeat(64),
  folder: {
    id: 'folder',
    name: folderName,
    mime: 'application/vnd.google-apps.folder',
    parents: ['root'],
    version: '1'
  },
  files: structuredClone(files),
  ignoredFiles: 0
});
function fixture(change = () => {}) {
  let current = true,
    stopped = 0,
    reads = 0;
  const calls = [];
  class IntegrationError extends Error {
    constructor(code) {
      super(code);
      this.code = code;
    }
  }
  const controller = new AbortController();
  const harness = {
    IntegrationError,
    captureLibraryOperation(owner) {
      assert.equal(owner, 'alice');
      return {
        signal: controller.signal,
        assertCurrent() {
          if (!current) throw new IntegrationError('account_changed');
        },
        stop() {
          stopped++;
        }
      };
    },
    async request(path, options) {
      calls.push({ path, options });
      const url = new URL(path, 'https://example.test/');
      assert.equal(options.userId, 'alice');
      assert.equal(url.searchParams.get('root'), 'root');
      assert.equal(url.searchParams.get('folder'), 'folder');
      if (url.pathname.endsWith('/reader-bridge/')) {
        const value = manifest();
        await change({
          kind: 'manifest',
          value,
          index: reads++,
          revoke() {
            current = false;
            controller.abort();
          }
        });
        return value;
      }
      assert.ok(url.pathname.endsWith('/reader-bridge-file/'));
      assert.equal(url.searchParams.get('revision'), 'a'.repeat(64));
      assert.equal(url.searchParams.get('generation'), manifest().generation);
      const file = files.find((item) => item.id === url.searchParams.get('id'));
      assert.ok(file);
      assert.equal(options.binary, true);
      assert.ok(options.maximumBytes >= file.size);
      const value = { bytes: contents[file.id].slice().buffer };
      await change({
        kind: 'file',
        file,
        value,
        revoke() {
          current = false;
          controller.abort();
        }
      });
      return value.bytes;
    }
  };
  const module = { exports: {} };
  compileFunction(compiled.outputFiles[0].text, ['require', 'module', 'exports', 'bridgeHarness'])(
    require,
    module,
    module.exports,
    harness
  );
  return {
    preview: (signal) => module.exports.previewDriveReaderBridge(selection, signal),
    capture: module.exports.captureDriveReaderPreview,
    recheck: module.exports.recheckDriveReaderPreview,
    revoke: () => {
      current = false;
    },
    calls,
    stopped: () => stopped
  };
}

test('real Yatsu package and sidecars become a verified read-only projection', async () => {
  const f = fixture();
  const result = await f.preview();
  assert.equal(result.title, 'Manabi Yatsu Portability Fixture');
  assert.equal(result.characters, 72);
  assert.match(result.projection.snapshot.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(result.projection.values.resume.targetSectionId, 'section-1');
  assert.equal(result.projection.originals.length, 2);
  assert.equal(result.packageId, 'book');
  assert.equal(f.calls.length, 5);
  assert.equal(f.stopped(), 1);
  assert.ok(f.calls.every((call) => !call.options.method && !call.options.value));
});

test('local comparison captures only genuine previews in their original account generation', async () => {
  const f = fixture();
  const preview = await f.preview();
  const prepared = f.capture(preview);
  assert.equal(prepared.content.title, preview.title);
  assert.equal(prepared.selection.owner, selection.owner);
  const content = prepared.content;
  content.elementHtml = 'changed by caller';
  prepared.selection.owner = 'another';
  assert.notEqual(f.capture(preview).content.elementHtml, content.elementHtml);
  assert.equal(f.capture(preview).selection.owner, selection.owner);
  assert.throws(() => f.capture({ ...preview }), /Refresh/);
  f.revoke();
  assert.throws(() => f.capture(preview), { code: 'account_changed' });
  assert.throws(prepared.assertCurrent, { code: 'account_changed' });
});

test('receive rechecks the original full Drive observation before accepting local changes', async () => {
  const f = fixture(({ kind, value, index }) => {
    if (kind === 'manifest' && index > 2) value.files[0].version = '2';
  });
  const preview = await f.preview();
  await f.recheck(preview);
  await assert.rejects(f.recheck(preview), { code: 'conflict' });
  await assert.rejects(f.recheck({ ...preview }), { code: 'conflict' });
});

test('reconnection and any final manifest change discard a fully decoded preview', async () => {
  for (const mutate of [
    (value) => (value.generation = '00000000-0000-0000-0000-000000000003'),
    (value) => (value.revision = 'b'.repeat(64)),
    (value) => (value.files[0].version = '2'),
    (value) => value.ignoredFiles++
  ]) {
    const f = fixture(({ kind, value, index }) => {
      if (kind === 'manifest' && index === 1) mutate(value);
    });
    await assert.rejects(f.preview(), { code: 'conflict' });
    assert.equal(f.stopped(), 1);
  }
});

test('account changes and cancellation after a download never release a projection', async () => {
  const f = fixture(({ kind, revoke }) => {
    if (kind === 'file') revoke();
  });
  await assert.rejects(f.preview(), { code: 'account_changed' });
  assert.equal(f.calls.length, 2);
  assert.equal(f.stopped(), 1);
  const controller = new AbortController();
  const canceled = fixture(({ kind }) => {
    if (kind === 'file') controller.abort();
  });
  await assert.rejects(canceled.preview(controller.signal), { name: 'AbortError' });
  assert.equal(canceled.stopped(), 1);
});

test('untrusted manifest identities, duplicate roles and oversized files stop before download', async () => {
  for (const mutate of [
    (value) => (value.folder.id = 'elsewhere'),
    (value) => (value.folder.parents = ['other']),
    (value) => value.files.push(value.files[0]),
    (value) => (value.files[0].size = 2 ** 40),
    (value) => (value.files[0].parents = ['other']),
    (value) => (value.files[0].name = '../progress_1_11_1_0.json'),
    (value) => (value.profile = 'ttu-1-6'),
    (value) => (value.generation = 'invalid')
  ]) {
    const f = fixture(({ kind, value }) => {
      if (kind === 'manifest') mutate(value);
    });
    await assert.rejects(f.preview());
    assert.equal(f.calls.length, 1);
    assert.equal(f.stopped(), 1);
  }
});

test('truncated, malformed and different-title book content never produces a preview', async () => {
  const short = fixture(({ kind, value }) => {
    if (kind === 'file') value.bytes = new ArrayBuffer(1);
  });
  await assert.rejects(short.preview(), { code: 'conflict' });
  const corrupted = fixture(({ kind, value }) => {
    if (kind === 'file') value.bytes = new ArrayBuffer(value.bytes.byteLength);
  });
  await assert.rejects(corrupted.preview());
  const title = fixture(({ kind, value }) => {
    if (kind === 'manifest') value.folder.name = 'Different';
  });
  await assert.rejects(title.preview(), /folder disagree/);
});
