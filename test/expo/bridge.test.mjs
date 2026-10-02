import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer, atob } from 'node:buffer';
import {
  BridgeAuthority,
  ImportTransfer,
  parseBridgeRequest,
  safeExternalLink,
  IMPORT_CHUNK_BYTES,
  bridgeMessageBytes,
  importChunkRequestId
} from '../../apps/web/src/platform/bridge-contract.ts';
const scope = { session: 'session_123', epoch: 0 };
const request = (extra = {}) => ({
  version: 1,
  ...scope,
  id: 'request_123',
  method: 'snapshot',
  payload: {},
  ...extra
});
test('bridge validates version, method, scope and bounded payload', () => {
  assert.equal(parseBridgeRequest(request()).method, 'snapshot');
  for (const change of [
    { version: 2 },
    { method: 'fetch' },
    { epoch: -1 },
    { payload: null },
    { session: 'x' },
    { payload: { text: 'x'.repeat(800000) } }
  ])
    assert.throws(() => parseBridgeRequest(request(change)));
});
test('duplicate requests coalesce, changed payload and stale scope never execute', async () => {
  let count = 0;
  const authority = new BridgeAuthority(
    () => scope,
    async () => ++count,
    new AbortController().signal
  );
  const [a, b] = await Promise.all([authority.request(request()), authority.request(request())]);
  assert.equal(a.value, 1);
  assert.deepEqual(a, b);
  assert.equal((await authority.request(request({ payload: { x: 1 } }))).outcome, 'not-started');
  assert.equal((await authority.request(request({ epoch: 1 }))).outcome, 'not-started');
  assert.equal(count, 1);
});
test('a completed operation is reported completed but stale after account ABA', async () => {
  let epoch = 0;
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const authority = new BridgeAuthority(
    () => ({ ...scope, epoch }),
    async () => {
      await pending;
      return 'saved';
    },
    new AbortController().signal
  );
  const result = authority.request(request());
  epoch = 2;
  finish();
  const reply = await result;
  assert.equal(reply.outcome, 'completed');
  assert.equal(reply.stale, true);
  assert.equal(reply.value, 'saved');
});
test('exceptions remain unknown outcomes, never silently retry a possibly committed mutation', async () => {
  let count = 0;
  const authority = new BridgeAuthority(
    () => scope,
    async () => {
      count++;
      throw new Error('lost acknowledgement');
    },
    new AbortController().signal
  );
  assert.equal((await authority.request(request())).outcome, 'unknown');
  await authority.request(request());
  assert.equal(count, 1);
});
test('bounded sequential transfer rejects other accounts and incomplete/oversized chunks', () => {
  const upload = new ImportTransfer();
  upload.begin(scope, 'transfer_123', 'test.epub', 3);
  assert.throws(() => upload.chunk({ ...scope, epoch: 1 }, 'transfer_123', 0, new Uint8Array([1])));
  assert.throws(() => upload.chunk(scope, 'transfer_123', 1, new Uint8Array([1])));
  assert.throws(() =>
    upload.chunk(scope, 'transfer_123', 0, new Uint8Array(IMPORT_CHUNK_BYTES + 1))
  );
  upload.chunk(scope, 'transfer_123', 0, new Uint8Array([1, 2]));
  assert.throws(() => upload.commit(scope, 'transfer_123'));
  upload.chunk(scope, 'transfer_123', 1, new Uint8Array([3]));
  const file = upload.commit(scope, 'transfer_123');
  assert.equal(file.size, 3);
  assert.deepEqual([...file.chunks.flatMap((x) => [...x])], [1, 2, 3]);
});
test('external links cannot carry native/file/javascript capabilities or embedded credentials', () => {
  assert.equal(safeExternalLink('https://example.org/a'), 'https://example.org/a');
  for (const url of [
    'javascript:alert(1)',
    'file:///private',
    'content://provider',
    'https://user:secret@example.org'
  ])
    assert.equal(safeExternalLink(url), undefined);
});

