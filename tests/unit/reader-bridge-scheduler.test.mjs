/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { build } from 'esbuild';
const { outputFiles } = await build({
  entryPoints: ['apps/web/src/lib/manabi/reader-bridge-scheduler.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node'
});
const { createReaderBridgeScheduler, READER_BRIDGE_SCHEDULE: policy } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
);
const record = (id, receive = false) => ({
  id,
  revision: 'v1',
  state: 'linked',
  automaticChecks: true,
  automaticReceive: receive
});
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function fixture(rows, overrides = {}) {
  const calls = [],
    received = [],
    publications = [];
  let now = 0;
  const scheduler = createReaderBridgeScheduler({
    now: () => now,
    list: async () => rows,
    observe: async (row) => {
      calls.push(row.id);
      return { state: 'changed', observedAt: 'observed', observedRevision: 'remote-v1' };
    },
    receive: async (row) => {
      received.push(row.id);
      return { state: 'received', observedAt: 'received' };
    },
    publish: (state) => publications.push(structuredClone(state)),
    ...overrides
  });
  return {
    scheduler,
    calls,
    received,
    publications,
    advance: (ms) => {
      now += ms;
    },
    latest: () => publications.at(-1)
  };
}
test('only opted-in linked books run, at most five per pass, with fair rotation', async () => {
  const rows = Array.from({ length: 12 }, (_, i) => record(String(i)));
  rows.push(
    { ...record('restored'), state: 'restored' },
    { ...record('off'), automaticChecks: false },
    { id: 'legacy', revision: 'v1', state: 'linked' }
  );
  const h = fixture(rows);
  await h.scheduler.tick();
  assert.equal(h.calls.length, 5);
  await h.scheduler.tick();
  assert.equal(h.calls.length, 10);
  await h.scheduler.tick();
  assert.equal(h.calls.length, 12);
  await h.scheduler.tick();
  assert.equal(h.calls.length, 12);
  assert.equal(new Set(h.calls).size, 12);
  h.advance(policy.interval);
  await h.scheduler.tick();
  assert.equal(h.calls.length, 17);
  assert.equal(h.received.length, 0);
});
test('safe receive is separately opted in and bounded to one full comparison per pass', async () => {
  const h = fixture([record('one', true), record('two', true), record('check-only')]);
  await h.scheduler.tick();
  assert.deepEqual(h.received, ['one']);
  await h.scheduler.tick();
  assert.deepEqual(h.received, ['one', 'two']);
  h.advance(policy.interval);
  await h.scheduler.tick();
  assert.deepEqual(
    h.received,
    ['one', 'two'],
    'Already received remote content is not downloaded repeatedly'
  );
});
test('overlapping timers coalesce and stopping drops delayed results', async () => {
  const hold = deferred();
  let signal;
  const h = fixture([record('one')], {
    observe: async (_row, cancellation) => {
      signal = cancellation;
      return hold.promise;
    }
  });
  const first = h.scheduler.tick();
  await Promise.resolve();
  await h.scheduler.tick();
  assert.ok(signal);
  h.scheduler.stop();
  assert.equal(signal.aborted, true);
  const count = h.publications.length;
  hold.resolve({ state: 'changed', observedAt: 'late', observedRevision: 'v2' });
  await first;
  assert.equal(h.publications.length, count);
  assert.deepEqual(h.latest(), {});
});
test('errors back off, honor Retry-After and do not block another book', async () => {
  let attempts = 0;
  const h = fixture([record('failed'), record('good')], {
    observe: async (row) => {
      if (row.id === 'failed') {
        attempts++;
        throw { retryAfter: 900 };
      }
      return { state: 'unchanged', observedAt: 'now', observedRevision: 'v1' };
    }
  });
  await h.scheduler.tick();
  assert.equal(h.latest().failed.state, 'retry');
  assert.equal(h.latest().good.state, 'unchanged');
  h.advance(policy.interval);
  await h.scheduler.tick();
  assert.equal(attempts, 1);
  h.advance(600_000);
  await h.scheduler.tick();
  assert.equal(attempts, 2);
  h.advance(900_000);
  await h.scheduler.tick();
  assert.equal(attempts, 3);
  h.advance(900_000);
  await h.scheduler.tick();
  assert.equal(attempts, 3, 'Exponential backoff exceeds earlier Retry-After');
});
test('lost consent and changed revisions erase stale status and refresh without timer bypass', async () => {
  const rows = [record('one', true)];
  const h = fixture(rows);
  await h.scheduler.tick();
  rows[0].revision = 'v2';
  rows[0].automaticReceive = false;
  await h.scheduler.tick();
  assert.equal(h.latest().one.revision, 'v2');
  assert.equal(h.received.length, 1);
  rows[0].automaticChecks = false;
  await h.scheduler.tick();
  assert.deepEqual(h.latest(), {});
});
test('invalid or replaced remote identity pauses until a deliberate recheck', async () => {
  let calls = 0;
  const h = fixture([record('one')], {
    observe: async () => {
      calls++;
      throw { code: 'changed' };
    }
  });
  await h.scheduler.tick();
  assert.equal(h.latest().one.state, 'paused');
  h.advance(24 * 60 * 60_000);
  await h.scheduler.tick();
  assert.equal(calls, 1);
  h.scheduler.invalidate();
  await h.scheduler.tick();
  assert.equal(calls, 2);
});
test('review holds do not download the same conflict on every polling pass', async () => {
  let comparisons = 0;
  const h = fixture([record('one', true)], {
    receive: async () => {
      comparisons++;
      return { state: 'review', observedAt: 'now' };
    }
  });
  await h.scheduler.tick();
  h.advance(policy.interval);
  await h.scheduler.tick();
  assert.equal(comparisons, 1);
  assert.equal(h.latest().one.state, 'review');
  h.scheduler.invalidate();
  await h.scheduler.tick();
  assert.equal(comparisons, 2);
});
test('listing failures back off and stop remains final even when listing resolves late', async () => {
  let listings = 0;
  const pending = deferred();
  const h = fixture([], {
    list: () => {
      if (++listings === 1) throw new Error('storage');
      return pending.promise;
    }
  });
  await h.scheduler.tick();
  await h.scheduler.tick();
  assert.equal(listings, 1);
  h.advance(policy.interval);
  const flight = h.scheduler.tick();
  h.scheduler.stop();
  pending.resolve([record('late')]);
  await flight;
  assert.deepEqual(h.calls, []);
});

