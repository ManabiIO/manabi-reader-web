/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  canonical,
  createSnippet,
  editSnippet,
  encodeSnippet,
  parseSnippet,
  plainContent
} from '../../apps/web/src/lib/snippets/document.ts';

const fixtureKey = 'manabi-snippet-backup-lineage';
const memory = {
  records: new Map(),
  collectionImports: []
};
globalThis[Symbol.for(fixtureKey)] = memory;

const result = await build({
  stdin: {
    contents: `export { exportSnippets, restoreBackup } from './src/lib/snippets/portability.ts';`,
    resolveDir: fileURLToPath(new URL('../../apps/web/', import.meta.url))
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  write: false,
  plugins: [
    {
      name: 'snippet-backup-lineage-fixture',
      setup(builder) {
        builder.onResolve({ filter: /^\.\.\/library\/organization$/ }, () => ({
          path: 'organization',
          namespace: 'fixture'
        }));
        builder.onResolve({ filter: /^\.\/database$/ }, () => ({
          path: 'database',
          namespace: 'fixture'
        }));
        builder.onResolve({ filter: /^\.\/scope$/ }, () => ({
          path: 'scope',
          namespace: 'fixture'
        }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => {
          if (path === 'organization')
            return {
              loader: 'js',
              contents: `
                const memory = globalThis[Symbol.for('manabi-snippet-backup-lineage')];
                export const organization = {
                  subscribe(fn) {
                    fn({ collections: [] });
                    return () => {};
                  }
                };
                export async function importSnippetCollections(collections, guard) {
                  guard();
                  memory.collectionImports.push(structuredClone(collections));
                }`
            };
          if (path === 'database')
            return {
              loader: 'js',
              contents: `
                const memory = globalThis[Symbol.for('manabi-snippet-backup-lineage')];
                export async function getRecord(owner, id) {
                  return structuredClone(memory.records.get(JSON.stringify([owner, id])));
                }
                export async function mutateRecord(owner, id, guard, change) {
                  guard();
                  const key = JSON.stringify([owner, id]);
                  const current = memory.records.get(key);
                  const next = change(current ? structuredClone(current) : undefined);
                  if (next) memory.records.set(key, structuredClone(next));
                  return next;
                }`
            };
          return {
            loader: 'js',
            contents: `
              export const scope = () => ({ owner: 'unused', guard() {} });`
          };
        });
      }
    }
  ]
});
const { exportSnippets, restoreBackup } = await import(
  'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
);

const selected = { owner: 'account:alice', guard() {} };
const source = {
  id: 'local-fixture',
  owner: null,
  provider: 'local',
  root: '',
  name: 'Local'
};
const location = (document) => ({
  source,
  parent: '',
  name: document.id + '.manabi-snippet.json',
  fileId: document.id + '.manabi-snippet.json',
  token: 'token-' + document.revision
});
const key = (id) => JSON.stringify([selected.owner, id]);
const record = (document, extra = {}) => ({
  key: key(document.id),
  owner: selected.owner,
  document,
  destination: location(document),
  locations: [location(document)],
  primary: JSON.stringify([null, source.id, source.root, location(document).fileId]),
  remoteRevision: document.revision,
  dirty: false,
  conflicts: [],
  ...extra
});
const backup = (...items) =>
  canonical({
    format: 'manabi-snippets-export',
    version: 1,
    items,
    collections: []
  });

function reset() {
  memory.records.clear();
  memory.collectionImports = [];
}

test('newer restored descendant advances the logical document and becomes pending for its existing home', async () => {
  reset();
  const base = createSnippet(plainContent('before'));
  const newer = editSnippet(base, plainContent('after'), '');
  memory.records.set(key(base.id), record(base));

  await restoreBackup(backup(newer), selected);

  const current = memory.records.get(key(base.id));
  assert.equal(current.document.revision, newer.revision);
  assert.equal(canonical(current.document), canonical(newer));
  assert.equal(current.dirty, true);
  assert.equal(current.upload, undefined);
  assert.equal(current.remoteRevision, base.revision);
  assert.equal(current.conflicts.length, 0);
  assert.equal(memory.collectionImports.length, 1);
});

test('restoring a known ancestor is a no-op rather than a false conflict', async () => {
  reset();
  const base = createSnippet(plainContent('before'));
  const newer = editSnippet(base, plainContent('after'), '');
  memory.records.set(
    key(base.id),
    record(newer, { remoteRevision: base.revision, dirty: true })
  );
  const before = structuredClone(memory.records.get(key(base.id)));

  await restoreBackup(backup(base), selected);

  assert.deepEqual(memory.records.get(key(base.id)), before);
});

test('restoring a sibling revision keeps both branches as an explicit conflict', async () => {
  reset();
  const base = createSnippet(plainContent('base'));
  const local = editSnippet(base, plainContent('local'), '');
  const remote = editSnippet(base, plainContent('remote'), '');
  memory.records.set(key(base.id), record(local, { remoteRevision: base.revision, dirty: true }));

  await restoreBackup(backup(remote), selected);

  const current = memory.records.get(key(base.id));
  assert.equal(current.document.revision, local.revision);
  assert.equal(current.conflicts.length, 1);
  assert.equal(current.conflicts[0].revision, remote.revision);
  assert.equal(current.dirty, true);
});

test('restoring a descendant of an existing conflict replaces that branch ancestor', async () => {
  reset();
  const base = createSnippet(plainContent('base'));
  const local = editSnippet(base, plainContent('local'), '');
  const remote = editSnippet(base, plainContent('remote'), '');
  const remote2 = editSnippet(remote, plainContent('remote newer'), '');
  memory.records.set(
    key(base.id),
    record(local, {
      remoteRevision: base.revision,
      dirty: true,
      conflicts: [remote],
      issue: 'Conflicting versions found. Both have been kept.'
    })
  );

  await restoreBackup(backup(remote2), selected);

  const current = memory.records.get(key(base.id));
  assert.equal(current.document.revision, local.revision);
  assert.deepEqual(current.conflicts.map((value) => value.revision), [remote2.revision]);
});

test('a restored merge revision can advance current and retire conflict ancestors', async () => {
  reset();
  const base = createSnippet(plainContent('base'));
  const local = editSnippet(base, plainContent('local'), '');
  const remote = editSnippet(base, plainContent('remote'), '');
  const merged = parseSnippet(
    encodeSnippet({
      ...local,
      revision: globalThis.crypto.randomUUID(),
      parents: [local.revision, remote.revision, ...local.parents].slice(0, 16),
      modifiedAt: Math.max(local.modifiedAt, remote.modifiedAt) + 1,
      content: plainContent('merged')
    })
  );
  memory.records.set(
    key(base.id),
    record(local, {
      remoteRevision: base.revision,
      dirty: true,
      conflicts: [remote],
      issue: 'Conflicting versions found. Both have been kept.'
    })
  );

  await restoreBackup(backup(merged), selected);

  const current = memory.records.get(key(base.id));
  assert.equal(current.document.revision, merged.revision);
  assert.equal(current.conflicts.length, 0);
  assert.equal(current.issue, undefined);
  assert.equal(current.dirty, true);
});

test('a pending provider upload owns non-identical restore changes until it settles', async () => {
  reset();
  const base = createSnippet(plainContent('base'));
  const newer = editSnippet(base, plainContent('newer'), '');
  const current = record(base, {
    dirty: true,
    upload: {
      document: structuredClone(base),
      destination: location(base),
      expected: location(base)
    }
  });
  memory.records.set(key(base.id), current);

  await restoreBackup(backup(base), selected);
  assert.deepEqual(memory.records.get(key(base.id)), current);

  await assert.rejects(
    () => restoreBackup(backup(newer), selected),
    /Finish the pending snippet operation/
  );
  assert.deepEqual(memory.records.get(key(base.id)), current);
});


test('JSON backup refuses to silently drop unresolved conflict branches', async () => {
  reset();
  const base = createSnippet(plainContent('base'));
  const local = editSnippet(base, plainContent('local'), '');
  const remote = editSnippet(base, plainContent('remote'), '');
  memory.records.set(
    key(base.id),
    record(local, {
      remoteRevision: base.revision,
      dirty: true,
      conflicts: [remote],
      issue: 'Conflicting versions found. Both have been kept.'
    })
  );

  await assert.rejects(
    () => exportSnippets([base.id], selected),
    /Resolve this snippet’s conflicting versions/
  );
  const current = memory.records.get(key(base.id));
  assert.equal(current.conflicts.length, 1);
  assert.equal(current.conflicts[0].revision, remote.revision);
});
