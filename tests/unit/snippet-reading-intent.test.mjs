/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Exercise the production synchronizer; only storage and its network boundary
// are fixtures. Each database mutation sees a fresh snapshot, as IDB does.
const fixtureKey = 'manabi-snippet-reading-intent-test';
let fixture;
globalThis[Symbol.for(fixtureKey)] = {
  getRecord: async (owner, id) => {
    assert.equal(owner, fixture.record.owner);
    assert.equal(id, fixture.record.document.id);
    return structuredClone(fixture.record);
  },
  mutateRecord: async (owner, id, guard, change) => {
    const beforeMutation = fixture.beforeMutation;
    fixture.beforeMutation = undefined;
    if (beforeMutation) await beforeMutation();
    guard();
    assert.equal(owner, fixture.record.owner);
    assert.equal(id, fixture.record.document.id);
    const next = change(structuredClone(fixture.record));
    if (next) fixture.record = structuredClone(next);
    return structuredClone(next);
  },
  locationKey: (location) =>
    JSON.stringify([
      location.source.owner,
      location.source.id,
      location.source.root,
      location.fileId
    ]),
  librarySource: async () => ({
    state: async () => {
      const snapshot = structuredClone(fixture.remote);
      await fixture.onRead?.();
      return snapshot;
    },
    write: async (key, value, expected) => {
      fixture.writes.push({ key, value: structuredClone(value), expected });
      await fixture.onWrite?.();
      if (fixture.writeError) throw fixture.writeError;
      assert.equal(expected, fixture.remote.revision);
      fixture.remote = { value: structuredClone(value), revision: 'acknowledged' };
      return structuredClone(fixture.remote);
    }
  }),
  sha256: async (value) => createHash('sha256').update(value).digest('hex')
};
const mockExports = {
  '../library/catalog': ['librarySource'],
  '../manabi/sources': ['sha256'],
  './database': ['getRecord', 'mutateRecord', 'locationKey']
};
const bundled = await build({
  entryPoints: [
    fileURLToPath(new URL('../../apps/web/src/lib/snippets/reading-state.ts', import.meta.url))
  ],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'reading-storage-fixtures',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) =>
          Object.hasOwn(mockExports, args.path)
            ? { path: args.path, namespace: 'fixture' }
            : undefined
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents:
            `const fixture = globalThis[Symbol.for(${JSON.stringify(fixtureKey)})];\n` +
            mockExports[args.path]
              .map((name) => `export const ${name} = fixture.${name};`)
              .join('\n'),
          loader: 'js'
        }));
      }
    }
  ]
});
const { saveProgress, touchReading, syncReading, readingKey } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);
const id = '10000000-0000-4000-8000-000000000001';
const revision = '20000000-0000-4000-8000-000000000002';
const cursor = (blockId) => ({ blockId, revision, quote: blockId, before: '', offset: 0 });
const location = {
  source: { owner: 'alice', id: 'source', root: 'folder', provider: 'google', name: 'Drive' },
  fileId: 'snippet-file',
  parent: 'folder',
  name: 'test.manabi-snippet.json',
  token: 'file-v1'
};
const state = (blockId, readAt) => ({
  format: 'manabi-snippet-reading',
  version: 1,
  id,
  readAt,
  locator: cursor(blockId)
});
function reset(local = {}, remote = state('remote', 200)) {
  fixture = {
    record: {
      owner: 'account:alice',
      key: JSON.stringify(['account:alice', id]),
      document: { id },
      destination: location,
      locations: [location],
      primary: globalThis[Symbol.for(fixtureKey)].locationKey(location),
      dirty: false,
      conflicts: [],
      ...local
    },
    remote: { value: remote, revision: 'remote-v1' },
    writes: [],
    active: true
  };
  return { owner: fixture.record.owner, guard: () => assert.ok(fixture.active, 'account changed') };
}

// Keep these ordered and serial: the fixture is module-scoped and each test owns it.
test('first open does not prevent a remote saved position from being restored', async () => {
  const selected = reset();
  await touchReading(id, selected);
  const openedAt = fixture.record.readAt;
  await syncReading(id, selected);
  assert.deepEqual(fixture.record.progress, cursor('remote'));
  assert.equal(fixture.record.progressAt, 200);
  assert.equal(fixture.record.readAt, openedAt);
  assert.equal(fixture.writes.length, 0);
});

test('opening cached progress cannot publish it over newer progress on another device', async () => {
  const selected = reset({ progress: cursor('cached'), readAt: 100, progressDirty: false });
  await touchReading(id, selected);
  assert.equal(fixture.record.progressDirty, false);
  assert.equal(fixture.record.progressAt, 100);
  const openedAt = fixture.record.readAt;
  await syncReading(id, selected);
  assert.deepEqual(fixture.record.progress, cursor('remote'));
  assert.equal(fixture.record.progressAt, 200);
  assert.equal(fixture.record.readAt, openedAt);
  assert.equal(fixture.writes.length, 0);
});

test('repeated opens freeze the legacy position timestamp, not its latest visit time', async () => {
  const selected = reset({ progress: cursor('cached'), readAt: 100 });
  await touchReading(id, selected);
  await touchReading(id, selected);
  assert.equal(fixture.record.progressAt, 100);
  assert.equal(fixture.record.progressDirty, undefined);
  await syncReading(id, selected);
  assert.deepEqual(fixture.record.progress, cursor('remote'));
});

test('opening an unsynced position preserves its original ordering against remote progress', async () => {
  const selected = reset({ progress: cursor('offline'), readAt: 100, progressDirty: true });
  await touchReading(id, selected);
  await syncReading(id, selected);
  assert.deepEqual(fixture.record.progress, cursor('remote'));
  assert.equal(fixture.record.progressDirty, false);
  assert.equal(fixture.writes.length, 0);
});

