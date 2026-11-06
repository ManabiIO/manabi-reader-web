import assert from 'node:assert/strict';
import test from 'node:test';
import { loadOfflineModule, deferred } from './fixtures/offline-module.mjs';

const create = (overrides = {}) => {
  const { api } = loadOfflineModule('apps/web/src/runtime/browser-storage-status.ts');
  return api.createBrowserStorageStatus({
    capabilities: () => ({ protection: true, request: true, estimate: true }),
    readProtection: async () => false,
    requestProtection: async () => true,
    estimate: async () => ({ usage: 4, quota: 10 }),
    ...overrides
  });
};

test('initial observations are unknown and snapshots stay stable between updates', async () => {
  let requests = 0;
  const model = create({
    requestProtection: async () => {
      requests++;
      return true;
    }
  });
  assert.equal(model.snapshot(), model.snapshot());
  assert.equal(model.snapshot().busy, 'checking');
  assert.equal(model.snapshot().usage, null);
  await model.refresh();
  assert.equal(model.snapshot().protection, 'unconfirmed');
  assert.equal(model.snapshot().usage, 4);
  assert.equal(requests, 0);
});

test('unsupported and partial capabilities never fabricate an estimate', async () => {
  const unsupported = create({
    capabilities: () => ({ protection: false, request: false, estimate: false })
  });
  await unsupported.refresh();
  assert.equal(unsupported.snapshot().protection, 'unavailable');
  assert.equal(unsupported.snapshot().usage, null);
  assert.equal(unsupported.snapshot().quota, null);
  assert.equal(unsupported.snapshot().canRequest, false);
  await unsupported.requestProtection();
  assert.equal(unsupported.snapshot().feedback, 'unavailable');
  const partial = create({
    capabilities: () => ({ protection: false, request: true, estimate: true })
  });
  await partial.refresh();
  assert.equal(partial.snapshot().usage, 4);
  assert.equal(partial.snapshot().canRequest, true);
});

test('failed checks and invalid estimates clear observations without claiming zero usage', async () => {
  const model = create({
    readProtection: async () => {
      throw Error('blocked');
    },
    estimate: async () => {
      throw Error('blocked');
    }
  });
  await model.refresh();
  assert.equal(model.snapshot().feedback, 'check-failed');
  assert.equal(model.snapshot().usage, null);
  for (const estimate of [{ usage: NaN, quota: Infinity }, { usage: -1, quota: 0 }, {}]) {
    const invalid = create({ estimate: async () => estimate });
    await invalid.refresh();
    assert.equal(invalid.snapshot().usage, null);
    assert.equal(invalid.snapshot().quota, null);
  }
  const over = create({ estimate: async () => ({ usage: 20, quota: 10 }) });
  await over.refresh();
  assert.equal(over.snapshot().usage, 20);
});

test('denials are unconfirmed and grant survives an estimate rejection', async () => {
  const denied = create({ requestProtection: async () => false });
  await denied.requestProtection();
  assert.equal(denied.snapshot().protection, 'unconfirmed');
  assert.equal(denied.snapshot().feedback, 'not-granted');
  const granted = create({
    estimate: async () => {
      throw Error('blocked');
    }
  });
  await granted.requestProtection();
  assert.equal(granted.snapshot().protection, 'protected');
  assert.equal(granted.snapshot().feedback, 'granted');
  assert.equal(granted.snapshot().usage, null);
});

test('request starts synchronously, preempts a check, and coalesces concurrent actions', async () => {
  const probe = deferred(),
    permission = deferred(),
    estimate = deferred();
  let requests = 0,
    estimates = 0;
  const model = create({
    readProtection: () => probe.promise,
    requestProtection: () => {
      requests++;
      return permission.promise;
    },
    estimate: () => {
      estimates++;
      return estimates === 1 ? estimate.promise : Promise.resolve({ usage: 7, quota: 10 });
    }
  });
  const check = model.refresh();
  const request = model.requestProtection();
  assert.equal(requests, 1);
  assert.equal(model.requestProtection(), request);
  assert.equal(model.refresh(), request);
  probe.resolve(false);
  estimate.resolve({ usage: 1, quota: 2 });
  await check;
  assert.equal(model.snapshot().busy, 'requesting');
  assert.equal(model.snapshot().usage, null);
  permission.resolve(true);
  await request;
  assert.equal(model.snapshot().protection, 'protected');
  assert.equal(model.snapshot().usage, 7);
  assert.equal(model.snapshot().busy, null);
});

test('a check completing after a grant cannot overwrite it', async () => {
  const probe = deferred();
  const model = create({ readProtection: () => probe.promise });
  const check = model.refresh();
  await model.requestProtection();
  probe.resolve(false);
  await check;
  assert.equal(model.snapshot().protection, 'protected');
  assert.equal(model.snapshot().feedback, 'granted');
});

test('dispose invalidates pending work and subscriptions without resurrection', async () => {
  const permission = deferred();
  let estimates = 0,
    events = 0;
  const model = create({
    requestProtection: () => permission.promise,
    estimate: async () => {
      estimates++;
      return {};
    }
  });
  model.subscribe(() => events++);
  const request = model.requestProtection();
  model.dispose();
  const snapshot = model.snapshot(),
    count = events;
  permission.resolve(true);
  await request;
  await model.refresh();
  await model.requestProtection();
  model.subscribe(() => events++);
  assert.equal(model.snapshot(), snapshot);
  assert.equal(events, count);
  assert.equal(estimates, 0);
});

test('synchronous dependency failures are contained', async () => {
  const model = create({
    requestProtection: () => {
      throw Error('blocked');
    }
  });
  await model.requestProtection();
  assert.equal(model.snapshot().feedback, 'unavailable');
  assert.equal(model.snapshot().busy, null);
  const unavailable = create({
    capabilities: () => {
      throw Error('blocked');
    }
  });
  await unavailable.refresh();
  assert.equal(unavailable.snapshot().protection, 'unavailable');
});
