/* SPDX-License-Identifier: GPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderController, type ManagedProvider } from '../../apps/web/src/lib/dictionary/provider-controller';
import type { Provider } from '../../apps/web/src/lib/dictionary/api';

function deferred() { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; }
class FakeProvider implements ManagedProvider {
  active = false; stopped = false; closed = false;
  startGate = deferred(); closeGate = deferred(); entered = deferred(); closing = deferred();
  failStart = false; failClose = false;
  constructor(readonly mode: Provider, private readonly owners: Set<FakeProvider>, readonly events: string[]) {}
  async start(signal: AbortSignal) {
    assert.equal(this.owners.size, 0, 'previous owner must close before this one starts');
    this.owners.add(this); this.events.push(`start:${this.mode}`); this.entered.resolve();
    await this.startGate.promise;
    if (this.failStart) throw new Error('start failed');
    signal.throwIfAborted(); this.active = true;
  }
  stopAccepting() { this.stopped = true; this.active = false; this.events.push(`stop:${this.mode}`); }
  async close() {
    this.events.push(`close:${this.mode}`); this.closing.resolve(); await this.closeGate.promise;
    if (this.failClose) throw new Error('uncertain shutdown');
    this.owners.delete(this); this.closed = true;
  }
}
function setup() {
  const owners = new Set<FakeProvider>(), providers: FakeProvider[] = [], events: string[] = [];
  const controller = new ProviderController((mode) => { const p = new FakeProvider(mode, owners, events); providers.push(p); return p; }, (state) => events.push(`state:${state.provider}:${state.phase}`));
  return { controller, owners, providers, events };
}
async function flush() { await new Promise((r) => setImmediate(r)); }

test('switch stops admissions synchronously and awaits complete owner cleanup', async () => {
  const h = setup(); const first = h.controller.select('builtin'); await flush();
  const a = h.providers[0]; a.startGate.resolve(); await first; assert.equal(a.active, true);
  const second = h.controller.select('extension'); assert.equal(a.active, false); assert.equal(a.stopped, true);
  await a.closing.promise; assert.equal(h.providers.length, 1);
  a.closeGate.resolve(); await flush();
  const b = h.providers[1]; assert.equal(b.mode, 'extension'); b.startGate.resolve(); await second;
  b.closeGate.resolve(); await h.controller.close(); assert.equal(h.owners.size, 0);
});
test('obsolete initialization cannot activate after a rapid provider change', async () => {
  const h = setup(); const first = h.controller.select('builtin'); await flush(); const a = h.providers[0];
  const second = h.controller.select('extension'); const third = h.controller.select('off');
  a.startGate.resolve(); await a.closing.promise; a.closeGate.resolve(); await first; await second; await flush();
  assert.deepEqual(h.providers.map((p) => p.mode), ['builtin', 'off']);
  const b = h.providers[1]; b.startGate.resolve(); await third;
  assert.equal(h.events.includes('state:builtin:active'), false); assert.equal(h.events.includes('state:extension:active'), false);
  b.closeGate.resolve(); await h.controller.close();
});
test('uncertain cleanup fails closed without admitting another managed scanner', async () => {
  const h = setup(); const first = h.controller.select('builtin'); await flush(); const a = h.providers[0];
  a.startGate.resolve(); await first; a.failClose = true; a.closeGate.resolve();
  await assert.rejects(h.controller.select('extension'), /uncertain shutdown/);
  await assert.rejects(h.controller.select('off'), /uncertain shutdown/);
  assert.equal(h.providers.length, 1); assert.equal(a.active, false);
});
test('initialization failure can retry only after its partial owner closes', async () => {
  const h = setup(); const attempt = h.controller.select('builtin'); await flush(); const a = h.providers[0];
  a.failStart = true; a.closeGate.resolve(); a.startGate.resolve(); await assert.rejects(attempt, /start failed/);
  const retry = h.controller.select('builtin'); await flush(); const b = h.providers[1];
  assert.equal(a.closed, true); b.startGate.resolve(); await retry; b.closeGate.resolve(); await h.controller.close();
});
test('explicit extension and off selections never construct a built-in provider', async () => {
  const h = setup(); const start = h.controller.select('extension'); await flush();
  const a = h.providers[0]; a.startGate.resolve(); await start; a.closeGate.resolve();
  const off = h.controller.select('off'); await flush(); const b = h.providers[1]; b.startGate.resolve(); await off;
  assert.deepEqual(h.providers.map((p) => p.mode), ['extension', 'off']); b.closeGate.resolve(); await h.controller.close();
});
test('controller close invalidates startup and permanently rejects new selections', async () => {
  const h = setup(); const start = h.controller.select('builtin'); await flush(); const a = h.providers[0];
  const close = h.controller.close(); a.closeGate.resolve(); a.startGate.resolve(); await start; await close;
  assert.equal(a.active, false); assert.equal(h.owners.size, 0); await assert.rejects(h.controller.select('builtin'), /closed/);
});
