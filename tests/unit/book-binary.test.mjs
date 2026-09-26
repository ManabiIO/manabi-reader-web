import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  encodeBook,
  decodeBook
} from '../../apps/web/src/lib/data/database/books-db/book-binary.ts';

test('book binary bytes survive structured clone with MIME and arbitrary resource keys intact', async () => {
  const bytes = new Uint8Array([0, 1, 127, 128, 255]);
  const image = new Blob([bytes], { type: 'image/png' });
  const book = {
    id: 42,
    title: '本',
    elementHtml: '<img>',
    blobs: Object.fromEntries([
      ['絵.png', image],
      ['__proto__', image],
      ['empty', new Blob([])]
    ]),
    coverImage: image,
    manabiTtuImport: { version: 1, sourceTitle: '本' }
  };
  const stored = await encodeBook(book);
  assert.equal(stored.blobs['絵.png'] instanceof Blob, false);
  assert.deepEqual(new Uint8Array(stored.blobs['絵.png'].bytes), bytes);
  assert.equal(book.blobs['絵.png'], image);
  const restored = decodeBook(globalThis.structuredClone(stored));
  assert.deepEqual(Object.keys(restored.blobs), ['絵.png', '__proto__', 'empty']);
  assert.deepEqual(new Uint8Array(await restored.blobs['__proto__'].arrayBuffer()), bytes);
  assert.deepEqual(new Uint8Array(await restored.coverImage.arrayBuffer()), bytes);
  assert.equal(restored.coverImage.type, 'image/png');
  assert.equal(restored.blobs.empty.size, 0);
  assert.deepEqual(restored.manabiTtuImport, book.manabiTtuImport);
  assert.equal(restored.title, book.title);
});

test('legacy records stay readable, while re-saving converts their bytes without changing portable content', async () => {
  const book = {
    blobs: { image: new Blob(['legacy'], { type: 'image/svg+xml' }) },
    coverImage: 'image'
  };
  assert.equal(await decodeBook(book).blobs.image.text(), 'legacy');
  const stored = await encodeBook(book);
  assert.deepEqual(await encodeBook(stored), stored);
  assert.equal(decodeBook(stored).coverImage, 'image');
  assert.equal(await decodeBook(stored).blobs.image.text(), 'legacy');
});

test('unreadable legacy backing files fail before a replacement can be written', async () => {
  const image = new Blob(['original']);
  const cause = new DOMException('Missing backing file', 'NotFoundError');
  image.arrayBuffer = async () => {
    throw cause;
  };
  const original = { blobs: { image }, coverImage: undefined };
  await assert.rejects(encodeBook(original), (error) => {
    assert.equal(error.cause, cause);
    assert.match(error.message, /re-import the original source/i);
    return true;
  });
  assert.equal(original.blobs.image, image);
});

test('binary preparation aborts are save failures, never user cancellation', async () => {
  const image = new Blob(['unreadable']);
  const cause = new DOMException('Native byte read failed', 'AbortError');
  image.arrayBuffer = async () => {
    throw cause;
  };
  await assert.rejects(encodeBook({ blobs: { image } }), (error) => {
    assert.notEqual(error.name, 'AbortError');
    assert.equal(error.cause, cause);
    assert.match(error.message, /could not be read/i);
    return true;
  });
});

test('encoding rejects malformed stored binary values before any database write', async () => {
  for (const value of [
    null,
    {},
    'bad',
    42,
    { format: 'reader-bytes-v2', type: 'image/png', bytes: new ArrayBuffer(1) },
    { format: 'reader-bytes-v1', type: 7, bytes: new ArrayBuffer(1) },
    { format: 'reader-bytes-v1', type: 'image/png', bytes: new Uint8Array(1) }
  ]) {
    await assert.rejects(encodeBook({ blobs: { image: value } }), /unsupported image format/);
    assert.throws(() => decodeBook({ blobs: { image: value } }), /unsupported image format/);
  }
});

test('re-encoding byte records owns the bytes and strips unrelated record fields', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const record = {
    format: 'reader-bytes-v1',
    type: 'image/png',
    bytes: bytes.buffer,
    extra: new Blob(['unexpected'])
  };
  const result = await encodeBook({ blobs: { image: record } });
  bytes[0] = 9;
  assert.deepEqual([...new Uint8Array(result.blobs.image.bytes)], [1, 2, 3]);
  assert.deepEqual(Object.keys(result.blobs.image).sort(), ['bytes', 'format', 'type']);
});

test('shared cover and image Blob is read once per encoding operation', async () => {
  const image = new Blob(['shared'], { type: 'image/png' });
  const read = image.arrayBuffer.bind(image);
  let calls = 0;
  image.arrayBuffer = () => {
    calls++;
    return read();
  };
  const result = await encodeBook({ blobs: { a: image, b: image }, coverImage: image });
  assert.equal(calls, 1);
  assert.equal(result.blobs.a, result.blobs.b);
  assert.equal(result.blobs.a, result.coverImage);
});

test('binary preparation snapshots nested metadata and queued byte records before its first await', async () => {
  let entered, release;
  const started = new Promise((resolve) => (entered = resolve));
  const gate = new Promise((resolve) => (release = resolve));
  const image = new Blob(['first']);
  const read = image.arrayBuffer.bind(image);
  image.arrayBuffer = async () => {
    entered();
    await gate;
    return read();
  };
  const queuedBytes = new Uint8Array([1, 2, 3]);
  const later = { format: 'reader-bytes-v1', type: 'image/png', bytes: queuedBytes.buffer };
  const book = {
    title: 'Original',
    sections: [{ title: 'Original section', nested: { offset: 5 } }],
    publicationManifest: { spine: [{ href: 'original.xhtml' }] },
    manabiTtuImport: { entries: ['original receipt'] },
    blobs: { first: image, later },
    coverImage: later
  };
  const pending = encodeBook(book);
  await started;
  book.sections[0].nested.offset = 999;
  book.publicationManifest.spine[0].href = 'wrong.xhtml';
  book.manabiTtuImport.entries.push('later receipt');
  queuedBytes[0] = 9;
  later.type = 'text/plain';
  release();
  const result = await pending;
  assert.equal(result.sections[0].nested.offset, 5);
  assert.equal(result.publicationManifest.spine[0].href, 'original.xhtml');
  assert.deepEqual(result.manabiTtuImport.entries, ['original receipt']);
  assert.deepEqual([...new Uint8Array(result.blobs.later.bytes)], [1, 2, 3]);
  assert.equal(result.blobs.later.type, 'image/png');
  assert.equal(result.blobs.later, result.coverImage);
});

test('invalid queued byte records fail before an earlier image starts asynchronous work', async () => {
  const image = new Blob(['first']);
  let reads = 0;
  image.arrayBuffer = async () => {
    reads++;
    return new ArrayBuffer(1);
  };
  await assert.rejects(
    encodeBook({ blobs: { first: image, later: { format: 'invalid' } } }),
    /unsupported image format/
  );
  assert.equal(reads, 0);
});
