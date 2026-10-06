import test from 'node:test';
import assert from 'node:assert/strict';
import { BridgeClient } from '../../apps/web/src/platform/bridge-client.ts';
const initial = { session: 'session_123', epoch: 0 };
const reply = (request) => ({ ...request, ok: true, outcome: 'completed', value: 'saved' });
test('fire-and-forget Expo handle receives a separately correlated asynchronous reply', async () => {
  let sent;
  const client = new BridgeClient(
    () => initial,
    (request) => {
      sent = request;
    }
  );
  let settled = false;
  const result = client.request('snapshot').then((value) => {
    settled = true;
    return value;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(client.receive(reply(sent)), true);
  assert.equal((await result).value, 'saved');
  client.dispose();
});
test('foreign session/id replies cannot settle a pending mutation', async () => {
  let sent;
  const client = new BridgeClient(
    () => initial,
    (request) => {
      sent = request;
    }
  );
  const result = client.request('settings', { key: 'fontSize', value: 24 });
  assert.equal(client.receive({ ...reply(sent), session: 'foreign_123' }), false);
  assert.equal(client.receive({ ...reply(sent), id: 'foreign_123' }), false);
  client.receive(reply(sent));
  assert.equal((await result).outcome, 'completed');
  client.dispose();
});
test('late completed replies retain outcome but become stale across account ABA', async () => {
  let scope = initial,
    sent;
  const client = new BridgeClient(
    () => scope,
    (request) => {
      sent = request;
    }
  );
  const result = client.request('settings');
  scope = { ...initial, epoch: 2 };
  client.receive(reply(sent));
  const value = await result;
  assert.equal(value.stale, true);
  assert.equal(value.outcome, 'completed');
  client.dispose();
});
test('send failure and teardown never imply safe automatic mutation replay', async () => {
  const a = new BridgeClient(
    () => initial,
    () => {
      throw new Error('not ready');
    }
  );
  await assert.rejects(a.request('settings'), /not ready/);
  let sent;
  const b = new BridgeClient(
    () => initial,
    (request) => {
      sent = request;
    }
  );
  const pending = b.request('settings');
  b.dispose();
  await assert.rejects(pending, /saved outcome must be reconciled/);
  assert.equal(b.receive(reply(sent)), false);
});
test('reader close has no arbitrary timeout while confirmation is pending', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let sent;
  const client = new BridgeClient(
    () => initial,
    (request) => {
      sent = request;
    }
  );
  let settled = false;
  const pending = client.request('close').then((value) => {
    settled = true;
    return value;
  });
  t.mock.timers.tick(24 * 60 * 60 * 1000);
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(client.receive({ ...reply(sent), value: { allowed: false } }), true);
  assert.deepEqual((await pending).value, { allowed: false });
  client.dispose();
});
test('other bridge methods keep bounded acknowledgement deadlines', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const client = new BridgeClient(
    () => initial,
    () => {}
  );
  const pending = client.request('snapshot');
  const rejected = assert.rejects(pending, /has not acknowledged/);
  t.mock.timers.tick(30000);
  await rejected;
  client.dispose();
});
test('scope retirement settles untimed close with unknown outcome and never replays it', async () => {
  let scope = initial;
  const sent = [];
  const client = new BridgeClient(
    () => scope,
    (request) => sent.push(request)
  );
  const pending = client.request('close');
  const rejected = assert.rejects(pending, /saved outcome is unknown/);
  scope = { ...initial, epoch: 1 };
  client.retireStaleRequests();
  await rejected;
  assert.equal(client.receive({ ...reply(sent[0]), value: { allowed: true } }), false);
  assert.equal(sent.length, 1);
  const active = client.request('snapshot');
  client.retireStaleRequests();
  assert.equal(client.receive(reply(sent[1])), true);
  await active;
  client.dispose();
});
test('provider disposal rejects a close still awaiting confirmation', async () => {
  const client = new BridgeClient(
    () => initial,
    () => {}
  );
  const pending = client.request('close');
  const rejected = assert.rejects(pending, /saved outcome must be reconciled/);
  client.dispose();
  await rejected;
});

