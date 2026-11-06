/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import pLimit from 'p-limit';
import { deferred, loadOfflineModule } from './fixtures/offline-module.mjs';

function fixture({ cached = false } = {}) {
  const prompts = [],
    calls = [],
    hooks = {},
    progress = [],
    prompt = deferred();
  const observer = { next() {} };
  const root = {
    async queryPermission() {
      calls.push('query');
      await hooks.query?.();
      return 'prompt';
    },
    async requestPermission() {
      calls.push('request');
      if (hooks.request) return hooks.request();
      throw new Error('User activation is required');
    }
  };
  const { api } = loadOfflineModule('apps/web/src/lib/data/storage/handler/filesystem-handler.ts', {
    globals: { File },
    modules: {
      '$lib/data/env': { ttuCompatibilityRootName: 'ttu-reader-data' },
      '$lib/data/store': {
        database: {
          db: Promise.resolve({ get: async () => ({ data: { directoryHandle: root } }) }),
          listLoading$: observer,
          dataListChanged$: observer
        },
        fsStorageSource$: { getValue: () => '' }
      },
      '$lib/data/reading-goal': {},
      '$lib/functions/statistic-util': {},
      '$runtime/../ui/dialogs': { StorageUnlock: {} },
      '$lib/data/storage/storage-source-manager': { isRemoteContext: () => false },
      '$lib/data/dialog-manager': {
        dialogManager: {
          dialogs$: {
            next: (dialogs) => {
              prompts.push(dialogs[0].props);
              prompt.resolve();
            }
          }
        }
      },
      '$lib/data/storage/storage-handler-factory': {},
      '$lib/functions/replication/error-handler': {},
      '$lib/manabi/external-book-data': {},
      '$lib/functions/replication/replicator': { exporterVersion: 1 },
      '$lib/functions/replication/replication-progress': {
        replicationProgress$: { next: (value) => progress.push(value) }
      },
      '$lib/functions/file-loaders/utils/restored-book': {},
      '@zip.js/zip.js': {},
      'p-limit': pLimit
    }
  });
  const handler = new api.FilesystemStorageHandler({}, 'filesystem');
  const cancel = new AbortController();
  handler.startContext({ title: 'Book' }, cancel.signal);
  if (cached) handler.rootDirectory = root;
  return { handler, root, cancel, calls, hooks, prompts, prompt };
}

for (const cached of [false, true]) {
  test(`cancelled or closed permission dialog cannot retry (cached=${cached})`, async () => {
    const f = fixture({ cached });
    const pending = f.handler.ensureRoot();
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await f.prompt.promise;
    assert.equal(f.prompts[0].showCancel, true);
    f.prompts[0].resolver(undefined);
    await rejected;
    assert.deepEqual(f.calls, ['query', 'request']);
    assert.equal(f.prompts.length, 1);
  });
  test(`Continue retries permissions once and can grant access (cached=${cached})`, async () => {
    const f = fixture({ cached });
    const pending = f.handler.ensureRoot();
    await f.prompt.promise;
    f.hooks.request = () => 'granted';
    f.prompts[0].resolver({ clientId: '', clientSecret: '' });
    assert.equal(await pending, f.root);
    assert.deepEqual(f.calls, ['query', 'request', 'query', 'request']);
    assert.equal(f.handler.rootDirectory, f.root);
  });
  test(`a repeated activation error cannot reopen the continuation dialog (cached=${cached})`, async () => {
    const f = fixture({ cached });
    const pending = f.handler.ensureRoot();
    const rejected = assert.rejects(pending, /activation is required/);
    await f.prompt.promise;
    f.prompts[0].resolver({ clientId: '', clientSecret: '' });
    await rejected;
    assert.equal(f.prompts.length, 1);
    assert.equal(f.calls.length, 4);
  });
}

for (const boundary of ['query', 'dialog'])
  for (const retire of ['cancel', 'context', 'source'])
    test(`${retire} during ${boundary} cannot admit another permission attempt`, async () => {
      const f = fixture(),
        entered = deferred(),
        finish = deferred();
      if (boundary === 'query')
        f.hooks.query = async () => {
          entered.resolve();
          await finish.promise;
        };
      const pending = f.handler.ensureRoot();
      const rejected = assert.rejects(pending, { name: 'AbortError' });
      await (boundary === 'query' ? entered.promise : f.prompt.promise);
      if (retire === 'cancel') f.cancel.abort();
      if (retire === 'context') f.handler.startContext({ title: 'Replacement' });
      if (retire === 'source') f.handler.clearData();
      if (boundary === 'query') finish.resolve();
      else f.prompts[0].resolver({ clientId: '', clientSecret: '' });
      await rejected;
      assert.deepEqual(f.calls, boundary === 'query' ? ['query'] : ['query', 'request']);
      assert.equal(f.handler.rootDirectory, undefined);
    });

test('a pre-cancelled operation does not query permissions', async () => {
  const f = fixture({ cached: true });
  f.cancel.abort();
  await assert.rejects(f.handler.ensureRoot(), { name: 'AbortError' });
  assert.deepEqual(f.calls, []);
});

test('disabled storage unlock does not open a continuation dialog', async () => {
  const f = fixture();
  await assert.rejects(f.handler.ensureRoot(false), /activation is required/);
  assert.equal(f.prompts.length, 0);
});

for (const retire of ['context', 'cancel'])
  test(`catalog permission admission remains valid after unrelated book ${retire}`, async () => {
    const f = fixture({ cached: true }),
      entered = deferred(),
      finish = deferred();
    f.root.queryPermission = async () => {
      f.calls.push('query');
      entered.resolve();
      await finish.promise;
      return 'granted';
    };
    f.root.values = async function* () {};
    const pending = f.handler.getBookList();
    await entered.promise;
    if (retire === 'context') f.handler.startContext({ title: 'Replacement' });
    else f.cancel.abort();
    finish.resolve();
    assert.deepEqual(Array.from(await pending), []);
    assert.deepEqual(f.calls, ['query']);
  });
test('deletion uses its explicit cancellation signal during permission discovery', async () => {
  const f = fixture({ cached: true }),
    cancel = new AbortController(),
    entered = deferred(),
    finish = deferred();
  f.hooks.query = async () => {
    entered.resolve();
    await finish.promise;
  };
  const pending = f.handler.deleteBookData(['Book'], cancel.signal);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await entered.promise;
  cancel.abort();
  finish.resolve();
  await rejected;
  assert.deepEqual(f.calls, ['query']);
  assert.equal(f.prompts.length, 0);
});
for (const cached of [false, true])
  test(`background permission lookup never opens native or continuation prompts (cached=${cached})`, async () => {
    const f = fixture({ cached });
    f.handler.askForStorageUnlock = false;
    await assert.rejects(f.handler.getBookList(), /permissions/i);
    assert.deepEqual(f.calls, ['query']);
    assert.equal(f.prompts.length, 0);
  });
