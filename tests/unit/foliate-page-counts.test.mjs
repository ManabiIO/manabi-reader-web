/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import {
  PageCountCache,
  pageNumber,
  pageNumberLabel
} from '../../apps/web/src/lib/foliate-epub/page-counts.ts';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const immediate = async () => {};

test('unknown preceding chapter lengths show a weighted percentage', () => {
  const value = pageNumber([undefined, 5, 8], 1, 3, 5, [100, 200, 100]);
  assert.equal(value.current, undefined);
  assert.equal(value.total, undefined);
  assert.equal(pageNumberLabel(value, true), '45%');
});

test('a known prefix gives the exact current page while later chapters remain uncounted', () => {
  const value = pageNumber([4, 7, undefined], 1, 3, 7);
  assert.equal(value.current, 7);
  assert.equal(value.total, undefined);
  assert.equal(pageNumberLabel(value, true), '7');
  assert.equal(pageNumberLabel(value, false), '7');
});

test('expanded controls add the total; hidden controls show only the current number', () => {
  const value = pageNumber([4, 7, 9], 2, 2, 9);
  assert.equal(pageNumberLabel(value, true), '13 of 20');
  assert.equal(pageNumberLabel(value, false), '13');
});

test('the first page is known before any background chapter finishes', () => {
  assert.equal(pageNumberLabel(pageNumber([undefined, undefined], 0, 1, 8), true), '1');
});

test('background counting publishes prefixes in order and skips the known active chapter', async () => {
  const pending = [];
  const updates = [];
  const cache = new PageCountCache(
    3,
    (index) => new Promise((resolve) => pending.push({ index, resolve })),
    () => updates.push(cache.counts.slice()),
    undefined,
    immediate
  );
  cache.useLayout('phone', 2, 6);
  await tick();
  assert.equal(pending[0].index, 0);
  pending[0].resolve(3);
  await tick();
  assert.deepEqual(cache.counts, [3, undefined, 6]);
  assert.equal(pending[1].index, 1);
  pending[1].resolve(4);
  await cache.settled;
  assert.deepEqual(cache.counts, [3, 4, 6]);
  assert.equal(pending.length, 2);
  assert.ok(updates.some((value) => value[0] === 3 && value[1] === undefined));
  cache.destroy();
});

test('a stale asynchronous measurement cannot overwrite a resized layout', async () => {
  const pending = [];
  const cache = new PageCountCache(
    2,
    (index, signal) => new Promise((resolve) => pending.push({ index, signal, resolve })),
    () => {},
    undefined,
    immediate
  );
  cache.useLayout('wide', 0, 3);
  const old = cache.settled;
  await tick();
  cache.useLayout('narrow', 0, 8);
  await tick();
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve(11);
  await cache.settled;
  pending[0].resolve(99);
  await old;
  assert.deepEqual(cache.counts, [8, 11]);
  cache.destroy();
});

test('returning to a measured layout reuses cached chapter counts', async () => {
  let measurements = 0;
  const cache = new PageCountCache(
    2,
    async () => ++measurements + 4,
    () => {},
    undefined,
    immediate
  );
  cache.useLayout('wide', 0, 3);
  await cache.settled;
  cache.useLayout('narrow', 0, 8);
  await cache.settled;
  cache.useLayout('wide', 0, 3);
  await cache.settled;
  assert.deepEqual(cache.counts, [3, 5]);
  assert.equal(measurements, 2);
  cache.destroy();
});

test('destroy fences unfinished work and invalid measurements stay unknown', async () => {
  let finish;
  let changes = 0;
  const cache = new PageCountCache(
    2,
    () => new Promise((resolve) => (finish = resolve)),
    () => changes++,
    undefined,
    immediate
  );
  cache.useLayout('phone', 0, 3);
  cache.record(1, NaN);
  cache.record(1, 0);
  cache.record(1, 1.5);
  await tick();
  assert.equal(cache.counts[1], undefined);
  cache.destroy();
  const before = changes;
  finish(10);
  await cache.settled;
  assert.equal(changes, before);
  assert.equal(cache.counts[1], undefined);
});
