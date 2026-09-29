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
  '../manabi/sources': { sha256: 'sha256' },
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
const { writeDocument } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

function source(id = crypto.randomUUID()) {
  return { id, owner: null, provider: 'local', root: '', name: 'Local snippets' };
}
async function setup() {
  const fs = filesystem(),
    src = source();
  fixture = {
    fs,
    db: integrationDatabase({ id: src.id, name: src.name, handle: fs.root, writable: true })
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
  assert.equal((await fs.handle(name)).bytes.length, 0, 'aborted create leaves the native placeholder');

  fs.hooks.write = undefined;
  const location = await writeDocument(destination, doc, undefined, guard);
  assert.equal(location.name, name);
  assert.equal(canonical(parseSnippet(await fs.read(name))), canonical(doc));
});

test('an unrelated zero-byte filename is not reclaimed as this snippet', async () => {
  const { fs, src } = await setup(),
    doc = createSnippet(plainContent('keep collision safe')),
    other = `Unrelated — ${crypto.randomUUID()}.manabi-snippet.json`;
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
