import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceKey } from '../../.cache/media-test-build/device-checkpoint.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test('device sampling rejects cached bytes completed after source revocation', async () => {
  let valid = true;
  const pendingRead = deferred();
  const source = {
    name: 'remote.webm',
    size: 65536,
    version: 'version',
    isCurrent: () => valid,
    read: () => pendingRead.promise
  };
  const reading = deviceKey(source, new AbortController().signal);
  valid = false;
  pendingRead.resolve(new Uint8Array(32768));
  await assert.rejects(reading, /source.*current/i);
});

test('device sampling keeps revocation sticky if a source predicate is replaced later', async () => {
  let valid = true;
  let reads = 0;
  const source = {
    name: 'remote.webm',
    size: 65536,
    version: 'version',
    isCurrent: () => valid,
    async read(start, end) {
      reads++;
      const result = new Uint8Array(end - start);
      if (reads === 1) valid = false;
      return result;
    }
  };
  const reading = deviceKey(source, new AbortController().signal);
  source.isCurrent = () => true;
  await assert.rejects(reading, /source.*current/i);
  assert.equal(reads, 1);
});
