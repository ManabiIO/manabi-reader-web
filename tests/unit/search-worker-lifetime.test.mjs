/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { searchBodies } from '../../apps/web/src/lib/snippets/search.ts';
import { searchBookContents } from '../../apps/web/src/lib/search/book-content-source.ts';
import { startSearchSources } from '../../apps/web/src/lib/search/source-session.ts';

async function withWorker(run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const workers = [];
  class Worker {
    static failPost = false;
    constructor() {
      this.terminated = 0;
      workers.push(this);
    }
    postMessage(message) {
      if (Worker.failPost) throw new Error('postMessage failed');
      this.request = message;
    }
    terminate() {
      this.terminated++;
    }
    emit(type, extra = {}) {
      this.onmessage({ data: { requestId: this.request.requestId, type, ...extra } });
    }
  }
  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: Worker
  });
  try {
    return await run(Worker, workers);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'Worker', previous);
    else delete globalThis.Worker;
  }
}
const scope = () => ({ owner: 'alice', guard() {} });

test('completed snippet workers retire once, even after cancellation and late messages', () =>
  withWorker((_Worker, workers) => {
    const states = [];
    const stop = searchBodies('猫', ['one'], scope(), (state) => states.push(state));
    workers[0].emit('done', { scanned: 1, failed: 0, batch: [] });
    assert.equal(states.at(-1).busy, false);
    const count = states.length;
    stop();
    stop();
    workers[0].emit('batch', { batch: [] });
    assert.equal(workers[0].terminated, 1);
    assert.equal(states.length, count);
  }));

test('a failed initial result receiver does not leave a worker alive', () =>
  withWorker((_Worker, workers) => {
    assert.throws(
      () =>
        searchBodies('猫', ['one'], scope(), () => {
          throw new Error('receiver failed');
        }),
      /receiver failed/
    );
    assert.equal(workers[0].terminated, 1);
    assert.equal(workers[0].request, undefined);
  }));

test('change-driven book publication skips progress-only batches but keeps failures and completion', () =>
  withWorker(async (_Worker, workers) => {
    const states = [];
    const stop = await searchBookContents(
      '猫',
      [{ bookId: 1, isPlaceholder: false, contentHash: 'a'.repeat(64) }],
      null,
      new AbortController().signal,
      (state) => states.push(state),
      { progress: false }
    );
    assert.equal(states.length, 0);
    workers[0].emit('progress', { scanned: 1, failed: 0 });
    assert.equal(states.length, 0);
    workers[0].emit('progress', { scanned: 2, failed: 1 });
    assert.equal(states.length, 1);
    assert.equal(states.at(-1).failed, 1);
    workers[0].emit('batch', {
      hits: [
        {
          bookId: 1,
          locator: { resource: { spineIndex: 0 }, start: 0 },
          excerpt: '猫',
          excerptMatch: { start: 0, end: 1 }
        }
      ]
    });
    assert.equal(states.length, 2);
    assert.equal(states.at(-1).hits.length, 1);
    workers[0].emit('done', { scanned: 2, failed: 1, truncated: false });
    assert.equal(states.length, 3);
    assert.equal(states.at(-1).busy, false);
    stop();
  }));

test('change-driven snippet publication skips scan-only batches but keeps failures and completion', () =>
  withWorker((_Worker, workers) => {
    const states = [];
    const stop = searchBodies(
      '猫',
      ['one'],
      scope(),
      (state) => states.push(state),
      { progress: false }
    );
    assert.equal(states.length, 1);
    workers[0].emit('batch', { scanned: 20, failed: 0, batch: [] });
    assert.equal(states.length, 1);
    workers[0].emit('batch', { scanned: 40, failed: 1, batch: [] });
    assert.equal(states.length, 2);
    assert.equal(states.at(-1).failed, 1);
    workers[0].emit('batch', {
      scanned: 60,
      failed: 1,
      batch: [{ id: 'one', hits: [{ locator: {}, excerpt: '猫', reading: false }] }]
    });
    assert.equal(states.length, 3);
    assert.equal(states.at(-1).hits.size, 1);
    workers[0].emit('done', { scanned: 61, failed: 1, batch: [], truncated: false });
    assert.equal(states.length, 4);
    assert.equal(states.at(-1).busy, false);
    assert.equal(states.at(-1).scanned, 61);
    stop();
  }));

test('postMessage failure retires its worker and does not block another search source', () =>
  withWorker((Worker, workers) => {
    Worker.failPost = true;
    const states = [];
    const stop = startSearchSources(
      [
        {
          start(_signal, receive) {
            return searchBodies('猫', ['one'], scope(), (batch) =>
              receive({
                rows: [],
                busy: batch.busy,
                failed: batch.failed,
                truncated: batch.truncated
              })
            );
          }
        },
        {
          start(_signal, receive) {
            receive({ rows: ['video'], busy: false, failed: 0, truncated: false });
          }
        }
      ],
      new AbortController().signal,
      (state) => states.push(state)
    );
    assert.equal(workers[0].terminated, 1);
    assert.deepEqual(states.at(-1), {
      state: 'ready',
      value: { rows: ['video'], failed: 1, truncated: false }
    });
    stop();
  }));

test('account revocation drops queued snippet messages and retires the worker', () =>
  withWorker((_Worker, workers) => {
    let current = true;
    const states = [];
    const selected = {
      owner: 'alice',
      guard() {
        if (!current) throw new Error('Account changed');
      }
    };
    const stop = searchBodies('猫', ['one'], selected, (batch) => states.push(batch));
    const count = states.length;
    current = false;
    workers[0].emit('batch', { batch: [{ id: 'one', hits: ['stale'] }] });
    stop();
    assert.equal(states.length, count);
    assert.equal(workers[0].terminated, 1);
  }));
