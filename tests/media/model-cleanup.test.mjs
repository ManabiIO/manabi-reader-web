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
    return { writes: 0, closed: false, aborted: false,
        async write() { this.writes++; }, async close() { this.closed = true; },
        async abort() { this.aborted = true; }, ...override };
}

for (const synchronous of [false, true]) test(`HTTP failure preserves its status when writer abort ${synchronous ? 'throws' : 'rejects'}`, async () => {
    let canceled = false;
    const response = new Response(new ReadableStream({ cancel() { canceled = true; return Promise.reject(Error('cleanup')); } }), { status: 503 });
    const out = target({ abort() { this.aborted = true; if (synchronous) throw Error('writer abort'); return Promise.reject(Error('writer abort')); } });
    await assert.rejects(downloadVerified(response, out, expected, signal()), /Model download failed \(503\)/);
    assert.equal(canceled, true); assert.equal(out.aborted, true); assert.equal(out.closed, false);
});

test('locked response cannot leak an open writer or cancel another reader', async () => {
    let canceled = false;
    const response = new Response(new ReadableStream({ cancel() { canceled = true; } }));
    const owner = response.body.getReader(), out = target();
    await assert.rejects(downloadVerified(response, out, expected, signal()), TypeError);
    assert.equal(out.aborted, true); assert.equal(out.closed, false); assert.equal(canceled, false);
    assert.equal(response.body.locked, true); await owner.cancel(); owner.releaseLock();
});

test('empty response body aborts the destination without publishing', async () => {
    const out = target();
    await assert.rejects(downloadVerified(new Response(null), out, expected, signal()), /Model download failed/);
    assert.equal(out.aborted, true); assert.equal(out.closed, false);
});

test('already aborted download releases its unread response and destination', async () => {
    const controller = new AbortController(); controller.abort(); let canceled = false;
    const response = new Response(new ReadableStream({ cancel() { canceled = true; } })), out = target();
    await assert.rejects(downloadVerified(response, out, expected, controller.signal), { name: 'AbortError' });
    assert.equal(out.aborted, true); assert.equal(out.writes, 0); assert.equal(canceled, true);
});

test('a stalled stream cancellation cannot hold the failed download open', { timeout: 1500 }, async () => {
    const response = new Response(new ReadableStream({ cancel() { return new Promise(() => {}); } }), { headers: { 'Content-Length': '999' } });
    const out = target();
    await assert.rejects(downloadVerified(response, out, expected, signal()), /Unexpected model size/);
    assert.equal(out.aborted, true); assert.equal(response.body.locked, false);
});

test('failure to commit the verified destination remains visible after cleanup', async () => {
    const original = Error('quota while committing');
    const out = target({ async close() { throw original; }, async abort() { this.aborted = true; throw Error('already closed'); } });
    const response = new Response(payload);
    await assert.rejects(downloadVerified(response, out, expected, signal()), e => e === original);
    assert.equal(out.aborted, true); assert.equal(response.body.locked, false);
});
