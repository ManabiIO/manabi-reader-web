/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BlobWriter,
  TextReader,
  ZipWriter
} from '../../apps/web/node_modules/@zip.js/zip.js/index.js';
import {
  LimitedArchive,
  BOOK_ARCHIVE_LIMITS,
  validateArchivePath,
  resolveArchivePath
} from '../../apps/web/src/lib/functions/file-loaders/utils/limited-archive';

async function zip(files: Record<string, string>) {
  const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
  for (const [name, contents] of Object.entries(files)) {
    await writer.add(name, new TextReader(contents));
  }
  return writer.close();
}
const options = { useWebWorkers: false };
const limits = (values: Partial<typeof BOOK_ARCHIVE_LIMITS>) => ({
  ...BOOK_ARCHIVE_LIMITS,
  ...values
});

test('reads an ordinary compressed Japanese entry with exact bytes', async () => {
  const archive = await LimitedArchive.open(
    await zip({ 'OEBPS/text.xhtml': '<ruby>本<rt>ほん</rt></ruby>' }),
    options
  );
  try {
    assert.equal(await archive.readText('OEBPS/text.xhtml'), '<ruby>本<rt>ほん</rt></ruby>');
  } finally {
    await archive.close();
  }
});

test('rejects compressed input over the configured cap', async () => {
  await assert.rejects(
    LimitedArchive.open(new Blob(['oversized']), { limits: limits({ compressedBytes: 2 }) }),
    /Compressed archive/
  );
});

test('rejects entry count before extracting data', async () => {
  await assert.rejects(
    LimitedArchive.open(await zip({ a: 'a', b: 'b' }), {
      ...options,
      limits: limits({ entryCount: 1 })
    }),
    /too many entries/
  );
});

test('rejects declared entry and aggregate ZIP bombs', async () => {
  const blob = await zip({ a: 'a'.repeat(1000), b: 'b'.repeat(1000) });
  await assert.rejects(
    LimitedArchive.open(blob, { ...options, limits: limits({ entryBytes: 500 }) }),
    /entry is too large/
  );
  await assert.rejects(
    LimitedArchive.open(blob, { ...options, limits: limits({ totalBytes: 1500 }) }),
    /decompressed size/
  );
});

test('actual decoder output is bounded even when central-directory size lies', async () => {
  const bytes = new Uint8Array(await (await zip({ a: 'x'.repeat(100000) })).arrayBuffer());
  const view = new DataView(bytes.buffer);
  for (let offset = 0; offset + 46 < bytes.length; offset++) {
    if (view.getUint32(offset, true) === 0x02014b50) view.setUint32(offset + 24, 1, true);
  }
  const archive = await LimitedArchive.open(new Blob([bytes]), {
    ...options,
    limits: limits({ entryBytes: 1000 })
  });
  try {
    await assert.rejects(archive.readBlob('a'), /Decoded archive entry is too large/);
  } finally {
    await archive.close();
  }
});

test('text has a lower independent budget', async () => {
  const archive = await LimitedArchive.open(await zip({ a: 'long text' }), {
    ...options,
    limits: limits({ textBytes: 2 })
  });
  try {
    await assert.rejects(archive.readText('a'), /resource is too large/);
  } finally {
    await archive.close();
  }
});

test('cumulative output budget includes repeated reads', async () => {
  const archive = await LimitedArchive.open(await zip({ a: '1234' }), {
    ...options,
    limits: limits({ totalBytes: 5 })
  });
  try {
    assert.equal(await archive.readText('a'), '1234');
    await assert.rejects(archive.readText('a'), /Decoded archive data/);
  } finally {
    await archive.close();
  }
});

test('queued reads settle on cancellation and closed archives reject reads', async () => {
  const controller = new AbortController();
  const archive = await LimitedArchive.open(await zip({ a: 'x'.repeat(100000) }), {
    ...options,
    signal: controller.signal,
    limits: limits({ concurrency: 1 })
  });
  const requests = Array.from({ length: 6 }, () => archive.readText('a'));
  controller.abort();
  const settled = await Promise.allSettled(requests);
  assert(settled.every((result) => result.status === 'rejected'));
  await archive.close();
  await assert.rejects(archive.readText('a'), { name: 'AbortError' });
});

test('pre-aborted import never exposes an archive', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    LimitedArchive.open(await zip({ a: 'a' }), { ...options, signal: controller.signal }),
    { name: 'AbortError' }
  );
});

test('bounded map never starts more than the configured concurrency', async () => {
  const archive = await LimitedArchive.open(await zip({ a: 'a' }), options);
  let active = 0,
    peak = 0;
  try {
    const results = await archive.map([1, 2, 3, 4, 5], async (item) => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return item * 2;
    });
    assert.deepEqual(results, [2, 4, 6, 8, 10]);
    assert.equal(peak, 2);
  } finally {
    await archive.close();
  }
});

test('map failure drains active operations, rejects once, and stops queued work', async () => {
  const archive = await LimitedArchive.open(await zip({ a: 'a' }), options);
  let finished = false,
    started = 0;
  try {
    await assert.rejects(
      archive.map([1, 2, 3, 4], async (item) => {
        started++;
        if (item === 1) throw new Error('bad entry');
        await new Promise((resolve) => setTimeout(resolve, 5));
        finished = true;
      }),
      /bad entry/
    );
    assert.equal(started, 2); // the other already-admitted worker is drained
    assert.equal(finished, true);
  } finally {
    await archive.close();
  }
});

for (const path of ['../a', '/a', 'a/../b', 'a\\b', 'C:/book', 'a//b', 'a/%2e%2e/b', 'a\0b']) {
  test(`rejects unsafe path ${JSON.stringify(path)}`, () =>
    assert.throws(() => validateArchivePath(path), /Unsafe archive/));
}

test('manifest resolution permits ordinary parent paths inside the ZIP, never above its root', () => {
  assert.equal(
    resolveArchivePath('OEBPS/text/chapter.xhtml', '../images/表紙.png'),
    'OEBPS/images/表紙.png'
  );
  assert.equal(resolveArchivePath('OEBPS/content.opf', 'text/a%20b.xhtml'), 'OEBPS/text/a b.xhtml');
  assert.throws(() => resolveArchivePath('content.opf', '../cover.png'), /escapes/);
  assert.throws(
    () => resolveArchivePath('content.opf', 'https://example.test/a'),
    /relative local/
  );
});

test('prototype-like entry names remain ordinary Map data', async () => {
  const archive = await LimitedArchive.open(await zip({ constructor: 'safe' }), options);
  try {
    assert.equal(await archive.readText('constructor'), 'safe');
  } finally {
    await archive.close();
  }
});
