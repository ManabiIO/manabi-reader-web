/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { filesystem, integrationDatabase } from './helpers/local-file-fixture.mjs';
import {
  canonical,
  createSnippet,
  encodeSnippet,
  filename,
  parseSnippet,
  plainContent
} from '../../apps/web/src/lib/snippets/document.ts';

const fixtureKey = 'manabi-snippet-local-storage-recovery';
let fixture;
globalThis[Symbol.for(fixtureKey)] = {
  currentUser: () => null,
  classIntegrationError: class IntegrationError extends Error {
    constructor(code, status = 0) {
      super(code);
      this.name = 'IntegrationError';
      this.code = code;
      this.status = status;
    }
  },
  integrationDB: async () => fixture.db,
  exclusive: async (_key, work) => work(),
  openDirectory: async (root, path) => {
    let current = root;
    for (const part of path ? path.split('/') : [])
      current = await current.getDirectoryHandle(part);
    return current;
  },
  safePath: (path) => {
    if (!path) return [];
    const parts = path.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\')))
      throw new Error('Invalid path.');
    return parts;
  },
  sha256: async (value) => {
    const bytes =
      typeof value === 'string'
        ? new TextEncoder().encode(value)
        : value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return createHash('sha256').update(bytes).digest('hex');
  },
  withLocalLibraryConnection: async (admitted, write, work) => {
    await fixture.beforeConnect?.();
    const current = await fixture.db.get('localLibraries', admitted.id);
    if (
      !current ||
      !(current.handle === admitted.handle || (await current.handle.isSameEntry(admitted.handle)))
    )
      throw new globalThis[Symbol.for(fixtureKey)].classIntegrationError('not_found');
    if (
      (write && !current.writable) ||
      (await current.handle.queryPermission({ mode: write ? 'readwrite' : 'read' })) !== 'granted'
    )
      throw new globalThis[Symbol.for(fixtureKey)].classIntegrationError('permission_required');
    fixture.authorityCalls.push({ id: admitted.id, write });
    return work(current);
  }
};

const mock = {
  '../manabi/client': {
    currentUser: 'currentUser',
    IntegrationError: 'classIntegrationError',
    request: 'unused'
  },
  '../manabi/persistence': { integrationDB: 'integrationDB', exclusive: 'exclusive' },
  '../library/file-operations': { openDirectory: 'openDirectory', safePath: 'safePath' },
  '../manabi/sources': {
    sha256: 'sha256',
    withLocalLibraryConnection: 'withLocalLibraryConnection'
  },
  '../library/catalog': { librarySource: 'unused' },
  '../webdav/source': { davSource: 'unused', withDavSourceLock: 'unused' },
  '../webdav/client': {
    davChild: 'unused',
    davRoot: 'unused',
    strongEtag: 'unused',
    decodeDavText: 'unused'
  }
};

const bundled = await build({
  entryPoints: [
    fileURLToPath(new URL('../../apps/web/src/lib/snippets/storage.ts', import.meta.url))
  ],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  plugins: [
    {
      name: 'local-storage-fixture',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) =>
          Object.hasOwn(mock, args.path) ? { path: args.path, namespace: 'fixture' } : undefined
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => {
          const exports = mock[args.path];
          const lines = Object.entries(exports).map(([name, source]) =>
            source === 'unused'
              ? `export const ${name} = (..._args) => { throw new Error('Unexpected fixture call: ${name}'); };`
              : source === 'classIntegrationError'
                ? `export const ${name} = fixture.classIntegrationError;`
                : `export const ${name} = fixture.${source};`
          );
          return {
            contents:
              `const fixture = globalThis[Symbol.for(${JSON.stringify(fixtureKey)})];\n` +
              lines.join('\n'),
            loader: 'js'
          };
        });
      }
    }
  ]
});
const { capability, makeFolder, readDocument, removeDocument, writeDocument } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

