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
