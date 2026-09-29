import test from 'node:test';
import assert from 'node:assert/strict';
import { ProfileLifetime } from '../../.cache/media-test-build/profile-lifetime.js';

function deferred() {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function connection(id) {
  return { id };
}
function workspace(initial, log, disposed) {
  return {
    initial,
    setConnection(value) {
      log.push(value?.id ?? null);
    },
    async dispose() {
      disposed.push(initial?.id ?? null);
    }
  };
}

test('same-account available refresh updates connection without transient revocation', async () => {
  const calls = [],
    disposed = [],
    mounted = [];
  const lifetime = new ProfileLifetime(
    async () => null,
    (_scope, value) => {
      mounted.push(value?.id ?? null);
      return workspace(value, calls, disposed);
    },
    (error) => {
      throw error;
    }
  );
  await lifetime.update({ status: 'available', userId: 'u', connection: connection('u:1') });
  calls.length = 0;
  await lifetime.update({
    status: 'available',
    userId: 'u',
    connection: connection('u:1-refresh')
  });
  assert.deepEqual(mounted, ['u:1']);
  assert.equal(disposed.length, 0);
  assert.deepEqual(calls, ['u:1-refresh', 'u:1-refresh']);
  assert.equal(calls.includes(null), false);
  await lifetime.stop();
});

test('changed account revokes old connection before asynchronous teardown', async () => {
  const calls = [],
    disposed = [],
    gate = deferred();
  let mounts = 0;
  const lifetime = new ProfileLifetime(
    async () => {
      await gate.promise;
      return null;
    },
    (_scope, value) => {
      mounts++;
      return workspace(value, calls, disposed);
    },
    (error) => {
      throw error;
    }
  );
  await lifetime.update({ status: 'available', userId: 'one', connection: connection('one:1') });
  calls.length = 0;
  const changing = lifetime.update({
    status: 'available',
    userId: 'two',
    connection: connection('two:1')
  });
  assert.deepEqual(calls, [null]);
  await changing;
  assert.equal(mounts, 2);
  assert.deepEqual(disposed, ['one:1']);
  gate.resolve();
  await lifetime.stop();
});

test('unavailable same account revokes network authority immediately', async () => {
  const calls = [],
    disposed = [];
  const lifetime = new ProfileLifetime(
    async () => null,
    (_scope, value) => workspace(value, calls, disposed),
    (error) => {
      throw error;
    }
  );
  await lifetime.update({ status: 'available', userId: 'u', connection: connection('u:1') });
  calls.length = 0;
  await lifetime.update({ status: 'unavailable', userId: 'u' });
  assert.deepEqual(calls, [null, null]);
  assert.equal(disposed.length, 0);
  await lifetime.stop();
});
