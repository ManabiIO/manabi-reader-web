import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudSource, sourceLifetime } from '../../.cache/media-test-build/sources.js';
test('a source without an account lifetime stays compatible', () => {
  const check = sourceLifetime({});
  assert.doesNotThrow(check);
  assert.doesNotThrow(check);
});
test('capture preserves predicate receiver and latches original failures', () => {
  const source = {
    valid: true,
    isCurrent() {
      return this.valid;
    }
  };
  const check = sourceLifetime(source);
  check();
  source.valid = false;
  assert.throws(check, /source.*current/i);
  source.valid = true;
  source.isCurrent = () => true;
  assert.throws(check, /source.*current/i);
});
test('a throwing lifetime predicate is not interpreted as permission or retried', () => {
  let calls = 0;
  const reason = new Error('provider revoked');
  const check = sourceLifetime({
    isCurrent() {
      calls++;
      throw reason;
    }
  });
  for (let n = 0; n < 2; n++) assert.throws(check, (error) => error === reason);
  assert.equal(calls, 1);
});

test('a revoked cloud source cannot revive when its account predicate becomes true again', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL('https://reader.example/')
  });
  let allowed = true;
  let checks = 0;
  const version = 'a'.repeat(64);
  try {
    const source = cloudSource(
      {
        name: 'video.webm',
        size: 1024,
        version,
        url:
          '/api/reader-web/connections/11111111-1111-4111-8111-111111111111/media/' +
          '?id=file&root=root&user=user&version=' +
          version
      },
      'user',
      () => {
        checks++;
        return allowed;
      }
    );
    assert.doesNotThrow(() => source.playback());
    allowed = false;
    assert.throws(() => source.playback(), /Account changed/);
    allowed = true;
    assert.throws(() => source.playback(), /Account changed/);
    assert.equal(source.isCurrent(), false);
    assert.equal(checks, 2, 'revoked source retried its authority predicate');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'location', previous);
    else delete globalThis.location;
  }
});

test('streamed ranges preserve nonzero offsets above four GiB without truncation', async () => {
  const gib = 1024 ** 3;
  const start = 5 * gib + 12345;
  const end = start + 2 * 1024 * 1024 + 17;
  const calls = [];
  const source = {
    name: 'Huge.webm',
    size: 7 * gib,
    version: 'huge',
    async read(a, b, signal) {
      signal.throwIfAborted();
      calls.push([a, b]);
      const bytes = new Uint8Array(b - a);
      bytes[0] = a % 251;
      bytes[bytes.length - 1] = (b - 1) % 251;
      return bytes;
    }
  };
  const reader = (await import('../../.cache/media-test-build/sources.js'))
    .streamedRange(source, start, end, new AbortController().signal)
    .getReader();
  const chunks = [];
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
  }
  reader.releaseLock();
  assert.deepEqual(calls, [
    [start, start + 1024 * 1024],
    [start + 1024 * 1024, start + 2 * 1024 * 1024],
    [start + 2 * 1024 * 1024, end]
  ]);
  assert.equal(
    chunks.reduce((sum, bytes) => sum + bytes.length, 0),
    end - start
  );
  assert.equal(chunks[0][0], start % 251);
  assert.equal(chunks.at(-1).at(-1), (end - 1) % 251);
});

test('cloud range requests preserve offsets above four GiB end to end', async () => {
  const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const gib = 1024 ** 3;
  const size = 7 * gib;
  const start = 5 * gib + 54321;
  const end = start + 257;
  const version = 'b'.repeat(64);
  const user = 'large-user';
  const seen = [];
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL('https://reader.example/')
  });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input, init) => {
      seen.push({
        url: String(input),
        range: init?.headers?.Range,
        user: init?.headers?.['X-Manabi-User']
      });
      return new Response(new Uint8Array(end - start).fill(7), {
        status: 206,
        headers: {
          'X-Manabi-User': user,
          ETag: `"${version}"`,
          'Content-Range': `bytes ${start}-${end - 1}/${size}`
        }
      });
    }
  });
  try {
    const source = cloudSource(
      {
        name: 'Huge.webm',
        size,
        version,
        url:
          '/api/reader-web/connections/11111111-1111-4111-8111-111111111111/media/' +
          `?id=huge&root=root&user=${user}&version=${version}`
      },
      user,
      () => true
    );
    const bytes = await source.read(start, end, new AbortController().signal);
    assert.equal(bytes.length, end - start);
    assert.deepEqual(seen, [
      {
        url:
          'https://reader.example/api/reader-web/connections/11111111-1111-4111-8111-111111111111/media/' +
          `?id=huge&root=root&user=${user}&version=${version}`,
        range: `bytes=${start}-${end - 1}`,
        user
      }
    ]);
  } finally {
    if (locationDescriptor) Object.defineProperty(globalThis, 'location', locationDescriptor);
    else delete globalThis.location;
    if (fetchDescriptor) Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
    else delete globalThis.fetch;
  }
});
