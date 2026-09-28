/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { observeElementWidth } from '../../apps/web/src/lib/hooks/observe-element-width.ts';

// Exercise the production scheduling helper with controlled browser delivery.
// This does not claim native layout or native ResizeObserver execution.
function harness(t, changed = () => {}) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  let observer;
  const frames = new Map();
  let nextFrame = 0;
  const calls = [];
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      observer = this;
    }
    observe(target) {
      this.target = target;
    }
    disconnect() {
      this.disconnected = true;
    }
  };
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'ResizeObserver', original);
    else delete globalThis.ResizeObserver;
  });
  const node = {
    clientWidth: 1200,
    isConnected: true,
    ownerDocument: {
      defaultView: {
        requestAnimationFrame(callback) {
          const id = nextFrame++;
          frames.set(id, callback);
          return id;
        },
        cancelAnimationFrame(id) {
          frames.delete(id);
        }
      }
    }
  };
  const stop = observeElementWidth(node, (width) => {
    calls.push(width);
    changed(width);
  });
  return {
    node,
    calls,
    frames,
    observer,
    stop,
    notify: () => observer.callback([{ target: node }]),
    flush() {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback();
    }
  };
}

test('resize delivery is deferred and bursts coalesce even for animation frame zero', (t) => {
  const h = harness(t);
  h.notify();
  h.notify();
  assert.deepEqual(h.calls, []);
  assert.equal(h.frames.size, 1);
  h.flush();
  assert.deepEqual(h.calls, [1200]);
  assert.equal(h.observer.target, h.node);
  h.stop();
});

test('height-only layout notifications do not rewrite the grid size', (t) => {
  const h = harness(t);
  h.flush();
  for (let i = 0; i < 5; i += 1) {
    h.node.clientHeight = 100 + i;
    h.notify();
    h.flush();
  }
  assert.deepEqual(h.calls, [1200]);
  h.stop();
});

test('width changes are measured after delivery and can shrink then grow again', (t) => {
  const h = harness(t);
  h.flush();
  h.node.clientWidth = 200;
  h.notify();
  assert.deepEqual(h.calls, [1200]);
  h.flush();
  h.node.clientWidth = 1600;
  h.notify();
  h.flush();
  assert.deepEqual(h.calls, [1200, 200, 1600]);
  h.stop();
});

test('layout feedback schedules at most one follow-up and ignores unchanged width', (t) => {
  let h;
  h = harness(t, () => h.notify());
  h.flush();
  assert.deepEqual(h.calls, [1200]);
  assert.equal(h.frames.size, 1);
  h.flush();
  assert.equal(h.frames.size, 0);
  assert.deepEqual(h.calls, [1200]);
  h.stop();
});

test('destroy cancels queued work and late observer delivery cannot revive it', (t) => {
  const h = harness(t);
  h.stop();
  h.notify();
  h.flush();
  assert.equal(h.observer.disconnected, true);
  assert.equal(h.frames.size, 0);
  assert.deepEqual(h.calls, []);
});

test('a disconnected element is not measured until a connected notification', (t) => {
  const h = harness(t);
  h.node.isConnected = false;
  h.flush();
  assert.deepEqual(h.calls, []);
  h.node.isConnected = true;
  h.notify();
  h.flush();
  assert.deepEqual(h.calls, [1200]);
  h.stop();
});
