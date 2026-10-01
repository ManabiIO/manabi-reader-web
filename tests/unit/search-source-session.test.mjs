/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as turn } from 'node:timers/promises';
import { startSearchSources } from '../../apps/web/src/lib/search/source-session.ts';
import { queryTask } from '../../apps/web/src/lib/search/query-task.mjs';

const batch = (rows, busy = false, extra = {}) => ({
  rows,
  busy,
  failed: 0,
  truncated: false,
  ...extra
});

// Gates describe causal ordering. These cases do not depend on machine load or fixed sleeps.
test('slow source admission does not delay siblings, and admission is not completion', async () => {
  const gate = Promise.withResolvers();
  const states = [];
  const retired = [];
  let book;
  const stop = startSearchSources(
    [
      {
        async start(_signal, receive) {
          book = receive;
          await gate.promise;
          return () => retired.push('book');
        }
      },
      {
        start(_signal, receive) {
          receive(batch(['video']));
          return () => retired.push('video');
        }
      },
      {
        start(_signal, receive) {
          receive(batch(['snippet']));
          return () => retired.push('snippet');
        }
      }
    ],
    new AbortController().signal,
    (state) => states.push(state)
  );
  assert.equal(states.at(-1).state, 'loading');
  assert.deepEqual(states.at(-1).value.rows, ['video', 'snippet']);
  gate.resolve();
  await turn();
  assert.equal(states.at(-1).state, 'loading');
  book(batch(['book-1', 'book-2']));
  assert.deepEqual(states.at(-1), {
    state: 'ready',
    value: { rows: ['book-1', 'video', 'snippet', 'book-2'], failed: 0, truncated: false }
  });
  stop();
  stop();
  assert.deepEqual(retired.sort(), ['book', 'snippet', 'video']);
});

test('completed sources retire promptly while a sibling remains busy', () => {
  const states = [];
  let slowReceive,
    completedReceive,
    retired = 0;
  const stop = startSearchSources(
    [
      {
        start(_signal, receive) {
          completedReceive = receive;
          receive(batch(['done']));
          return () => retired++;
        }
      },
      {
        start(_signal, receive) {
          slowReceive = receive;
          receive(batch(['pending'], true));
        }
      }
    ],
    new AbortController().signal,
    (state) => states.push(state)
  );
  assert.equal(retired, 1);
  assert.equal(states.at(-1).state, 'loading');
  const count = states.length;
  completedReceive(batch(['late'], true));
  assert.equal(states.length, count);
  slowReceive(batch(['finished']));
  assert.equal(states.at(-1).state, 'ready');
  stop();
  assert.equal(retired, 1);
});

test('late async cleanup retires immediately after its source already completed', async () => {
  const gate = Promise.withResolvers();
  let retired = 0;
  const states = [];
  const stop = startSearchSources(
    [
      {
        async start(_signal, receive) {
          receive(batch(['complete']));
          await gate.promise;
          return () => retired++;
        }
      },
      {
        start(_signal, receive) {
          receive(batch(['sibling'], true));
        }
      }
    ],
    new AbortController().signal,
    (state) => states.push(state)
  );
  assert.equal(retired, 0);
  assert.equal(states.at(-1).state, 'loading');
  gate.resolve();
  await turn();
  assert.equal(retired, 1);
  stop();
  assert.equal(retired, 1);
});

test('sync and async source failures retain successful and partial results', async () => {
  const gate = Promise.withResolvers();
  const states = [];
  let late;
  const stop = startSearchSources(
    [
      {
        start() {
          throw new Error('scope unavailable');
        }
      },
      {
        async start(_signal, receive) {
          late = receive;
          receive(batch(['partial'], true, { failed: 2, truncated: true }));
          await gate.promise;
        }
      },
      {
        start(_signal, receive) {
          receive(batch(['successful']));
        }
      }
    ],
    new AbortController().signal,
    (state) => states.push(state)
  );
  assert.equal(states.at(-1).state, 'loading');
  gate.reject(new Error('storage failed after a partial batch'));
  await turn();
  assert.deepEqual(states.at(-1), {
    state: 'ready',
    value: { rows: ['partial', 'successful'], failed: 4, truncated: true }
  });
  const count = states.length;
  late(batch(['resurrected'], true));
  assert.equal(states.length, count);
  stop();
});

test('cancellation retires late admission once and suppresses late batches and errors', async () => {
  for (const reject of [false, true]) {
    const gate = Promise.withResolvers();
    const parent = new AbortController();
    const states = [];
    let late,
      child,
      retired = 0;
    const stop = startSearchSources(
      [
        {
          async start(signal, receive) {
            child = signal;
            late = receive;
            await gate.promise;
            return () => retired++;
          }
        }
      ],
      parent.signal,
      (state) => states.push(state)
    );
    parent.abort();
    const count = states.length;
    assert.equal(child.aborted, true);
    late(batch(['stale']));
    if (reject) gate.reject(new Error('late failure'));
    else gate.resolve();
    await turn();
    stop();
    assert.equal(states.length, count);
    assert.equal(retired, reject ? 0 : 1);
  }
});

