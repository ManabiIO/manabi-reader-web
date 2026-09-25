/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Loader } from '../../apps/web/src/lib/foliate-epub/epub.js';

test('Foliate resource loader coalesces concurrent loads and releases each retained reference', async () => {
  const originalURL = globalThis.URL;
  const created = [];
  const revoked = [];
  let loadCount = 0;
  let release;

  globalThis.URL = {
    createObjectURL() {
      const value = `blob:test-${created.length + 1}`;
      created.push(value);
      return value;
    },
    revokeObjectURL(value) {
      revoked.push(value);
    }
  };

  try {
    const item = { href: 'images/page.png', mediaType: 'image/png' };
    const loader = new Loader({
      loadText: async () => null,
      loadBlob: async () => {
        loadCount += 1;
        return await new Promise((resolve) => {
          release = resolve;
        });
      },
      resources: { manifest: [item] }
    });

    const first = loader.loadItem(item);
    const second = loader.loadItem(item);
    await Promise.resolve();
    assert.equal(loadCount, 1);

    release(new Blob(['image'], { type: 'image/png' }));
    const [firstURL, secondURL] = await Promise.all([first, second]);
    assert.equal(firstURL, secondURL);
    assert.deepEqual(created, ['blob:test-1']);

    loader.unloadItem(item);
    assert.deepEqual(revoked, []);
    loader.unloadItem(item);
    assert.deepEqual(revoked, ['blob:test-1']);
    assert.equal(loader.destroy(), true);
    assert.equal(loader.destroy(), false);
  } finally {
    globalThis.URL = originalURL;
  }
});

test('destroyed Foliate loader cannot publish a late resource', async () => {
  const originalURL = globalThis.URL;
  let createCount = 0;
  let release;

  globalThis.URL = {
    createObjectURL() {
      createCount += 1;
      return `blob:late-${createCount}`;
    },
    revokeObjectURL() {}
  };

  try {
    const item = { href: 'images/late.png', mediaType: 'image/png' };
    const loader = new Loader({
      loadText: async () => null,
      loadBlob: async () =>
        await new Promise((resolve) => {
          release = resolve;
        }),
      resources: { manifest: [item] }
    });

    const pending = loader.loadItem(item);
    await Promise.resolve();
    assert.equal(loader.destroy(), true);
    release(new Blob(['late'], { type: 'image/png' }));

    assert.equal(await pending, null);
    assert.equal(createCount, 0);
    assert.equal(await loader.loadItem(item), null);
  } finally {
    globalThis.URL = originalURL;
  }
});

test('resource-relative links preserve query and fragment while loading the owning resource once', async () => {
  const originalURL = globalThis.URL;
  globalThis.URL = {
    createObjectURL() {
      return 'blob:chapter-two';
    },
    revokeObjectURL() {}
  };

  try {
    const item = { href: 'OPS/chapter-2.xhtml', mediaType: 'application/xhtml+xml' };
    const loader = new Loader({
      loadText: async () => '<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>',
      loadBlob: async () => null,
      resources: { manifest: [item] }
    });

    // Exercise the public href resolver without requiring a DOM parse by
    // replacing the XHTML item with a binary fixture after path resolution.
    item.mediaType = 'image/png';
    loader.loadBlob = async () => new Blob(['x'], { type: 'image/png' });
    const url = await loader.loadHref?.('../OPS/chapter-2.xhtml?mode=1#note', 'OPS/chapter-1.xhtml');
    assert.equal(url, 'blob:chapter-two?mode=1#note');
    loader.destroy();
  } finally {
    globalThis.URL = originalURL;
  }
});
