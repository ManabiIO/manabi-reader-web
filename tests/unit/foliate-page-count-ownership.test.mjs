/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import { PageCountCache } from '../../apps/web/src/lib/foliate-epub/page-counts.ts';

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('foreground count wins over an already-running background measurement', async () => {
  let release;
  const cache = new PageCountCache(
    2,
    () => new Promise((resolve) => (release = resolve)),
    () => {},
    undefined,
    async () => {}
  );
  cache.useLayout('phone', 0, 3);
  await tick();
  cache.record(1, 7);
  release(99);
  await cache.settled;
  assert.deepEqual(cache.counts, [3, 7]);
  cache.destroy();
});

test('invalid section indices cannot publish phantom counts', () => {
  let changes = 0;
  const cache = new PageCountCache(
    1,
    async () => 3,
    () => changes++
  );
  cache.useLayout('phone', 0, 3);
  const before = changes;
  for (const index of [NaN, 0.5, -1, 1, Infinity]) cache.record(index, 7);
  assert.equal(changes, before);
  assert.deepEqual(Object.keys(cache.counts), ['0']);
  assert.deepEqual(cache.counts, [3]);
  cache.destroy();
});