function source(id = globalThis.crypto.randomUUID()) {
  return { id, owner: null, provider: 'local', root: '', name: 'Local snippets' };
}
async function setup() {
  const fs = filesystem(),
    src = source();
  fixture = {
    fs,
    db: integrationDatabase({ id: src.id, name: src.name, handle: fs.root, writable: true }),
    authorityCalls: [],
    beforeConnect: undefined
  };
  return { fs, src };
}
const guard = () => undefined;

test('retry recovers the deterministic zero-byte placeholder left by an aborted first create', async () => {
  const { fs, src } = await setup(),
    doc = createSnippet(plainContent('クラッシュ後も復旧する')),
    name = filename(doc),
    destination = { source: src, parent: '', name };

  let fail = true;
  fs.hooks.write = async () => {
    if (fail) {
      fail = false;
      throw new Error('injected first-write crash');
    }
  };
  await assert.rejects(
    () => writeDocument(destination, doc, undefined, guard),
    /injected first-write crash/
  );
  assert.equal(
    (await fs.handle(name)).bytes.length,
    0,
    'aborted create leaves the native placeholder'
  );

  fs.hooks.write = undefined;
  const location = await writeDocument(destination, doc, undefined, guard);
  assert.equal(location.name, name);
  assert.equal(canonical(parseSnippet(await fs.read(name))), canonical(doc));
});

test('an unrelated zero-byte filename is not reclaimed as this snippet', async () => {
  const { fs, src } = await setup(),
    doc = createSnippet(plainContent('keep collision safe')),
    other = `Unrelated — ${globalThis.crypto.randomUUID()}.manabi-snippet.json`;
  await fs.handle(other, true);
  await assert.rejects(
    () => writeDocument({ source: src, parent: '', name: other }, doc, undefined, guard),
    /invalid|unsupported|format/i
  );
  assert.equal((await fs.handle(other)).bytes.length, 0);
});

test('a non-empty malformed deterministic file is never overwritten during recovery', async () => {
  const { fs, src } = await setup(),
    doc = createSnippet(plainContent('do not clobber external bytes')),
    name = filename(doc);
  await fs.put(name, 'not a snippet document');
  await assert.rejects(
    () => writeDocument({ source: src, parent: '', name }, doc, undefined, guard),
    /invalid|unsupported|format/i
  );
  assert.equal(await fs.read(name), 'not a snippet document');
});

test('successful retry writes the exact portable document bytes', async () => {
  const { fs, src } = await setup(),
    doc = createSnippet(plainContent('exact bytes')),
    name = filename(doc);
  await fs.handle(name, true);
  await writeDocument({ source: src, parent: '', name }, doc, undefined, guard);
  assert.equal(await fs.read(name), encodeSnippet(doc));
});

test('local snippet writes reject a replaced source before touching the stale handle', async () => {
  const { fs, src } = await setup(),
    doc = createSnippet(plainContent('replacement must not retarget writes')),
    replacement = filesystem();
  fixture.beforeConnect = async () => {
    const current = fixture.db.tables.get('localLibraries').get(src.id);
    current.handle = replacement.root;
    fixture.beforeConnect = undefined;
  };
  await assert.rejects(
    () => writeDocument({ source: src, parent: '' }, doc, undefined, guard),
    (error) => error?.code === 'not_found'
  );
  assert.deepEqual(fs.events, []);
  assert.deepEqual(replacement.events, []);
  assert.deepEqual(fixture.authorityCalls, []);
});

test('local snippet writes reject disconnect before physical admission', async () => {
  const { fs, src } = await setup(),
    doc = createSnippet(plainContent('disconnect must fence writes'));
  fixture.beforeConnect = async () => {
    fixture.db.tables.get('localLibraries').delete(src.id);
    fixture.beforeConnect = undefined;
  };
  await assert.rejects(
    () => writeDocument({ source: src, parent: '' }, doc, undefined, guard),
    (error) => error?.code === 'not_found'
  );
  assert.deepEqual(fs.events, []);
  assert.deepEqual(fixture.authorityCalls, []);
});

