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
