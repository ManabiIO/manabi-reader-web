import test from 'node:test';
import assert from 'node:assert/strict';
import { DecodeSessionCache } from '../../.cache/media-test-build/decode-session.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const job = (id = 'job') => ({ id });

function harness() {
  let opens = 0;
  const pipelines = [];
  const cache = new DecodeSessionCache(async (_job, signal) => {
    opens++;
    signal.throwIfAborted();
    const pipeline = {
      decodes: 0,
      disposed: 0,
      async decode(_track, start, end, operation) {
        operation.throwIfAborted();
        this.decodes++;
        return new Float32Array(Math.ceil((end - start) * 16000));
      },
      dispose() {
        this.disposed++;
      }
    };
    pipelines.push(pipeline);
    return pipeline;
  });
  return { cache, pipelines, opens: () => opens };
}

test('one active job owner reuses its decoder across ordinary windows', async () => {
  const h = harness();
  const controller = new AbortController();
  await h.cache.decode(job(), 1, 0, 28, controller.signal);
  await h.cache.decode(job(), 1, 24, 52, controller.signal);
  assert.equal(h.opens(), 1);
  assert.equal(h.pipelines.length, 1);
  assert.equal(h.pipelines[0].decodes, 2);
  controller.abort(new DOMException('owner complete', 'AbortError'));
  assert.equal(h.pipelines[0].disposed, 1);
});

test('a successor owner with the same durable job ID never inherits decoder state', async () => {
  const h = harness();
  const first = new AbortController();
  const second = new AbortController();
  await h.cache.decode(job(), 1, 0, 28, first.signal);
  await h.cache.decode(job(), 1, 24, 52, second.signal);
  assert.equal(h.opens(), 2);
  assert.equal(h.pipelines[0].disposed, 1);
  assert.equal(h.pipelines[1].decodes, 1);
  h.cache.dispose();
  assert.equal(h.pipelines[1].disposed, 1);
});

test('owner abort retires a reusable decoder before another call can use it', async () => {
  const h = harness();
  const first = new AbortController();
  await h.cache.decode(job(), 1, 0, 28, first.signal);
  first.abort(new DOMException('paused', 'AbortError'));
  assert.equal(h.pipelines[0].disposed, 1);
  await assert.rejects(h.cache.decode(job(), 1, 24, 52, first.signal), { name: 'AbortError' });
  const second = new AbortController();
  await h.cache.decode(job(), 1, 24, 52, second.signal);
  assert.equal(h.opens(), 2);
});

test('late non-cooperating open is detached promptly and its pipeline is disposed', async () => {
  const gate = deferred();
  let disposed = 0;
  const cache = new DecodeSessionCache(async () => {
    const pipeline = await gate.promise;
    return pipeline;
  });
  const controller = new AbortController();
  const pending = cache.decode(job(), 1, 0, 28, controller.signal);
  await Promise.resolve();
  controller.abort(new DOMException('cancelled', 'AbortError'));
  await assert.rejects(pending, { name: 'AbortError' });
  gate.resolve({
    async decode() {
      throw new Error('retired decoder used');
    },
    dispose() {
      disposed++;
    }
  });
  // The ignored open can resume in a later microtask turn before the raw-promise
  // observer disposes its returned pipeline. Wait one task turn so every queued
  // promise continuation drains without assuming a fixed microtask count.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(disposed, 1);
});

test('failed opens are not cached and a later attempt can recover', async () => {
  let opens = 0;
  const cache = new DecodeSessionCache(async () => {
    if (++opens === 1) throw new Error('open failed');
    return {
      async decode() {
        return new Float32Array(1);
      },
      dispose() {}
    };
  });
  const first = new AbortController();
  await assert.rejects(cache.decode(job(), 1, 0, 1, first.signal), /open failed/);
  const second = new AbortController();
  assert.equal((await cache.decode(job(), 1, 0, 1, second.signal)).length, 1);
  assert.equal(opens, 2);
});

test('different jobs keep independent decoder sessions', async () => {
  const h = harness();
  const one = new AbortController();
  const two = new AbortController();
  await h.cache.decode(job('one'), 1, 0, 1, one.signal);
  await h.cache.decode(job('two'), 1, 0, 1, two.signal);
  assert.equal(h.opens(), 2);
  one.abort(new DOMException('first owner complete', 'AbortError'));
  assert.equal(h.pipelines[0].disposed, 1);
  assert.equal(h.pipelines[1].disposed, 0);
  h.cache.dispose();
  assert.equal(h.pipelines[1].disposed, 1);
});
