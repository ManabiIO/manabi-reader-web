/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ReaderPanelSelection } from '../../apps/web/src/lib/reader-panel-selection.ts';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function harness() {
  const selection = new ReaderPanelSelection();
  const received = [];
  const errors = [];
  const run = (work, current = () => true) =>
    selection.run(
      work,
      current,
      (value) => received.push(value),
      (error) => errors.push(error)
    );
  return { selection, received, errors, run };
}

test('a current locator is delivered exactly once', async () => {
  const h = harness();
  await h.run(async () => 'current');
  assert.deepEqual(h.received, ['current']);
  assert.deepEqual(h.errors, []);
});

test('out-of-order resource digests only deliver the latest choice', async () => {
  const h = harness();
  const first = deferred();
  const last = deferred();
  const a = h.run(() => first.promise);
  const b = h.run(() => last.promise);
  last.resolve('last');
  await b;
  first.resolve('first');
  await a;
  assert.deepEqual(h.received, ['last']);
});

test('dismissal fences a previous opening even after the panel reopens', async () => {
  const h = harness();
  const old = deferred();
  const pending = h.run(() => old.promise);
  h.selection.invalidate();
  await h.run(async () => 'reopened');
  old.resolve('dismissed');
  await pending;
  assert.deepEqual(h.received, ['reopened']);
});

test('a replaced book or projection cannot receive an old locator', async () => {
  const h = harness();
  const old = deferred();
  let currentBook = 'first';
  const pending = h.run(
    () => old.promise,
    () => currentBook === 'first'
  );
  currentBook = 'second';
  old.resolve('wrong book');
  await pending;
  assert.deepEqual(h.received, []);
  assert.deepEqual(h.errors, []);
});

test('a late rejection from a dismissed panel is consumed, not shown on its successor', async () => {
  const h = harness();
  const old = deferred();
  const pending = h.run(() => old.promise);
  h.selection.invalidate();
  old.reject(new Error('old digest'));
  await pending;
  assert.deepEqual(h.received, []);
  assert.deepEqual(h.errors, []);
  await h.run(async () => 'new work');
  assert.deepEqual(h.received, ['new work']);
});

test('a current failure is reported and a subsequent selection can recover', async () => {
  const h = harness();
  const error = new Error('digest unavailable');
  await h.run(() => Promise.reject(error));
  assert.deepEqual(h.errors, [error]);
  assert.deepEqual(h.received, []);
  await h.run(async () => 'retry');
  assert.deepEqual(h.received, ['retry']);
});

test('a synchronous preparation failure is also contained', async () => {
  const h = harness();
  const error = new RangeError('invalid range');
  await h.run(() => {
    throw error;
  });
  assert.deepEqual(h.errors, [error]);
});

test('destroying the component fences pending and future work', async () => {
  const h = harness();
  const pending = deferred();
  const task = h.run(() => pending.promise);
  h.selection.dispose();
  pending.resolve('unmounted');
  await task;
  let prepared = false;
  await h.run(async () => {
    prepared = true;
    return 'after disposal';
  });
  assert.equal(prepared, false);
  assert.deepEqual(h.received, []);
  assert.deepEqual(h.errors, []);
});
