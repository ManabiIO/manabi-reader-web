/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { deferred, loadOfflineModule } from './fixtures/offline-module.mjs';

const status = () => ({ dictionaries: [], preferences: { disabled: [] } });
const committed = () => ({
  summary: { title: 'Local dictionary' },
  warnings: [],
  cancelledAfterCommit: false
});
const drain = async () => {
  for (let i = 0; i < 4; i++) await setImmediate();
};
function fixture(overrides = {}) {
  const timers = new Map();
  const leases = [];
  const runtime = {
    client: {
      status: async () => status(),
      setEnabled: async () => status(),
      deleteDictionary: async () => status(),
      importDictionary: async () => committed(),
      recordDefaultInstall: async () => status(),
      search: async (query) => ({
        contractVersion: 1,
        query,
        prefix: false,
        dictionaryCount: 1,
        preview: { items: [] }
      }),
      ...overrides.client
    },
    installDefault: async () => new Blob(['dictionary']),
    recommendations: async () => [],
    ...overrides.runtime
  };
  const { DictionaryController } = loadOfflineModule(
    'apps/web/src/library-react/dictionary-controller.ts',
    {
      globals: {
        Error,
        queueMicrotask,
        setTimeout(callback) {
          const id = {};
          timers.set(id, callback);
          return id;
        },
        clearTimeout(id) {
          timers.delete(id);
        }
      },
      modules: {
        '$lib/search/dictionary-runtime': {
          dictionaryLease() {
            const lease = {
              released: false,
              get: () => overrides.open?.() ?? Promise.resolve(runtime),
              release() {
                this.released = true;
              }
            };
            leases.push(lease);
            return lease;
          }
        }
      }
    }
  ).api;
  const c = new DictionaryController();
  let stop = c.activate();
  return {
    c,
    runtime,
    leases,
    timers,
    stop: () => stop(),
    restart() {
      stop();
      stop = c.activate();
    },
    async search() {
      await drain();
      for (const [id, callback] of [...timers]) {
        timers.delete(id);
        await callback();
      }
      await drain();
    }
  };
}

test('unmount while opening a toggle never mutates the retired runtime', async () => {
  const opening = deferred();
  let toggles = 0;
  const f = fixture({
    open: () => opening.promise,
    client: { setEnabled: async () => (++toggles, status()) }
  });
  const pending = f.c.toggleDictionary('Local dictionary', false);
  f.stop();
  opening.resolve(f.runtime);
  await pending;
  assert.equal(toggles, 0);
});

test('retry and status refresh do not retire or inspect an active dictionary mutation', async () => {
  const mutation = deferred();
  let statusCalls = 0;
  const f = fixture({
    client: {
      importDictionary: () => mutation.promise,
      status: async () => (++statusCalls, status())
    }
  });
  try {
    const pending = f.c.install(new Blob(['dictionary']));
    await drain();
    f.c.retry();
    await f.c.refreshStatus();
    assert.equal(f.leases.length, 1);
    assert.equal(f.leases[0].released, false);
    assert.equal(statusCalls, 0);
    mutation.resolve(committed());
    await pending;
    assert.equal(f.leases.length, 2);
  } finally {
    mutation.resolve(committed());
    f.stop();
  }
});

test('query edits wait for toggle completion before restarting search', async () => {
  const mutation = deferred();
  let searches = 0;
  const f = fixture({
    client: {
      setEnabled: () => mutation.promise,
      search: async (query) => {
        searches++;
        return { contractVersion: 1, query, prefix: false, dictionaryCount: 1 };
      }
    }
  });
  try {
    const pending = f.c.toggleDictionary('Local dictionary', false);
    f.c.query = '猫';
    await f.search();
    assert.equal(searches, 0);
    mutation.resolve(status());
    await pending;
    await f.search();
    assert.equal(searches, 1);
  } finally {
    mutation.resolve(status());
    f.stop();
  }
});

test('expanding during a failed toggle loads status when the mutation finishes', async () => {
  const mutation = deferred();
  let statusCalls = 0;
  const f = fixture({
    client: {
      setEnabled: () => mutation.promise,
      status: async () => (++statusCalls, status())
    }
  });
  try {
    const pending = f.c.toggleDictionary('Local dictionary', false);
    f.c.full = true;
    await drain();
    assert.equal(statusCalls, 0);
    mutation.reject(new Error('Settings failed.'));
    await pending;
    await drain();
    assert.equal(statusCalls, 1);
  } finally {
    mutation.resolve(status());
    f.stop();
  }
});

