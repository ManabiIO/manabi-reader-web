import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BookResourceLease } from '../../apps/web/src/lib/preprocessing/book-resources.mjs';

const placeholderFor = (key) => `data:image/gif;ttu:${key};base64,fixture`;
function fixture(blobs, overrides = {}) {
  const created = [];
  const revoked = [];
  const lease = new BookResourceLease({
    blobs,
    placeholderFor,
    inferMimeType: () => 'image/png',
    sanitizeSvg: () => '<svg></svg>',
    createObjectURL: (blob) => {
      created.push(blob);
      return `blob:test/${created.length}`;
    },
    revokeObjectURL: (url) => revoked.push(url),
    ...overrides
  });
  return { lease, created, revoked };
}
const raster = () => new globalThis.Blob(['image'], { type: 'image/png' });

// These exercise actual resource lifetime code, not an alternate renderer.
test('source normalization never allocates a render URL or accepts a saved one', () => {
  const { lease, created } = fixture({ 'a.png': raster() });
  assert.equal(lease.resolveSourceImage('ttu:a.png'), placeholderFor('a.png'));
  assert.equal(lease.resolveSourceImage(placeholderFor('a.png')), placeholderFor('a.png'));
  assert.equal(lease.resolveSourceImage('blob:previous-read/a'), undefined);
  assert.equal(lease.resolveSourceImage('https://foreign.test/a.png'), undefined);
  assert.equal(created.length, 0);
  assert.throws(() => lease.resolveRenderImage('ttu:a.png'), /not ready/);
  lease.dispose();
});

test('render preparation is shared and borrowed URL sets cannot change ownership', async () => {
  const { lease, created, revoked } = fixture({ 'a.png': raster() });
  const first = lease.prepare();
  assert.equal(lease.prepare(), first);
  await first;
  assert.equal(created.length, 1);
  assert.equal(lease.resolveRenderImage('ttu:a.png'), 'blob:test/1');
  const exposed = lease.imageUrls();
  exposed.clear();
  assert.equal(lease.imageUrls().size, 1);
  lease.dispose();
  lease.dispose();
  assert.deepEqual(revoked, ['blob:test/1']);
  assert.throws(() => lease.resolveSourceImage('ttu:a.png'), { name: 'AbortError' });
});

test('a failure after an earlier allocation releases the entire partial batch', async () => {
  const { lease, created, revoked } = fixture(
    { 'a.png': raster(), 'b.svg': new globalThis.Blob(['unsafe'], { type: 'image/svg+xml' }) },
    {
      sanitizeSvg: () => {
        throw new Error('SVG rejection');
      }
    }
  );
  await assert.rejects(lease.prepare(), /SVG rejection/);
  assert.equal(created.length, 1);
  assert.deepEqual(revoked, ['blob:test/1']);
  assert.throws(() => lease.imageUrls(), /SVG rejection/);
});

test('dispose during an awaited SVG read cannot publish a late URL', async () => {
  let finish;
  class DelayedSvg extends globalThis.Blob {
    text() {
      return new Promise((resolve) => {
        finish = resolve;
      });
    }
  }
  const { lease, created, revoked } = fixture({
    'a.png': raster(),
    'b.svg': new DelayedSvg(['svg'], { type: 'image/svg+xml' })
  });
  const pending = lease.prepare();
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  lease.dispose();
  finish('<svg/>');
  await rejected;
  assert.equal(created.length, 1);
  assert.deepEqual(revoked, ['blob:test/1']);
});

