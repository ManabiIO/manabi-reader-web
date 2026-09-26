/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ReaderNavigationCoordinator,
  resourceForReaderLocator
} from '../../apps/web/src/lib/foliate-epub/reader-navigation-owner.ts';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test('latest reader request owns preparation and the eventual renderer call', async () => {
  const navigation = new ReaderNavigationCoordinator();
  const preparation = deferred();
  const moved = [];
  const older = navigation.run(async (owner) => {
    await preparation.promise;
    if (!owner.isCurrent()) return false;
    moved.push('old');
    return true;
  });
  const newer = navigation.run(async () => {
    moved.push('new');
    return true;
  });
  assert.equal(await newer, true);
  preparation.resolve();
  assert.equal(await older, false);
  assert.deepEqual(moved, ['new']);
  assert.equal(navigation.pending, false);
});

test('an older completion cannot stop suppression for the current request', async () => {
  const navigation = new ReaderNavigationCoordinator();
  const first = deferred();
  const second = deferred();
  const older = navigation.run(() => first.promise);
  const newer = navigation.run(() => second.promise);
  first.resolve(true);
  assert.equal(await older, false);
  assert.equal(navigation.pending, true);
  second.resolve(true);
  assert.equal(await newer, true);
  assert.equal(navigation.pending, false);
});

test('user movement cancels a delayed initial saved-position restore', async () => {
  const navigation = new ReaderNavigationCoordinator();
  const bookmark = deferred();
  let restored = false;
  const initial = navigation.run(async (owner) => {
    await bookmark.promise;
    if (!owner.isCurrent()) return false;
    restored = true;
    return true;
  });
  navigation.cancel();
  assert.equal(navigation.pending, false);
  bookmark.resolve({ exploredCharCount: 100 });
  assert.equal(await initial, false);
  assert.equal(restored, false);
});

test('failed and ignored renderer receipts are not successful reveals', async () => {
  const navigation = new ReaderNavigationCoordinator();
  for (const receipt of [false, undefined, null, { ignored: true }]) {
    assert.equal(await navigation.run(async () => receipt), false);
  }
});

test('destroy invalidates delayed work and refuses later requests', async () => {
  const navigation = new ReaderNavigationCoordinator();
  const preparation = deferred();
  let effects = 0;
  const pending = navigation.run(async (owner) => {
    await preparation.promise;
    if (!owner.isCurrent()) return false;
    effects++;
    return true;
  });
  navigation.destroy();
  navigation.destroy();
  preparation.resolve();
  assert.equal(await pending, false);
  const refused = navigation.run(async () => {
    effects++;
    return true;
  });
  assert.equal(await refused, false);
  assert.equal(effects, 0);
});

test('superseded failures cannot surface as errors for the newer request', async () => {
  const navigation = new ReaderNavigationCoordinator();
  const old = deferred();
  const pending = navigation.run(() => old.promise);
  assert.equal(await navigation.run(async () => true), true);
  old.reject(new Error('old resource unavailable'));
  assert.equal(await pending, false);
  await assert.rejects(
    navigation.run(async () => {
      throw new Error('current failure');
    }),
    /current failure/
  );
  assert.equal(navigation.pending, false);
});

test('an abort listener starting a newer request keeps ownership', async () => {
  const navigation = new ReaderNavigationCoordinator();
  const original = deferred();
  const latest = deferred();
  let newest;
  let intermediateRan = false;
  const first = navigation.run(async (owner) => {
    owner.signal.addEventListener(
      'abort',
      () => {
        newest = navigation.run(() => latest.promise);
      },
      { once: true }
    );
    return original.promise;
  });
  const intermediate = navigation.run(async () => {
    intermediateRan = true;
    return true;
  });
  assert.equal(await intermediate, false);
  assert.equal(intermediateRan, false);
  original.resolve(true);
  assert.equal(await first, false);
  assert.equal(navigation.pending, true);
  latest.resolve(true);
  assert.equal(await newest, true);
  assert.equal(navigation.pending, false);
});

test('locator lookup uses publication identity and rejects mismatched resources', () => {
  const resources = [
    { href: 'a.xhtml', spineIndex: 0, sectionId: 'a' },
    { href: 'b.xhtml', spineIndex: 1, sectionId: 'b' }
  ];
  assert.equal(
    resourceForReaderLocator(resources, { resource: { ...resources[1] } }),
    resources[1]
  );
  assert.equal(
    resourceForReaderLocator(resources, { resource: { href: 'a.xhtml', spineIndex: 1 } }),
    undefined
  );
  for (const index of [NaN, 0.5, -1, 2, null, '0']) {
    assert.equal(
      resourceForReaderLocator(resources, { resource: { href: 'a.xhtml', spineIndex: index } }),
      undefined
    );
  }
  assert.equal(resourceForReaderLocator(resources, { resource: undefined }), undefined);
});

test('repeated resource hrefs retain their exact spine occurrence', () => {
  const resources = [
    { href: 'repeat.xhtml', spineIndex: 0, sectionId: 'first' },
    { href: 'repeat.xhtml', spineIndex: 1, sectionId: 'second' }
  ];
  assert.equal(
    resourceForReaderLocator(resources, { resource: { href: 'repeat.xhtml', spineIndex: 1 } }),
    resources[1]
  );
});
