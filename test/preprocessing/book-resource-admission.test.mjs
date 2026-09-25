import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BookResourceLease } from '../../apps/web/src/lib/preprocessing/book-resources.mjs';

test('partial resource sets cannot be exposed before ready admission', async () => {
  let finish;
  class DelayedSvg extends globalThis.Blob {
    text() {
      return new Promise((resolve) => {
        finish = resolve;
      });
    }
  }
  let sequence = 0;
  const lease = new BookResourceLease({
    blobs: {
      'a.png': new globalThis.Blob(['png'], { type: 'image/png' }),
      'b.svg': new DelayedSvg(['svg'], { type: 'image/svg+xml' })
    },
    placeholderFor: (key) => `placeholder:${key}`,
    inferMimeType: () => 'image/png',
    sanitizeSvg: () => '<svg/>',
    createObjectURL: () => `blob:fixture/${++sequence}`,
    revokeObjectURL: () => {}
  });
  const pending = lease.prepare();
  assert.throws(() => lease.assertReady(), /not ready/);
  assert.throws(() => lease.imageUrls(), /not ready/);
  assert.throws(() => lease.pictures(['ttu:a.png'], true), /not ready/);
  finish('<svg/>');
  await pending;
  assert.doesNotThrow(() => lease.assertReady());
  lease.dispose();
  assert.throws(() => lease.assertReady(), { name: 'AbortError' });
});