test('a duplicate acknowledged mutation preserves its completed outcome after account change', async () => {
  let epoch = 0,
    count = 0;
  const authority = new BridgeAuthority(
    () => ({ ...scope, epoch }),
    async () => ++count,
    new AbortController().signal
  );
  assert.equal((await authority.request(request())).outcome, 'completed');
  epoch = 2;
  const duplicate = await authority.request(request());
  assert.equal(duplicate.outcome, 'completed');
  assert.equal(duplicate.stale, true);
  assert.equal(count, 1);
});

test('bounded readonly polling does not consume mutation receipts or permit read IDs to mutate', async () => {
  let count = 0;
  const authority = new BridgeAuthority(
    () => scope,
    async () => ++count,
    new AbortController().signal
  );
  for (let index = 0; index < 2200; index++)
    assert.equal((await authority.request(request({ id: `read_poll_${index}` }))).ok, true);
  assert.equal(authority.reads.size, 16);
  assert.equal(authority.outcomes.size, 0);
  const fresh = request({ id: 'read_poll_2200' });
  const a = await authority.request(fresh),
    b = await authority.request(fresh);
  assert.equal(a.value, b.value);
  assert.throws(
    () => parseBridgeRequest(request({ id: 'read_poll_1', method: 'delete' })),
    /cannot authorize/
  );
  assert.equal((await authority.request(request({ method: 'delete' }))).ok, true);
  assert.equal(authority.outcomes.size, 1);
});

test('large completed mutation receipts discard raw payloads while preserving exact duplicate outcomes', async () => {
  let count = 0;
  const authority = new BridgeAuthority(
    () => scope,
    async () => ++count,
    new AbortController().signal
  );
  const input = request({ method: 'import.chunk', payload: { data: 'x'.repeat(100000) } });
  const first = await authority.request(input);
  const receipt = authority.outcomes.get(input.id);
  assert.equal(receipt.hashed, true);
  assert.equal((await receipt.fingerprint).length, 64);
  assert.equal((await authority.request(input)).value, first.value);
  assert.equal(
    (await authority.request({ ...input, payload: { data: 'y'.repeat(100000) } })).outcome,
    'not-started'
  );
  assert.equal(count, 1);
});

test('bridge bounds encoded Unicode bytes rather than UTF-16 characters', () => {
  for (const value of ['ASCII', '日本語', '😀の本', '\ud800'])
    assert.equal(bridgeMessageBytes(value), new TextEncoder().encode(value).length);
  assert.throws(
    () => parseBridgeRequest(request({ payload: { query: '本'.repeat(300000) } })),
    /size limit/
  );
});

test('read cache keeps pending work coalesced and refuses an unbounded pending queue', async () => {
  let resolve;
  const gate = new Promise((done) => {
    resolve = done;
  });
  let count = 0;
  const authority = new BridgeAuthority(
    () => scope,
    async () => {
      count++;
      await gate;
      return 'ready';
    },
    new AbortController().signal
  );
  const pending = Array.from({ length: 32 }, (_, index) =>
    authority.request(request({ id: `read_pending_${index}` }))
  );
  const duplicate = authority.request(request({ id: 'read_pending_0' }));
  assert.equal(
    (await authority.request(request({ id: 'read_pending_33' }))).outcome,
    'not-started'
  );
  assert.equal(count, 32);
  resolve();
  assert.equal((await duplicate).value, 'ready');
  await Promise.all(pending);
  assert.equal(authority.reads.size, 16);
});

