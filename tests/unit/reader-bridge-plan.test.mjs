/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { planReaderBridge } from '../../apps/web/src/lib/manabi/reader-bridge-plan.ts';

const a = 'a'.repeat(64),
  b = 'b'.repeat(64),
  c = 'c'.repeat(64);
const day = 'statistics/2026-10-22';
const otherDay = 'statistics/2026-10-21';
function snapshot(records = {}, overrides = {}) {
  return {
    binding: 'account/connection/root/book-id',
    generation: 'connection-generation-1',
    profile: 'ttu-1-6',
    fingerprint: 'f'.repeat(64),
    revision: 'observed-revision',
    records,
    ...overrides
  };
}
function input(local = {}, remote = {}, base, overrides = {}) {
  return {
    local: snapshot(local, { revision: 'local-2' }),
    remote: { state: 'available', snapshot: snapshot(remote, { revision: 'provider-2' }) },
    ...(base ? { baseline: { local: snapshot(base), remote: snapshot(base) } } : {}),
    direction: 'both',
    writeCapability: 'conditional-recoverable',
    ...overrides
  };
}
function noMutation(plan) {
  assert.deepEqual(plan.pull, []);
  assert.deepEqual(plan.push, []);
  assert.deepEqual(plan.acknowledge, []);
}

test('first connection previews divergent resume positions instead of choosing the later clock', () => {
  const plan = planReaderBridge(input({ resume: a }, { resume: b }));
  assert.equal(plan.state, 'review');
  assert.deepEqual(plan.conflicts, [{ key: 'resume', reason: 'initial-difference' }]);
  noMutation(plan);
});

test('distinct days combine but one concurrently edited daily total blocks the whole book', () => {
  const independent = planReaderBridge(input({ [day]: a }, { [otherDay]: b }));
  assert.deepEqual(independent.push, [day]);
  assert.deepEqual(independent.pull, [otherDay]);
  const conflict = planReaderBridge(input({ [day]: b }, { [day]: c, [otherDay]: b }, { [day]: a }));
  assert.deepEqual(conflict.conflicts, [{ key: day, reason: 'both-changed' }]);
  noMutation(conflict); // No sum, max, or timestamp winner for cumulative totals.
});

test('replayed remote totals and observed echoes do not create another outgoing contribution', () => {
  const pull = planReaderBridge(input({ [day]: a }, { [day]: b }, { [day]: a }));
  assert.deepEqual(pull.pull, [day]);
  assert.deepEqual(pull.acknowledge, []); // Applying is still required.
  const accepted = input({ [day]: b }, { [day]: b }, { [day]: b });
  for (let i = 0; i < 10; i++) {
    const replay = planReaderBridge(accepted);
    assert.deepEqual(replay.push, []);
    assert.deepEqual(replay.pull, []);
    assert.deepEqual(replay.acknowledge, [day]);
  }
});

test('a one-sided resume change can move backwards; both changed positions require review', () => {
  const plan = planReaderBridge(input({ resume: a }, { resume: b }, { resume: a }));
  assert.deepEqual(plan.pull, ['resume']);
  const conflict = planReaderBridge(input({ resume: b }, { resume: c }, { resume: a }));
  assert.equal(conflict.state, 'review');
  noMutation(conflict);
});

test('missing, inaccessible, unknown-version and unstable remote observations never reset data', () => {
  for (const state of ['missing', 'unreadable', 'unsupported', 'unstable']) {
    const plan = planReaderBridge(input({ resume: b }, {}, { resume: a }, { remote: { state } }));
    assert.equal(plan.state, 'paused');
    assert.equal(plan.reason, `remote-${state}`);
    noMutation(plan);
  }
});

test('missing rows on either side, including both sides, are not inferred tombstones', () => {
  for (const [local, remote] of [
    [{}, { [day]: a }],
    [{ [day]: a }, {}],
    [{}, {}]
  ]) {
    const plan = planReaderBridge(input(local, remote, { [day]: a }));
    assert.equal(plan.state, 'review');
    assert.deepEqual(plan.conflicts, [{ key: day, reason: 'removed' }]);
    noMutation(plan);
  }
});

test('receive-only preserves unsent local intent while allowing independent incoming days', () => {
  const plan = planReaderBridge(
    input(
      { resume: b },
      { resume: a, [day]: c },
      { resume: a },
      {
        direction: 'receive',
        writeCapability: undefined
      }
    )
  );
  assert.deepEqual(plan.pending, ['resume']);
  assert.deepEqual(plan.push, []);
  assert.deepEqual(plan.pull, [day]);
  assert.deepEqual(plan.acknowledge, []);
});