test('native chunks use canonical sequenced identities without replacing pending promises', async () => {
  const sent = [];
  const client = new BridgeClient(
    () => initial,
    (input) => sent.push(input)
  );
  const payload = { transferId: 'transfer_123', sequence: 0, data: 'AQ==' };
  const first = client.request('import.chunk', payload);
  assert.equal(sent[0].id, 'import_chunk_transfer_123_0');
  await assert.rejects(client.request('import.chunk', payload), /still awaiting acknowledgement/);
  await assert.rejects(
    client.request('import.chunk', { ...payload, data: 'Ag==' }),
    /still awaiting acknowledgement/
  );
  assert.equal(sent.length, 1);
  assert.equal(client.receive(reply(sent[0])), true);
  assert.equal((await first).outcome, 'completed');
  const next = client.request('import.chunk', { ...payload, sequence: 1 });
  assert.equal(sent[1].id, 'import_chunk_transfer_123_1');
  client.receive(reply(sent[1]));
  await next;
  client.dispose();
});

test('timed-out chunk identities cannot be resent or confused with a delayed acknowledgement', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sent = [];
  const client = new BridgeClient(
    () => initial,
    (input) => sent.push(input)
  );
  const payload = { transferId: 'transfer_123', sequence: 0, data: 'AQ==' };
  const first = client.request('import.chunk', payload);
  const rejected = assert.rejects(first, /has not acknowledged/);
  t.mock.timers.tick(30000);
  await rejected;
  assert.equal(sent.length, 1);
  await assert.rejects(client.request('import.chunk', payload), /already sent/);
  await assert.rejects(
    client.request('import.chunk', { ...payload, data: 'Ag==' }),
    /already sent/
  );
  assert.equal(sent.length, 1);
  assert.equal(client.receive(reply(sent[0])), false);
  client.dispose();
});

test('settled and scope-retired chunk identities cannot capture older replies', async () => {
  let scope = initial;
  const sent = [];
  const client = new BridgeClient(
    () => scope,
    (input) => sent.push(input)
  );
  const payload = { transferId: 'transfer_123', sequence: 0, data: 'AQ==' };
  const first = client.request('import.chunk', payload);
  client.receive(reply(sent[0]));
  await first;
  await assert.rejects(
    client.request('import.chunk', { ...payload, data: 'Ag==' }),
    /already sent/
  );
  const second = client.request('import.chunk', { ...payload, sequence: 1 });
  const retired = assert.rejects(second, /saved outcome is unknown/);
  scope = { ...initial, epoch: 2 };
  client.retireStaleRequests();
  await retired;
  await assert.rejects(client.request('import.chunk', { ...payload, sequence: 1 }), /already sent/);
  assert.equal(client.receive(reply(sent[1])), false);
  const fresh = client.request('import.chunk', { ...payload, transferId: 'transfer_fresh' });
  client.receive(reply(sent[2]));
  await fresh;
  assert.equal(sent.length, 3);
  client.dispose();
});

test('client chunk history is constant per transfer and bounded without forgetting old identities', async () => {
  let sent;
  const client = new BridgeClient(
    () => initial,
    (input) => {
      sent = input;
    }
  );
  for (let sequence = 0; sequence < 2200; sequence++) {
    const pending = client.request('import.chunk', {
      transferId: 'transfer_0',
      sequence,
      data: 'AQ=='
    });
    client.receive(reply(sent));
    await pending;
  }
  assert.equal(client.chunkSequences.size, 1);
  assert.equal(client.chunkSequences.get('transfer_0'), 2199);
  for (let transfer = 1; transfer < 2048; transfer++) {
    const pending = client.request('import.chunk', {
      transferId: `transfer_${transfer}`,
      sequence: 0,
      data: 'AQ=='
    });
    client.receive(reply(sent));
    await pending;
  }
  assert.equal(client.chunkSequences.size, 2048);
  await assert.rejects(
    client.request('import.chunk', { transferId: 'transfer_fresh', sequence: 0, data: 'AQ==' }),
    /history is full/
  );
  await assert.rejects(
    client.request('import.chunk', { transferId: 'transfer_0', sequence: 0, data: 'Ag==' }),
    /already sent/
  );
  client.dispose();
  assert.equal(client.chunkSequences.size, 0);
});