test('evicted readonly requests may refresh state but never discard retained mutation outcomes', async () => {
  let count = 0;
  const authority = new BridgeAuthority(
    () => scope,
    async () => ++count,
    new AbortController().signal
  );
  const mutation = request({ id: 'mutation_1', method: 'delete' });
  const saved = await authority.request(mutation);
  const read = request({ id: 'read_state_0' });
  const prior = await authority.request(read);
  for (let index = 1; index <= 20; index++)
    await authority.request(request({ id: `read_state_${index}` }));
  assert.ok((await authority.request(read)).value > prior.value);
  assert.equal((await authority.request(mutation)).value, saved.value);
  assert.equal(authority.outcomes.size, 1);
});

// Exercise the real transfer implementation behind the same decode/commit boundary
// as the DOM host, rather than a counter-only bridge executor.
function transferHarness(options = {}) {
  const upload = new ImportTransfer();
  const lifetime = new AbortController();
  let owner = { ...scope };
  let serial = 0;
  const calls = [];
  const saved = [];
  const authority = new BridgeAuthority(
    () => owner,
    async (input) => {
      calls.push(input.method);
      const { transferId, sequence, data, name, size } = input.payload;
      if (input.method === 'import.begin') return upload.begin(input, transferId, name, size);
      if (input.method === 'import.chunk') {
        if (options.beforeChunk) await options.beforeChunk(input);
        const received = upload.chunk(
          input,
          transferId,
          sequence,
          Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
        );
        if (options.afterChunk) await options.afterChunk(input);
        return received;
      }
      if (input.method === 'import.commit') {
        const book = upload.commit(input, transferId);
        saved.push({ name: book.name, size: book.size });
        if (options.afterCommit) await options.afterCommit(input);
        return saved.length;
      }
      if (input.method === 'import.cancel') return upload.cancel();
      return null;
    },
    lifetime.signal,
    upload
  );
  const make = (method, payload, extra = {}) =>
    request({
      ...owner,
      id: `mutation_${++serial}`,
      method,
      payload,
      ...extra
    });
  const chunk = (transferId, sequence, data = 'AQ==', extra = {}) =>
    make(
      'import.chunk',
      { transferId, sequence, data },
      { id: importChunkRequestId(transferId, sequence), ...extra }
    );
  return {
    upload,
    authority,
    calls,
    saved,
    lifetime,
    make,
    chunk,
    command: (method, payload) => authority.request(make(method, payload)),
    setScope: (value) => {
      owner = value;
    }
  };
}

