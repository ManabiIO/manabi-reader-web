import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudRequest, listCloudFolder } from '../../.cache/media-test-build/cloud-listing.js';
import { syncMedia } from '../../.cache/media-test-build/sync.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

test('cloud request detaches promptly when its transport ignores abort', async () => {
  const request = deferred();
  const controller = new AbortController();
  const reason = new DOMException('account changed', 'AbortError');
  let started = false;
  const pending = cloudRequest(
    {
      userId: 'user',
      isCurrent: () => true,
      request: () => {
        started = true;
        return request.promise;
      }
    },
    'connections/example/media-info/',
    controller.signal
  );
  await tick();
  assert.equal(started, true);
  let settled = false;
  let rejection;
  pending.catch((error) => {
    settled = true;
    rejection = error;
  });
  controller.abort(reason);
  await tick();
  assert.equal(settled, true, 'caller remained attached to a stalled transport');
  assert.equal(rejection, reason);
  request.resolve({ late: true });
  await pending.catch(() => {});
});

test('sync feed abort does not wait for a stalled request or apply its late result', async () => {
  const request = deferred();
  const controller = new AbortController();
  const reason = new DOMException('signed out', 'AbortError');
  const writes = [];
  const store = {
    local: async () => 0,
    putLocal: async (...args) => writes.push(args),
    accept: async () => {
      throw new Error('late feed was applied');
    },
    records: async () => [],
    prepare: async () => {
      throw new Error('unexpected prepare');
    }
  };
  const pending = syncMedia(
    store,
    { userId: 'user', isCurrent: () => true, request: () => request.promise },
    controller.signal
  );
  await tick();
  let settled = false;
  let rejection;
  pending.catch((error) => {
    settled = true;
    rejection = error;
  });
  controller.abort(reason);
  await tick();
  assert.equal(settled, true, 'sync remained attached to a stalled feed request');
  assert.equal(rejection, reason);
  assert.deepEqual(writes, []);
  request.resolve({ items: [], next_cursor: 0, has_more: false });
  await pending.catch(() => {});
  await tick();
  assert.deepEqual(writes, [], 'a retired feed wrote its late cursor');
});

test('sync mutation abort does not wait for a stalled upload or acknowledge it later', async () => {
  const mutation = deferred();
  const controller = new AbortController();
  const reason = new DOMException('signed out', 'AbortError');
  let requests = 0;
  let acknowledgements = 0;
  const candidate = {
    kind: 'video_resume',
    id: 'resume',
    dirty: true,
    conflict: undefined
  };
  const prepared = {
    ...candidate,
    dirty: false,
    pending: { request: { mutation_id: 'mutation-1' } }
  };
  let recordReads = 0;
  const store = {
    local: async () => 0,
    putLocal: async () => {},
    accept: async () => {},
    records: async () => (++recordReads === 1 ? [candidate] : [prepared]),
    prepare: async () => prepared,
    ack: async () => {
      acknowledgements++;
    },
    conflict: async () => {
      throw new Error('unexpected conflict');
    }
  };
  const transport = {
    userId: 'user',
    isCurrent: () => true,
    request: async () => {
      requests++;
      if (requests === 1) return { items: [], next_cursor: 0, has_more: false };
      return mutation.promise;
    }
  };
  const pending = syncMedia(store, transport, controller.signal);
  for (let n = 0; n < 20 && requests < 2; n++) await tick();
  assert.equal(requests, 2);
  let settled = false;
  let rejection;
  pending.catch((error) => {
    settled = true;
    rejection = error;
  });
  controller.abort(reason);
  await tick();
  assert.equal(settled, true, 'sync remained attached to a stalled mutation request');
  assert.equal(rejection, reason);
  mutation.resolve({ accepted: true, mutation_id: 'mutation-1', record: {} });
  await pending.catch(() => {});
  await tick();
  assert.equal(acknowledgements, 0, 'retired upload was acknowledged after sign-out');
});

