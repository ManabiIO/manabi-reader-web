/** Production algorithms, with explicit OPFS/Worker/storage doubles. No ASR claims. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { MOSS, getModel } from '../../.cache/media-test-build/model-cache.js';
import { DeviceCheckpoints } from '../../.cache/media-test-build/device-checkpoint.js';
import { MossClient } from '../../.cache/media-test-build/moss-client.js';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const bounded = async (promise) => {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Cancellation remained blocked')), 500);
      })]);
  }
  finally {
    clearTimeout(timer);
  }
};
test('MOSS remains the selected immutable Mudler Q5_0 artifact, without another model', () => {
  assert.equal(MOSS.repository, 'mudler/moss-transcribe.cpp-gguf');
  assert.equal(MOSS.filename, 'moss-transcribe-q5_0.gguf');
  assert.equal(MOSS.quantization, 'q5_0');
  assert.equal(MOSS.bytes, 648174592);
  assert.equal(MOSS.sha256, '7e9ce1de5648ed49fc5c4f5e003d61a7421a63c14074f7275dc8a8cc664ff865');
  assert.equal(MOSS.revision, '54e4bbd17da3f84adf1c1bcf7791b9b9266f741e');
  assert.ok(Object.isFrozen(MOSS));
});
async function cacheHarness(body) {
  const storage = Object.getOwnPropertyDescriptor(navigator, 'storage');
  const locks = Object.getOwnPropertyDescriptor(navigator, 'locks');
  const oldFetch = globalThis.fetch;
  const calls = [];
  const writer = { async abort() { calls.push('abort'); }, async close() { calls.push('close'); }, async write() { calls.push('write'); } };
  const file = { async createWritable() { calls.push('open-writer'); return writer; }, async getFile() { return new File([], 'empty'); } };
  const dir = {
    async getDirectoryHandle() { return dir; },
    async getFileHandle(_name, options) {
      if (!options?.create)
        throw new DOMException('Not found', 'NotFoundError');
      return file;
    }
  };
  const mock = { async getDirectory() { return dir; }, async estimate() { return { quota: 2e9, usage: 0 }; } };
  Object.defineProperty(navigator, 'storage', { configurable: true, value: mock });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  globalThis.fetch = async () => { calls.push('fetch'); throw Error('Unexpected model network request'); };
  try {
    await body({ mock, dir, file, writer, calls });
  }
  finally {
    globalThis.fetch = oldFetch;
    for (const [name, previous] of [['storage', storage], ['locks', locks]]) {
      if (previous)
        Object.defineProperty(navigator, name, previous);
      else
        delete navigator[name];
    }
  }
}
test('Cancel during OPFS directory lookup stops preparation and prevents a late download', () => cacheHarness(async ({ mock, calls }) => {
  const opened = deferred(), controller = new AbortController();
  mock.getDirectory = () => opened.promise;
  const promise = getModel(controller.signal, () => { });
  const rejected = assert.rejects(bounded(promise), { name: 'AbortError' });
  controller.abort();
  try {
    await rejected;
    assert.deepEqual(calls, []);
  }
  finally {
    opened.resolve({ getDirectoryHandle() { calls.push('late-directory'); } });
    await tick();
  }
  assert.deepEqual(calls, []);
}));
test('Cancel during quota estimation stops before opening a writable stream', () => cacheHarness(async ({ mock, calls }) => {
  const estimate = deferred(), reached = deferred(), controller = new AbortController();
  mock.estimate = () => { reached.resolve(); return estimate.promise; };
  const promise = getModel(controller.signal, () => { });
  await reached.promise;
  const rejected = assert.rejects(bounded(promise), { name: 'AbortError' });
  controller.abort();
  try {
    await rejected;
  }
  finally {
    estimate.resolve({ quota: 2e9, usage: 0 });
    await tick();
  }
  assert.deepEqual(calls, []);
}));
test('a writable stream opened after Cancel is aborted without fetching or committing', () => cacheHarness(async ({ file, writer, calls }) => {
  const opening = deferred(), reached = deferred(), controller = new AbortController();
  file.createWritable = () => { reached.resolve(); return opening.promise; };
  const promise = getModel(controller.signal, () => { });
  await reached.promise;
  const rejected = assert.rejects(bounded(promise), { name: 'AbortError' });
  controller.abort();
  try {
    await rejected;
  }
  finally {
    opening.resolve(writer);
    await tick();
  }
  assert.deepEqual(calls, ['abort']);
}));
test('failed fetch closes preparation without waiting indefinitely for writer abort', () => cacheHarness(async ({ writer, calls }) => {
  writer.abort = () => { calls.push('abort'); return new Promise(() => { }); };
  await assert.rejects(bounded(getModel(new AbortController().signal, () => { })), /Unexpected model network request/);
  assert.deepEqual(calls, ['open-writer', 'fetch', 'abort']);
}));
const deviceKey = 'sampled-v1:' + 'a'.repeat(64);
const snapshot = position => ({ version: 1, position, duration: 2001, rate: 1, finished: false, updatedAt: position + 1 });
test('2,000 stalled device checkpoints retain just the active and latest write', async () => {
  const held = deferred(), reached = deferred(), writes = [];
  const device = new DeviceCheckpoints({
    async local() { },
    async putLocal(_scope, _kind, _key, value) {
      writes.push(structuredClone(value));
      if (writes.length === 1) {
        reached.resolve();
        await held.promise;
      }
    }
  }, 'guest', deviceKey);
  const first = device.save(snapshot(0));
  await reached.promise;
  const pending = [];
  for (let i = 1; i < 2000; i++)
    pending.push(device.save(snapshot(i)));
  const closing = device.close(), secondClose = device.close();
  let ended = false;
  secondClose.then(() => { ended = true; });
  try {
    await tick();
    assert.equal(ended, false);
    assert.equal(writes.length, 1);
    held.resolve();
    await Promise.all([first, ...pending, closing, secondClose]);
    assert.deepEqual(writes.map(value => value.position), [0, 1999]);
    assert.equal(closing, secondClose);
    await assert.rejects(device.save(snapshot(2000)), /closed/);
  }
  finally {
    held.resolve();
    await device.close();
  }
});
test('a device snapshot arriving at the final-write handoff is not stranded', async () => {
  const writes = [];
  let device, later;
  device = new DeviceCheckpoints({
    async local() { },
    putLocal(_scope, _kind, _key, value) {
      writes.push(value.position);
      if (value.position === 1)
        queueMicrotask(() => queueMicrotask(() => { later = device.save(snapshot(2)); }));
      return Promise.resolve();
    }
  }, 'guest', deviceKey);
  await device.save(snapshot(1));
  await tick();
  await later;
  await device.close();
  assert.deepEqual(writes, [1, 2]);
});
test('a failed device write rejects the coalesced saves and does not overwrite recovery data', async () => {
  const held = deferred(), reached = deferred();
  let calls = 0;
  const device = new DeviceCheckpoints({
    async local() { },
    async putLocal() { calls++; reached.resolve(); await held.promise; throw Error('disk failure'); }
  }, 'guest', deviceKey);
  const first = device.save(snapshot(1));
  await reached.promise;
  const second = device.save(snapshot(2));
  const failures = [assert.rejects(first, /disk failure/), assert.rejects(second, /disk failure/)];
  held.resolve();
  await Promise.all(failures);
  await assert.rejects(device.save(snapshot(3)), /paused/);
  await device.close();
  assert.equal(calls, 1);
});
test('falsy explicit cancellation reasons cannot resolve inference as successful', async () => {
  const old = globalThis.Worker;
  let worker;
  class FakeWorker extends EventTarget {
    constructor() { super(); worker = this; }
    postMessage(message) {
      if (message.type === 'prepare' || message.type === 'dispose')
        queueMicrotask(() => {
          this.dispatchEvent(new MessageEvent('message', { data: {
              id: message.id, type: message.type === 'prepare' ? 'ready' : 'disposed', value: null
            } }));
        });
    }
    terminate() { }
  }
  globalThis.Worker = FakeWorker;
  const client = new MossClient('/moss', new URL('https://test.invalid/worker.js'));
  try {
    await client.prepare(new AbortController().signal, () => { });
    const controller = new AbortController();
    const result = client.transcribe(new Float32Array([0.1]), controller.signal);
    const rejected = assert.rejects(result, error => error === 0);
    controller.abort(0);
    await rejected;
    assert.ok(worker);
  }
  finally {
    await client.dispose();
    globalThis.Worker = old;
  }
});
test('compiled Worker acknowledges only after model and pthread cleanup (runtime doubles)', () => {
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', 'tests/media/worker-disposal-gate.mjs'], {
    cwd: new URL('../..', import.meta.url), encoding: 'utf8', timeout: 5000
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS: 3 compiled-worker disposal cases/);
});

test('quota guidance derives its free-space requirement from the pinned model bytes', () =>
  cacheHarness(async ({ mock, calls }) => {
    const required = MOSS.bytes + 32 * 1024 * 1024;
    mock.estimate = async () => ({ quota: required - 1, usage: 0 });
    await assert.rejects(
      getModel(new AbortController().signal, () => {}),
      /at least 682 MB of free browser storage/
    );
    assert.deepEqual(calls, [], 'insufficient quota must not open a writer or start a download');
  })
);