test('reserved chunk identities bind method, transfer, sequence and maximum token length', () => {
  const transferId = 'x'.repeat(128);
  const id = importChunkRequestId(transferId, Number.MAX_SAFE_INTEGER);
  assert.equal(id.length, 158);
  const input = request({
    id,
    method: 'import.chunk',
    payload: { transferId, sequence: Number.MAX_SAFE_INTEGER, data: 'AQ==' }
  });
  assert.equal(parseBridgeRequest(input).id, id);
  for (const change of [
    { method: 'delete' },
    { method: 'import.commit' },
    { payload: { ...input.payload, transferId: 'transfer_other' } },
    { payload: { ...input.payload, sequence: 0 } },
    { id: `${id}_extra` }
  ])
    assert.throws(() => parseBridgeRequest({ ...input, ...change }));
  for (const sequence of [-1, 0.5, '0', NaN, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => importChunkRequestId('transfer_123', sequence));
  assert.throws(() => importChunkRequestId('too-short', undefined));
});

test('more than 2048 real transient chunks leave only begin and commit in the permanent ledger', async () => {
  const host = transferHarness();
  const count = 750;
  const data = Buffer.alloc(32, 7).toString('base64');
  for (let book = 0; book < 3; book++) {
    const transferId = `transfer_book_${book}`;
    assert.equal(
      (await host.command('import.begin', { transferId, name: 'test.epub', size: count * 32 })).ok,
      true
    );
    const beforeChunks = host.authority.outcomes.size;
    for (let sequence = 0; sequence < count; sequence++) {
      const result = await host.authority.request(host.chunk(transferId, sequence, data));
      assert.equal(result.ok, true);
      assert.equal(result.value, (sequence + 1) * 32);
      assert.equal(host.authority.outcomes.size, beforeChunks);
      assert.ok(host.authority.chunks.size <= 16);
    }
    assert.equal((await host.command('import.commit', { transferId })).ok, true);
    assert.equal(host.upload.current, undefined);
  }
  assert.equal(host.calls.filter((method) => method === 'import.chunk').length, 2250);
  assert.equal(host.saved.length, 3);
  assert.equal(host.authority.outcomes.size, 6);
  assert.equal(host.authority.chunks.size, 16);
  assert.equal(host.upload.usedIds.size, 3);
});

test('recent chunks coalesce, conflicting payloads fail, and evicted chunks cannot execute again', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const host = transferHarness({
    afterChunk: (input) => (input.payload.sequence === 0 ? gate : undefined)
  });
  await host.command('import.begin', { transferId: 'transfer_123', name: 'test.txt', size: 20 });
  const first = host.chunk('transfer_123', 0);
  const pending = host.authority.request(first);
  const duplicate = host.authority.request(first);
  const conflict = await host.authority.request({
    ...first,
    payload: { ...first.payload, data: 'Ag==' }
  });
  assert.equal(conflict.outcome, 'not-started');
  assert.match(conflict.error, /reused/);
  assert.equal(host.calls.filter((method) => method === 'import.chunk').length, 1);
  release();
  assert.deepEqual(await pending, await duplicate);
  assert.equal((await host.authority.request(first)).value, 1);
  for (let sequence = 1; sequence < 20; sequence++)
    assert.equal((await host.authority.request(host.chunk('transfer_123', sequence))).ok, true);
  assert.equal(host.authority.chunks.has(first.id), false);
  const calls = host.calls.length;
  for (const data of ['AQ==', 'Ag==']) {
    const expired = await host.authority.request({ ...first, payload: { ...first.payload, data } });
    assert.equal(expired.outcome, 'not-started');
    assert.match(expired.error, /expired|out of order/);
  }
  assert.equal(host.calls.length, calls);
  assert.equal(host.upload.current.received, 20);
});

test('out-of-order, unowned and unattached chunk requests never reach the executor', async () => {
  const host = transferHarness();
  assert.equal(
    (await host.authority.request(host.chunk('transfer_123', 0))).outcome,
    'not-started'
  );
  await host.command('import.begin', { transferId: 'transfer_123', name: 'test.txt', size: 2 });
  for (const input of [
    host.chunk('transfer_123', 1),
    host.chunk('transfer_other', 0),
    host.chunk('transfer_123', 0, 'AQ==', { epoch: 1 })
  ])
    assert.equal((await host.authority.request(input)).outcome, 'not-started');
  assert.equal(host.calls.filter((method) => method === 'import.chunk').length, 0);
  assert.equal((await host.authority.request(host.chunk('transfer_123', 0))).value, 1);
  let executions = 0;
  const unattached = new BridgeAuthority(
    () => scope,
    async () => ++executions,
    new AbortController().signal
  );
  const result = await unattached.request(host.chunk('transfer_123', 1));
  assert.equal(result.outcome, 'not-started');
  assert.match(result.error, /unavailable/);
  assert.equal(executions, 0);
});

