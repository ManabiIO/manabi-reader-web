/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout, clearTimeout } from 'node:timers';
import vm from 'node:vm';
import { build } from 'esbuild';

const { outputFiles } = await build({
  stdin: {
    contents: `export * from './apps/web/src/lib/manabi/client'; export * from './apps/web/src/lib/manabi/operation-scope';`,
    resolveDir: new URL('../../', import.meta.url).pathname,
    loader: 'ts'
  },
  alias: { $lib: new URL('../../apps/web/src/lib', import.meta.url).pathname },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false
});
const key = 'manabi-reader-local-profile-v1';
const alice = { id: 'alice', username: 'Alice' };
const bob = { id: 'bob', username: 'Bob' };
function session(user) {
  return new Response(JSON.stringify({ user, csrf_token: 'x'.repeat(64), providers: [] }), {
    headers: { 'Content-Type': 'application/json', 'X-Manabi-User': user?.id ?? '' }
  });
}
function client(profile = alice) {
  const data = new Map(profile === undefined ? [] : [[key, JSON.stringify(profile)]]);
  const listeners = new Map();
  const context = {
    exports: {},
    module: { exports: {} },
    AbortController,
    AbortSignal,
    TextDecoder,
    Headers,
    Response,
    setTimeout,
    clearTimeout,
    navigator: { onLine: false },
    localStorage: {
      getItem: (name) => data.get(name) ?? null,
      setItem: (name, value) => data.set(name, value),
      removeItem: (name) => data.delete(name)
    },
    window: { addEventListener: (name, listener) => listeners.set(name, listener) },
    fetch: async () => {
      throw new Error('offline');
    }
  };
  vm.runInNewContext(outputFiles[0].text, context);
  return { api: context.module.exports, context, data, listeners };
}

test('local import admission waits for the initial profile and still revokes a real account switch', async () => {
  const { api, context } = client();
  let release;
  context.navigator.onLine = true;
  context.fetch = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  let admitted = false;
  const pending = api.prepareLocalLibraryOperation().then((scope) => {
    admitted = true;
    return scope;
  });
  await Promise.resolve();
  assert.equal(admitted, false);
  release(session(alice));
  const scope = await pending;
  try {
    assert.equal(scope.profileId, 'alice');
    scope.assertCurrent();
    context.fetch = async () => session(bob);
    await api.refreshAccount(true);
    assert.throws(() => scope.assertCurrent(), { code: 'account_changed' });
  } finally {
    scope.stop();
  }
});

test('local import admission keeps offline and anonymous use local, and cancellation admits no operation', async () => {
  for (const profile of [alice, null]) {
    const { api, context } = client(profile);
    const first = await api.prepareLocalLibraryOperation();
    assert.equal(first.profileId, profile?.id ?? null);
    first.stop();
    context.fetch = () => {
      assert.fail('Settled local admission must not probe the network');
    };
    const next = await api.prepareLocalLibraryOperation();
    next.assertCurrent();
    next.stop();
  }
  const { api, context } = client();
  let release;
  context.fetch = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const controller = new AbortController();
  const pending = api.prepareLocalLibraryOperation(controller.signal);
  controller.abort();
  release(session(alice));
  await assert.rejects(pending, { name: 'AbortError' });
});

test('cold offline reload exposes only local identity and cannot authorize a request', async () => {
  const { api, data } = client();
  assert.equal(api.localProfileUser(), null, 'unresolved login hides cached identity');
  await api.refreshAccount(true);
  assert.equal(api.localProfileUser()?.id, 'alice');
  assert.equal(api.currentUser(), null);
  assert.throws(() => api.accountScope(), { code: 'sign_in_required' });
  await assert.rejects(api.request('preferences/'), { code: 'sign_in_required' });
  assert.equal(JSON.parse(data.get(key)).csrf_token, undefined);
});

test('confirmed sign-out clears persisted identity and it stays hidden after another offline probe', async () => {
  const { api, context, data } = client();
  context.fetch = async () => session(null);
  await api.refreshAccount(true);
  assert.equal(api.localProfileUser(), null);
  assert.equal(data.has(key), false);
  context.fetch = async () => {
    throw new Error('offline');
  };
  await api.refreshAccount(true);
  assert.equal(api.localProfileUser(), null);
});

test('explicit sign-out revokes local visibility even when its follow-up session probe is offline', async () => {
  const { api, context, data } = client();
  context.navigator.onLine = true;
  context.fetch = async () => session(alice);
  await api.refreshAccount(true);
  context.fetch = async (url) => {
    if (url.endsWith('logout/')) {
      context.navigator.onLine = false;
      return new Response('{}', {
        headers: { 'Content-Type': 'application/json', 'X-Manabi-User': 'alice' }
      });
    }
    throw new Error('offline');
  };
  await api.signOut();
  assert.equal(api.localProfileUser(), null);
  assert.equal(api.currentUser(), null);
  assert.equal(data.has(key), false);
});

test('switching accounts replaces the local profile without retaining credentials', async () => {
  const { api, context, data } = client();
  context.fetch = async () => session(bob);
  await api.refreshAccount(true);
  assert.equal(api.localProfileUser()?.id, 'bob');
  assert.deepEqual(JSON.parse(data.get(key)), bob);
});

test('sign-out from another tab invalidates a pending request and does not rewrite shared storage', async () => {
  const { api, context, data, listeners } = client();
  context.navigator.onLine = true;
  context.fetch = async () => session(alice);
  await api.refreshAccount(true);
  let resolve;
  context.fetch = async (url) => {
    if (url.endsWith('preferences/'))
      return new Promise((done) => {
        resolve = done;
      });
    throw new Error('offline');
  };
  const pending = api.request('preferences/');
  data.delete(key);
  listeners.get('storage')({ key });
  resolve(
    new Response('{}', {
      headers: { 'Content-Type': 'application/json', 'X-Manabi-User': 'alice' }
    })
  );
  await assert.rejects(pending, { code: 'account_changed' });
  assert.equal(api.localProfileUser(), null);
  assert.equal(data.has(key), false);
});

test('explicit account requests may probe connectivity when the browser offline hint is stale', async () => {
  const { api, context } = client();
  context.navigator.onLine = true;
  context.fetch = async () => session(alice);
  await api.refreshAccount(true);
  let requests = 0;
  context.fetch = async () => {
    requests++;
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json', 'X-Manabi-User': 'alice' }
    });
  };
  context.navigator.onLine = false;
  assert.equal((await api.request('preferences/')).ok, true);
  assert.equal(requests, 1);
  assert.equal(api.currentUser()?.id, 'alice');
});

test('invalid persisted identities and online service failures cannot expose a remembered profile', async () => {
  for (const profile of [{ id: 'alice\nadmin', username: 'Alice' }, [], {}, null]) {
    const { api } = client(profile);
    await api.refreshAccount(true);
    assert.equal(api.localProfileUser(), null);
  }
  const { api, context } = client();
  context.navigator.onLine = true;
  await api.refreshAccount(true);
  assert.equal(api.localProfileUser(), null);
});
