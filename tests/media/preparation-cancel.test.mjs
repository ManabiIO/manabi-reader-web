/** Worker control-plane doubles only: not a WASM build or cancellation-latency benchmark. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MossClient } from '../../.cache/media-test-build/moss-client.js';
const signal = () => new AbortController().signal;
const tick = () => new Promise((r) => setTimeout(r, 0));
class WorkerDouble extends EventTarget {
  static current;
  calls = [];
  constructor() {
    super();
    WorkerDouble.current = this;
  }
  postMessage(value) {
    this.calls.push(value);
  }
  terminate() {}
  reply(type, value, id = this.calls.find((c) => c.type === 'prepare').id) {
    this.dispatchEvent(new MessageEvent('message', { data: { id, type, value } }));
  }
}
async function withClient(body) {
  const old = globalThis.Worker;
  globalThis.Worker = WorkerDouble;
  const client = new MossClient('/moss', new URL('file:///test-worker.js'));
  try {
    await body(client);
  } finally {
    client.dispose();
    if (old === undefined) delete globalThis.Worker;
    else globalThis.Worker = old;
  }
}
test('early runtime handshake does not settle preparation or admit transcription', () =>
  withClient(async (client) => {
    let prepared = false;
    const pending = client.prepare(signal(), () => {}).then(() => (prepared = true));
    const worker = WorkerDouble.current;
    worker.reply('runtime', null);
    await tick();
    assert.equal(prepared, false);
    await assert.rejects(client.transcribe(new Float32Array(10), signal()), /Prepare/);
    worker.reply('ready', null);
    await pending;
    assert.equal(prepared, true);
    const inference = client.transcribe(new Float32Array(10), signal());
    const call = worker.calls.at(-1);
    worker.reply('result', '[0.0][S01]こんにちは[1.0]', call.id);
    assert.equal(await inference, '[0.0][S01]こんにちは[1.0]');
  }));
test('aborting preparation stores its operation into the early shared cancellation word', () =>
  withClient(async (client) => {
    const controller = new AbortController();
    const pending = client.prepare(controller.signal, () => {});
    const worker = WorkerDouble.current,
      prepare = worker.calls[0];
    const buffer = new SharedArrayBuffer(64),
      word = new Int32Array(buffer, 16, 1);
    worker.reply('runtime', { buffer, offset: 16 });
    controller.abort();
    assert.equal(Atomics.load(word, 0), prepare.operation);
    assert.ok(worker.calls.some((c) => c.type === 'cancel-download' && c.id === prepare.id));
    // A C++ loader can return a generic load error after observing cancellation.
    // The owner must retain the user's AbortError instead of showing a memory error.
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    worker.reply('error', 'MOSS could not load');
    await rejected;
    await assert.rejects(client.transcribe(new Float32Array(10), signal()), /Prepare/);
  }));
test('readiness refreshes the shared view and inference cancellation uses its own identity', () =>
  withClient(async (client) => {
    const pending = client.prepare(signal(), () => {}),
      worker = WorkerDouble.current;
    const initial = new SharedArrayBuffer(64),
      current = new SharedArrayBuffer(128);
    worker.reply('runtime', { buffer: initial, offset: 16 });
    worker.reply('ready', { buffer: current, offset: 16 });
    await pending;
    const controller = new AbortController(),
      transcribing = client.transcribe(new Float32Array(10), controller.signal);
    const request = worker.calls.at(-1);
    controller.abort();
    assert.equal(new Int32Array(initial, 16, 1)[0], 0);
    assert.equal(new Int32Array(current, 16, 1)[0], request.operation);
    assert.notEqual(request.operation, worker.calls[0].operation);
    const rejected = assert.rejects(transcribing, { name: 'AbortError' });
    worker.reply('error', 'Transcription cancelled', request.id);
    await rejected;
  }));
for (const [name, value] of [
  ['ordinary memory', { buffer: new ArrayBuffer(64), offset: 4 }],
  ['null pointer', { buffer: new SharedArrayBuffer(64), offset: 0 }],
  ['misaligned pointer', { buffer: new SharedArrayBuffer(64), offset: 5 }],
  ['outside memory', { buffer: new SharedArrayBuffer(64), offset: 64 }],
  ['invalid pointer', { buffer: new SharedArrayBuffer(64), offset: NaN }]
])
  test(`invalid early cancellation ${name} rejects before readiness`, () =>
    withClient(async (client) => {
      const pending = client.prepare(signal(), () => {}),
        rejected = assert.rejects(pending, /cancellation buffer/);
      WorkerDouble.current.reply('runtime', value);
      await rejected;
      await assert.rejects(client.transcribe(new Float32Array(10), signal()), /Prepare/);
    }));
test('retired preparation messages cannot make its replacement model ready', () =>
  withClient(async (client) => {
    const controller = new AbortController(),
      first = client.prepare(controller.signal, () => {});
    const previous = WorkerDouble.current;
    previous.reply('runtime', null);
    controller.abort();
    const rejected = assert.rejects(first, { name: 'AbortError' });
    previous.reply('error', 'Cancelled');
    await rejected;
    const second = client.prepare(signal(), () => {});
    const disposal = previous.calls.find((message) => message.type === 'dispose');
    previous.dispatchEvent(
      new MessageEvent('message', {
        data: { id: disposal.id, type: 'disposed', value: null }
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const current = WorkerDouble.current;
    previous.reply('ready', null);
    await assert.rejects(client.transcribe(new Float32Array(10), signal()), /Prepare/);
    assert.notEqual(previous, current);
    current.reply('runtime', null);
    current.reply('ready', null);
    await second;
  }));
test('worker exposes preparation cancellation before fetching or mounting weights (source integration guard)', () => {
  const text = fs.readFileSync(
    new URL('../../apps/web/src/lib/media/moss-worker.ts', import.meta.url),
    'utf8'
  );
  const begin = text.indexOf('runtime!._moss_web_begin(operation)'),
    handshake = text.search(/reply\(\s*'runtime'/);
  assert.ok(begin > 0 && handshake > begin && text.indexOf('await getModel(') > handshake);
  assert.ok(text.includes('operation > 0x7ffffffe'));
  assert.ok(text.includes('(!data.threaded && data.threads !== 1)'));
});