test('completed and cancelled transfer identities cannot be reused, including account ABA', async () => {
  const host = transferHarness();
  await host.command('import.begin', { transferId: 'transfer_123', name: 'test.txt', size: 1 });
  const first = host.chunk('transfer_123', 0);
  await host.authority.request(first);
  await host.command('import.commit', { transferId: 'transfer_123' });
  assert.throws(
    () => host.upload.begin(scope, 'transfer_123', 'other.txt', 1),
    /already been used/
  );
  host.setScope({ ...scope, epoch: 2 });
  assert.throws(
    () => host.upload.begin({ ...scope, epoch: 2 }, 'transfer_123', 'other.txt', 1),
    /already been used/
  );
  const previous = await host.authority.request(first);
  assert.equal(previous.outcome, 'completed');
  assert.equal(previous.stale, true);
  const changedScope = await host.authority.request({ ...first, epoch: 2 });
  assert.equal(changedScope.outcome, 'not-started');
  await host.command('import.begin', {
    transferId: 'transfer_cancelled',
    name: 'test.txt',
    size: 1
  });
  await host.command('import.cancel', {});
  assert.throws(
    () => host.upload.begin({ ...scope, epoch: 2 }, 'transfer_cancelled', 'other.txt', 1),
    /already been used/
  );
  assert.equal(host.saved.length, 1);
});

test('unknown chunk outcomes retire their transfer and remain non-replayable after cache eviction', async () => {
  const host = transferHarness({
    afterChunk: (input) => {
      if (input.payload.transferId === 'transfer_failed')
        throw new Error('lost chunk acknowledgement');
    }
  });
  await host.command('import.begin', { transferId: 'transfer_failed', name: 'test.txt', size: 2 });
  const failed = host.chunk('transfer_failed', 0);
  assert.equal((await host.authority.request(failed)).outcome, 'unknown');
  assert.equal(host.upload.current, undefined);
  assert.equal((await host.authority.request(failed)).outcome, 'unknown');
  assert.equal(
    (await host.authority.request(host.chunk('transfer_failed', 1))).outcome,
    'not-started'
  );
  await host.command('import.begin', { transferId: 'transfer_next', name: 'next.txt', size: 20 });
  for (let sequence = 0; sequence < 20; sequence++)
    await host.authority.request(host.chunk('transfer_next', sequence));
  const calls = host.calls.length;
  assert.equal(host.authority.chunks.has(failed.id), false);
  assert.equal((await host.authority.request(failed)).outcome, 'not-started');
  assert.equal(host.calls.length, calls);
  assert.equal(host.upload.current.id, 'transfer_next');
  host.upload.cancel();
  assert.throws(
    () => host.upload.begin(scope, 'transfer_failed', 'retry.txt', 1),
    /already been used/
  );
});

test('unknown completed database commits remain permanent and cannot replay after chunk cache turnover', async () => {
  const host = transferHarness({
    afterCommit: () => {
      throw new Error('database saved but reply was lost');
    }
  });
  await host.command('import.begin', { transferId: 'transfer_saved', name: 'saved.txt', size: 1 });
  await host.authority.request(host.chunk('transfer_saved', 0));
  const commit = host.make('import.commit', { transferId: 'transfer_saved' });
  assert.equal((await host.authority.request(commit)).outcome, 'unknown');
  await host.command('import.begin', { transferId: 'transfer_next', name: 'next.txt', size: 20 });
  for (let sequence = 0; sequence < 20; sequence++)
    await host.authority.request(host.chunk('transfer_next', sequence));
  host.setScope({ ...scope, epoch: 2 });
  const duplicate = await host.authority.request(commit);
  assert.equal(duplicate.outcome, 'unknown');
  assert.equal(duplicate.stale, true);
  assert.equal(host.saved.length, 1);
  assert.equal(host.authority.outcomes.has(commit.id), true);
  assert.equal(host.authority.outcomes.size, 3);
});

test('unmount releases transfer bytes and preserves completed/stale and unknown persistent outcomes', async () => {
  const host = transferHarness();
  await host.command('import.begin', { transferId: 'transfer_123', name: 'test.txt', size: 2 });
  const first = host.chunk('transfer_123', 0);
  await host.authority.request(first);
  host.lifetime.abort();
  assert.equal(host.upload.current, undefined);
  const duplicate = await host.authority.request(first);
  assert.equal(duplicate.outcome, 'completed');
  assert.equal(duplicate.stale, true);
  assert.equal(
    (await host.authority.request(host.chunk('transfer_123', 1))).outcome,
    'not-started'
  );
  assert.equal(
    (await host.command('import.commit', { transferId: 'transfer_123' })).outcome,
    'not-started'
  );
  assert.equal(host.saved.length, 0);
});