test('account changes close the session before another batch can publish', () => {
  let owner = 'alice',
    receive,
    child,
    retired = 0;
  const states = [];
  const stop = startSearchSources(
    [
      {
        start(signal, callback) {
          child = signal;
          receive = callback;
          callback(batch(['alice-result'], true));
          return () => retired++;
        }
      }
    ],
    new AbortController().signal,
    (state) => states.push(state),
    () => {
      if (owner !== 'alice') throw new DOMException('Account changed', 'AbortError');
    }
  );
  owner = 'bob';
  const count = states.length;
  receive(batch(['wrong-account']));
  assert.equal(states.length, count);
  assert.equal(child.aborted, true);
  assert.equal(retired, 1);
  stop();
  assert.equal(retired, 1);
});

test('a throwing session receiver stops before admitting any source', () => {
  let admitted = 0;
  const stop = startSearchSources(
    [
      {
        start() {
          admitted++;
        }
      }
    ],
    new AbortController().signal,
    () => {
      throw new Error('receiver failed');
    }
  );
  assert.equal(admitted, 0);
  assert.doesNotThrow(stop);
});

test('a late session receiver failure retires admitted resources and suppresses later batches', () => {
  let receiveSource,
    retired = 0,
    publications = 0;
  const stop = startSearchSources(
    [
      {
        start(_signal, receive) {
          receiveSource = receive;
          return () => retired++;
        }
      }
    ],
    new AbortController().signal,
    () => {
      publications++;
      if (publications > 1) throw new Error('late receiver failure');
    }
  );
  receiveSource(batch(['first'], true));
  assert.equal(retired, 1);
  const count = publications;
  receiveSource(batch(['late']));
  assert.equal(publications, count);
  stop();
  assert.equal(retired, 1);
});

test('already-cancelled requests never admit a source', () => {
  const parent = new AbortController();
  parent.abort();
  assert.throws(
    () =>
      startSearchSources(
        [
          {
            start() {
              assert.fail('cancelled source admitted');
            }
          }
        ],
        parent.signal,
        () => assert.fail('cancelled result published')
      ),
    { name: 'AbortError' }
  );
});

test('an empty source plan is immediately ready', () => {
  const states = [];
  const stop = startSearchSources([], new AbortController().signal, (state) => states.push(state));
  assert.deepEqual(states, [{ state: 'ready', value: { rows: [], failed: 0, truncated: false } }]);
  stop();
});

test('source snapshots cannot be mutated behind a sibling update', () => {
  const rows = ['original'];
  let sibling;
  const states = [];
  const stop = startSearchSources(
    [
      {
        start(_signal, receive) {
          receive(batch(rows));
        }
      },
      {
        start(_signal, receive) {
          sibling = receive;
        }
      }
    ],
    new AbortController().signal,
    (state) => states.push(state)
  );
  rows.push('unpublished');
  sibling(batch(['sibling']));
  assert.deepEqual(states.at(-1).value.rows, ['original', 'sibling']);
  stop();
});

test('one failed cleanup does not prevent other resources from retiring', async () => {
  const gate = Promise.withResolvers();
  let retired = 0;
  const stop = startSearchSources(
    [
      {
        start() {
          return () => {
            throw new Error('cleanup failure');
          };
        }
      },
      {
        start() {
          return () => retired++;
        }
      },
      {
        async start() {
          await gate.promise;
          return () => {
            retired++;
            throw new Error('late cleanup failure');
          };
        }
      }
    ],
    new AbortController().signal,
    () => {}
  );
  assert.doesNotThrow(stop);
  gate.resolve();
  await turn();
  stop();
  assert.equal(retired, 2);
});

test('query replacement cancels the old session while the new one completes', async () => {
  const gate = Promise.withResolvers();
  const oldStarted = Promise.withResolvers();
  const newStarted = Promise.withResolvers();
  const states = [];
  let oldReceive,
    retired = 0;
  const task = queryTask((state) => states.push(state));
  task.start(
    (signal, publish) =>
      startSearchSources(
        [
          {
            async start(_signal, receive) {
              oldReceive = receive;
              receive(batch(['old-partial'], true));
              oldStarted.resolve();
              await gate.promise;
              return () => retired++;
            }
          }
        ],
        signal,
        publish
      ),
    0
  );
  await oldStarted.promise;
  task.start(
    (signal, publish) =>
      startSearchSources(
        [
          {
            start(_signal, receive) {
              receive(batch(['new-result']));
              newStarted.resolve();
            }
          }
        ],
        signal,
        publish
      ),
    0
  );
  await newStarted.promise;
  oldReceive(batch(['stale-result']));
  gate.resolve();
  await turn();
  assert.deepEqual(states.at(-1).value.rows, ['new-result']);
  assert.equal(retired, 1);
  assert.equal(
    states.some((state) => state.value?.rows.includes('stale-result')),
    false
  );
  task.stop();
});