test('opening cancellation owns resource cleanup; a canceled lease cannot be reused', async () => {
  const controller = new globalThis.AbortController();
  let finish;
  class DelayedSvg extends globalThis.Blob {
    text() {
      return new Promise((resolve) => {
        finish = resolve;
      });
    }
  }
  const { lease, created } = fixture({
    'a.svg': new DelayedSvg(['svg'], { type: 'image/svg+xml' })
  });
  const pending = lease.prepare({ signal: controller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  controller.abort();
  finish('<svg/>');
  await rejected;
  assert.equal(created.length, 0);
  assert.throws(() => lease.prepare(), { name: 'AbortError' });
});

test('SVG is sanitized and fallback MIME is normalized before URL creation', async () => {
  const { lease, created } = fixture({
    'a.png': new globalThis.Blob(['raster']),
    'b.svg': new globalThis.Blob(['<svg>input</svg>'], { type: 'image/svg+xml' }),
    'no.html': new globalThis.Blob(['<script/>'], { type: 'text/html' })
  });
  await lease.prepare();
  assert.deepEqual(created.map((blob) => blob.type), ['image/png', 'image/svg+xml']);
  assert.equal(await created[1].text(), '<svg></svg>');
  assert.equal(lease.resolveSourceImage('ttu:no.html'), undefined);
  lease.dispose();
});

test('gallery follows canonical source order and excludes unreferenced assets', async () => {
  const { lease } = fixture({ 'a.png': raster(), 'unused.png': raster(), 'b.png': raster() });
  await lease.prepare();
  const source = [placeholderFor('b.png'), placeholderFor('a.png'), placeholderFor('b.png')];
  assert.deepEqual(lease.pictures(source, true), [
    { url: 'blob:test/3', unspoilered: false },
    { url: 'blob:test/1', unspoilered: false }
  ]);
  assert.ok(lease.pictures(source, false).every((picture) => picture.unspoilered));
  lease.dispose();
});

test('mutating a source record after construction cannot substitute its resource', async () => {
  const original = raster();
  const blobs = { 'a.png': original };
  const { lease, created } = fixture(blobs);
  blobs['a.png'] = new globalThis.Blob(['foreign'], { type: 'text/html' });
  blobs['b.png'] = raster();
  await lease.prepare();
  assert.deepEqual(created, [original]);
  assert.equal(lease.resolveSourceImage('ttu:b.png'), undefined);
  lease.dispose();
});

test('revocation errors do not strand other URLs or make disposal non-idempotent', async () => {
  const attempted = [];
  const { lease } = fixture(
    { 'a.png': raster(), 'b.png': raster() },
    {
      revokeObjectURL: (url) => {
        attempted.push(url);
        throw new Error('revoke');
      },
      report: () => {
        throw new Error('diagnostic');
      }
    }
  );
  await lease.prepare();
  assert.doesNotThrow(() => lease.dispose());
  lease.dispose();
  assert.deepEqual(attempted, ['blob:test/1', 'blob:test/2']);
});

test('invalid records and ambiguous placeholder aliases fail before resource work', () => {
  assert.throws(() => fixture({ 'a.png': 'not a Blob' }), /size limit/);
  assert.throws(
    () => fixture({ a: raster(), b: raster() }, { placeholderFor: () => 'duplicate' }),
    /Ambiguous/
  );
});

test('cancellation settles preparation even while the underlying SVG read is stalled', async () => {
  class StalledSvg extends globalThis.Blob {
    text() {
      return new Promise(() => {});
    }
  }
  const controller = new globalThis.AbortController();
  const { lease, created } = fixture({
    'a.svg': new StalledSvg(['svg'], { type: 'image/svg+xml' })
  });
  const pending = lease.prepare({ signal: controller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  controller.abort();
  await rejected;
  assert.equal(created.length, 0);
});

test('a resource created by a reentrant disposed lifetime is immediately revoked', async () => {
  let lease;
  const revoked = [];
  ({ lease } = fixture(
    { 'a.png': raster() },
    {
      createObjectURL: () => {
        lease.dispose();
        return 'blob:late';
      },
      revokeObjectURL: (url) => revoked.push(url)
    }
  ));
  await assert.rejects(lease.prepare(), { name: 'AbortError' });
  assert.deepEqual(revoked, ['blob:late']);
});

test('gallery resolves decoded resource names and aliases without rescanning HTML', async () => {
  const { lease } = fixture({ '猫&犬.png': raster() });
  await lease.prepare();
  assert.deepEqual(lease.pictures(['ttu:猫&犬.png', placeholderFor('猫&犬.png')], false), [
    { url: 'blob:test/1', unspoilered: true }
  ]);
  lease.dispose();
});
