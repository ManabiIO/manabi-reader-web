/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ReaderController, changedReaderProps, type Subscribable } from './controller.ts';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
function source<T>(initial: T) {
  let value = initial;
  const listeners = new Set<(value: T) => void>();
  return {
    get listeners() {
      return listeners.size;
    },
    next(next: T) {
      value = next;
      for (const listener of listeners) listener(value);
    },
    subscribe(listener: (value: T) => void) {
      listeners.add(listener);
      listener(value);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}

test('reader effects settle in dependency order and do not rerun for unchanged inputs', async () => {
  const life = new ReaderController();
  let input = 2,
    middle = 0,
    output = 0,
    runs = 0;
  life.effect(
    () => [middle],
    () => {
      runs++;
      life.changed((output = middle + 1));
    }
  );
  life.effect(
    () => [input],
    () => {
      life.changed((middle = input * 3));
    }
  );
  assert.equal(output, 0);
  life.start();
  await settle();
  assert.equal(output, 7);
  assert.equal(runs, 2);
  life.invalidate();
  await settle();
  assert.equal(runs, 2);
  life.changed((input = 4));
  await settle();
  assert.equal(output, 13);
  life.destroy();
});

test('optional and replaced observable sources own exactly one subscription', async () => {
  const life = new ReaderController();
  const one = source(1),
    two = source(2);
  let current: Subscribable<number> | undefined;
  const values: number[] = [];
  life.observeSource(
    () => current,
    (value) => values.push(value)
  );
  life.start();
  await settle();
  assert.deepEqual(values, []);
  life.changed((current = one));
  await settle();
  assert.equal(one.listeners, 1);
  life.changed((current = two));
  await settle();
  assert.equal(one.listeners, 0);
  assert.equal(two.listeners, 1);
  one.next(3);
  two.next(4);
  assert.deepEqual(values, [1, 2, 4]);
  life.changed((current = undefined));
  await settle();
  assert.equal(two.listeners, 0);
  life.destroy();
});

test('a discarded reader lifetime never mounts or notifies after teardown', async () => {
  const life = new ReaderController();
  let mounts = 0,
    cleanups = 0,
    updates = 0;
  life.onMount(() => {
    mounts++;
    return () => {
      cleanups++;
    };
  });
  life.subscribe(() => {
    updates++;
  });
  life.invalidate();
  life.destroy();
  life.start();
  await settle();
  assert.deepEqual({ mounts, cleanups, updates }, { mounts: 0, cleanups: 0, updates: 0 });
});

test('mounted lifetimes mount and clean up once, including pending updates', async () => {
  const life = new ReaderController();
  let mounts = 0,
    cleanups = 0,
    updates = 0;
  const observable = source(1);
  life.onMount(() => {
    mounts++;
    return () => {
      cleanups++;
    };
  });
  life.observeSource(
    () => observable,
    () => {}
  );
  life.subscribe(() => {
    updates++;
  });
  life.start();
  life.start();
  await settle();
  const before = updates;
  observable.next(2);
  life.destroy();
  life.destroy();
  await settle();
  assert.equal(mounts, 1);
  assert.equal(cleanups, 1);
  assert.equal(updates, before);
  assert.equal(observable.listeners, 0);
});

test('mutation results retain async expressions and prefix/postfix semantics', async () => {
  const life = new ReaderController();
  let count = 0;
  assert.equal(life.changed(count++), 0);
  assert.equal(count, 1);
  assert.equal(life.changed(++count), 2);
  assert.equal(life.changed((count = await Promise.resolve(9))), 9);
  life.destroy();
});

test('unchanged parent snapshots cannot roll back locally published reader state', () => {
  const incoming = { exploredCharCount: 10, open: true, fontSize: 22 };
  const changes = changedReaderProps(incoming, { ...incoming, fontSize: 24 });
  assert.deepEqual(changes, { fontSize: 24 });
  assert.deepEqual(
    changedReaderProps(incoming, { ...incoming, exploredCharCount: 30, open: false }),
    { exploredCharCount: 30, open: false }
  );
});

test('prepare derives the first view without mounting and retires pre-mount subscriptions', async () => {
  const life = new ReaderController();
  const input = source(8);
  let current = 0,
    derived = 0,
    mounted = 0;
  life.observeSource(
    () => input,
    (value) => {
      current = value;
    }
  );
  life.effect(
    () => [current],
    () => {
      life.changed((derived = current * 2));
    }
  );
  life.onMount(() => {
    mounted++;
  });
  life.prepare();
  assert.equal(derived, 16);
  assert.equal(mounted, 0);
  assert.equal(input.listeners, 1);
  life.destroy();
  life.start();
  await settle();
  assert.equal(mounted, 0);
  assert.equal(input.listeners, 0);
});