test('cloud request keeps the admitted user identity across a delayed response', async () => {
  const response = deferred();
  const transport = {
    userId: 'old-user',
    isCurrent: () => true,
    request(_path, options) {
      assert.equal(options.userId, 'old-user');
      return response.promise;
    }
  };
  const pending = cloudRequest(
    transport,
    'connections/example/media-info/',
    new AbortController().signal
  );
  await tick();
  transport.userId = 'new-user';
  response.resolve({ ok: true });
  await assert.rejects(pending, /Account changed/);
});

test('paginated cloud listing cannot continue an old connection under a new user', async () => {
  let requests = 0;
  const transport = {
    userId: 'old-user',
    isCurrent: () => true,
    async request(_path, options) {
      requests++;
      if (requests === 1) {
        assert.equal(options.userId, 'old-user');
        return {
          items: [],
          get cursor() {
            transport.userId = 'new-user';
            return 'next';
          }
        };
      }
      throw new Error('old connection was requested under the replacement user');
    }
  };
  await assert.rejects(
    listCloudFolder(
      transport,
      {
        id: '11111111-1111-4111-8111-111111111111',
        provider: 'fixture',
        roots: ['root'],
        needs_reconnect: false
      },
      'root',
      '',
      new AbortController().signal
    ),
    /Account changed/
  );
  assert.equal(requests, 1);
});

test('sync snapshots its user before a stalled feed resolves', async () => {
  const feed = deferred();
  const writes = [];
  const transport = {
    userId: 'old-user',
    isCurrent: () => true,
    request(_path, options) {
      assert.equal(options.userId, 'old-user');
      return feed.promise;
    }
  };
  const store = {
    local: async () => 0,
    putLocal: async (...args) => writes.push(args),
    accept: async () => {
      throw new Error('changed-account feed was applied');
    },
    records: async () => [],
    prepare: async () => {
      throw new Error('unexpected prepare');
    }
  };
  const pending = syncMedia(store, transport, new AbortController().signal);
  await tick();
  transport.userId = 'new-user';
  feed.resolve({ items: [], next_cursor: 0, has_more: false });
  await assert.rejects(pending, /signed-in account changed/);
  assert.deepEqual(writes, []);
});

test('sync error reporting preserves the network failure if isCurrent throws', async () => {
  const network = new Error('network failed');
  let requestFailed = false;
  let requests = 0;
  const transport = {
    userId: 'user',
    isCurrent() {
      if (requestFailed) throw new Error('current-account predicate failed');
      return true;
    },
    request: async () => {
      requests++;
      requestFailed = true;
      throw network;
    }
  };
  const store = {
    local: async () => 0,
    putLocal: async () => {},
    accept: async () => {},
    records: async () => [],
    prepare: async () => {
      throw new Error('unexpected prepare');
    }
  };
  await assert.rejects(
    syncMedia(store, transport, new AbortController().signal),
    (error) => error === network
  );
  assert.equal(requests, 1, 'the network failure must actually be reached');
});

test('throwing sync status observer cannot abort durable synchronization', async () => {
  const writes = [];
  const store = {
    local: async () => 0,
    putLocal: async (...args) => writes.push(args),
    accept: async () => {},
    records: async () => [],
    prepare: async () => {
      throw new Error('unexpected prepare');
    }
  };
  const transport = {
    userId: 'user',
    isCurrent: () => true,
    request: async () => ({ items: [], next_cursor: 0, has_more: false })
  };
  await syncMedia(store, transport, new AbortController().signal, () => {
    throw new Error('broken status UI');
  });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].slice(0, 3), ['account:user', 'sync', 'cursor']);
});

test('throwing sync error observer cannot replace the transport failure', async () => {
  const network = new Error('network unavailable');
  const store = {
    local: async () => 0,
    putLocal: async () => {},
    accept: async () => {},
    records: async () => [],
    prepare: async () => {
      throw new Error('unexpected prepare');
    }
  };
  await assert.rejects(
    syncMedia(
      store,
      {
        userId: 'user',
        isCurrent: () => true,
        request: async () => {
          throw network;
        }
      },
      new AbortController().signal,
      () => {
        throw new Error('broken status UI');
      }
    ),
    (error) => error === network
  );
});
