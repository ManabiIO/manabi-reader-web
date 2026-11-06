/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { loadOfflineModule } from './fixtures/offline-module.mjs';

function provider(events) {
  const noop = async () => {};
  return {
    render() {},
    installDefault: noop,
    recommendations: noop,
    client: Object.fromEntries(
      [
        'status',
        'search',
        'importDictionary',
        'deleteDictionary',
        'setEnabled',
        'recordDefaultInstall',
        'close'
      ].map((name) => [name, name === 'close' ? async () => events.push('client-close') : noop])
    ),
    preprocessor: {
      protocol: 1,
      id: 'analysis',
      release: '1',
      fingerprint: async () => null,
      preprocess: async () => null,
      mount: () => () => {},
      dispose: async () => events.push('analysis-dispose')
    }
  };
}
const drain = async () => {
  for (let i = 0; i < 6; i++) await setImmediate();
};
test('analysis and dictionary storage share leases and retire before a replacement opens', async () => {
  const events = [];
  const runtime = provider(events);
  let opens = 0;
  const { api } = loadOfflineModule('apps/web/src/lib/search/dictionary-runtime.ts', {
    modules: {
      './dictionary-provider-selection': {
        openDictionaryProvider: async () => {
          events.push('open');
          opens++;
          return runtime;
        }
      }
    }
  });
  const first = api.dictionaryLease(),
    second = api.dictionaryLease();
  assert.equal(await first.get(), runtime);
  assert.equal(await second.get(), runtime);
  assert.equal(opens, 1);
  first.release();
  await drain();
  assert.deepEqual(events, ['open']);
  second.release();
  const third = api.dictionaryLease();
  await third.get();
  assert.deepEqual(events, ['open', 'analysis-dispose', 'client-close', 'open']);
  third.release();
  await drain();
  assert.deepEqual(events.slice(-2), ['analysis-dispose', 'client-close']);
});
test('failed analysis admission cleans up storage and permits another open', async () => {
  const events = [];
  const invalid = provider(events);
  invalid.preprocessor.protocol = 2;
  let attempts = 0;
  const { api } = loadOfflineModule('apps/web/src/lib/search/dictionary-runtime.ts', {
    modules: {
      './dictionary-provider-selection': {
        openDictionaryProvider: async () => (++attempts === 1 ? invalid : provider(events))
      }
    }
  });
  const lease = api.dictionaryLease();
  await assert.rejects(lease.get(), /preprocessor protocol/);
  assert.deepEqual(events, ['analysis-dispose', 'client-close']);
  assert.ok(await lease.get());
  lease.release();
  await drain();
});
test('analysis cleanup failure still closes dictionary storage', async () => {
  const events = [];
  const runtime = provider(events);
  runtime.preprocessor.dispose = async () => {
    throw new Error('failed dispose');
  };
  const { api } = loadOfflineModule('apps/web/src/lib/search/dictionary-runtime.ts', {
    modules: { './dictionary-provider-selection': { openDictionaryProvider: async () => runtime } }
  });
  const lease = api.dictionaryLease();
  await lease.get();
  lease.release();
  await drain();
  assert.deepEqual(events, ['client-close']);
});

test('released startup waiting for retirement never opens an unnecessary storage owner', async () => {
  const events = [];
  let finishFirst,
    opens = 0;
  const firstRuntime = provider(events);
  const { api } = loadOfflineModule('apps/web/src/lib/search/dictionary-runtime.ts', {
    modules: {
      './dictionary-provider-selection': {
        openDictionaryProvider: () => {
          opens++;
          return opens === 1
            ? new Promise((resolve) => {
                finishFirst = resolve;
              })
            : Promise.resolve(provider(events));
        }
      }
    }
  });
  const first = api.dictionaryLease();
  const opening = first.get();
  await drain();
  first.release();
  const cancelled = api.dictionaryLease();
  const queued = cancelled.get();
  const rejected = assert.rejects(queued, { name: 'AbortError' });
  cancelled.release();
  const replacement = api.dictionaryLease();
  const next = replacement.get();
  await drain();
  assert.equal(opens, 1);
  finishFirst(firstRuntime);
  await opening;
  await rejected;
  await next;
  assert.equal(opens, 2, 'Only the live replacement may start after disposal');
  assert.deepEqual(events, ['analysis-dispose', 'client-close']);
  replacement.release();
  await drain();
  assert.deepEqual(events, [
    'analysis-dispose',
    'client-close',
    'analysis-dispose',
    'client-close'
  ]);
});

test('one departing consumer cannot cancel another consumer waiting on the same startup', async () => {
  const events = [];
  let finish,
    opens = 0;
  const { api } = loadOfflineModule('apps/web/src/lib/search/dictionary-runtime.ts', {
    modules: {
      './dictionary-provider-selection': {
        openDictionaryProvider: () => {
          opens++;
          return new Promise((resolve) => {
            finish = resolve;
          });
        }
      }
    }
  });
  const first = api.dictionaryLease(),
    second = api.dictionaryLease();
  const one = first.get(),
    two = second.get();
  await drain();
  first.release();
  const shared = provider(events);
  finish(shared);
  assert.equal(await one, shared);
  assert.equal(await two, shared);
  assert.equal(opens, 1);
  assert.deepEqual(events, []);
  second.release();
  await drain();
  assert.deepEqual(events, ['analysis-dispose', 'client-close']);
});
