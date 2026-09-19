/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BlobReader,
  BlobWriter,
  TextReader,
  ZipWriter
} from '../../apps/web/node_modules/@zip.js/zip.js/index.js';
import {
  ArchiveBudget,
  LimitedArchive,
  BOOK_ARCHIVE_LIMITS,
  BACKUP_ARCHIVE_LIMITS
} from '../../apps/web/src/lib/functions/file-loaders/utils/limited-archive';
import { readRestoredBook } from '../../apps/web/src/lib/functions/file-loaders/utils/restored-book';

const options = { useWebWorkers: false };
const meta = {
  title: '復元 / 日本語',
  elementHtml: '<div><p><ruby>猫<rt>ねこ</rt></ruby></p></div>',
  styleSheet: 'ruby{ruby-position:over}',
  sections: [{ reference: 's1', charactersWeight: 1, characters: 1, startCharacter: 0 }],
  language: 'ja'
};
async function zip(files: Record<string, string | Blob>) {
  const writer = new ZipWriter(new BlobWriter(), options);
  for (const [name, data] of Object.entries(files))
    await writer.add(name, typeof data === 'string' ? new TextReader(data) : new BlobReader(data));
  return writer.close();
}
const mime = (name: string) => (name.endsWith('.png') ? 'image/png' : '');
async function book(value: unknown = meta, images: Record<string, string | Blob> = {}) {
  return zip({ 'staticdata.json': JSON.stringify(value), ...images });
}

test('real nested backup preserves Japanese title, ruby, sections and local resources', async () => {
  const nested = await book(meta, {
    'blobs/pic.png': new Blob(['image']),
    'cover.png': new Blob(['cover'])
  });
  const outer = await LimitedArchive.open(
    await zip({ '復元 %2F 日本語/bookdata_1_10_1_0_0.zip': nested }),
    { ...options, literalNames: true, limits: BACKUP_ARCHIVE_LIMITS }
  );
  try {
    const restored = await readRestoredBook(
      await outer.readBlob('復元 %2F 日本語/bookdata_1_10_1_0_0.zip'),
      mime,
      options
    );
    assert.equal(restored?.title, meta.title);
    assert.equal(restored?.elementHtml, meta.elementHtml);
    assert.deepEqual(restored?.sections, meta.sections);
    assert.equal(restored?.language, 'ja');
    assert.equal(await restored?.blobs['pic.png'].text(), 'image');
    assert.equal(restored?.blobs['pic.png'].type, 'image/png');
    assert.equal(await restored?.coverImage?.text(), 'cover');
  } finally {
    await outer.close();
  }
});
test('one shared budget charges both compressed nested bytes and decoded book content', async () => {
  const nested = await book({ ...meta, elementHtml: 'x'.repeat(5000) });
  const budget = new ArchiveBudget(nested.size + 4000);
  const outer = await LimitedArchive.open(await zip({ 'title/book.zip': nested }), {
    ...options,
    budget
  });
  try {
    const source = await outer.readBlob('title/book.zip');
    await assert.rejects(
      readRestoredBook(source, mime, { ...options, budget }),
      /shared size limit/
    );
  } finally {
    await outer.close();
  }
});
test('shared budget spans separate restored books and does not reset after errors', async () => {
  const blob = await book();
  const size = new TextEncoder().encode(JSON.stringify(meta)).byteLength;
  const budget = new ArchiveBudget(size + 1);
  assert.ok(await readRestoredBook(blob, mime, { ...options, budget }));
  await assert.rejects(readRestoredBook(blob, mime, { ...options, budget }), /shared size limit/);
  await assert.rejects(readRestoredBook(blob, mime, { ...options, budget }), /shared size limit/);
});
for (const name of ['../escape', '/absolute', 'a/../b', 'a\\b', 'a//b']) {
  test(`literal backup keys still reject actual path traversal: ${name}`, async () => {
    await assert.rejects(
      LimitedArchive.open(await zip({ [name]: 'x' }), { ...options, literalNames: true }),
      /Unsafe archive path/
    );
  });
}
test('encoded title punctuation is literal in backup mode but rejected in EPUB mode', async () => {
  const z = await zip({ 'title%2Fpart/book.zip': 'x' });
  await assert.rejects(LimitedArchive.open(z, options), /Unsafe archive path/);
  const a = await LimitedArchive.open(z, { ...options, literalNames: true });
  try {
    assert.equal(await a.readText('title%2Fpart/book.zip'), 'x');
  } finally {
    await a.close();
  }
});
test('metadata must exist and validate before exposing a restored book', async () => {
  await assert.rejects(
    readRestoredBook(await zip({ 'blobs/a.png': 'x' }), mime, options),
    /not found/
  );
  assert.equal(await readRestoredBook(await zip({}), mime, options), undefined);
});
for (const value of [
  null,
  [],
  {},
  { ...meta, title: 12 },
  { ...meta, elementHtml: '' },
  { ...meta, styleSheet: {} },
  { ...meta, sections: {} },
  { ...meta, sections: [{ reference: 'x', charactersWeight: -1 }] },
  { ...meta, sections: [{ reference: 'x', charactersWeight: 1, characters: -2 }] },
  { ...meta, htmlBackup: 3 }
]) {
  test(`invalid metadata is rejected: ${JSON.stringify(value).slice(0, 80)}`, async () => {
    await assert.rejects(
      readRestoredBook(await book(value), mime, options),
      /Invalid restored book/
    );
  });
}
test('JSON entry cap is enforced before text decoding', async () => {
  await assert.rejects(
    readRestoredBook(await book(), mime, {
      ...options,
      limits: { ...BOOK_ARCHIVE_LIMITS, textBytes: 10 }
    }),
    /resource is too large/
  );
});
test('ambiguous multiple covers reject the book', async () => {
  await assert.rejects(
    readRestoredBook(await book(meta, { 'cover.png': 'a', 'cover.jpg': 'b' }), mime, options),
    /multiple covers/
  );
});
test('pre-aborted nested import returns no partial book and next independent import succeeds', async () => {
  const blob = await book();
  const c = new AbortController();
  c.abort();
  await assert.rejects(readRestoredBook(blob, mime, { ...options, signal: c.signal }), {
    name: 'AbortError'
  });
  assert.ok(await readRestoredBook(blob, mime, options));
});
test('cancellation during nested import drains jobs without returning partial book', async () => {
  const blob = await book(
    meta,
    Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [`blobs/${i}.png`, new Blob(['x'.repeat(50000)])])
    )
  );
  const c = new AbortController();
  await assert.rejects(
    readRestoredBook(blob, mime, { ...options, signal: c.signal }, () => c.abort()),
    { name: 'AbortError' }
  );
});
test('JSON prototype keys are never spread into the restored model', async () => {
  const payload = JSON.parse(
    JSON.stringify(meta).slice(0, -1) +
      ',"__proto__":{"polluted":true},"id":123,"storageSource":"foreign"}'
  );
  const result = await readRestoredBook(
    await book(payload, { 'blobs/__proto__': 'ok' }),
    mime,
    options
  );
  assert.ok(result);
  assert.equal(Object.getPrototypeOf(result.blobs), null);
  assert.equal(Object.hasOwn(result, 'storageSource'), false);
  assert.equal(Object.hasOwn(result, 'id'), false);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});
