/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import { performance } from 'node:perf_hooks';
import { PageTurnController } from '../../apps/web/src/lib/foliate-epub/page-turn-controller.ts';

const tick = () => new Promise((resolve) => setImmediate(resolve));

// Event/lifetime tests, not a substitute for trusted browser touch acceptance.
async function withController(options, run) {
  const descriptors = new Map();
  const install = (name, value) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true });
  };
  const state = { prepared: [], committed: 0, cancelled: 0 };
  let activeTurn;
  const frames = new Map();
  let nextFrame = 0;
  const host = new EventTarget();
  host.visualViewport = { scale: 1 };
  const document = new EventTarget();
  document.hidden = false;
  document.hasFocus = () => true;
  document.defaultView = host;
  const content = new EventTarget();
  content.nodeType = 9;
  content.documentElement = { style: {} };
  content.getSelection = () => ({ toString: () => '' });
  const paginator = new EventTarget();
  paginator.nodeType = 1;
  paginator.ownerDocument = document;
  paginator.pageTurnDirection = 'ltr';
  const attributes = new Map();
  paginator.setAttribute = (name, value) => attributes.set(name, String(value));
  paginator.getAttribute = (name) => attributes.get(name) ?? null;
  paginator.removeAttribute = (name) => attributes.delete(name);
  paginator.getContents = () => [{ doc: content, index: 0 }];
  paginator.isPageNumberControlAt = () => false;
  paginator.getBoundingClientRect = () => ({ width: 400 });
  paginator.cancelPageTurn = () => activeTurn?.cancel();
  paginator.preparePageTurn = async (direction) => {
    state.prepared.push(direction);
    activeTurn = {
      update: () => true,
      commit: () => {
        activeTurn = undefined;
        state.committed++;
        return true;
      },
      cancel: () => {
        activeTurn = undefined;
        state.cancelled++;
      }
    };
    return activeTurn;
  };
  install('window', host);
  install('document', document);
  install('matchMedia', () => ({ matches: false }));
  install('requestAnimationFrame', (callback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  install('cancelAnimationFrame', (id) => frames.delete(id));
  const controller = new PageTurnController(paginator, options);
  const flush = async () => {
    await tick();
    for (const [id, callback] of [...frames]) {
      frames.delete(id);
      callback(performance.now() + 1000);
    }
    await tick();
  };
  const send = (target, type, properties = {}) => {
    const event = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries(properties))
      Object.defineProperty(event, key, { value });
    target.dispatchEvent(event);
    return event;
  };
  try {
    await run({ controller, paginator, content, state, flush, send, host, document });
  } finally {
    controller.destroy();
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

test('configured frame shortcuts suppress the fallback and are forwarded once', async () => {
  let calls = 0;
  await withController(
    {
      keydown: (event) => {
        calls++;
        event.preventDefault();
      }
    },
    async ({ content, send, state, flush }) => {
      const event = send(content, 'keydown', { key: 'PageDown' });
      await flush();
      assert.equal(calls, 1);
      assert.equal(event.defaultPrevented, true);
      assert.deepEqual(state.prepared, []);
    }
  );
});

test('unmapped PageDown is untouched; unhandled arrows retain page navigation', async () => {
  await withController({ keydown: () => {} }, async ({ content, send, state, flush }) => {
    assert.equal(send(content, 'keydown', { key: 'PageDown' }).defaultPrevented, false);
    assert.deepEqual(state.prepared, []);
    assert.equal(send(content, 'keydown', { key: 'ArrowRight' }).defaultPrevented, true);
    await flush();
    assert.deepEqual(state.prepared, [1]);
    assert.equal(state.committed, 1);
  });
});

test('composition and modified fallback keys do not turn the page', async () => {
  await withController({}, async ({ content, send, state, flush }) => {
    for (const properties of [{ isComposing: true }, { ctrlKey: true }]) {
      const event = send(content, 'keydown', { key: 'ArrowRight', ...properties });
      assert.equal(event.defaultPrevented, false);
    }
    await flush();
    assert.deepEqual(state.prepared, []);
  });
});

test('repeated fallback key reaches the burst sequence and releases on keyup', async () => {
  await withController({}, async ({ content, send, state, flush }) => {
    const event = send(content, 'keydown', { key: 'ArrowRight', repeat: true });
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(state.prepared, [1]);
    send(content, 'keyup', { key: 'ArrowRight' });
    await flush();
    assert.equal(state.committed, 1);
  });
});

test('disabled wheel navigation leaves explicit page controls available', async () => {
  await withController(
    { canTurn: (event) => event?.type !== 'wheel' },
    async ({ paginator, controller, state, send, flush }) => {
      const wheel = send(paginator, 'wheel', { deltaX: 300, deltaY: 0, deltaMode: 0 });
      assert.equal(wheel.defaultPrevented, false);
      assert.deepEqual(state.prepared, []);
      await controller.turn(1);
      await flush();
      assert.equal(state.committed, 1);
    }
  );
});

test('an overlay cancels an already prepared turn before commit', async () => {
  let allowed = true;
  await withController({ canTurn: () => allowed }, async ({ controller, state, flush }) => {
    await controller.turn(1);
    assert.deepEqual(state.prepared, [1]);
    allowed = false;
    await flush();
    assert.equal(state.committed, 0);
    assert.equal(state.cancelled, 1);
  });
});

test('owned reading UI blocks keyboard, pointer, wheel and programmatic turns', async () => {
  await withController(
    { canTurn: () => false },
    async ({ controller, paginator, content, send, state, flush }) => {
      send(content, 'keydown', { key: 'ArrowRight' });
      send(paginator, 'pointerdown', {
        isPrimary: true,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
        clientX: 350,
        clientY: 100
      });
      send(paginator, 'pointermove', { pointerId: 1, clientX: 20, clientY: 100 });
      send(paginator, 'pointerup', { pointerId: 1 });
      send(paginator, 'wheel', { deltaX: 300, deltaY: 0, deltaMode: 0 });
      await controller.turn(1);
      await flush();
      assert.deepEqual(state.prepared, []);
      assert.equal(state.committed, 0);
    }
  );
});

test('destruction cancels a late prepared turn without animating or publishing it', async () => {
  await withController({}, async ({ controller, paginator, state, flush }) => {
    let resolve;
    paginator.preparePageTurn = () => new Promise((accept) => (resolve = accept));
    const pending = controller.turn(1);
    controller.destroy();
    resolve({
      update: () => assert.fail('Destroyed turn must not animate'),
      commit: () => assert.fail('Destroyed turn must not commit'),
      cancel: () => {
        state.cancelled++;
      }
    });
    await pending;
    await flush();
    assert.equal(state.cancelled, 1);
  });
});

test('top-window blur during iframe refocus does not cancel a handled page shortcut', async () => {
  await withController({}, async ({ controller, host, state, flush }) => {
    await controller.turn(1);
    host.dispatchEvent(new Event('blur'));
    await flush();
    assert.equal(state.committed, 1);
  });
});

test('genuine document focus loss cancels a pending turn', async () => {
  await withController({}, async ({ controller, host, document, state, flush }) => {
    await controller.turn(1);
    document.hasFocus = () => false;
    host.dispatchEvent(new Event('blur'));
    await flush();
    assert.equal(state.committed, 0);
  });
});
