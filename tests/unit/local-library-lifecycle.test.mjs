/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';

const result = await build({
  entryPoints: [new URL('../../apps/web/src/lib/manabi/persistence.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false
});
const { exclusive } = await import(
  'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
);

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('an already canceled lock request cannot start its callback', async () => {
  let started = false;
  await assert.rejects(
    exclusive(
      'already-canceled',
      async () => {
        started = true;
      },
      AbortSignal.abort()
    ),
    { name: 'AbortError' }
  );
  assert.equal(started, false);
});

test('fallback serialization skips canceled work and permits the next operation', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  });
  const entered = deferred(),
    release = deferred();
  const events = [];
  const first = exclusive('fallback-cancel', async () => {
    events.push('first');
    entered.resolve();
    await release.promise;
    events.push('finished');
  });
  await entered.promise;
  const controller = new AbortController();
  const canceled = exclusive(
    'fallback-cancel',
    async () => {
      events.push('canceled');
    },
    controller.signal
  );
  const rejected = assert.rejects(canceled, { name: 'AbortError' });
  const last = exclusive('fallback-cancel', async () => {
    events.push('last');
    return 42;
  });
  controller.abort();
  assert.deepEqual(events, ['first']);
  release.resolve();
  await first;
  await rejected;
  assert.equal(await last, 42);
  assert.deepEqual(events, ['first', 'finished', 'last']);
  assert.equal(await exclusive('fallback-cancel', async () => 'reused'), 'reused');
});

test('native lock requests receive the signal and retain the callback result', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const controller = new AbortController();
  let calls = 0;
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      locks: {
        request: async (name, options, work) => {
          calls++;
          assert.equal(name, 'manabi-reader:native-cancel');
          assert.equal(options.signal, controller.signal);
          return work();
        }
      }
    },
    configurable: true
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  });
  assert.equal(await exclusive('native-cancel', async () => 'saved', controller.signal), 'saved');
  assert.equal(calls, 1);
});
