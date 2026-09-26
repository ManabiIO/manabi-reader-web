/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { EPUB } from '../../apps/web/src/lib/foliate-epub/epub.js';

async function withBook(run) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
  const state = { reads: 0, parses: 0 };
  // An actual parse is forbidden in these pre-/post-destruction cases. EPUB
  // parsing itself remains covered by the real import/browser fixtures.
  Object.defineProperty(globalThis, 'DOMParser', {
    configurable: true,
    value: class {
      parseFromString() {
        state.parses++;
        throw new Error('Unexpected parse of a closed publication');
      }
    }
  });
  const source = {
    loadText: async () => {
      state.reads++;
      return null;
    },
    loadBlob: async () => {
      state.reads++;
      return null;
    },
    getSize: () => 0
  };
  const book = new EPUB(source);
  try {
    await run(book, state);
  } finally {
    book.destroy();
    if (descriptor) Object.defineProperty(globalThis, 'DOMParser', descriptor);
    else Reflect.deleteProperty(globalThis, 'DOMParser');
  }
}

test('EPUB destruction is idempotent and initialization cannot reopen its source', async () => {
  await withBook(async (book, state) => {
    assert.equal(book.destroy(), true);
    assert.equal(book.destroy(), false);
    await assert.rejects(book.init(), { name: 'AbortError' });
    assert.equal(state.reads, 0);
    assert.equal(state.parses, 0);
  });
});

test('destruction while loading the container refuses before parsing stale XML', async () => {
  await withBook(async (book, state) => {
    let release;
    book.loadText = () => new Promise((resolve) => (release = resolve));
    const pending = book.init();
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    book.destroy();
    release('<container/>');
    await rejected;
    assert.equal(state.parses, 0);
  });
});

test('destroying a publication fences a separately requested document parse', async () => {
  await withBook(async (book, state) => {
    let release;
    book.loadText = () => new Promise((resolve) => (release = resolve));
    const pending = book.loadDocument({
      href: 'chapter.xhtml',
      mediaType: 'application/xhtml+xml'
    });
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    book.destroy();
    release('<html/>');
    await rejected;
    assert.equal(state.parses, 0);
  });
});

test('closed publications refuse cover and auxiliary reads before source access', async () => {
  await withBook(async (book, state) => {
    book.resources = { cover: { href: 'cover.png', mediaType: 'image/png' } };
    book.destroy();
    await assert.rejects(book.getCover(), { name: 'AbortError' });
    await assert.rejects(book.getCalibreBookmarks(), { name: 'AbortError' });
    assert.equal(state.reads, 0);
  });
});
