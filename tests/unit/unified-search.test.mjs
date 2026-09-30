/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as turn } from 'node:timers/promises';
import { queryTask } from '../../apps/web/src/lib/search/query-task.mjs';
const wait = () => new Promise((resolve) => globalThis.setTimeout(resolve, 5));
test('dictionary, titles and content publish independently', async () => {
  const dictionary = [],
    titles = [],
    content = [];
  const a = queryTask((s) => dictionary.push(s)),
    b = queryTask((s) => titles.push(s)),
    c = queryTask((s) => content.push(s));
  const gate = Promise.withResolvers();
  a.start(async (_s, publish) => {
    await gate.promise;
    publish({ state: 'ready', value: 'dictionary' });
  }, 0);
  b.start(async (_s, publish) => publish({ state: 'ready', value: 'titles' }), 0);
  c.start(async () => {
    throw new Error('content unavailable');
  }, 0);
  await wait();
  assert.equal(titles.at(-1).value, 'titles');
  assert.equal(dictionary.at(-1).state, 'loading');
  assert.equal(content.at(-1).state, 'error');
  gate.resolve();
  await wait();
  assert.equal(dictionary.at(-1).value, 'dictionary');
  a.stop();
  b.stop();
  c.stop();
});
test('new query rejects stale success and stale error', async () => {
  for (const reject of [false, true]) {
    const states = [],
      gate = Promise.withResolvers();
    const task = queryTask((s) => states.push(s));
    task.start(async (_s, p) => {
      await gate.promise;
      p({ state: 'ready', value: 'old' });
    }, 0);
    await wait();
    task.start(async (_s, p) => p({ state: 'ready', value: 'new' }), 0);
    await wait();
    if (reject) gate.reject(new Error('old error'));
    else gate.resolve();
    await wait();
    assert.equal(states.at(-1).value, 'new');
    task.stop();
  }
});
test('clear or unmount aborts admission and prevents late publications', async () => {
  const states = [],
    gate = Promise.withResolvers();
  let signal;
  const task = queryTask((s) => states.push(s));
  task.start(async (s, p) => {
    signal = s;
    await gate.promise;
    p({ state: 'ready', value: 'late' });
  }, 0);
  await wait();
  task.stop();
  assert(signal.aborted);
  gate.resolve();
  await wait();
  assert(!states.some((s) => s.value === 'late'));
});
test('late worker cleanup is executed exactly once after cancellation', async () => {
  const gate = Promise.withResolvers();
  let stopped = 0;
  const task = queryTask(() => {});
  task.start(async () => {
    await gate.promise;
    return () => {
      stopped++;
    };
  }, 0);
  await wait();
  task.stop();
  gate.resolve();
  await wait();
  task.stop();
  assert.equal(stopped, 1);
});
test('debounce starts only the latest work', async () => {
  const calls = [];
  const task = queryTask(() => {});
  task.start(() => {
    calls.push('old');
  }, 20);
  task.start(() => {
    calls.push('new');
  }, 0);
  await wait();
  assert.deepEqual(calls, ['new']);
  task.stop();
});
test('streaming partial results survive a sibling source pending state', async () => {
  const states = [];
  const task = queryTask((s) => states.push(s));
  const gate = Promise.withResolvers();
  task.start(async (_s, p) => {
    p({ state: 'loading', value: ['snippet'] });
    await gate.promise;
    p({ state: 'ready', value: ['book', 'snippet'] });
  }, 0);
  await wait();
  assert.deepEqual(states.at(-1).value, ['snippet']);
  gate.resolve();
  await wait();
  assert.deepEqual(states.at(-1).value, ['book', 'snippet']);
  task.stop();
});

async function withTimers(run) {
  const set = globalThis.setTimeout,
    clear = globalThis.clearTimeout,
    queued = [];
  globalThis.setTimeout = (callback) => {
    const timer = { callback, cancelled: false };
    queued.push(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => {
    if (timer) timer.cancelled = true;
  };
  try {
    await run(queued);
  } finally {
    globalThis.setTimeout = set;
    globalThis.clearTimeout = clear;
  }
}

test('a throwing cleanup retires once and cannot block the next query', () =>
  withTimers(async (queued) => {
    const states = [];
    let retired = 0;
    const task = queryTask((state) => states.push(state));
    task.start(() => () => {
      retired++;
      throw new Error('worker cleanup failed');
    });
    await queued[0].callback();
    assert.doesNotThrow(() =>
      task.start((_signal, publish) => publish({ state: 'ready', value: 'next' }))
    );
    await queued[1].callback();
    task.stop();
    task.stop();
    assert.equal(retired, 1);
    assert.equal(states.at(-1).value, 'next');
  }));

test('clearing or replacing loading prevents stale work from being scheduled', () =>
  withTimers(async (queued) => {
    for (const replace of [false, true]) {
      let handled = false,
        oldCalls = 0,
        newCalls = 0;
      const task = queryTask(() => {
        if (handled) return;
        handled = true;
        if (replace) task.start(() => newCalls++);
        else task.stop();
      });
      const before = queued.length;
      task.start(() => oldCalls++);
      const admitted = queued.slice(before);
      assert.equal(admitted.length, replace ? 1 : 0);
      for (const timer of admitted) await timer.callback();
      assert.equal(oldCalls, 0);
      assert.equal(newCalls, replace ? 1 : 0);
      task.stop();
    }
  }));

test('a queued timer cannot admit work after cancellation', () =>
  withTimers(async (queued) => {
    let calls = 0;
    const task = queryTask(() => {});
    task.start(() => calls++);
    task.stop();
    assert.equal(queued[0].cancelled, true);
    // Model a timer callback already queued by the host before clearTimeout.
    await queued[0].callback();
    assert.equal(calls, 0);
  }));

test('late throwing cleanup cannot affect an already completed replacement query', async () => {
  const started = Promise.withResolvers(),
    gate = Promise.withResolvers(),
    replacement = Promise.withResolvers(),
    states = [];
  let retired = 0;
  const task = queryTask((state) => states.push(state));
  task.start(async () => {
    started.resolve();
    await gate.promise;
    return () => {
      retired++;
      throw new Error('late cleanup failed');
    };
  }, 0);
  await started.promise;
  task.start((_signal, publish) => {
    publish({ state: 'ready', value: 'replacement' });
    replacement.resolve();
  }, 0);
  await replacement.promise;
  gate.resolve();
  await turn();
  task.stop();
  assert.equal(retired, 1);
  assert.equal(states.at(-1).value, 'replacement');
});
