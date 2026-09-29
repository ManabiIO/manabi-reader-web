import test from 'node:test';
import assert from 'node:assert/strict';
import { DecodeSessionCache } from '../../.cache/media-test-build/decode-session.js';

const turn = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const outcome = (promise) =>
  promise.then(
    (value) => ({ fulfilled: true, value }),
    (reason) => ({ fulfilled: false, reason })
  );
const reasons = [null, 0, false, new DOMException('owner cancelled', 'AbortError')];

for (const reason of reasons) {
  test(`abort before scheduled open starts no decoder (${String(reason)})`, async () => {
    let opens = 0;
    const cache = new DecodeSessionCache(async () => {
      opens++;
      return { decode: async () => new Float32Array(1), dispose() {} };
    });
    const owner = new AbortController();
    const pending = outcome(cache.decode({ id: 'job' }, 1, 0, 1, owner.signal));
    owner.abort(reason);
    try {
      assert.deepEqual(await pending, { fulfilled: false, reason });
      await turn();
      assert.equal(opens, 0);
    } finally {
      cache.dispose();
    }
  });

  for (const late of ['resolve', 'reject']) {
    test(`abort detaches an active non-cooperating decode before late ${late} (${String(reason)})`, async () => {
      const decoding = deferred(),
        entered = deferred();
      let disposed = 0,
        calls = 0;
      const cache = new DecodeSessionCache(async () => ({
        decode: async () => {
          calls++;
          entered.resolve();
          return await decoding.promise;
        },
        dispose() {
          disposed++;
        }
      }));
      const owner = new AbortController();
      const pending = outcome(cache.decode({ id: 'job' }, 1, 0, 1, owner.signal));
      await entered.promise;
      owner.abort(reason);
      try {
        const first = await Promise.race([pending, turn().then(() => 'still waiting')]);
        assert.deepEqual(first, { fulfilled: false, reason });
        assert.equal(disposed, 1);
        assert.equal(calls, 1);
      } finally {
        if (late === 'resolve') decoding.resolve(new Float32Array([42]));
        else decoding.reject(new Error('late physical decoder failure'));
        await pending;
        await turn();
        cache.dispose();
      }
    });
  }
}

test('cache disposal is terminal and cannot reopen a decoder for a later owner', async () => {
  let opens = 0;
  const cache = new DecodeSessionCache(async () => {
    opens++;
    return { decode: async () => new Float32Array(1), dispose() {} };
  });
  cache.dispose();
  cache.dispose();
  const result = await outcome(cache.decode({ id: 'job' }, 1, 0, 1, new AbortController().signal));
  assert.equal(result.fulfilled, false);
  assert.match(String(result.reason), /closed/i);
  assert.equal(opens, 0);
});

test('cache disposal before scheduled open cancels the caller without creating a decoder', async () => {
  let opens = 0;
  const cache = new DecodeSessionCache(async () => {
    opens++;
    return { decode: async () => new Float32Array(1), dispose() {} };
  });
  const pending = outcome(cache.decode({ id: 'job' }, 1, 0, 1, new AbortController().signal));
  cache.dispose();
  assert.equal((await pending).reason?.name, 'AbortError');
  await turn();
  assert.equal(opens, 0);
});

test('a replacement owner rejects the old decode without waiting for its physical completion', async () => {
  const oldDecode = deferred(),
    entered = deferred();
  let opens = 0,
    disposed = 0;
  const cache = new DecodeSessionCache(async () => {
    const number = ++opens;
    return {
      async decode() {
        if (number === 1) {
          entered.resolve();
          return await oldDecode.promise;
        }
        return new Float32Array([2]);
      },
      dispose() {
        disposed++;
      }
    };
  });
  const first = outcome(cache.decode({ id: 'job' }, 1, 0, 1, new AbortController().signal));
  await entered.promise;
  try {
    const next = await cache.decode({ id: 'job' }, 1, 1, 2, new AbortController().signal);
    assert.deepEqual([...next], [2]);
    const retired = await Promise.race([first, turn().then(() => 'still waiting')]);
    assert.equal(retired.fulfilled, false);
    assert.equal(retired.reason?.name, 'AbortError');
    assert.equal(disposed, 1);
    assert.equal(opens, 2);
  } finally {
    oldDecode.resolve(new Float32Array([1]));
    await first;
    cache.dispose();
  }
});

test('mutable caller job ID cannot leave an aborted session registered', async () => {
  const cache = new DecodeSessionCache(async () => ({
    decode: async () => new Float32Array(1),
    dispose() {}
  }));
  const owner = new AbortController(),
    job = { id: 'original' };
  await cache.decode(job, 1, 0, 1, owner.signal);
  job.id = 'changed-by-caller';
  owner.abort(0);
  try {
    assert.equal(cache.sessions.size, 0);
  } finally {
    cache.dispose();
  }
});
