/** @license BSD-3-Clause — Manabi media integration. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadVerified } from '../../.cache/media-test-build/model-cache.js';
import { digestText } from '../../.cache/media-test-build/hash.js';

// Tiny known bytes exercise transport/publication only, not a real GGUF or MOSS.
const payload = new TextEncoder().encode('GGUFtest model');
const expected = { bytes: payload.length, sha256: digestText('GGUFtest model') };
const signal = () => new AbortController().signal;
function target(override = {}) {
  return {
    writes: 0,
    closed: false,
    aborted: false,
    async write() {
      this.writes++;
    },
    async close() {
      this.closed = true;
    },
    async abort() {
      this.aborted = true;
    },
    ...override
  };
}

for (const synchronous of [false, true])
  test(`HTTP failure preserves its status when writer abort ${synchronous ? 'throws' : 'rejects'}`, async () => {
    let canceled = false;
    const response = new Response(
      new ReadableStream({
        cancel() {
          canceled = true;
          return Promise.reject(Error('cleanup'));
        }
      }),
      { status: 503 }
    );
    const out = target({
      abort() {
        this.aborted = true;
        if (synchronous) throw Error('writer abort');
        return Promise.reject(Error('writer abort'));
      }
    });
    await assert.rejects(
      downloadVerified(response, out, expected, signal()),
      /Model download failed \(503\)/
    );
    assert.equal(canceled, true);
    assert.equal(out.aborted, true);
    assert.equal(out.closed, false);
  });

test('locked response cannot leak an open writer or cancel another reader', async () => {
  let canceled = false;
  const response = new Response(
    new ReadableStream({
      cancel() {
        canceled = true;
      }
    })
  );
  const owner = response.body.getReader(),
    out = target();
  await assert.rejects(downloadVerified(response, out, expected, signal()), TypeError);
  assert.equal(out.aborted, true);
  assert.equal(out.closed, false);
  assert.equal(canceled, false);
  assert.equal(response.body.locked, true);
  await owner.cancel();
  owner.releaseLock();
});

test('empty response body aborts the destination without publishing', async () => {
  const out = target();
  await assert.rejects(
    downloadVerified(new Response(null), out, expected, signal()),
    /Model download failed/
  );
  assert.equal(out.aborted, true);
  assert.equal(out.closed, false);
});

test('already aborted download releases its unread response and destination', async () => {
  const controller = new AbortController();
  controller.abort();
  let canceled = false;
  const response = new Response(
      new ReadableStream({
        cancel() {
          canceled = true;
        }
      })
    ),
    out = target();
  await assert.rejects(downloadVerified(response, out, expected, controller.signal), {
    name: 'AbortError'
  });
  assert.equal(out.aborted, true);
  assert.equal(out.writes, 0);
  assert.equal(canceled, true);
});

test(
  'a stalled stream cancellation cannot hold the failed download open',
  { timeout: 1500 },
  async () => {
    const response = new Response(
      new ReadableStream({
        cancel() {
          return new Promise(() => {});
        }
      }),
      { headers: { 'Content-Length': '999' } }
    );
    const out = target();
    await assert.rejects(
      downloadVerified(response, out, expected, signal()),
      /Unexpected model size/
    );
    assert.equal(out.aborted, true);
    assert.equal(response.body.locked, false);
  }
);

test('failure to commit the verified destination remains visible after cleanup', async () => {
  const original = Error('quota while committing');
  const out = target({
    async close() {
      throw original;
    },
    async abort() {
      this.aborted = true;
      throw Error('already closed');
    }
  });
  const response = new Response(payload);
  await assert.rejects(downloadVerified(response, out, expected, signal()), (e) => e === original);
  assert.equal(out.aborted, true);
  assert.equal(response.body.locked, false);
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const bounded = async (promise) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Operation remained blocked')), 500);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
};

test('writer abort that never settles does not hide HTTP failure', { timeout: 1500 }, async () => {
  let aborted = 0;
  const out = target({
    abort() {
      aborted++;
      return new Promise(() => {});
    }
  });
  await assert.rejects(
    bounded(downloadVerified(new Response(null, { status: 503 }), out, expected, signal())),
    /Model download failed \(503\)/
  );
  assert.equal(aborted, 1);
  assert.equal(out.closed, false);
});

test(
  'Cancel detaches a stalled disk write and never closes or reports late progress',
  { timeout: 1500 },
  async () => {
    const controller = new AbortController(),
      started = deferred(),
      disk = deferred(),
      updates = [];
    const out = target({
      write() {
        this.writes++;
        started.resolve();
        return disk.promise;
      },
      abort() {
        this.aborted = true;
        return new Promise(() => {});
      }
    });
    const result = downloadVerified(new Response(payload), out, expected, controller.signal, (p) =>
      updates.push(p)
    );
    const rejected = assert.rejects(bounded(result), { name: 'AbortError' });
    await started.promise;
    controller.abort();
    await rejected;
    disk.resolve();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(out.writes, 1);
    assert.equal(out.aborted, true);
    assert.equal(out.closed, false);
    assert.deepEqual(updates, []);
  }
);

test('late rejection of an abandoned model write remains observed', { timeout: 1500 }, async () => {
  const controller = new AbortController(),
    started = deferred(),
    disk = deferred();
  const out = target({
    write() {
      started.resolve();
      return disk.promise;
    }
  });
  const result = downloadVerified(new Response(payload), out, expected, controller.signal);
  const rejected = assert.rejects(bounded(result), { name: 'AbortError' });
  await started.promise;
  controller.abort();
  await rejected;
  disk.reject(Error('Late disk failure'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(out.closed, false);
  assert.equal(out.aborted, true);
});

test(
  'late Cancel during verified close does not report download success',
  { timeout: 1500 },
  async () => {
    const controller = new AbortController(),
      closing = deferred(),
      commit = deferred();
    const out = target({
      close() {
        closing.resolve();
        return commit.promise;
      }
    });
    const result = downloadVerified(new Response(payload), out, expected, controller.signal);
    const rejected = assert.rejects(bounded(result), { name: 'AbortError' });
    await closing.promise;
    controller.abort();
    await rejected;
    // The actual filesystem may finish committing fully verified bytes here.
    // We make no rollback claim, but the abandoned call cannot return success.
    commit.resolve();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(out.aborted, true);
  }
);

test(
  'read cancellation cannot leave the pipeline blocked by a noncooperating reader',
  { timeout: 1500 },
  async () => {
    const controller = new AbortController(),
      started = deferred(),
      reading = deferred();
    let released = 0,
      canceled = 0;
    // Explicit transport double, not a real network connection.
    const response = {
      ok: true,
      status: 200,
      headers: new Headers(),
      body: {
        getReader() {
          return {
            read() {
              started.resolve();
              return reading.promise;
            },
            cancel() {
              canceled++;
              return new Promise(() => {});
            },
            releaseLock() {
              released++;
            }
          };
        }
      }
    };
    const out = target(),
      result = downloadVerified(response, out, expected, controller.signal);
    const rejected = assert.rejects(bounded(result), { name: 'AbortError' });
    await started.promise;
    controller.abort();
    await rejected;
    reading.reject(Error('Late transport failure'));
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(canceled > 0);
    assert.equal(released, 1);
    assert.equal(out.writes, 0);
    assert.equal(out.closed, false);
  }
);
