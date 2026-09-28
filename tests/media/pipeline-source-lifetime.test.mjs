import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaPipeline } from '../../.cache/media-test-build/pipeline.js';
import { identify, streamedRange } from '../../.cache/media-test-build/sources.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const signal = () => new AbortController().signal;
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function harness() {
  let valid = true,
    created = 0,
    disposed = 0,
    calls = 0;
  const source = {
    name: 'remote.webm',
    size: 4,
    version: 'old',
    isCurrent() {
      return valid;
    },
    async read(start, end) {
      return new Uint8Array(end - start);
    }
  };
  const track = {
    id: 1,
    canDecode: async () => true,
    getNumberOfChannels: async () => 1,
    getName: async () => null,
    getLanguageCode: async () => 'ja',
    getDisposition: async () => ({
      default: false,
      primary: false,
      forced: false,
      original: false,
      commentary: false,
      hearingImpaired: false,
      visuallyImpaired: false
    }),
    async *buffers() {}
  };
  const input = {
    async getAudioTracks() {
      calls++;
      return [track];
    },
    async computeDuration() {
      calls++;
      return 2;
    },
    async getPrimaryVideoTrack() {
      calls++;
      return null;
    },
    dispose() {
      disposed++;
    }
  };
  const bunny = {
    create() {
      created++;
      return input;
    }
  };
  return {
    source,
    input,
    track,
    bunny,
    revoke: () => {
      valid = false;
    },
    restore: () => {
      valid = true;
    },
    stats: () => ({ created, disposed, calls }),
    open: () => new MediaPipeline(bunny, source)
  };
}
test('revoked source cannot construct a decoder from cached bytes', () => {
  const h = harness();
  h.revoke();
  assert.throws(h.open, /source.*current/i);
  assert.equal(h.stats().created, 0);
});
for (const method of ['metadata', 'audioTracks', 'describeAudioTracks'])
  test(`cached ${method} respects revoked source authority without another byte read`, async () => {
    const h = harness(),
      pipeline = h.open();
    try {
      await pipeline[method]();
      const before = h.stats().calls;
      h.revoke();
      await assert.rejects(pipeline[method](), /source.*current/i);
      assert.equal(h.stats().calls, before);
      assert.equal(h.stats().disposed, 1);
      h.restore();
      await assert.rejects(pipeline[method]());
      assert.equal(h.stats().calls, before, 'revocation must retire the pipeline permanently');
    } finally {
      pipeline.dispose();
    }
  });
test('revocation while cached metadata resolves prevents returning its value', async () => {
  const h = harness(),
    d = deferred();
  h.input.computeDuration = () => d.promise;
  const pipeline = h.open();
  const read = pipeline.metadata();
  h.revoke();
  d.resolve(2);
  await assert.rejects(read, /source.*current/i);
  assert.equal(h.stats().disposed, 1);
});
test('revocation during decoder readiness stops before creating Web Audio', async () => {
  const h = harness(),
    d = deferred();
  h.track.canDecode = () => d.promise;
  const pipeline = h.open(),
    read = pipeline.decode(1, 0, 1, signal());
  await tick();
  h.revoke();
  d.resolve(true);
  await assert.rejects(read, /source.*current/i);
  assert.equal(h.stats().disposed, 1);
});
test('full hash cannot finish after revocation in the final progress callback', async () => {
  const h = harness();
  await assert.rejects(identify(h.source, signal(), h.revoke), /source.*current/i);
});
test('range stream rejects cached bytes returned after revocation', async () => {
  const h = harness(),
    d = deferred();
  h.source.read = () => d.promise;
  const reader = streamedRange(h.source, 0, 4, signal()).getReader();
  const pending = reader.read();
  await tick();
  h.revoke();
  d.resolve(new Uint8Array(4));
  await assert.rejects(pending, /source.*current/i);
  reader.releaseLock();
});
test('replacing the source predicate cannot revive an admitted pipeline', async () => {
  const h = harness(),
    pipeline = h.open();
  h.revoke();
  h.source.isCurrent = () => true;
  try {
    await assert.rejects(pipeline.metadata(), /source.*current/i);
  } finally {
    pipeline.dispose();
  }
});

test('revocation during OfflineAudioContext rendering cannot return cached PCM', async () => {
  const h = harness(),
    render = deferred(),
    previous = globalThis.OfflineAudioContext;
  let rendering = false;
  globalThis.OfflineAudioContext = class {
    startRendering() {
      rendering = true;
      return render.promise;
    }
  };
  const pipeline = h.open();
  try {
    const read = pipeline.decode(1, 0, 1, signal());
    for (let i = 0; i < 100 && !rendering; i++) await tick();
    assert.equal(rendering, true);
    h.revoke();
    render.resolve({ getChannelData: () => new Float32Array(16000) });
    await assert.rejects(read, /source.*current/i);
    assert.equal(h.stats().disposed, 1);
  } finally {
    render.resolve({ getChannelData: () => new Float32Array(16000) });
    pipeline.dispose();
    if (previous === undefined) delete globalThis.OfflineAudioContext;
    else globalThis.OfflineAudioContext = previous;
  }
});
