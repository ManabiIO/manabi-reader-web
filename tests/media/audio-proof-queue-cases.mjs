/** Same production queue/store scenarios in Node and native IndexedDB. No real ASR. */
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { TranscriptionQueue } from '../../.cache/media-test-build/queue.js';
import { audioProof } from '../../.cache/media-test-build/audio-proof.js';
const tick = () => new Promise((r) => setTimeout(r, 1));
const same = (a, b) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw Error('Mismatch: ' + JSON.stringify([a, b]));
};
async function until(read) {
  for (let i = 0; i < 1000; i++) {
    const value = await read();
    if (value) return value;
    await tick();
  }
  throw Error('Proof queue scenario timed out');
}
async function scenario(factory, mode) {
  const name = 'async-proof-' + crypto.randomUUID(),
    key = 'content:' + 'd'.repeat(64);
  let store = new MediaStore(factory, name),
    queue,
    calls = 0,
    prepared = 0,
    digestCalls = 0,
    finish;
  const original = crypto.subtle.digest;
  const input = new Float32Array(32000).fill(0.25),
    expected = audioProof(0, 2, input);
  // Real native digest snapshots the bytes; expose a controlled delayed completion.
  crypto.subtle.digest = function (...args) {
    digestCalls++;
    const computed = original.apply(this, args);
    if (mode === 'failure') return Promise.reject(new Error('scripted digest failure'));
    if (mode === 'cancel')
      return computed.then(
        (value) =>
          new Promise((resolve) => {
            finish = () => resolve(value);
          })
      );
    return computed;
  };
  try {
    queue = new TranscriptionQueue(
      store,
      'guest',
      {
        async prepare() {
          prepared++;
        },
        async transcribe(pcm) {
          calls++;
          same(pcm.length, 32000);
          structuredClone(pcm, { transfer: [pcm.buffer] });
          return '[0][S01]字幕[1]';
        },
        dispose() {}
      },
      async () => input.slice()
    );
    const job = await queue.enqueue(key, 'ja', '1', 2, 0, true, 'sampled-v1:' + 'a'.repeat(64));
    if (mode === 'cancel') {
      await until(() => finish);
      await queue.cancel(job.id);
      finish();
    }
    const saved = await until(async () => {
      const j = await store.local('guest', 'jobs', job.id);
      return ['paused', 'failed'].includes(j?.status) ? j : undefined;
    });
    await queue.dispose();
    same(digestCalls, 1);
    if (mode === 'success') {
      same(calls, 1);
      same(prepared, 1);
      same(saved.nextWindow, 1);
      same(saved.audioProofs, [expected]);
      same(saved.pauseReason, 'identity');
    } else {
      same(calls, 0);
      same(prepared, 0);
      same(saved.nextWindow, 0);
      same(saved.audioProofs, []);
      same(saved.cues, []);
      same(saved.status, mode === 'cancel' ? 'paused' : 'failed');
    }
    same(await store.tracks('guest', key), []);
    await store.close();
    store = new MediaStore(factory, name);
    same(await store.local('guest', 'jobs', job.id), saved);
    return { calls, prepared, digestCalls, status: saved.status };
  } finally {
    finish?.();
    crypto.subtle.digest = original;
    await queue?.dispose();
    await store.close();
  }
}
export const cases = ['success', 'cancel', 'failure'].map((mode) => ({
  name: 'native audio-proof ' + mode + ' preserves queue/checkpoint authority',
  run: (factory) => scenario(factory, mode)
}));
