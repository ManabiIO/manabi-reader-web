import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStorageAccess } from '../../apps/web/src/lib/data/window/navigator/storage-access.mjs';
import {
  getOfflineStatus,
  inspectOfflineShell,
  isUsableShellResponse,
  OFFLINE_STATUS_REQUEST
} from '../../apps/web/src/lib/service-worker/offline-status.mjs';

const scope = 'https://reader.example/reader-web/';
const goodReply = {
  type: OFFLINE_STATUS_REQUEST,
  scope,
  version: 'test',
  state: 'ready',
  required: 3,
  cached: 3
};
function registration(reply = goodReply) {
  return {
    scope,
    waiting: null,
    active: {
      scriptURL: scope + 'service-worker.js',
      state: 'activated',
      postMessage(message, ports) {
        assert.deepEqual(message, { type: OFFLINE_STATUS_REQUEST });
        ports[0].postMessage(reply);
        ports[0].close();
      }
    }
  };
}
const containerFor = (value) => ({ getRegistration: async () => value });

test('storage access tolerates unsupported/partial APIs and throwing getters', async () => {
  for (const getter of [
    () => undefined,
    () => ({}),
    () => {
      throw new Error('SecurityError');
    }
  ]) {
    const access = createStorageAccess(getter);
    assert.equal(await access.persisted(), false);
    assert.equal(await access.persist(), false);
    assert.deepEqual(await access.estimate(), {});
  }
});

test('storage methods retain their native receiver', async () => {
  const manager = {
    persisted() {
      assert.equal(this, manager);
      return false;
    },
    persist() {
      assert.equal(this, manager);
      return true;
    },
    estimate() {
      assert.equal(this, manager);
      return { usage: 0, quota: 100 };
    }
  };
  const access = createStorageAccess(() => manager);
  assert.equal(await access.persist(), true);
  assert.deepEqual(await access.estimate(), { usage: 0, quota: 100 });
});

test('storage promise rejections never escape to settings/import callers', async () => {
  const reject = async () => {
    throw new Error('Denied');
  };
  const access = createStorageAccess(() => ({
    persisted: reject,
    persist: reject,
    estimate: reject
  }));
  assert.equal(await access.persisted(), false);
  assert.equal(await access.persist(), false);
  assert.deepEqual(await access.estimate(), {});
  const separate = createStorageAccess(() => ({ persisted: async () => false, persist: reject }));
  assert.equal(await separate.persist(), false);
});

test('persistence checks existing permission and coalesces concurrent requests', async () => {
  let calls = 0;
  let finish;
  let granted = false;
  const access = createStorageAccess(() => ({
    persisted: async () => granted,
    persist: () => {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    }
  }));
  const first = access.persist();
  const second = access.persist();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  granted = true;
  finish(true);
  assert.equal(await first, true);
  assert.equal(await access.persist(), true);
  assert.equal(calls, 1);
});

test('a denied persistence request does not permanently prevent a later retry', async () => {
  let calls = 0;
  const access = createStorageAccess(() => ({ persist: async () => ++calls > 1 }));
  assert.equal(await access.persist(), false);
  assert.equal(await access.persist(), true);
  assert.equal(calls, 2);
});

test('invalid or absent estimates do not produce misleading usage percentages', async () => {
  for (const value of [
    undefined,
    {},
    { quota: 0, usage: 0 },
    { quota: NaN, usage: 1 },
    { quota: 100, usage: -1 },
    { quota: 100, usage: Infinity },
    { quota: '100', usage: 1 }
  ]) {
    assert.deepEqual(
      await createStorageAccess(() => ({ estimate: async () => value })).estimate(),
      {}
    );
  }
});

test('readiness can inspect the active worker without a controlling worker on first visit', async () => {
  const result = await getOfflineStatus(containerFor(registration()), scope);
  assert.deepEqual(result, { state: 'ready', updateWaiting: false });
});

test('waiting updates do not replace the active version in the readiness check', async () => {
  const reg = registration();
  reg.waiting = {
    postMessage() {
      throw new Error('Must not query waiting worker');
    }
  };
  assert.deepEqual(await getOfflineStatus(containerFor(reg), scope), {
    state: 'ready',
    updateWaiting: true
  });
});

test('unsupported, absent, and activating workers are not reported ready', async () => {
  assert.equal((await getOfflineStatus(undefined, scope)).state, 'unsupported');
  assert.equal((await getOfflineStatus(containerFor(undefined), scope)).state, 'unknown');
  const reg = registration();
  reg.active.state = 'activating';
  assert.equal((await getOfflineStatus(containerFor(reg), scope)).state, 'preparing');
});

