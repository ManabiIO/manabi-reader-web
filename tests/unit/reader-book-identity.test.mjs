/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { identifyReaderBook } from '../../apps/web/src/lib/manabi/reader-book-identity.ts';
import { canonical } from '../../apps/web/src/lib/manabi/ttu-migration-format.ts';

const data = () => ({
  title: '本',
  elementHtml: '<p>本</p>',
  styleSheet: 'p {color:red}',
  sections: [{ reference: 'p', charactersWeight: 1, startCharacter: 0, characters: 300 }],
  language: 'ja',
  creators: [{ name: 'Writer' }],
  blobs: { 'image.png': new Blob(['image']) },
  coverImage: new Blob(['cover'])
});
const hash = async (value) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : new Uint8Array(await value.arrayBuffer()))
    .digest('hex');

test('shared identity preserves existing import receipt fingerprints exactly', async () => {
  const book = data();
  const previous = await hash(
    canonical({
      html: book.elementHtml,
      css: book.styleSheet,
      sections: book.sections,
      language: book.language,
      creators: book.creators,
      metadata: book.metadata,
      pageDirection: book.pageDirection,
      characters: 300,
      media: [['image.png', await hash(book.blobs['image.png'])]],
      cover: await hash(book.coverImage)
    })
  );
  assert.deepEqual(await identifyReaderBook(book, 300), { fingerprint: previous, characters: 300 });
  assert.deepEqual(await identifyReaderBook(book, 0), { fingerprint: previous, characters: 300 });
});

test('media, sections and text prove identity; local IDs and claimed hashes do not', async () => {
  const before = await identifyReaderBook(data(), 300);
  assert.deepEqual(
    await identifyReaderBook(
      { ...data(), id: 90, contentHash: 'f'.repeat(64), lastBookOpen: 100 },
      300
    ),
    before
  );
  for (const changes of [
    { elementHtml: '<p>different</p>' },
    { coverImage: new Blob(['other']) },
    { blobs: { 'image.png': new Blob(['other']) } },
    { sections: [{ reference: 'other', charactersWeight: 1 }] }
  ])
    assert.notEqual(
      (await identifyReaderBook({ ...data(), ...changes }, 300)).fingerprint,
      before.fingerprint
    );
});

test('mutating input after hashing begins cannot relabel the accepted book', async () => {
  const book = data(),
    expected = await identifyReaderBook(data(), 300);
  const pending = identifyReaderBook(book, 300);
  book.sections[0].reference = 'changed';
  book.blobs['image.png'] = new Blob(['changed']);
  book.creators[0].name = 'Other';
  book.coverImage = new Blob(['changed']);
  assert.deepEqual(await pending, expected);
});

test('invalid character counts and cancellation return no identity', async () => {
  for (const characters of [-1, NaN, 0.5, Number.MAX_SAFE_INTEGER + 1])
    await assert.rejects(identifyReaderBook(data(), characters));
  const controller = new AbortController();
  const pending = identifyReaderBook(data(), 300, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});
