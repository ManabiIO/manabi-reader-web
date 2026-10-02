import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BridgeAuthority,
  ImportTransfer,
  parseBridgeRequest,
  safeExternalLink,
  IMPORT_CHUNK_BYTES
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
