/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Loader } from '../../apps/web/src/lib/foliate-epub/epub.js';

test('Foliate resource loader coalesces concurrent loads and releases each retained reference', async () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const created = [];
  const revoked = [];
  let loadCount = 0;
  let release;

  URL.createObjectURL = () => {
    const value = `blob:test-${created.length + 1}`;
    created.push(value);
    return value;
  };
  URL.revokeObjectURL = (value) => {
    revoked.push(value);
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
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

test('destroyed Foliate loader cannot publish a late resource', async () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  let createCount = 0;
  let release;

  URL.createObjectURL = () => {
    createCount += 1;
    return `blob:late-${createCount}`;
  };
  URL.revokeObjectURL = () => {};

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
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

test('resource-relative links preserve query and fragment while loading the owning resource once', async () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = () => 'blob:chapter-two';
  URL.revokeObjectURL = () => {};

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
    const url = await loader.loadHref?.(
      '../OPS/chapter-2.xhtml?mode=1#note',
      'OPS/chapter-1.xhtml'
    );
    assert.equal(url, 'blob:chapter-two?mode=1#note');
    loader.destroy();
  } finally {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

test('failed parent publication releases child resources loaded during replacement', async () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const created = [];
  const revoked = [];

  URL.createObjectURL = () => {
    const value = `blob:dependency-${created.length + 1}`;
    created.push(value);
    return value;
  };
  URL.revokeObjectURL = (value) => revoked.push(value);

  try {
    const parent = { href: 'OPS/style.css', mediaType: 'text/css' };
    const child = { href: 'OPS/image.png', mediaType: 'image/png' };
    const loader = new Loader({
      loadText: async (href) =>
        href === parent.href ? 'body{background:url("image.png")}' : null,
      loadBlob: async (href) =>
        href === child.href ? new Blob(['image'], { type: 'image/png' }) : null,
      resources: { manifest: [parent, child] }
    });
    loader.eventTarget.addEventListener('data', (event) => {
      if (event.detail.name === parent.href)
        event.detail.data = Promise.reject(new Error('transform failed'));
    });

    await assert.rejects(loader.loadItem(parent), /transform failed/);
    assert.equal(created.length, 1);
    assert.deepEqual(revoked, ['blob:dependency-1']);
    loader.destroy();
  } finally {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});