test('deliberate scrolling publishes a newer position and the existing wire format', async () => {
  const selected = reset({ progress: cursor('cached'), readAt: 100, progressAt: 100 });
  await saveProgress(id, cursor('scrolled'), selected);
  const changedAt = fixture.record.progressAt;
  assert.ok(changedAt > 200);
  assert.equal(fixture.record.progressDirty, true);
  await syncReading(id, selected);
  assert.equal(fixture.writes.length, 1);
  assert.deepEqual(fixture.writes[0].value, state('scrolled', changedAt));
  assert.equal(fixture.writes[0].expected, 'remote-v1');
  assert.equal(fixture.record.progressDirty, false);
  assert.equal(fixture.record.progressAt, changedAt);
});

test('an open during an upload does not leave unchanged progress dirty forever', async () => {
  const selected = reset({
    progress: cursor('local'),
    readAt: 300,
    progressAt: 300,
    progressDirty: true
  });
  fixture.onWrite = () => touchReading(id, selected);
  await syncReading(id, selected);
  assert.deepEqual(fixture.record.progress, cursor('local'));
  assert.equal(fixture.record.progressAt, 300);
  assert.ok(fixture.record.readAt > 300);
  assert.equal(fixture.record.progressDirty, false);
  assert.equal(fixture.writes[0].value.readAt, 300);
});

test('a scroll during an upload is never acknowledged by the older write', async () => {
  const selected = reset({
    progress: cursor('local'),
    readAt: 300,
    progressAt: 300,
    progressDirty: true
  });
  fixture.onWrite = () => saveProgress(id, cursor('later-scroll'), selected);
  await syncReading(id, selected);
  assert.deepEqual(fixture.remote.value.locator, cursor('local'));
  assert.deepEqual(fixture.record.progress, cursor('later-scroll'));
  assert.equal(fixture.record.progressDirty, true);
  fixture.onWrite = undefined;
  await syncReading(id, selected);
  assert.deepEqual(fixture.remote.value.locator, cursor('later-scroll'));
  assert.equal(fixture.record.progressDirty, false);
});

test('delayed remote adoption cannot replace a scroll made before its local transaction', async () => {
  const selected = reset({ progress: cursor('cached'), readAt: 100, progressAt: 100 });
  fixture.beforeMutation = () => saveProgress(id, cursor('just-scrolled'), selected);
  await syncReading(id, selected);
  assert.deepEqual(fixture.record.progress, cursor('just-scrolled'));
  assert.equal(fixture.record.progressDirty, true);
});

test('a cached newer position is retained without re-uploading it on open', async () => {
  const selected = reset({
    progress: cursor('local'),
    readAt: 300,
    progressAt: 300,
    progressDirty: false
  });
  await touchReading(id, selected);
  await syncReading(id, selected);
  assert.deepEqual(fixture.record.progress, cursor('local'));
  assert.equal(fixture.writes.length, 0);
});

test('a transfer compares actual position times, not the recent-open timestamp', async () => {
  const selected = reset({ progress: cursor('cached'), readAt: 100 });
  await touchReading(id, selected);
  fixture.record.transfer = 'transfer-owned';
  await syncReading(id, selected, { ...location, fileId: 'destination-file' });
  assert.deepEqual(fixture.record.progress, cursor('remote'));
  assert.equal(fixture.record.transfer, 'transfer-owned');
  assert.equal(fixture.writes.length, 0);
});

test('epoch-zero remote progress can be restored when no local position exists', async () => {
  const selected = reset({}, state('remote', 0));
  await touchReading(id, selected);
  await syncReading(id, selected);
  assert.deepEqual(fixture.record.progress, cursor('remote'));
  assert.equal(fixture.record.progressAt, 0);
});

test('failed position writes retain local pending progress', async () => {
  const selected = reset({
    progress: cursor('local'),
    readAt: 300,
    progressAt: 300,
    progressDirty: true
  });
  fixture.writeError = new Error('network unavailable');
  await assert.rejects(syncReading(id, selected), /network unavailable/);
  assert.deepEqual(fixture.record.progress, cursor('local'));
  assert.equal(fixture.record.progressDirty, true);
});

test('a changed storage home rejects the old source response before any write', async () => {
  const selected = reset({
    progress: cursor('local'),
    readAt: 300,
    progressAt: 300,
    progressDirty: true
  });
  fixture.onRead = () => {
    fixture.record.primary = 'new-home';
  };
  await assert.rejects(syncReading(id, selected), /Snippet storage changed/);
  assert.equal(fixture.writes.length, 0);
  assert.equal(fixture.record.progressDirty, true);
});

test('an account change rejects a delayed response', async () => {
  const selected = reset();
  fixture.onRead = () => {
    fixture.active = false;
  };
  await assert.rejects(syncReading(id, selected), /account changed/);
  assert.equal(fixture.record.progress, undefined);
  assert.equal(fixture.writes.length, 0);
});

test('malformed remote positions never replace or acknowledge local progress', async () => {
  const selected = reset(
    { progress: cursor('local'), readAt: 300, progressAt: 300, progressDirty: true },
    { ...state('remote', 400), locator: { ...cursor('remote'), offset: -1 } }
  );
  await assert.rejects(syncReading(id, selected), /Unsupported snippet reading state/);
  assert.deepEqual(fixture.record.progress, cursor('local'));
  assert.equal(fixture.record.progressDirty, true);
});

test('reading keys remain stable, domain-separated and validate UUID identity', async () => {
  const key = await readingKey(id);
  assert.equal(
    key,
    'book_' + createHash('sha256').update(`manabi-snippet-reading-v1:${id}`).digest('hex')
  );
  await assert.rejects(readingKey('not-a-uuid'), /Invalid snippet identity/);
});
