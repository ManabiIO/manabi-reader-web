/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createStoredFoliateBook } from '../../apps/web/src/lib/foliate-epub/stored-foliate-book.ts';

const manifest = { resources: [{ href: 'chapter.xhtml', spineIndex: 0, sectionId: 'chapter' }] };
// Lifecycle-only fixture. Browser acceptance checks actual parsing and rendering.
const document = { createElement: () => ({ children: [{ outerHTML: '<p>safe chapter</p>' }] }) };
function create(resources = manifest.resources) {
  return createStoredFoliateBook('', '', { resources }, document).book;
}

async function track(run) {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const revoked = [];
  let created = 0;
  URL.createObjectURL = () => `blob:unit-${++created}`;
  URL.revokeObjectURL = (value) => revoked.push(value);
  try {
    await run(revoked);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
}

test('a failed section URL allocation does not leak a reference on retry', async () => {
  await track(async (revoked) => {
    const book = create();
    const original = URL.createObjectURL;
    URL.createObjectURL = () => {
      throw new Error('allocation failed');
    };
    await assert.rejects(book.sections[0].load(), /allocation failed/);
    URL.createObjectURL = original;
    const url = await book.sections[0].load();
    book.sections[0].unload();
    assert.deepEqual(revoked, [url]);
    book.destroy();
    assert.deepEqual(revoked, [url]);
  });
});

test('shared section leases revoke once at final release or forced destruction', async () => {
  await track(async (revoked) => {
    const book = create();
    const section = book.sections[0];
    const first = await section.load();
    assert.equal(await section.load(), first);
    section.unload();
    assert.deepEqual(revoked, []);
    assert.equal(await section.load(), first);
    book.destroy();
    section.unload();
    book.destroy();
    assert.deepEqual(revoked, [first]);
    await assert.rejects(section.load(), { name: 'AbortError' });
  });
});

test('stored publication rejects invalid resource identity before constructing URLs', () => {
  for (const spineIndex of [-1, 0.5, '0', null, 1])
    assert.throws(() => create([{ ...manifest.resources[0], spineIndex }]), /invalid resource/);
  assert.throws(() => create([{ ...manifest.resources[0], href: null }]), /invalid resource/);
  assert.throws(() => create([{ ...manifest.resources[0], sectionId: 1 }]), /invalid resource/);
});

// The importer can prefix a maximum-length package ID with `ttu-`.
test('stored publication retains accepted long generated section IDs', () => {
  const book = create([{ ...manifest.resources[0], sectionId: `ttu-${'a'.repeat(512)}` }]);
  assert.equal(book.sections.length, 1);
  book.destroy();
});