test('local snippet writes require durable write consent from the current source row', async () => {
  const { fs, src } = await setup(),
    doc = createSnippet(plainContent('consent must be current'));
  fixture.beforeConnect = async () => {
    fixture.db.tables.get('localLibraries').get(src.id).writable = false;
    fixture.beforeConnect = undefined;
  };
  await assert.rejects(
    () => writeDocument({ source: src, parent: '' }, doc, undefined, guard),
    (error) => error?.code === 'permission_required'
  );
  assert.deepEqual(fs.events, []);
  assert.deepEqual(fixture.authorityCalls, []);
});

test('normal local snippet create enters shared source authority as a write operation', async () => {
  const { src } = await setup(),
    doc = createSnippet(plainContent('shared source authority'));
  await writeDocument({ source: src, parent: '' }, doc, undefined, guard);
  assert.deepEqual(fixture.authorityCalls, [{ id: src.id, write: true }]);
});

test('local read, capability, folder creation and remove all enter shared source authority', async () => {
  const { fs, src } = await setup(),
    doc = createSnippet(plainContent('all local operations are fenced')),
    location = await writeDocument({ source: src, parent: '' }, doc, undefined, guard);
  fixture.authorityCalls.length = 0;

  const loaded = await readDocument(src, location.fileId, guard);
  assert.equal(canonical(loaded.document), canonical(doc));
  assert.deepEqual(fixture.authorityCalls, [{ id: src.id, write: false }]);

  fixture.authorityCalls.length = 0;
  assert.deepEqual(await capability(src, guard), { write: true });
  assert.deepEqual(fixture.authorityCalls, [{ id: src.id, write: false }]);

  fixture.authorityCalls.length = 0;
  assert.equal(await makeFolder({ source: src, parent: '' }, 'Child', guard), 'Child');
  assert.deepEqual(fixture.authorityCalls, [{ id: src.id, write: true }]);

  fixture.authorityCalls.length = 0;
  await removeDocument(location, doc, guard);
  assert.deepEqual(fixture.authorityCalls, [{ id: src.id, write: true }]);
  await assert.rejects(fs.read(location.fileId), { name: 'NotFoundError' });
});

test('write permission revoked before commit aborts without publishing new bytes', async () => {
  const { fs, src } = await setup(),
    original = createSnippet(plainContent('original')),
    first = await writeDocument({ source: src, parent: '' }, original, undefined, guard),
    edited = {
      ...original,
      revision: globalThis.crypto.randomUUID(),
      parents: [original.revision],
      modifiedAt: original.modifiedAt + 1,
      content: plainContent('new bytes must not commit')
    };
  fs.hooks.write = async () => {
    fs.root.queryPermission = async () => 'denied';
  };
  await assert.rejects(
    () =>
      writeDocument({ source: src, parent: first.parent, name: first.name }, edited, first, guard),
    (error) => error?.code === 'permission_required'
  );
  fs.hooks.write = undefined;
  fs.root.queryPermission = async () => 'granted';
  assert.equal(canonical(parseSnippet(await fs.read(first.fileId))), canonical(original));
});

test('remove permission revoked before physical deletion preserves the document', async () => {
  const { fs, src } = await setup(),
    doc = createSnippet(plainContent('keep when permission disappears')),
    location = await writeDocument({ source: src, parent: '' }, doc, undefined, guard);
  let calls = 0;
  fs.root.queryPermission = async ({ mode } = {}) => {
    calls++;
    // Shared authority admission succeeds; the explicit pre-delete check fails.
    return mode === 'readwrite' && calls > 1 ? 'denied' : 'granted';
  };
  await assert.rejects(
    () => removeDocument(location, doc, guard),
    (error) => error?.code === 'permission_required'
  );
  fs.root.queryPermission = async () => 'granted';
  assert.equal(canonical(parseSnippet(await fs.read(location.fileId))), canonical(doc));
});
