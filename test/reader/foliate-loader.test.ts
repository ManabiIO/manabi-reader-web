/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { Loader } from '../../apps/web/src/lib/foliate/epub.js';

function installObjectUrlHarness() {
  const created: string[] = [];
  const revoked: string[] = [];
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => {
    const url = `blob:foliate-test-${created.length + 1}`;
    created.push(url);
    return url;
  };
  URL.revokeObjectURL = (url) => {
    revoked.push(String(url));
  };
  return {
    created,
    revoked,
    restore() {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  };
}

test('Foliate loader coalesces concurrent resource loads and retains each owner', async () => {
  const urls = installObjectUrlHarness();
  let resolveBlob!: (value: Blob) => void;
  let loadCount = 0;
  try {
    const item = { href: 'OPS/image.png', mediaType: 'image/png' };
    const loader = new Loader({
      loadText: async () => null,
      loadBlob: async () => {
        loadCount += 1;
        return await new Promise<Blob>((resolve) => {
          resolveBlob = resolve;
        });
      },
      resources: { manifest: [item] }
    });

    const first = loader.loadItem(item);
    const second = loader.loadItem(item);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(loadCount, 1);

    resolveBlob(new Blob(['image'], { type: 'image/png' }));
    const [firstUrl, secondUrl] = await Promise.all([first, second]);
    assert.equal(firstUrl, secondUrl);
    assert.deepEqual(urls.created, ['blob:foliate-test-1']);

    loader.unloadItem(item);
    assert.deepEqual(urls.revoked, []);
    loader.unloadItem(item);
    assert.deepEqual(urls.revoked, ['blob:foliate-test-1']);
    assert.equal(loader.destroy(), true);
    assert.equal(loader.destroy(), false);
  } finally {
    urls.restore();
  }
});

test('Foliate loader cannot publish a resource after destruction', async () => {
  const urls = installObjectUrlHarness();
  let resolveBlob!: (value: Blob) => void;
  try {
    const item = { href: 'OPS/image.png', mediaType: 'image/png' };
    const loader = new Loader({
      loadText: async () => null,
      loadBlob: async () =>
        await new Promise<Blob>((resolve) => {
          resolveBlob = resolve;
        }),
      resources: { manifest: [item] }
    });

    const pending = loader.loadItem(item);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(loader.destroy(), true);
    resolveBlob(new Blob(['late'], { type: 'image/png' }));
    assert.equal(await pending, null);
    assert.deepEqual(urls.created, []);
  } finally {
    urls.restore();
  }
});