test('read access alone never authorizes a remote write or acknowledgement', () => {
  const plan = planReaderBridge(
    input(
      { resume: b },
      { resume: a },
      { resume: a },
      {
        writeCapability: undefined
      }
    )
  );
  assert.equal(plan.reason, 'write-adapter-not-qualified');
  noMutation(plan);
  const pull = planReaderBridge(
    input(
      { resume: a },
      { resume: b },
      { resume: a },
      {
        writeCapability: undefined
      }
    )
  );
  assert.deepEqual(pull.pull, ['resume']);
});

test('unknown upload outcome pauses even if a fresh snapshot appears to match', () => {
  const plan = planReaderBridge(
    input(
      { resume: b },
      { resume: b },
      { resume: a },
      {
        uncertainWrite: true
      }
    )
  );
  assert.equal(plan.reason, 'reconcile-uncertain-write');
  noMutation(plan);
});

test('connection/account/root generation and content identity cannot silently rebind a plan', () => {
  for (const overrides of [
    { binding: 'other-account/root/book' },
    { generation: 'reconnected' },
    { fingerprint: a },
    { profile: 'yatsu-1-11' }
  ]) {
    const fixture = input({ resume: a }, { resume: b }, { resume: a });
    Object.assign(fixture.remote.snapshot, overrides);
    const plan = planReaderBridge(fixture);
    assert.equal(plan.reason, 'binding-or-content-changed');
    noMutation(plan);
  }
  const fixture = input({ resume: a }, { resume: a }, { resume: a });
  fixture.baseline.remote.binding = 'old-connection';
  assert.equal(planReaderBridge(fixture).reason, 'baseline-does-not-match');
});

test('invalid projections, unknown extensions and unsupported versions fail closed', () => {
  for (const bad of [
    snapshot({ resume: 'not-a-digest' }),
    snapshot({ 'statistics/2026-02-30': a }),
    snapshot({ 'notes/unknown-extension': a }),
    snapshot({}, { profile: 'yatsu-1-12' }),
    snapshot({}, { revision: '' }),
    snapshot({}, { fingerprint: '' }),
    snapshot([])
  ]) {
    const plan = planReaderBridge({ ...input(), remote: { state: 'available', snapshot: bad } });
    assert.equal(plan.reason, 'invalid-remote-snapshot');
    noMutation(plan);
  }
});

test('qualified Yatsu projections use the same conservative rules without claiming a live adapter', () => {
  const fixture = input({ resume: a }, { resume: b }, { resume: a });
  for (const side of [
    fixture.local,
    fixture.remote.snapshot,
    fixture.baseline.local,
    fixture.baseline.remote
  ])
    side.profile = 'yatsu-1-11';
  assert.deepEqual(planReaderBridge(fixture).pull, ['resume']);
});

test('a write plan names both observed revisions and does not acknowledge its own proposal', () => {
  const fixture = input({ resume: b }, { resume: a }, { resume: a });
  const untouched = structuredClone(fixture);
  const plan = planReaderBridge(fixture);
  assert.deepEqual(plan.push, ['resume']);
  assert.deepEqual(plan.acknowledge, []);
  assert.deepEqual(plan.precondition, {
    binding: fixture.local.binding,
    generation: fixture.local.generation,
    local: 'local-2',
    remote: 'provider-2'
  });
  assert.deepEqual(fixture, untouched);
});

test('inherited records are rejected and null-prototype projections remain valid', () => {
  const inherited = snapshot(Object.assign(Object.create({ resume: a }), { [day]: b }));
  const plan = planReaderBridge({
    ...input(),
    remote: { state: 'available', snapshot: inherited }
  });
  assert.equal(plan.reason, 'invalid-remote-snapshot');
  noMutation(plan);
  const records = Object.assign(Object.create(null), { resume: a });
  assert.deepEqual(planReaderBridge(input(records, records)).acknowledge, ['resume']);
});

test('unresolved baseline differences never disappear as unchanged synchronized state', () => {
  for (const remote of [{ resume: b }, {}]) {
    const fixture = input({ resume: a }, remote);
    fixture.baseline = { local: snapshot({ resume: a }), remote: snapshot(remote) };
    const plan = planReaderBridge(fixture);
    assert.equal(plan.reason, 'baseline-not-converged');
    noMutation(plan);
  }
});