test('pending transient chunk receipts stay coalesced and bounded', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const host = transferHarness({ afterChunk: () => gate });
  await host.command('import.begin', { transferId: 'transfer_123', name: 'test.txt', size: 40 });
  const pending = [];
  for (let sequence = 0; sequence < 32; sequence++)
    pending.push(host.authority.request(host.chunk('transfer_123', sequence)));
  const duplicate = host.authority.request(host.chunk('transfer_123', 0));
  assert.equal(host.authority.chunks.size, 32);
  assert.equal(
    (await host.authority.request(host.chunk('transfer_123', 32))).outcome,
    'not-started'
  );
  assert.equal(host.upload.current.admittedSequence, 31);
  release();
  assert.equal((await duplicate).value, 1);
  await Promise.all(pending);
  assert.equal(host.authority.chunks.size, 16);
  assert.equal((await host.authority.request(host.chunk('transfer_123', 32))).value, 33);
});

test('compact transient receipts retain cryptographic payload conflict detection', async () => {
  const host = transferHarness();
  await host.command('import.begin', {
    transferId: 'transfer_123',
    name: 'test.txt',
    size: IMPORT_CHUNK_BYTES
  });
  const input = host.chunk(
    'transfer_123',
    0,
    Buffer.alloc(IMPORT_CHUNK_BYTES, 7).toString('base64')
  );
  const first = await host.authority.request(input);
  const receipt = host.authority.chunks.get(input.id);
  assert.equal(receipt.hashed, true);
  assert.equal((await receipt.fingerprint).length, 64);
  assert.equal((await host.authority.request(input)).value, first.value);
  assert.equal(
    (
      await host.authority.request({
        ...input,
        payload: { ...input.payload, data: Buffer.alloc(IMPORT_CHUNK_BYTES, 8).toString('base64') }
      })
    ).outcome,
    'not-started'
  );
  assert.equal(host.authority.outcomes.size, 1);
});

test('legacy UUID chunks keep permanent replay protection when mixed with sequenced chunks', async () => {
  const host = transferHarness();
  await host.command('import.begin', { transferId: 'transfer_123', name: 'test.txt', size: 20 });
  const legacy = host.chunk('transfer_123', 0, 'AQ==', {
    id: '42307434-a1b2-432d-873b-ac657bbc2709'
  });
  assert.equal((await host.authority.request(legacy)).value, 1);
  assert.equal(
    (await host.authority.request(host.chunk('transfer_123', 0))).outcome,
    'not-started'
  );
  for (let sequence = 1; sequence < 20; sequence++)
    await host.authority.request(host.chunk('transfer_123', sequence));
  assert.equal((await host.authority.request(legacy)).value, 1);
  assert.equal(
    (await host.authority.request({ ...legacy, payload: { ...legacy.payload, data: 'Ag==' } }))
      .outcome,
    'not-started'
  );
  assert.equal(host.authority.outcomes.size, 2);
});

test('transfer identity tombstones are bounded without forgetting exhausted identities', () => {
  const transfer = new ImportTransfer();
  for (let index = 0; index < 2048; index++) {
    transfer.begin(scope, `transfer_${index}`, 'test.txt', 1);
    transfer.cancel();
  }
  assert.equal(transfer.usedIds.size, 2048);
  assert.throws(() => transfer.begin(scope, 'transfer_new', 'test.txt', 1), /history is full/);
  assert.throws(
    () => transfer.begin({ ...scope, epoch: 2 }, 'transfer_0', 'test.txt', 1),
    /already been used/
  );
});

