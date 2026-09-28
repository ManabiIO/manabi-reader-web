/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { getDropEventFiles } from '../../apps/web/src/lib/functions/file-dom/get-drop-event-files';

function event(items: unknown[] | undefined, files: File[] = []): DragEvent {
  return { dataTransfer: { items, files } } as unknown as DragEvent;
}

function fileEntry(file: File, fullPath = `/${file.name}`) {
  return {
    isDirectory: false,
    fullPath,
    file(resolve: (value: File) => void) {
      queueMicrotask(() => resolve(file));
    }
  };
}

function fileItem(file: File | null, entry: unknown = null) {
  return { kind: 'file', webkitGetAsEntry: () => entry, getAsFile: () => file };
}

function directory(batches: unknown[][]) {
  return {
    isDirectory: true,
    createReader() {
      let index = 0;
      return {
        readEntries(resolve: (entries: unknown[]) => void) {
          queueMicrotask(() => resolve(batches[index++] ?? []));
        }
      };
    }
  };
}

test('a drop without a data transfer is empty', async () => {
  assert.deepEqual(await getDropEventFiles({ dataTransfer: null } as DragEvent), []);
});

for (const items of [undefined, []]) {
  test(`FileList-only drops work with ${items ? 'empty' : 'missing'} items`, async () => {
    const file = new File(['本'], 'book.epub');
    assert.deepEqual(await getDropEventFiles(event(items, [file])), [file]);
  });
}

test('plain files work when the Entries API is unavailable', async () => {
  const file = new File(['本'], 'book.txt');
  const item = { kind: 'file', getAsFile: () => file };
  assert.deepEqual(await getDropEventFiles(event([item])), [file]);
});

test('a null entry falls back to the original File and its metadata', async () => {
  const file = new File(['日本語'], 'book.epub', {
    type: 'application/epub+zip',
    lastModified: 1234
  });
  const [result] = await getDropEventFiles(event([fileItem(file)]));
  assert.equal(result, file);
  assert.equal(result.type, 'application/epub+zip');
  assert.equal(result.lastModified, 1234);
  assert.equal(await result.text(), '日本語');
});

test('mixed entry and fallback files keep their order without duplicating FileList data', async () => {
  const first = new File(['one'], 'one.txt');
  const second = new File(['two'], 'two.txt');
  const third = new File(['three'], 'three.txt');
  const result = await getDropEventFiles(
    event(
      [fileItem(first), fileItem(second, fileEntry(second)), fileItem(third)],
      [first, second, third]
    )
  );
  assert.deepEqual(
    result.map((file) => file.name),
    ['one.txt', 'two.txt', 'three.txt']
  );
  assert.deepEqual(await Promise.all(result.map((file) => file.text())), ['one', 'two', 'three']);
});

test('a usable entry is not replaced by a fallback File', async () => {
  const file = new File(['book'], 'book.txt');
  const item = fileItem(file, fileEntry(file, '/shelf/book.txt'));
  item.getAsFile = () => {
    throw new Error('must not replace an entry');
  };
  const [result] = await getDropEventFiles(event([item], [file]));
  assert.equal(result.webkitRelativePath, 'shelf/book.txt');
  assert.equal(await result.text(), 'book');
});

test('fallback files are captured before an earlier directory finishes reading', async () => {
  const inside = new File(['inside'], 'inside.txt');
  const outside = new File(['outside'], 'outside.txt');
  let readable = true;
  const fallback = {
    kind: 'file',
    webkitGetAsEntry: () => null,
    getAsFile() {
      assert.equal(readable, true, 'drop data must be captured synchronously');
      return outside;
    }
  };
  const pending = getDropEventFiles(
    event([fileItem(null, directory([[fileEntry(inside, '/shelf/inside.txt')]])), fallback])
  );
  readable = false;
  const result = await pending;
  assert.deepEqual(
    result.map((file) => file.name),
    ['inside.txt', 'outside.txt']
  );
});

test('FileList-only data is snapshotted before the drop store is cleared', async () => {
  const file = new File(['本'], 'book.epub');
  const files = [file];
  const pending = getDropEventFiles(event(undefined, files));
  files.length = 0;
  assert.deepEqual(await pending, [file]);
});

test('directory pagination and nested package-relative paths remain intact', async () => {
  const first = new File(['mime'], 'mimetype');
  const second = new File(['xml'], 'container.xml');
  const root = directory([
    [fileEntry(first, '/Book.epub/mimetype')],
    [directory([[fileEntry(second, '/Book.epub/META-INF/container.xml')]])]
  ]);
  const result = await getDropEventFiles(event([fileItem(null, root)]));
  assert.deepEqual(
    result.map((file) => file.webkitRelativePath),
    ['Book.epub/mimetype', 'Book.epub/META-INF/container.xml']
  );
});

test('an entry read failure rejects instead of silently using a pathless fallback', async () => {
  const failure = new Error('entry permission revoked');
  const file = new File(['book'], 'book.txt');
  const entry = {
    isDirectory: false,
    file(_resolve: unknown, reject: (error: Error) => void) {
      reject(failure);
    }
  };
  await assert.rejects(
    getDropEventFiles(event([fileItem(file, entry)])),
    (error) => error === failure
  );
});

test('directory enumeration failure is preserved', async () => {
  const failure = new Error('directory permission revoked');
  const entry = {
    isDirectory: true,
    createReader() {
      return {
        readEntries(_resolve: unknown, reject: (error: Error) => void) {
          reject(failure);
        }
      };
    }
  };
  await assert.rejects(
    getDropEventFiles(event([fileItem(null, entry)])),
    (error) => error === failure
  );
});

test('non-file items and unreadable file items do not invent files', async () => {
  const text = {
    kind: 'string',
    webkitGetAsEntry() {
      throw new Error('not a file');
    }
  };
  assert.deepEqual(await getDropEventFiles(event([text, fileItem(null)])), []);
});
