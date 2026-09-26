/** Executes the compiled production worker handler in Node's module VM.
 * Only the model download/factory and worker host are doubled. No ASR or WASM.
 */
import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { MOSS } from '../../.cache/media-test-build/model-cache.js';
import * as contract from '../../.cache/media-test-build/moss-runtime-contract.js';
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const file = fs.readFileSync(new URL('../../.cache/media-test-build/moss-worker.js', import.meta.url), 'utf8');
async function harness(getModel) {
  const events = [], messages = [];
  let host;
  const buffer = new SharedArrayBuffer(4096), runtime = {
    _moss_web_abi_version: () => 1, _moss_web_engine_revision: () => 20, _moss_web_ggml_revision: () => 24,
    UTF8ToString: p => p === 20 ? MOSS.engineRevision : MOSS.ggmlRevision,
    HEAP32: new Int32Array(buffer), HEAPF32: new Float32Array(buffer),
    _moss_web_cancel_ptr: () => 16, _moss_web_begin: () => { }, _moss_web_load: () => 1,
    ccall() { events.push('load'); return 7; }, _malloc: () => 64, _free: () => { },
    _moss_transcribe_capi_transcribe_pcm: () => 0, _moss_transcribe_capi_last_error: () => 0,
    _moss_transcribe_capi_free_string: () => { }, _moss_transcribe_capi_free() { events.push('free'); },
    FS: { mkdir() { }, mount() { }, unmount() { } }, WORKERFS: {}, PThread: { terminateAllThreads() { events.push('stop-pool'); } }
  };
  host = { location: new URL('https://manabi.test/worker.js'), postMessage(message) { messages.push(message); events.push(message.type); }, close() { events.push('close'); } };
  const context = vm.createContext({ self: host, URL, AbortController, DOMException, SharedArrayBuffer, ArrayBuffer, Int32Array, Float32Array, console });
  function module(values) { return new vm.SyntheticModule(Object.keys(values), function () { for (const [name, value] of Object.entries(values))
    this.setExport(name, value); }, { context }); }
  const factory = module({ default: async () => runtime });
  await factory.link(() => { });
  await factory.evaluate();
  const worker = new vm.SourceTextModule(file, { context, identifier: 'moss-worker.js', importModuleDynamically: () => factory });
  await worker.link(name => name === './model-cache.js' ? module({ getModel }) : module(contract));
  await worker.evaluate();
  return { host, runtime, events, messages, send: data => host.onmessage({ data }), prepare: id => host.onmessage({ data: { id, type: 'prepare', operation: 1, url: 'https://manabi.test/threaded/moss.mjs', threaded: true, threads: 2 } }) };
}
// Idle cleanup must free the model and terminate the pool before acknowledging.
{
  const h = await harness(async () => new Blob(['test']));
  await h.prepare('prepare');
  assert.ok(h.messages.some(m => m.type === 'ready'));
  await h.send({ id: 'stop', type: 'dispose' });
  assert.deepEqual(h.events.slice(-4), ['free', 'stop-pool', 'disposed', 'close']);
  assert.equal(h.messages.at(-1).id, 'stop');
  await h.send({ id: 'late', type: 'prepare' });
  assert.equal(h.messages.at(-1).id, 'stop', 'no late admission after disposal');
}
// Close received while download is pending must abort it, then finish cleanup.
{
  const started = deferred();
  let cancelled = false;
  const h = await harness(signal => { started.resolve(); return new Promise((_, reject) => signal.addEventListener('abort', () => { cancelled = true; reject(signal.reason); }, { once: true })); });
  const p = h.prepare('prepare');
  await started.promise;
  await h.send({ id: 'stop', type: 'dispose' });
  await p;
  assert.equal(cancelled, true);
  assert.ok(!h.events.includes('load'));
  assert.deepEqual(h.events.slice(-3), ['stop-pool', 'disposed', 'close']);
  assert.equal(h.messages.at(-1).id, 'stop');
}
// If freeing fails, pool cleanup still runs, but no false successful ack is sent.
{
  const h = await harness(async () => new Blob(['test']));
  await h.prepare('prepare');
  h.runtime._moss_transcribe_capi_free = () => { throw Error('failed cleanup'); };
  await assert.rejects(h.send({ id: 'stop', type: 'dispose' }), /failed cleanup/);
  assert.deepEqual(h.events.slice(-2), ['stop-pool', 'close']);
  assert.ok(!h.messages.some(m => m.type === 'disposed'));
}
console.log('PASS: 3 compiled-worker disposal cases (runtime/download doubles, no WASM)');