test('parent scope, different script, and invalid requested scope fail closed', async () => {
  const parent = registration();
  parent.scope = 'https://reader.example/';
  assert.equal((await getOfflineStatus(containerFor(parent), scope)).state, 'unknown');
  const foreign = registration();
  foreign.active.scriptURL = scope + 'unrelated-worker.js';
  assert.equal((await getOfflineStatus(containerFor(foreign), scope)).state, 'unknown');
  assert.equal(
    (await getOfflineStatus(containerFor(registration()), scope + '?x=1')).state,
    'unknown'
  );
});

test('malformed and contradictory protocol replies cannot report readiness', async () => {
  for (const patch of [
    { type: 'other' },
    { scope: 'https://other/' },
    { version: '' },
    { state: 'installed' },
    { required: 0, cached: 0 },
    { cached: 2 },
    { cached: 4 },
    { cached: -1 },
    { cached: NaN },
    { required: 3.1 },
    { state: 'incomplete' }
  ]) {
    const result = await getOfflineStatus(
      containerFor(registration({ ...goodReply, ...patch })),
      scope
    );
    assert.equal(result.state, 'unknown', JSON.stringify(patch));
  }
});

test('old workers and stalled registration discovery time out without hanging settings', async () => {
  const reg = registration();
  reg.active.postMessage = () => {};
  assert.equal(
    (await getOfflineStatus(containerFor(reg), scope, { timeoutMs: 5 })).state,
    'unknown'
  );
  const stalled = { getRegistration: () => new Promise(() => {}) };
  assert.equal((await getOfflineStatus(stalled, scope, { timeoutMs: 5 })).state, 'unknown');
});

test('aborted requests and throwing browser operations resolve safely', async () => {
  const controller = new AbortController();
  const reg = registration();
  reg.active.postMessage = () => controller.abort();
  assert.equal(
    (await getOfflineStatus(containerFor(reg), scope, { signal: controller.signal })).state,
    'unknown'
  );
  assert.equal(
    (await getOfflineStatus(undefined, scope, { signal: controller.signal })).state,
    'unknown'
  );
  const throws = {
    getRegistration() {
      throw new Error('SecurityError');
    }
  };
  assert.equal((await getOfflineStatus(throws, scope)).state, 'unavailable');
  reg.active.postMessage = () => {
    throw new Error('closed');
  };
  assert.equal((await getOfflineStatus(containerFor(reg), scope)).state, 'unavailable');
});

test('a worker replaced while responding cannot publish stale readiness', async () => {
  const reg = registration();
  const post = reg.active.postMessage;
  reg.active.postMessage = (...args) => {
    reg.active = registration().active;
    post(...args);
  };
  assert.equal((await getOfflineStatus(containerFor(reg), scope)).state, 'unknown');
});

test('empty and missing caches are incomplete and not created by inspection', async () => {
  const storage = {
    keys: async () => [],
    open() {
      throw new Error('Should not create');
    }
  };
  assert.deepEqual(await inspectOfflineShell(storage, 'shell', new Set()), {
    state: 'incomplete',
    required: 0,
    cached: 0
  });
  assert.deepEqual(await inspectOfflineShell(storage, 'shell', new Set([scope])), {
    state: 'incomplete',
    required: 1,
    cached: 0
  });
});

test('bad responses, redirects and missing entries are incomplete', async () => {
  const cache = {
    match: async (key) =>
      ({
        a: new Response('good'),
        b: new Response(null, { status: 404 }),
        c: { status: 200, redirected: true }
      })[key.slice(scope.length)]
  };
  const storage = { keys: async () => ['shell'], open: async () => cache };
  assert.deepEqual(
    await inspectOfflineShell(
      storage,
      'shell',
      new Set(['a', 'b', 'c', 'missing'].map((path) => scope + path))
    ),
    {
      state: 'incomplete',
      required: 4,
      cached: 1
    }
  );
});

test('an idle or failed registration must not promise preparation', async () => {
  const reg = registration();
  reg.active = null;
  assert.equal((await getOfflineStatus(containerFor(reg), scope)).state, 'unknown');
  reg.installing = { state: 'redundant' };
  assert.equal((await getOfflineStatus(containerFor(reg), scope)).state, 'unknown');
  for (const state of ['parsed', 'installing', 'installed']) {
    reg.installing = { state };
    assert.equal((await getOfflineStatus(containerFor(reg), scope)).state, 'preparing');
  }
  reg.installing = null;
  reg.waiting = { state: 'installed' };
  assert.deepEqual(await getOfflineStatus(containerFor(reg), scope), {
    state: 'preparing',
    updateWaiting: true
  });
});

