/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { searchBodies } from '../../apps/web/src/lib/snippets/search.ts';
import { startSearchSources } from '../../apps/web/src/lib/search/source-session.ts';

function withWorker(run) {
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
    run(Worker, workers);
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

test('change-driven snippet publication skips scan-only batches but keeps failures and completion', () =>
  withWorker((_Worker, workers) => {
    const states = [];
    const stop = searchBodies('猫', ['one'], scope(), (state) => states.push(state), {
      progress: false
    });
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
    workers[0].emit('batch', {
      scanned: 61,
      failed: 1,
      batch: [{ id: 'one', hits: [{ locator: {}, excerpt: '猫 updated', reading: false }] }]
    });
    assert.equal(states.length, 4);
    assert.equal(states.at(-1).hits.get('one')[0].excerpt, '猫 updated');
    workers[0].emit('done', { scanned: 62, failed: 1, batch: [], truncated: false });
    assert.equal(states.length, 5);
    assert.equal(states.at(-1).busy, false);
    assert.equal(states.at(-1).scanned, 62);
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

test('scope invalidation emits one control callback without publishing a stale batch', () =>
  withWorker((_Worker, workers) => {
    let current = true;
    let invalidations = 0;
    const states = [];
    const selected = {
      owner: 'alice',
      guard() {
        if (!current) throw new Error('Scope expired');
      }
    };
    const stop = searchBodies('猫', ['one'], selected, (batch) => states.push(batch), {
      invalidated: () => invalidations++
    });
    workers[0].emit('batch', {
      scanned: 1,
      failed: 0,
      batch: [{ id: 'one', hits: [{ locator: {}, excerpt: '猫', reading: false }] }]
    });
    assert.equal(states.at(-1).hits.get('one')[0].excerpt, '猫');
    const count = states.length;

    current = false;
    workers[0].emit('batch', {
      scanned: 2,
      failed: 0,
      batch: [{ id: 'one', hits: [{ locator: {}, excerpt: 'stale', reading: false }] }]
    });
    workers[0].emit('done', { scanned: 2, failed: 0, batch: [] });

    assert.equal(invalidations, 1);
    assert.equal(states.length, count);
    assert.equal(workers[0].terminated, 1);
    stop();
  }));

test('expired snippet scope settles only that aggregate source and preserves published rows', () =>
  withWorker((_Worker, workers) => {
    let current = true;
    const selected = {
      owner: 'alice',
      guard() {
        if (!current) throw new Error('Scope expired');
      }
    };
    const states = [];
    const stop = startSearchSources(
      [
        {
          start(_signal, receive) {
            let rows = [];
            return searchBodies(
              '猫',
              ['one'],
              selected,
              (batch) => {
                rows = [...batch.hits.values()].flat().map((hit) => hit.excerpt);
                receive({
                  rows,
                  busy: batch.busy,
                  failed: batch.failed,
                  truncated: batch.truncated
                });
              },
              {
                progress: false,
                invalidated: () => receive({ rows, busy: false, failed: 1, truncated: false })
              }
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

    workers[0].emit('batch', {
      scanned: 1,
      failed: 0,
      batch: [{ id: 'one', hits: [{ locator: {}, excerpt: 'snippet', reading: false }] }]
    });
    assert.equal(states.at(-1).state, 'loading');

    current = false;
    workers[0].emit('batch', { scanned: 2, failed: 0, batch: [] });

    assert.deepEqual(states.at(-1), {
      state: 'ready',
      value: { rows: ['snippet', 'video'], failed: 1, truncated: false }
    });
    assert.equal(workers[0].terminated, 1);
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
