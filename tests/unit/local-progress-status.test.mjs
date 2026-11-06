/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
function production(path, imports = {}) {
  const filename = new URL('../../apps/web/src/' + path, import.meta.url);
  const { outputText, diagnostics } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    fileName: filename.pathname,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX
    },
    reportDiagnostics: true
  });
  assert.equal(diagnostics.length, 0);
  const module = { exports: {} };
  compileFunction(outputText, ['require', 'module', 'exports'])(
    (name) => {
      assert.ok(Object.hasOwn(imports, name), 'Unexpected dependency: ' + name);
      return imports[name];
    },
    module,
    module.exports
  );
  return module.exports;
}
const stores = production('lib/state/store.ts');
function fixture() {
  const api = production('runtime/local-progress-status.ts', { '../lib/state/store': stores });
  let value;
  api.localProgressStatus.subscribe((next) => {
    value = next;
  });
  const scope = { bookId: 1, profileId: 'alice', generation: 2 };
  const owner = (extra = {}) =>
    api.createLocalProgressOwner({ scope, isCurrent: () => true, retry: async () => {}, ...extra });
  return { api, owner, value: () => value, scope };
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
test('local progress reports saved only after the existing commit acknowledges; failure can be retried', async () => {
  const f = fixture(),
    commit = deferred();
  let retryCalls = 0;
  const owner = f.owner({
    retry: async () => {
      retryCalls++;
      await owner.track(async () => {});
    }
  });
  assert.equal(f.value().state, 'unknown');
  const pending = owner.track(() => commit.promise);
  assert.equal(f.value().state, 'saving');
  commit.reject(new Error('quota failure'));
  await assert.rejects(pending, /quota/);
  assert.equal(f.value().state, 'failed');
  await f.api.retryLocalProgressSave();
  assert.equal(retryCalls, 1);
  assert.equal(f.value().state, 'saved');
  owner.dispose();
});
test('only a current latest failure reveals the owning reader controls', async () => {
  const f = fixture(),
    old = deferred();
  let attention = 0;
  const first = f.owner({ onFailure: () => attention++ });
  const pending = first.track(() => old.promise);
  await first.track(async () => {});
  old.reject(new Error('superseded failure'));
  await assert.rejects(pending);
  assert.equal(attention, 0);
  await assert.rejects(
    first.track(async () => {
      throw new Error('current failure');
    })
  );
  assert.equal(attention, 1);
  const retired = deferred();
  const late = first.track(() => retired.promise);
  f.owner();
  retired.reject(new Error('retired reader'));
  await assert.rejects(late);
  assert.equal(attention, 1);
});

test('older successful completions cannot hide the latest failed save', async () => {
  const f = fixture(),
    owner = f.owner(),
    old = deferred();
  const pending = owner.track(() => old.promise);
  await assert.rejects(
    owner.track(async () => {
      throw new Error('latest failed');
    })
  );
  old.resolve();
  await pending;
  assert.equal(f.value().state, 'failed');
  owner.dispose();
});
test('book and session replacement fences late saves and old disposal', async () => {
  const f = fixture(),
    old = deferred(),
    first = f.owner();
  const pending = first.track(() => old.promise);
  const second = f.owner({ scope: { ...f.scope, bookId: 2 } });
  old.resolve();
  await pending;
  first.dispose();
  assert.equal(f.value().bookId, 2);
  assert.equal(f.value().state, 'unknown');
  await second.track(async () => {});
  assert.equal(f.value().state, 'saved');
  second.dispose();
  assert.equal(f.value(), null);
});
test('profile revocation and disposal cannot publish acknowledgements or retry stale work', async () => {
  const f = fixture(),
    commit = deferred();
  let current = true,
    retries = 0;
  const owner = f.owner({
    isCurrent: () => current,
    retry: async () => {
      retries++;
    }
  });
  const pending = owner.track(() => commit.promise);
  current = false;
  commit.resolve();
  await pending;
  assert.notEqual(f.value().state, 'saved');
  await f.api.retryLocalProgressSave();
  assert.equal(retries, 0);
  owner.dispose();
  assert.equal(f.value(), null);
  await owner.track(async () => {});
  assert.equal(f.value(), null);
});
function connectionFixture() {
  const data = {
    online: true,
    personal: { state: 'idle' },
    books: {},
    account: { session: { user: { id: 'alice' } } },
    profile: { id: 'alice' },
    automatic: { owner: 'alice', available: true, records: {} },
    progress: { bookId: 1, profileId: 'alice', generation: 2, state: 'saved' },
    page: { url: new URL('https://reader.test/reader-web/b?id=1') }
  };
  const { WebConnectionStatus } = production('runtime/WebConnectionStatus.tsx', {
    'react/jsx-runtime': jsx,
    '@phosphor-icons/react': { WifiSlash() {}, Info() {} },
    '$lib/manabi/books': { bookSyncStatus: 'books' },
    '$lib/manabi/personal-sync': { personalSyncStatus: 'personal' },
    '$lib/manabi/client': { account: 'account', accountGeneration: () => 2, localUser: 'profile' },
    '$lib/manabi/reader-bridge-automatic': { readerBridgeAutomaticStatus: 'automatic' },
    '$lib/data/store': { isOnline$: 'online' },
    '../shared-ui/ConnectionNotice': { ConnectionNotice() {} },
    './use-store': { useStore: (key) => data[key] },
    './paths': { base: '/reader-web' },
    './stores': { page: 'page' },
    './local-progress-status': {
      localProgressStatus: 'progress',
      retryLocalProgressSave: async () => {}
    }
  });
  return { data, props: (path = '/b') => WebConnectionStatus({ path }).props.children.props };
}
test('web status only displays the acknowledged save for this book, account and generation', () => {
  const f = connectionFixture();
  assert.equal(f.props().progressState, 'saved');
  for (const change of [{ bookId: 2 }, { profileId: 'bob' }, { generation: 1 }]) {
    const original = f.data.progress;
    f.data.progress = { ...original, ...change };
    assert.equal(f.props().progressState, 'unknown');
    f.data.progress = original;
  }
  assert.equal(f.props('/manage').progressState, 'unknown');
});
test('automatic Drive changes, review, retry and pause surface only for the current account', () => {
  const f = connectionFixture();
  for (const state of ['changed', 'review', 'retry', 'paused']) {
    f.data.automatic.records = { drive: { state } };
    assert.ok(f.props().syncAction, state);
    assert.equal(f.props('/connections').syncAction, undefined);
  }
  f.data.automatic.owner = 'bob';
  assert.equal(f.props().syncAction, undefined);
  f.data.account.session = null;
  f.data.automatic.owner = null;
  assert.equal(f.props().syncAction, undefined);
});

test('a late save from an already retired session cannot take the new reader status slot', async () => {
  const f = fixture();
  const current = f.owner({ scope: { ...f.scope, bookId: 2 } });
  const retired = f.owner({ isCurrent: () => false });
  await retired.track(async () => {});
  retired.dispose();
  await current.track(async () => {});
  assert.equal(f.value().bookId, 2);
  assert.equal(f.value().state, 'saved');
  current.dispose();
});