test('waiting-update information is sampled again when the shell scan completes', async () => {
  const reg = registration();
  const post = reg.active.postMessage;
  reg.active.postMessage = (...args) => {
    reg.waiting = { state: 'installed' };
    post(...args);
  };
  assert.deepEqual(await getOfflineStatus(containerFor(reg), scope), {
    state: 'ready',
    updateWaiting: true
  });
});

test('aborted registration discovery never starts a late worker query', async () => {
  const controller = new AbortController();
  let discover;
  let posts = 0;
  const reg = registration();
  reg.active.postMessage = () => posts++;
  const pending = getOfflineStatus(
    {
      getRegistration: () =>
        new Promise((resolve) => {
          discover = resolve;
        })
    },
    scope,
    { signal: controller.signal }
  );
  controller.abort();
  assert.equal((await pending).state, 'unknown');
  discover(reg);
  await Promise.resolve();
  assert.equal(posts, 0);
});

test('inspection bounds response handles and counts the full required manifest', async () => {
  let inFlight = 0;
  let maximum = 0;
  let matches = 0;
  const storage = {
    keys: async () => ['shell'],
    open: async () => ({
      async match() {
        inFlight++;
        maximum = Math.max(maximum, inFlight);
        await Promise.resolve();
        matches++;
        inFlight--;
        return new Response('app');
      }
    })
  };
  const urls = new Set(Array.from({ length: 25 }, (_, index) => scope + index));
  assert.deepEqual(await inspectOfflineShell(storage, 'shell', urls), {
    state: 'ready',
    required: 25,
    cached: 25
  });
  assert.equal(matches, 25);
  assert.ok(maximum <= 8);
});

test('failed cache enumeration or entry reads cannot certify offline readiness', async () => {
  const denied = async () => {
    throw new Error('SecurityError');
  };
  for (const storage of [
    { keys: denied },
    { keys: async () => ['shell'], open: denied },
    { keys: async () => ['shell'], open: async () => ({ match: denied }) }
  ]) {
    assert.equal(
      (await inspectOfflineShell(storage, 'shell', new Set([scope]))).state,
      'unavailable'
    );
  }
});

test('shell response metadata rejects empty statuses and document fallbacks for code', () => {
  const response = (mime, status = 200) =>
    new Response(status === 204 ? null : 'fixture', {
      status,
      headers: mime ? { 'Content-Type': mime } : {}
    });
  for (const path of ['app.js', 'MODULE.MJS', 'app.css']) {
    assert.equal(isUsableShellResponse(response('text/html'), scope + path), false);
    assert.equal(isUsableShellResponse(response('text/plain'), scope + path), false);
    assert.equal(isUsableShellResponse(response(null), scope + path), false);
  }
  for (const mime of [
    'text/javascript',
    'application/javascript',
    'text/javascript1.5',
    'application/x-javascript',
    'Text/JavaScript; charset=utf-8'
  ]) {
    assert.equal(isUsableShellResponse(response(mime), scope + 'app.js'), true, mime);
  }
  assert.equal(isUsableShellResponse(response('text/css; charset=utf-8'), scope + 'app.css'), true);
  assert.equal(isUsableShellResponse(response('text/html'), scope + 'manage', true), true);
  assert.equal(isUsableShellResponse(response('text/plain'), scope + 'manage', true), false);
  assert.equal(isUsableShellResponse(response('text/plain'), scope, true), false);
  assert.equal(isUsableShellResponse(response('text/plain'), scope + 'index.html'), false);
  assert.equal(
    isUsableShellResponse(response('application/json'), scope + 'data.json', true),
    true
  );
  assert.equal(isUsableShellResponse(response('image/png'), scope + 'icon.png'), true);
  assert.equal(isUsableShellResponse(response('text/javascript', 204), scope + 'app.js'), false);
  assert.equal(isUsableShellResponse(response('text/javascript', 206), scope + 'app.js'), false);
});

test('inspection uses the same document/code metadata checks without reading bodies', async () => {
  const urls = new Set([scope, scope + 'app.js', scope + 'app.css']);
  const pages = new Set([scope]);
  let bad = false;
  const storage = {
    keys: async () => ['shell'],
    open: async () => ({
      match: async (url) => ({
        status: 200,
        redirected: false,
        headers: new Headers({
          'Content-Type': bad
            ? 'text/plain'
            : url === scope
              ? 'text/html'
              : url.endsWith('.js')
                ? 'text/javascript'
                : 'text/css'
        }),
        text() {
          throw new Error('must not consume bodies');
        }
      })
    })
  };
  assert.equal((await inspectOfflineShell(storage, 'shell', urls, pages)).state, 'ready');
  bad = true;
  assert.deepEqual(await inspectOfflineShell(storage, 'shell', urls, pages), {
    state: 'incomplete',
    required: 3,
    cached: 0
  });
});
