/** Real client protocol with explicit Worker messages, not a browser runtime or recognition. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MossClient } from '../../.cache/media-test-build/moss-client.js';

class WorkerDouble extends EventTarget {
  static latest;
  constructor() {
    super();
    WorkerDouble.latest = this;
  }
  last;
  postMessage(data) {
    if (data.type === 'prepare' || data.type === 'dispose')
      queueMicrotask(() =>
        this.emit(data.id, data.type === 'prepare' ? 'ready' : 'disposed', null)
      );
    if (data.type === 'transcribe') this.last = data;
  }
  emit(id, type, value) {
    this.dispatchEvent(new MessageEvent('message', { data: { id, type, value } }));
  }
  terminate() {}
}
async function harness(body, observer = (previews) => (raw) => previews.push(raw)) {
  const old = globalThis.Worker;
  globalThis.Worker = WorkerDouble;
  const client = new MossClient('/moss', new URL('https://test.invalid/worker.js'));
  const controller = new AbortController(),
    previews = [];
  try {
    await client.prepare(controller.signal, () => {});
    const pending = client.transcribe(new Float32Array(160), controller.signal, observer(previews));
    await body({
      client,
      controller,
      previews,
      pending,
      worker: WorkerDouble.latest,
      id: WorkerDouble.latest.last.id
    });
  } finally {
    await client.dispose();
    if (old === undefined) delete globalThis.Worker;
    else globalThis.Worker = old;
  }
}
test('partial output arrives before success without settling the inference', () =>
  harness(async (h) => {
    let settled = false;
    h.pending.then(() => (settled = true));
    h.worker.emit(h.id, 'partial', '[0][S01]日本語');
    await Promise.resolve();
    assert.equal(settled, false);
    assert.deepEqual(h.previews, ['[0][S01]日本語']);
    h.worker.emit(h.id, 'result', '[0][S01]日本語[1]');
    assert.equal(await h.pending, '[0][S01]日本語[1]');
  }));
test('a preview consumer failure disables optional rendering without failing recognition', () =>
  harness(
    async (h) => {
      h.worker.emit(h.id, 'partial', 'first');
      h.worker.emit(h.id, 'partial', 'first second');
      h.worker.emit(h.id, 'result', 'first second final');
      assert.equal(await h.pending, 'first second final');
      assert.deepEqual(h.previews, ['first']);
    },
    (previews) => (raw) => {
      previews.push(raw);
      throw new Error('preview renderer failed');
    }
  ));
test('a wrong request ID cannot inject partial text', () =>
  harness(async (h) => {
    h.worker.emit('old', 'partial', 'foreign');
    assert.deepEqual(h.previews, []);
    h.worker.emit(h.id, 'result', '');
    await h.pending;
  }));
test('cancellation ignores late partial and result messages', () =>
  harness(async (h) => {
    const rejected = assert.rejects(h.pending, { name: 'AbortError' });
    h.controller.abort();
    h.worker.emit(h.id, 'partial', 'late');
    h.worker.emit(h.id, 'result', 'late');
    await rejected;
    assert.deepEqual(h.previews, []);
  }));
test('a partial prefix followed by an error is not a successful transcript', () =>
  harness(async (h) => {
    const rejected = assert.rejects(h.pending, /before EOS/);
    h.worker.emit(h.id, 'partial', '[0][S01]一時的');
    h.worker.emit(h.id, 'error', 'MOSS stopped before EOS');
    await rejected;
    assert.equal(h.previews.length, 1);
  }));
for (const value of [null, {}, 'x'.repeat(1024 * 1024 + 1)])
  test(`invalid partial value ${typeof value} is rejected`, () =>
    harness(async (h) => {
      const rejected = assert.rejects(h.pending, /Invalid MOSS output preview/);
      h.worker.emit(h.id, 'partial', value);
      await rejected;
    }));
test('rewritten partial prefix fails instead of appending contradictory text', () =>
  harness(async (h) => {
    const rejected = assert.rejects(h.pending, /Invalid MOSS output preview/);
    h.worker.emit(h.id, 'partial', 'original');
    h.worker.emit(h.id, 'partial', 'replacement');
    await rejected;
    assert.deepEqual(h.previews, ['original']);
  }));
test('late partial messages after success cannot mutate the previous operation', () =>
  harness(async (h) => {
    h.worker.emit(h.id, 'result', 'done');
    await h.pending;
    h.worker.emit(h.id, 'partial', 'late');
    assert.deepEqual(h.previews, []);
  }));

test('final result must agree with the previously emitted token prefix', () =>
  harness(async (h) => {
    const rejected = assert.rejects(h.pending, /prefix|preview/);
    h.worker.emit(h.id, 'partial', '[0][S01]確定候補');
    h.worker.emit(h.id, 'result', '[0][S01]全く別の結果[1]');
    await rejected;
  }));
test('final native ASCII trimming does not falsely reject a matching prefix', () =>
  harness(async (h) => {
    h.worker.emit(h.id, 'partial', ' \n[0][S01]内容[1]\n ');
    h.worker.emit(h.id, 'result', '[0][S01]内容[1]');
    assert.equal(await h.pending, '[0][S01]内容[1]');
  }));

test('native edge trimming cannot erase a word boundary inside the final transcript', () =>
  harness(async (h) => {
    const rejected = assert.rejects(h.pending, /prefix|preview/);
    h.worker.emit(h.id, 'partial', '[0][S01]a ');
    h.worker.emit(h.id, 'result', '[0][S01]apart[1]');
    await rejected;
  }));

const failingObserver = (previews) => (raw) => {
  previews.push(raw);
  throw new Error('optional preview failed');
};
test('disabled preview rendering does not disable worker prefix validation', () =>
  harness(async (h) => {
    const rejected = assert.rejects(h.pending, /Invalid MOSS output preview/);
    h.worker.emit(h.id, 'partial', 'first');
    h.worker.emit(h.id, 'partial', 'contradiction');
    await rejected;
    assert.deepEqual(h.previews, ['first']);
  }, failingObserver));
test('disabled preview rendering does not disable authoritative final validation', () =>
  harness(async (h) => {
    const rejected = assert.rejects(h.pending, /prefix|preview/);
    h.worker.emit(h.id, 'partial', 'first');
    h.worker.emit(h.id, 'partial', 'first second');
    h.worker.emit(h.id, 'result', 'first');
    await rejected;
    assert.deepEqual(h.previews, ['first']);
  }, failingObserver));
test('disabled preview rendering does not suppress cancellation', () =>
  harness(async (h) => {
    const rejected = assert.rejects(h.pending, { name: 'AbortError' });
    h.worker.emit(h.id, 'partial', 'first');
    h.controller.abort();
    h.worker.emit(h.id, 'result', 'first final');
    await rejected;
  }, failingObserver));
test('a failed observer does not retire the warm worker or disable the next observer', () =>
  harness(async (h) => {
    h.worker.emit(h.id, 'partial', 'first');
    h.worker.emit(h.id, 'result', 'first final');
    await h.pending;
    const nextPreviews = [];
    const next = h.client.transcribe(new Float32Array(160), h.controller.signal, (text) =>
      nextPreviews.push(text)
    );
    assert.equal(WorkerDouble.latest, h.worker);
    const nextId = h.worker.last.id;
    assert.notEqual(nextId, h.id);
    h.worker.emit(h.id, 'partial', 'stale');
    h.worker.emit(h.id, 'result', 'stale');
    h.worker.emit(nextId, 'partial', 'second');
    h.worker.emit(nextId, 'result', 'second final');
    assert.equal(await next, 'second final');
    assert.deepEqual(nextPreviews, ['second']);
    assert.deepEqual(h.previews, ['first']);
  }, failingObserver));
