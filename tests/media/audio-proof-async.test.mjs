import test from 'node:test';
import assert from 'node:assert/strict';
import { audioProof, audioProofAsync } from '../../.cache/media-test-build/audio-proof.js';
const signal = () => new AbortController().signal;
const pcm = (n) => Float32Array.from({ length: n }, (_, i) => (i % 7 ? Math.sin(i) : -0));

for (const count of [1, 17, 16000, 480000, 960000])
  test('native proof is byte-identical to saved SHA-256 at ' + count + ' samples', async () => {
    const source = pcm(count + 20),
      view = source.subarray(7, 7 + count);
    const before = source.slice();
    assert.deepEqual(
      await audioProofAsync(0, count / 16000, view, signal()),
      audioProof(0, count / 16000, view)
    );
    assert.deepEqual(source, before);
    assert.equal(view.byteLength, count * 4, 'native hashing did not detach inference input');
  });
for (const input of [
  new Float32Array(),
  new Float32Array([NaN]),
  new Float32Array([Infinity]),
  new Float64Array([1]),
  new Float32Array(960001)
])
  test(
    'invalid or unbounded proof is rejected: ' + input.constructor.name + '/' + input.length,
    async () => {
      await assert.rejects(audioProofAsync(0, 1, input, signal()), /Invalid/);
    }
  );
test('already-aborted proof never enters native crypto', async () => {
  const controller = new AbortController(),
    reason = new Error('stopped');
  controller.abort(reason);
  await assert.rejects(audioProofAsync(0, 1, null, controller.signal), (e) => e === reason);
});
test('native digest failure is propagated, not silently recalculated', async () => {
  const original = crypto.subtle.digest,
    reason = new Error('native error');
  crypto.subtle.digest = async () => {
    throw reason;
  };
  try {
    await assert.rejects(audioProofAsync(0, 1, pcm(16), signal()), (e) => e === reason);
  } finally {
    crypto.subtle.digest = original;
  }
});
test('cancellation during native hashing discards the late proof', async () => {
  const original = crypto.subtle.digest;
  let finish;
  crypto.subtle.digest = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const controller = new AbortController();
  try {
    const pending = audioProofAsync(0, 1, pcm(16), controller.signal);
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    controller.abort();
    finish(new ArrayBuffer(32));
    await rejected;
  } finally {
    crypto.subtle.digest = original;
  }
});
test('invalid native digest size is not saved', async () => {
  const original = crypto.subtle.digest;
  crypto.subtle.digest = async () => new ArrayBuffer(31);
  try {
    await assert.rejects(audioProofAsync(0, 1, pcm(16), signal()), /Invalid SHA-256/);
  } finally {
    crypto.subtle.digest = original;
  }
});
test('no-WebCrypto fallback keeps saved digest compatibility', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const source = pcm(2000),
    expected = audioProof(0, 1, source);
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
  try {
    assert.deepEqual(await audioProofAsync(0, 1, source, signal()), expected);
  } finally {
    Object.defineProperty(globalThis, 'crypto', original);
  }
});
test('shared or detached input cannot produce a racing native proof', async () => {
  if (typeof SharedArrayBuffer !== 'undefined')
    await assert.rejects(
      audioProofAsync(0, 1, new Float32Array(new SharedArrayBuffer(64)), signal()),
      /Invalid/
    );
  const input = pcm(16);
  structuredClone(input, { transfer: [input.buffer] });
  await assert.rejects(audioProofAsync(0, 1, input, signal()), /Invalid/);
});