test('late unknown chunk acknowledgement cannot cancel a newer account transfer', async () => {
  let reject;
  const lost = new Promise((_, fail) => {
    reject = fail;
  });
  const host = transferHarness({
    afterChunk: (input) => (input.payload.transferId === 'transfer_old' ? lost : undefined)
  });
  await host.command('import.begin', { transferId: 'transfer_old', name: 'old.txt', size: 1 });
  const old = host.chunk('transfer_old', 0);
  const pending = host.authority.request(old);
  host.upload.cancel();
  host.setScope({ ...scope, epoch: 2 });
  await host.command('import.begin', { transferId: 'transfer_new', name: 'new.txt', size: 1 });
  reject(new Error('old account acknowledgement lost'));
  const stale = await pending;
  assert.equal(stale.outcome, 'unknown');
  assert.equal(stale.stale, true);
  assert.equal(host.upload.current.id, 'transfer_new');
  assert.equal((await host.authority.request(host.chunk('transfer_new', 0))).ok, true);
  assert.equal((await host.command('import.commit', { transferId: 'transfer_new' })).ok, true);
  assert.deepEqual(host.saved, [{ name: 'new.txt', size: 1 }]);
});

test('evicted chunk identities stay expired after completion and account ABA', async () => {
  const host = transferHarness();
  await host.command('import.begin', { transferId: 'transfer_old', name: 'old.txt', size: 20 });
  const old = host.chunk('transfer_old', 0);
  for (let sequence = 0; sequence < 20; sequence++)
    await host.authority.request(host.chunk('transfer_old', sequence));
  const commit = host.make('import.commit', { transferId: 'transfer_old' });
  const saved = await host.authority.request(commit);
  assert.equal(saved.outcome, 'completed');
  assert.equal(host.authority.chunks.has(old.id), false);
  const calls = host.calls.length;
  assert.equal((await host.authority.request(old)).outcome, 'not-started');
  host.setScope({ ...scope, epoch: 2 });
  assert.equal((await host.authority.request({ ...old, epoch: 2 })).outcome, 'not-started');
  assert.equal(host.calls.length, calls);
  assert.throws(
    () => host.upload.begin({ ...scope, epoch: 2 }, 'transfer_old', 'retry.txt', 1),
    /already been used/
  );
  const duplicate = await host.authority.request(commit);
  assert.equal(duplicate.outcome, 'completed');
  assert.equal(duplicate.value, saved.value);
  assert.equal(duplicate.stale, true);
  assert.equal(host.saved.length, 1);
});

test('unmount during a delayed chunk prevents its application and retains an unknown stale receipt', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const host = transferHarness({ beforeChunk: () => gate });
  await host.command('import.begin', { transferId: 'transfer_123', name: 'test.txt', size: 1 });
  const chunk = host.chunk('transfer_123', 0);
  const pending = host.authority.request(chunk);
  host.lifetime.abort();
  release();
  const result = await pending;
  assert.equal(result.outcome, 'unknown');
  assert.equal(result.stale, true);
  assert.equal(host.upload.current, undefined);
  assert.equal((await host.authority.request(chunk)).outcome, 'unknown');
  assert.equal(host.calls.filter((method) => method === 'import.chunk').length, 1);
});

test('permanent receipt capacity is unchanged and completed outcomes are never evicted', async () => {
  let count = 0;
  const authority = new BridgeAuthority(
    () => scope,
    async () => ++count,
    new AbortController().signal
  );
  for (let index = 0; index < 2048; index++)
    assert.equal(
      (await authority.request(request({ id: `permanent_${index}`, method: 'delete' }))).ok,
      true
    );
  assert.equal(
    (await authority.request(request({ id: 'permanent_next', method: 'delete' }))).outcome,
    'not-started'
  );
  assert.equal(
    (await authority.request(request({ id: 'permanent_0', method: 'delete' }))).value,
    1
  );
  assert.equal(count, 2048);
  assert.equal(authority.outcomes.size, 2048);
});