test('a transient metadata error cannot turn a known conflict into an unchanged receipt', async () => {
  let observations = 0;
  let comparisons = 0;
  const h = fixture([record('one', true)], {
    observe: async () => {
      if (++observations === 2) throw new Error('temporarily offline');
      return { state: 'changed', observedAt: 'now', observedRevision: 'same-cloud' };
    },
    receive: async () => {
      comparisons++;
      return { state: 'review', observedAt: 'now' };
    }
  });
  await h.scheduler.tick();
  h.advance(policy.interval);
  await h.scheduler.tick();
  assert.equal(h.latest().one.state, 'retry');
  h.advance(policy.interval);
  await h.scheduler.tick();
  assert.equal(comparisons, 1);
  assert.equal(h.latest().one.state, 'review');
});

test('cached outcomes expire so another tab can resolve a conflict without changing cloud bytes', async () => {
  let comparisons = 0;
  const h = fixture([record('one', true)], {
    receive: async () => ({
      state: ++comparisons === 1 ? 'review' : 'unchanged',
      observedAt: String(comparisons)
    })
  });
  await h.scheduler.tick();
  h.advance(policy.outcomeLifetime - policy.interval);
  await h.scheduler.tick();
  assert.equal(comparisons, 1);
  h.advance(policy.interval);
  await h.scheduler.tick();
  assert.equal(comparisons, 2);
  assert.equal(h.latest().one.state, 'unchanged');
});

test('cancelled passes never receive a delayed metadata result, even after immediate invalidation', async () => {
  const deferredObservation = deferred();
  const h = fixture([record('one', true)], { observe: () => deferredObservation.promise });
  const pass = h.scheduler.tick();
  await Promise.resolve();
  h.scheduler.invalidate();
  deferredObservation.resolve({ state: 'changed', observedAt: 'late', observedRevision: 'late' });
  await pass;
  assert.deepEqual(h.received, []);
  assert.deepEqual(h.latest(), {});
});

test('one frequently changed book cannot starve other books of the receive budget', async () => {
  const rows = Array.from({ length: policy.perPass }, (_, index) => record(String(index), true));
  let revision = 0;
  const h = fixture(rows, {
    observe: async () => ({
      state: 'changed',
      observedAt: 'now',
      observedRevision: String(revision)
    })
  });
  for (let pass = 0; pass < rows.length; pass++) {
    revision++;
    await h.scheduler.tick();
    h.advance(policy.interval);
  }
  assert.deepEqual(
    h.received,
    rows.map((row) => row.id)
  );
});

for (const changeRemote of [false, true]) {
  test(`a known conflict stays visible when a full comparison is deferred (${changeRemote ? 'new' : 'same'} remote revision)`, async () => {
    let revision = 'remote-v1';
    let resolved = false;
    const comparisons = [];
    const h = fixture([record('one', true), record('two', true)], {
      observe: async () => ({
        state: 'unchanged',
        observedAt: 'observed',
        observedRevision: revision
      }),
      receive: async (row) => {
        comparisons.push(row.id);
        return { state: resolved ? 'unchanged' : 'review', observedAt: 'compared' };
      }
    });
    await h.scheduler.tick();
    await h.scheduler.tick();
    assert.deepEqual(comparisons, ['one', 'two']);
    assert.equal(h.latest().two.state, 'review');

    h.advance(policy.outcomeLifetime);
    if (changeRemote) revision = 'remote-v2';
    await h.scheduler.tick();
    assert.deepEqual(comparisons, ['one', 'two', 'one']);
    assert.equal(h.latest().two.state, 'review', 'Metadata must not clear an unresolved conflict');

    resolved = true;
    await h.scheduler.tick();
    assert.deepEqual(comparisons, ['one', 'two', 'one', 'two']);
    assert.equal(h.latest().two.state, 'unchanged', 'Only a full comparison resolves the conflict');
    assert.equal(h.latest().one.state, 'review');
  });
}
