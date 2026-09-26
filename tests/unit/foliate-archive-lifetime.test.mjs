/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { openFoliateEpub } from '../../apps/web/src/lib/foliate-epub/open-foliate-epub.ts';
import { LimitedArchive } from '../../apps/web/src/lib/functions/file-loaders/utils/limited-archive.ts';
import { EPUB } from '../../apps/web/src/lib/foliate-epub/epub.js';

function deferred() {
  let resolve;
  const promise = new Promise((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

async function withArchive(run) {
  const originalOpen = LimitedArchive.open;
  const originalInit = EPUB.prototype.init;
  const originalDestroy = EPUB.prototype.destroy;
  const parser = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
  const state = { closes: 0, destroys: 0, source: undefined };
  const archive = {
    entries: new Map([['chapter.xhtml', { uncompressedSize: 20 }]]),
    readText: async () => 'chapter',
    readBlob: async () => new Blob(['chapter']),
    close: async () => {
      state.closes++;
    }
  };
  LimitedArchive.open = async () => archive;
  Object.defineProperty(globalThis, 'DOMParser', { configurable: true, value: class {} });
  EPUB.prototype.init = async function () {
    state.source = this;
    return this;
  };
  EPUB.prototype.destroy = function () {
    state.destroys++;
  };
  try {
    await run(archive, state);
  } finally {
    LimitedArchive.open = originalOpen;
    EPUB.prototype.init = originalInit;
    EPUB.prototype.destroy = originalDestroy;
    if (parser) Object.defineProperty(globalThis, 'DOMParser', parser);
    else Reflect.deleteProperty(globalThis, 'DOMParser');
  }
}

test('every close caller awaits the same archive drain, and future reads refuse', async () => {
  await withArchive(async (archive, state) => {
    const drain = deferred();
    archive.close = async () => {
      state.closes++;
      await drain.promise;
    };
    const publication = await openFoliateEpub(new Blob());
    const first = publication.close();
    const second = publication.close();
    assert.equal(first, second);
    let closed = false;
    second.then(() => {
      closed = true;
    });
    await Promise.resolve();
    assert.equal(closed, false);
    await assert.rejects(state.source.loadText('chapter.xhtml'), { name: 'AbortError' });
    drain.resolve();
    await second;
    assert.equal(state.closes, 1);
    assert.equal(state.destroys, 1);
  });
});

test('a read completing after publication close cannot escape into the old book', async () => {
  await withArchive(async (archive, state) => {
    const pending = deferred();
    archive.readText = () => pending.promise;
    const publication = await openFoliateEpub(new Blob());
    const read = state.source.loadText('chapter.xhtml');
    const rejected = assert.rejects(read, { name: 'AbortError' });
    await publication.close();
    pending.resolve('late chapter');
    await rejected;
  });
});

test('optional absence is null; invalid paths and read failures stay errors', async () => {
  await withArchive(async (archive, state) => {
    const publication = await openFoliateEpub(new Blob());
    assert.equal(await state.source.loadText('META-INF/encryption.xml'), null);
    for (const uri of ['../chapter.xhtml', '/chapter.xhtml', 'https://example.com/chapter.xhtml'])
      await assert.rejects(state.source.loadText(uri), /Unsafe archive path/);
    const failure = new Error('decoder failed');
    archive.readText = async () => {
      throw failure;
    };
    await assert.rejects(state.source.loadText('chapter.xhtml'), (error) => error === failure);
    await publication.close();
  });
});

test('partial EPUB initialization cleans up without masking the original failure', async () => {
  await withArchive(async (archive, state) => {
    const failure = new Error('invalid package');
    EPUB.prototype.init = async () => {
      throw failure;
    };
    archive.close = async () => {
      state.closes++;
      throw new Error('close failed');
    };
    await assert.rejects(openFoliateEpub(new Blob()), (error) => error === failure);
    assert.equal(state.destroys, 1);
    assert.equal(state.closes, 1);
  });
});

test('abort during initialization cannot return a publication and cleanup runs once', async () => {
  await withArchive(async (_archive, state) => {
    const started = deferred();
    const gate = deferred();
    const controller = new AbortController();
    EPUB.prototype.init = async function () {
      started.resolve();
      await gate.promise;
      return this;
    };
    const opening = openFoliateEpub(new Blob(), { signal: controller.signal });
    const rejected = assert.rejects(opening, { name: 'AbortError' });
    await started.promise;
    controller.abort();
    gate.resolve();
    await rejected;
    assert.equal(state.closes, 1);
    assert.equal(state.destroys, 1);
  });
});

test('optional parser recovery cannot conceal a failed archive read during initialization', async () => {
  await withArchive(async (archive, state) => {
    const failure = new Error('ZIP checksum mismatch');
    archive.readText = async () => {
      throw failure;
    };
    EPUB.prototype.init = async function () {
      try {
        await this.loadText('chapter.xhtml');
      } catch {
        // Model an optional-nav fallback in the upstream parser.
      }
      return this;
    };
    await assert.rejects(openFoliateEpub(new Blob()), (error) => error === failure);
    assert.equal(state.closes, 1);
    assert.equal(state.destroys, 1);
  });
});