for (const operation of ['toggle', 'delete']) {
  test(`a retired ${operation} cannot clear a new mount's active mutation`, async () => {
    const previous = deferred();
    const next = deferred();
    let calls = 0;
    const mutate = () => (++calls === 1 ? previous.promise : next.promise);
    const f = fixture({ client: { setEnabled: mutate, deleteDictionary: mutate } });
    const start = () => {
      f.c.pendingDelete = 'Local dictionary';
      return operation === 'toggle'
        ? f.c.toggleDictionary('Local dictionary', false)
        : f.c.deleteDictionary('Local dictionary');
    };
    try {
      const pendingPrevious = start();
      await drain();
      f.restart();
      const pendingNext = start();
      await drain();
      previous.resolve(status());
      await pendingPrevious;
      assert.equal(f.c.managing, 'Local dictionary');
      assert.equal(f.leases.length, 2);
      next.resolve(status());
      await pendingNext;
      assert.equal(f.c.managing, '');
      assert.equal(f.leases.length, 3);
    } finally {
      previous.resolve(status());
      next.resolve(status());
      f.stop();
    }
  });
}

test('a prior mount import completion cannot overwrite a new mount or release its lease', async () => {
  const mutation = deferred();
  const f = fixture({ client: { importDictionary: () => mutation.promise } });
  try {
    const pending = f.c.install(new Blob(['dictionary']));
    await drain();
    f.restart();
    f.c.message = 'Current mount';
    mutation.resolve(committed());
    await pending;
    assert.equal(f.c.message, 'Current mount');
    assert.equal(f.leases.length, 2);
    assert.equal(f.leases[1].released, false);
    assert.equal(f.c.installing, false);
  } finally {
    f.stop();
  }
});

test('retry cancels stale recommendations before admitting replacement work', async () => {
  const recommendations = deferred();
  let signal;
  const f = fixture({
    runtime: {
      recommendations: (options) => {
        signal = options.signal;
        return recommendations.promise;
      }
    }
  });
  try {
    const pending = f.c.loadRecommendations();
    await drain();
    f.c.retry();
    assert.equal(signal.aborted, true);
    assert.equal(f.c.recommendationsLoading, false);
    recommendations.resolve([{ name: 'Retired runtime' }]);
    await pending;
    assert.equal(f.c.recommendations, undefined);
  } finally {
    recommendations.resolve([]);
    f.stop();
  }
});

test('default-install bookkeeping failure preserves durable import success', async () => {
  const f = fixture({
    client: {
      recordDefaultInstall: async () => {
        throw new Error('Preferences could not be saved.');
      }
    }
  });
  try {
    f.c.setupOpen = true;
    await f.c.install();
    assert.match(f.c.message, /Installed Local dictionary/);
    assert.match(f.c.message, /Preferences could not be saved/);
    assert.equal(f.c.setupOpen, false);
    assert.equal(f.leases.length, 2);
  } finally {
    f.stop();
  }
});

test('cancellation after an import commits reports success and reopens the durable dictionary', async () => {
  const mutation = deferred();
  const f = fixture({ client: { importDictionary: () => mutation.promise } });
  try {
    const pending = f.c.install(new Blob(['dictionary']));
    await drain();
    f.c.installController.abort();
    mutation.resolve({ ...committed(), cancelledAfterCommit: true });
    await pending;
    assert.equal(f.c.message, 'The dictionary finished installing before cancellation.');
    assert.equal(f.leases.length, 2);
    assert.equal(f.c.installing, false);
  } finally {
    mutation.resolve(committed());
    f.stop();
  }
});

test('unmount aborts pending status and search and suppresses their late results', async () => {
  const pendingStatus = deferred();
  const pendingSearch = deferred();
  let statusSignal;
  let searchSignal;
  const f = fixture({
    client: {
      status: (options) => {
        statusSignal = options.signal;
        return pendingStatus.promise;
      },
      search: (_query, _full, options) => {
        searchSignal = options.signal;
        return pendingSearch.promise;
      }
    }
  });
  f.c.full = true;
  f.c.query = '猫';
  await drain();
  for (const [id, callback] of [...f.timers]) {
    f.timers.delete(id);
    void callback();
  }
  await drain();
  f.stop();
  assert.equal(statusSignal.aborted, true);
  assert.equal(searchSignal.aborted, true);
  assert.equal(f.leases[0].released, true);
  pendingStatus.resolve(status());
  pendingSearch.resolve({ contractVersion: 1, query: '猫', prefix: false, dictionaryCount: 1 });
  await drain();
  assert.equal(f.c.dictionaryStatus, undefined);
  assert.equal(f.c.state.state, 'loading');
});
