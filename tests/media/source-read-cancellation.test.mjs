import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { localSource, identify, streamedRange } from '../../.cache/media-test-build/sources.js';
import { deviceKey } from '../../.cache/media-test-build/device-checkpoint.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

for (const kind of ['file', 'identity', 'sample', 'stream']) {
  for (const late of ['success', 'failure']) {
    for (const reason of [null, 0, false, new DOMException('Replaced read', 'AbortError')]) {
      test(`${kind} cancellation detaches before late ${late}, preserving ${String(reason)}`, async () => {
        const sourceRead = deferred(),
          entered = deferred();
        const controller = new AbortController();
        let reads = 0,
          slices = 0,
          progress = 0;
        const source = {
          name: 'Held.mp4',
          size: 4,
          version: 'test',
          read: () => {
            reads++;
            entered.resolve();
            return sourceRead.promise;
          }
        };
        let pending, reader;
        if (kind === 'file') {
          const file = new File([new Uint8Array(4)], 'Held.mp4');
          file.slice = () => {
            slices++;
            return {
              arrayBuffer: () => {
                reads++;
                entered.resolve();
                return sourceRead.promise;
              }
            };
          };
          pending = localSource(file).read(0, 4, controller.signal);
        } else if (kind === 'identity') {
          pending = identify(source, controller.signal, () => progress++);
        } else if (kind === 'sample') {
          pending = deviceKey(source, controller.signal);
        } else {
          reader = streamedRange(source, 0, 4, controller.signal).getReader();
          pending = reader.read();
        }
        let outcome;
        const observed = pending.then(
          (value) => {
            outcome = { resolved: true, value };
          },
          (error) => {
            outcome = { resolved: false, error };
          }
        );
        try {
          await entered.promise;
          controller.abort(reason);
          await turn(); // Drain task/microtask reactions; the source is STILL blocked.
          assert.ok(outcome, 'Aborted caller still awaits source I/O');
          assert.equal(outcome.resolved, false);
          assert.equal(outcome.error, reason);
          assert.equal(progress, 0);
          assert.equal(reads, 1);
          assert.equal(slices, kind === 'file' ? 1 : 0);
        } finally {
          if (late === 'failure') sourceRead.reject(new Error('Late physical read failure'));
          else sourceRead.resolve(kind === 'file' ? new ArrayBuffer(4) : new Uint8Array(4));
          await observed;
          await turn();
          reader?.releaseLock();
        }
        assert.equal(outcome.resolved, false);
        assert.equal(outcome.error, reason);
        assert.equal(progress, 0, 'Late data emitted identity progress after cancellation');
        assert.equal(reads, 1, 'Cancelled operation issued another source read');
      });
    }
  }
}

test('a pre-cancelled local read does not start Blob slicing or reading', async () => {
  const file = new File([new Uint8Array(4)], 'Held.mp4');
  file.slice = () => {
    throw Error('A cancelled request started disk I/O');
  };
  const controller = new AbortController();
  controller.abort(0);
  await assert.rejects(localSource(file).read(0, 4, controller.signal), (e) => e === 0);
});

test('uninterrupted local reads and content proofs retain their byte identities', async () => {
  const file = new File(['ordinary bytes'], 'Works.mp4', { lastModified: 1 });
  const source = localSource(file),
    signal = new AbortController().signal;
  const bytes = new TextEncoder().encode('ordinary bytes');
  assert.deepEqual(await source.read(0, source.size, signal), bytes);
  assert.equal(
    await identify(source, signal),
    'content:b2bda50d7c93491973d4e45c8a2e3fb84acc2e2f41430d5de16c7a33fdf47621'
  );
  assert.equal(
    await deviceKey(source, signal),
    'sampled-v1:d8b6f4a49f11ded506ec2cbf12e3b3e25adcab14eae3d3c9978d5a31d8753012'
  );
  const reader = streamedRange(source, 0, source.size, signal).getReader();
  assert.deepEqual((await reader.read()).value, bytes);
  assert.equal((await reader.read()).done, true);
  reader.releaseLock();
});
