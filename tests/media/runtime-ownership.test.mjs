/** Production queues/stores/clients; explicit lock, transaction and model doubles.
 * This verifies resource admission/order, not native Web Locks or model RAM/ASR.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { TranscriptionQueue } from '../../.cache/media-test-build/queue.js';
import { MossClient } from '../../.cache/media-test-build/moss-client.js';
import { TransactionFactory, RangeDouble } from './transaction-double.mjs';
const key = 'content:' + 'a'.repeat(64);
const tick = () => new Promise(r => setTimeout(r, 0));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
async function eventually(check) { for (let i = 0; i < 500; i++) {
  if (await check())
    return;
  await tick();
} assert.fail('Condition did not become true'); }
class LocksDouble {
  held = false;
  pending = [];
  releases = 0;
  request(name, options, callback) {
    assert.equal(name, 'manabi-moss-inference');
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    if (options.signal?.aborted)
      return Promise.reject(options.signal.reason);
    if (options.ifAvailable && this.held)
      return Promise.resolve(callback(null));
    return new Promise((resolve, reject) => {
      const entry = { options, callback, resolve, reject, abort: () => { this.pending = this.pending.filter(e => e !== entry); reject(options.signal.reason); } };
      options.signal?.addEventListener('abort', entry.abort, { once: true });
      this.pending.push(entry);
      this.pump();
    });
  }
  pump() {
    if (this.held || !this.pending.length)
      return;
    const e = this.pending.shift();
    e.options.signal?.removeEventListener('abort', e.abort);
    this.held = true;
    Promise.resolve().then(() => e.callback({ name: 'manabi-moss-inference', mode: 'exclusive' })).then(value => { this.held = false; this.releases++; e.resolve(value); this.pump(); }, error => { this.held = false; this.releases++; e.reject(error); this.pump(); });
  }
}
async function harness(body, withLocks = true) {
  const before = Object.getOwnPropertyDescriptor(navigator, 'locks'), oldRange = globalThis.IDBKeyRange;
  const locks = new LocksDouble();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: withLocks ? locks : undefined });
  globalThis.IDBKeyRange = RangeDouble;
  const store = new MediaStore(new TransactionFactory(), 'runtime-ownership'), queues = [], errors = [];
  const queue = (scope, engine, decode = async () => new Float32Array(16000).fill(.1)) => { const q = new TranscriptionQueue(store, scope, engine, decode, () => { }, e => errors.push(e)); queues.push(q); return q; };
  try {
    await body({ queue, store, locks, errors });
  }
  finally {
    await Promise.all(queues.map(q => q.dispose()));
    await store.close();
    if (before)
      Object.defineProperty(navigator, 'locks', before);
    else
      delete navigator.locks;
    if (oldRange === undefined)
      delete globalThis.IDBKeyRange;
    else
      globalThis.IDBKeyRange = oldRange;
  }
}
test('one origin lease spans a warm batch and its asynchronous model shutdown', () => harness(async ({ queue, store, locks, errors }) => {
  const first = deferred(), unload = deferred();
  let resident = 0, peak = 0, loadsA = 0, loadsB = 0, callsA = 0, stopping = false;
  function engine(name) {
    let loaded = false;
    return {
      async prepare() { if (!loaded) {
        loaded = true;
        peak = Math.max(peak, ++resident);
        if (name === 'A')
          loadsA++;
        else
          loadsB++;
      } },
      async transcribe() { if (name === 'A' && ++callsA === 1)
        await first.promise; return '[0][S01]テスト。[1]'; },
      async dispose() { if (!loaded)
        return; if (name === 'A') {
        stopping = true;
        await unload.promise;
      } loaded = false; resident--; }
    };
  }
  const a = queue('account:a', engine('A')), b = queue('account:b', engine('B'));
  try {
    const j1 = await a.enqueue(key, 'ja', '1', 2);
    await eventually(() => callsA === 1);
    const j2 = await a.enqueue(key, 'ja', '2', 2);
    const j3 = await b.enqueue(key, 'ja', '1', 2);
    await eventually(() => locks.pending.length === 1);
    first.resolve();
    await eventually(() => stopping);
    assert.equal((await store.local('account:a', 'jobs', j1.id)).status, 'complete');
    assert.equal((await store.local('account:a', 'jobs', j2.id)).status, 'complete');
    assert.equal(loadsA, 1, 'two files must reuse one loaded model');
    assert.equal(loadsB, 0, 'a successor must wait through asynchronous cleanup');
    assert.equal(locks.held, true);
    assert.equal(resident, 1);
    unload.resolve();
    await eventually(async () => (await store.local('account:b', 'jobs', j3.id)).status === 'complete');
    await eventually(() => !locks.held);
    assert.equal(peak, 1);
    assert.equal(resident, 0, 'idle tabs must release loaded models');
    assert.equal(loadsB, 1);
    assert.deepEqual(errors, []);
  }
  finally {
    first.resolve();
    unload.resolve();
  }
}));
test('same-account batches do not claim jobs whose local File belongs to another workspace', () => harness(async ({ queue, store, locks }) => {
  const first = deferred();
  const otherKey = 'content:' + 'b'.repeat(64);
  let started = false;
  const decoded = [];
  const a = queue('guest', { async prepare() { }, async transcribe() { started = true; await first.promise; return '[0][S01]First[1]'; }, dispose() { } }, async (job) => { decoded.push(['A', job.mediaKey]); assert.equal(job.mediaKey, key, 'A has no access to B local File'); return new Float32Array(16000).fill(.1); });
  const b = queue('guest', { async prepare() { }, async transcribe() { return '[0][S01]Second[1]'; }, dispose() { } }, async (job) => { decoded.push(['B', job.mediaKey]); assert.equal(job.mediaKey, otherKey); return new Float32Array(16000).fill(.1); });
  try {
    const j1 = await a.enqueue(key, 'en', '1', 2);
    await eventually(() => started);
    const j2 = await b.enqueue(otherKey, 'en', '1', 2);
    await eventually(() => locks.pending.length === 1);
    first.resolve();
    await eventually(async () => ['complete', 'failed'].includes((await store.local('guest', 'jobs', j2.id)).status));
    assert.equal((await store.local('guest', 'jobs', j2.id)).status, 'complete');
    assert.equal((await store.local('guest', 'jobs', j1.id)).status, 'complete');
    assert.deepEqual(decoded, [['A', key], ['B', otherKey]]);
  }
  finally {
    first.resolve();
  }
}));
test('closing a queue waiting for the runtime lock never creates a model', () => harness(async ({ queue, locks }) => {
  const other = deferred();
  const held = locks.request('manabi-moss-inference', {}, () => other.promise);
  let loads = 0;
  const q = queue('guest', { async prepare() { loads++; }, dispose() { } });
  try {
    await q.enqueue(key, 'ja', '1', 2);
    await eventually(() => locks.pending.length === 1);
    await q.dispose();
    assert.equal(locks.pending.length, 0);
    assert.equal(loads, 0);
    assert.equal(locks.held, true);
  }
  finally {
    other.resolve();
    await held;
  }
}));
test('all queue Close callers wait for the same runtime retirement', () => harness(async ({ queue }) => {
  const retiring = deferred();
  let stops = 0;
  const q = queue('guest', { dispose() { stops++; return retiring.promise; } });
  const first = q.dispose(), second = q.dispose();
  let done = false;
  void second.then(() => done = true);
  try {
    await tick();
    assert.equal(done, false);
    assert.equal(first, second);
    assert.equal(stops, 1);
  }
  finally {
    retiring.resolve();
    await Promise.all([first, second]);
  }
}));
test('without Web Locks a drained workspace still releases its own model', () => harness(async ({ queue, store }) => {
  let loaded = false;
  const q = queue('guest', { async prepare() { loaded = true; }, async transcribe() { return '[0][S01]Test[1]'; }, dispose() { loaded = false; } });
  const j = await q.enqueue(key, 'en', '1', 2);
  await eventually(async () => (await store.local('guest', 'jobs', j.id)).status === 'complete');
  await q.task;
  assert.equal(loaded, false);
}, false));
test('model lifetime ends after a failed decode and the next explicit job can retry', () => harness(async ({ queue, store }) => {
  let loaded = false, loads = 0, first = true;
  const q = queue('guest', { async prepare() { loaded = true; loads++; }, async transcribe() { return '[0][S01]Test[1]'; }, dispose() { loaded = false; } }, async () => { if (first) {
    first = false;
    throw Error('Decode failed');
  } return new Float32Array(16000).fill(.1); });
  const j = await q.enqueue(key, 'en', '1', 2);
  await eventually(async () => (await store.local('guest', 'jobs', j.id)).status === 'failed');
  await q.task;
  assert.equal(loaded, false);
  await q.resume(j.id);
  await eventually(async () => (await store.local('guest', 'jobs', j.id)).status === 'complete');
  await q.task;
  assert.equal(loads, 1, 'the failed initial decode must not load a model');
  assert.equal(loaded, false);
}));
test('a job admitted during retirement starts a fresh leased batch without being stranded', () => harness(async ({ queue, store, locks }) => {
  const retiring = deferred();
  let loaded = false, loads = 0, stops = 0, stopping = false;
  const q = queue('guest', { async prepare() { assert.equal(locks.held, true); if (!loaded) {
      loaded = true;
      loads++;
    } }, async transcribe() { return '[0][S01]Test[1]'; }, async dispose() { if (!loaded)
      return; stops++; if (stops === 1) {
      stopping = true;
      await retiring.promise;
    } loaded = false; } });
  try {
    const first = await q.enqueue(key, 'en', '1', 2);
    await eventually(() => stopping);
    const next = await q.enqueue(key, 'en', '2', 2);
    await tick();
    assert.equal(loads, 1);
    assert.equal((await store.local('guest', 'jobs', next.id)).status, 'queued');
    retiring.resolve();
    await eventually(async () => (await store.local('guest', 'jobs', next.id)).status === 'complete');
    await eventually(() => !locks.held);
    assert.equal((await store.local('guest', 'jobs', first.id)).status, 'complete');
    assert.equal(loads, 2);
    assert.equal(stops, 2);
    assert.equal(loaded, false);
  }
  finally {
    retiring.resolve();
  }
}));
test('closing during retirement does not restart a newly admitted batch', () => harness(async ({ queue, store, locks }) => {
  const retiring = deferred();
  let loaded = false, stopping = false, loads = 0;
  const q = queue('guest', { async prepare() { loaded = true; loads++; }, async transcribe() { return '[0][S01]Test[1]'; }, async dispose() { if (!loaded)
      return; stopping = true; await retiring.promise; loaded = false; } });
  try {
    await q.enqueue(key, 'en', '1', 2);
    await eventually(() => stopping);
    const next = await q.enqueue(key, 'en', '2', 2);
    const closing = q.dispose();
    retiring.resolve();
    await closing;
    await tick();
    assert.equal(locks.held, false);
    assert.equal(loads, 1);
    assert.equal(loaded, false);
    assert.equal((await store.local('guest', 'jobs', next.id)).status, 'queued');
  }
  finally {
    retiring.resolve();
  }
}));
class WorkerDouble extends EventTarget {
  static all = [];
  calls = [];
  terminated = false;
  constructor() { super(); WorkerDouble.all.push(this); }
  postMessage(value) { this.calls.push(value); }
  terminate() { this.terminated = true; }
  reply(type, id, value = null) { this.dispatchEvent(new MessageEvent('message', { data: { type, id, value } })); }
}
async function clients(body) {
  const old = globalThis.Worker;
  globalThis.Worker = WorkerDouble;
  WorkerDouble.all = [];
  const client = new MossClient('/moss', new URL('https://test.invalid/worker.js'));
  try {
    await body(client);
  }
  finally {
    const stopped = client.dispose();
    for (const w of WorkerDouble.all) {
      const request = w.calls.find(c => c.type === 'dispose');
      if (request)
        w.reply('disposed', request.id);
    }
    await stopped;
    if (old === undefined)
      delete globalThis.Worker;
    else
      globalThis.Worker = old;
  }
}
async function prepared(client) { const p = client.prepare(new AbortController().signal, () => { }); await eventually(() => WorkerDouble.all.at(-1)?.calls.some(c => c.type === 'prepare')); const w = WorkerDouble.all.at(-1); w.reply('ready', w.calls[0].id); await p; return w; }
test('a replacement client worker waits for previous pool shutdown acknowledgement', () => clients(async (client) => {
  const old = await prepared(client), stopped = client.dispose();
  let done = false;
  void stopped.then(() => done = true);
  const preparing = client.prepare(new AbortController().signal, () => { });
  await tick();
  assert.equal(done, false);
  assert.equal(WorkerDouble.all.length, 1);
  old.reply('disposed', 'another-id');
  await tick();
  assert.equal(done, false);
  old.reply('disposed', old.calls.find(c => c.type === 'dispose').id);
  await stopped;
  assert.equal(old.terminated, true);
  await eventually(() => WorkerDouble.all.length === 2);
  const next = WorkerDouble.all.at(-1);
  next.reply('ready', next.calls[0].id);
  await preparing;
}));
test('cancelled preparation waiting for shutdown cannot create a replacement worker', () => clients(async (client) => {
  const old = await prepared(client);
  client.dispose();
  const c = new AbortController();
  const p = client.prepare(c.signal, () => { }), rejected = assert.rejects(p, { name: 'AbortError' });
  c.abort();
  await rejected;
  old.reply('disposed', old.calls.find(c => c.type === 'dispose').id);
  await tick();
  assert.equal(WorkerDouble.all.length, 1);
}));
test('a second explicit Close fences a pending preparation after shutdown', () => clients(async (client) => {
  const old = await prepared(client);
  client.dispose();
  const p = client.prepare(new AbortController().signal, () => { }), rejected = assert.rejects(p, { name: 'AbortError' });
  const closed = client.dispose();
  old.reply('disposed', old.calls.find(c => c.type === 'dispose').id);
  await closed;
  await rejected;
  assert.equal(WorkerDouble.all.length, 1);
}));
test('unresponsive worker shutdown has a bounded termination fallback', () => clients(async (client) => {
  const w = await prepared(client);
  await client.dispose();
  assert.equal(w.terminated, true);
}));
