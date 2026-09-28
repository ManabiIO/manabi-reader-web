import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import * as fileOperations from '../../apps/web/src/lib/library/file-operations.ts';
import * as transactions from '../../apps/web/src/lib/data/database/books-db/commit-transaction.mjs';
import { filesystem, deferred, integrationDatabase } from './helpers/local-file-fixture.mjs';

// Complete production modules with controlled platform imports. The production
// plan, file I/O sequence, scope and transaction-completion helper all execute.
function moduleFrom(path, dependencies) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const exports = {};
  compileFunction(output, ['require', 'exports'], { filename: path })((name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected production import: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

async function fixture() {
  const fs = filesystem();
  await fs.put('One/1.epub', 'one');
  await fs.put('Two/2.epub', 'two');
  await fs.put('Spare/3.epub', 'three');
  await fs.put('Series/.manabi-reader.yaml', 'name: Before\n');
  const library = { id: 'local-fixture', name: 'Fixture', handle: fs.root, writable: true };
  const db = integrationDatabase(library);
  let profile = 'alice',
    gate;
  const subscribers = new Set(),
    calls = [];
  const client = {
    localProfileUser: () => (profile === null ? null : { id: profile }),
    accountScope: () => ({ userId: profile, generation: 1 }),
    localUser: {
      subscribe(fn) {
        subscribers.add(fn);
        fn(client.localProfileUser());
        return () => subscribers.delete(fn);
      }
    },
    IntegrationError: class extends Error {}
  };
  const scope = moduleFrom('../../apps/web/src/lib/manabi/operation-scope.ts', {
    './client': client
  });
  const actions = moduleFrom('../../apps/web/src/lib/library/local-series.ts', {
    '$lib/manabi/persistence': {
      integrationDB: async () => db,
      exclusive: async (name, work) => {
        calls.push(name);
        if (name === 'import-library-book' && gate) await gate.promise;
        return work();
      }
    },
    '$lib/manabi/books': { refreshLinkedBooks: async () => calls.push('refresh') },
    '$lib/manabi/operation-scope': scope,
    '$lib/data/database/books-db/commit-transaction.mjs': transactions,
    './organization': {
      sourceBookKey: (source, fileId) =>
        JSON.stringify([source.owner, source.id, source.root, fileId]),
      relocatePresentation: async (...args) => calls.push(['presentation', ...args])
    },
    './file-operations': fileOperations
  });
  fs.events.length = 0;
  return {
    ...fs,
    library,
    db,
    actions,
    calls,
    subscribers,
    block() {
      gate = deferred();
      return gate;
    },
    profile(value) {
      profile = value;
      for (const fn of subscribers) fn(client.localProfileUser());
    }
  };
}
const paths = ['One/1.epub', 'Two/2.epub'];

test('a queued move refuses a folder disconnected before admission without touching files', async () => {
  const f = await fixture(),
    gate = f.block();
  const result = f.actions.createLocalSeries(f.library, '', 'New Series', paths);
  f.db.tables.get('localLibraries').delete(f.library.id);
  gate.resolve();
  await assert.rejects(result, /disconnected|replaced/);
  assert.deepEqual(f.events, []);
  assert.equal(f.db.tables.get('metadata').size, 0);
  assert.equal(f.subscribers.size, 0);
});

test('a queued move observes revoked durable write consent instead of the stale UI copy', async () => {
  const f = await fixture(),
    gate = f.block();
  const result = f.actions.createLocalSeries(f.library, '', 'New Series', paths);
  f.db.tables.get('localLibraries').get(f.library.id).writable = false;
  gate.resolve();
  await assert.rejects(result, /Allow changes/);
  assert.deepEqual(f.events, []);
});

test('a queued rename cannot silently follow a replacement root under the same source ID', async () => {
  const f = await fixture(),
    gate = f.block();
  const result = f.actions.renameLocalSeries(f.library, 'Series', 'After');
  f.db.tables.get('localLibraries').get(f.library.id).handle = filesystem().root;
  gate.resolve();
  await assert.rejects(result, /disconnected|replaced/);
  assert.equal(await f.read('Series/.manabi-reader.yaml'), 'name: Before\n');
});

test('a local profile round trip cannot restore a queued move authority', async () => {
  const f = await fixture(),
    gate = f.block();
  const result = f.actions.createLocalSeries(f.library, '', 'New Series', paths);
  f.profile('bob');
  f.profile('alice');
  gate.resolve();
  await assert.rejects(result, /account_changed/);
  assert.deepEqual(f.events, []);
  assert.equal(f.subscribers.size, 0);
});

test('queued file selection and root objects are owned snapshots, not live UI inputs', async () => {
  const f = await fixture(),
    gate = f.block();
  const selected = [...paths];
  const result = f.actions.createLocalSeries(f.library, '', 'New Series', selected);
  selected[0] = 'Spare/3.epub';
  f.library.id = 'mutated-ui-source';
  f.library.handle = filesystem().root;
  gate.resolve();
  await result;
  assert.equal(await f.read('Spare/3.epub'), 'three');
  assert.equal(await f.read('New Series/1.epub'), 'one');
  assert.equal(await f.read('New Series/2.epub'), 'two');
  assert.ok(f.calls.includes('library-files:local-fixture'));
  assert.ok(!f.calls.includes('library-files:mutated-ui-source'));
});

test('rename cannot invalidate an unfinished move, which still resumes normally', async () => {
  const f = await fixture();
  const plan = await fileOperations.planMove(f.root, f.library.id, '', 'New Series', paths);
  const key = 'library-file-operation:' + f.library.id;
  await f.db.put('metadata', plan, key);
  const before = await f.db.get('metadata', key);
  await assert.rejects(
    f.actions.renameLocalSeries(f.library, 'Series', 'After'),
    /Resume the unfinished/
  );
  assert.equal(await f.read('Series/.manabi-reader.yaml'), 'name: Before\n');
  assert.deepEqual(await f.db.get('metadata', key), before);
  await f.actions.resumeLocalSeries(f.library);
  assert.equal(await f.read('New Series/1.epub'), 'one');
  assert.equal(await f.db.get('metadata', key), undefined);
});

test('disconnect during copying stops later publication and keeps recovery plus original files', async () => {
  const f = await fixture();
  f.hooks.write = async (handle) => {
    if (handle.path.endsWith('/1.epub')) f.db.tables.get('localLibraries').delete(f.library.id);
  };
  await assert.rejects(
    f.actions.createLocalSeries(f.library, '', 'New Series', paths),
    /disconnected|replaced/
  );
  assert.equal(await f.read('One/1.epub'), 'one');
  assert.equal(await f.read('Two/2.epub'), 'two');
  assert.ok(await f.db.get('metadata', 'library-file-operation:' + f.library.id));
  assert.ok(!f.events.some(([op]) => op === 'delete'));
});

test('normal local moves preserve every matching link ID, history ID and sync setting', async () => {
  const f = await fixture();
  const plan = await fileOperations.planMove(f.root, f.library.id, '', 'New Series', paths);
  const links = plan.files.map((file, index) => ({
    id: `link-${index}`,
    bookId: index + 1,
    owner: null,
    sourceId: f.library.id,
    root: '',
    fileId: file.from,
    contentHash: file.hash,
    name: file.from,
    syncEnabled: true,
    base: { progress: 0.7 }
  }));
  for (const link of links) f.db.tables.get('books').set(link.id, link);
  await f.actions.createLocalSeries(f.library, '', 'New Series', paths);
  for (const [index, link] of links.entries()) {
    assert.deepEqual(await f.db.get('books', link.id), {
      ...link,
      fileId: plan.files[index].to,
      name: `${index + 1}.epub`
    });
  }
  assert.equal(f.subscribers.size, 0);
});

test('pending journal source mismatch is rejected without deleting recovery data', async () => {
  const f = await fixture();
  const plan = await fileOperations.planMove(f.root, 'different-source', '', 'New Series', paths);
  await f.db.put('metadata', plan, 'library-file-operation:' + f.library.id);
  await assert.rejects(f.actions.pendingMoves(), /Invalid move recovery source/);
  assert.ok(await f.db.get('metadata', 'library-file-operation:' + f.library.id));
  assert.deepEqual(f.events, []);
});

test('anonymous offline local changes do not require a signed-in account', async () => {
  const f = await fixture();
  f.profile(null);
  await f.actions.renameLocalSeries(f.library, 'Series', 'After');
  assert.equal(await f.read('Series/.manabi-reader.yaml'), 'name: "After"\n');
  assert.equal(f.subscribers.size, 0);
});
