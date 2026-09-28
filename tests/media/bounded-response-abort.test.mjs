import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedResponse } from '../../.cache/media-test-build/sources.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test('bounded response detaches from a reader whose cancellation never settles', async () => {
  const read = deferred();
  const cancel = deferred();
  let cancellations = 0;
  let releases = 0;
  const response = {
    body: {
      getReader: () => ({
        read: () => read.promise,
        cancel: () => {
          cancellations++;
          return cancel.promise;
        },
        releaseLock: () => {
          releases++;
        }
      })
    }
  };
  const controller = new AbortController();
  const reason = new DOMException('cancelled', 'AbortError');
  const pending = boundedResponse(response, 4, controller.signal);
  await tick();
  controller.abort(reason);
  const outcome = await Promise.race([
    pending.then(
      () => ({ type: 'resolved' }),
      (error) => ({ type: 'rejected', error })
    ),
    new Promise((resolve) => setTimeout(() => resolve({ type: 'timeout' }), 50))
  ]);
  assert.equal(outcome.type, 'rejected', 'abort remained attached to stalled reader.read()');
  assert.equal(outcome.error, reason);
  assert.ok(cancellations >= 1);
  assert.equal(releases, 1);
  // A late transport completion remains observed but cannot change the outcome.
  read.resolve({ done: true, value: undefined });
  cancel.resolve();
  await tick();
});
