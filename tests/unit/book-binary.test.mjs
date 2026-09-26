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
  image.arrayBuffer = async () => {
    throw new DOMException('Missing backing file', 'NotFoundError');
  };
  const original = { blobs: { image }, coverImage: undefined };
  await assert.rejects(encodeBook(original), { name: 'NotFoundError' });
  assert.equal(original.blobs.image, image);
});
