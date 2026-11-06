/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { loadOfflineModule } from './fixtures/offline-module.mjs';

const key = 'manabi-reader-dictionary-setup-v1';
const drain = async () => {
  for (let i = 0; i < 4; i++) await setImmediate();
};
async function fixture(choice = null, ready = false) {
  const dom = new JSDOM('', { url: 'https://reader.example/manabitan-reader/' });
  const values = new Map(choice ? [[key, choice]] : []),
    timers = new Map(),
    observers = [];
  let sequence = 0;
  class Observer {
    constructor(callback) {
      this.callback = callback;
      this.connected = false;
      observers.push(this);
    }
    observe(target, options) {
      this.connected = true;
      this.target = target;
      this.options = options;
    }
    disconnect() {
      this.connected = false;
    }
    notify() {
      if (this.connected) this.callback([]);
    }
  }
  const { api } = loadOfflineModule('apps/web/src/reader-react/dictionary-controller.ts', {
    globals: {
      document: dom.window.document,
      queueMicrotask,
      MutationObserver: Observer,
      setTimeout(callback, delay) {
        assert.equal(delay, 1200);
        timers.set(++sequence, callback);
        return sequence;
      },
      clearTimeout(id) {
        timers.delete(id);
      }
    },
    modules: {
      react: {},
      '$lib/data/window/local-storage': {
        localStorage: {
          getItem: (name) => values.get(name) ?? null,
          setItem: (name, value) => values.set(name, value)
        }
      }
    }
  });
  const controller = api.createDictionary({ contentReady: ready });
  controller.controller.prepare();
  controller.controller.start();
  await drain();
  return {
    controller,
    dom,
    timers,
    observers,
    values,
    async contentReady() {
      controller.updateProps({ contentReady: true });
      await drain();
    },
    async expire() {
      for (const [id, callback] of [...timers]) {
        timers.delete(id);
        callback();
      }
      await drain();
    },
    async bridgeReady() {
      dom.window.document.documentElement.dataset.manabitanReaderJitendexBridge = 'true';
      for (const observer of observers) observer.notify();
      await drain();
    },
    close() {
      controller.controller.destroy();
      dom.window.close();
    }
  };
}

test('mount and content readiness never interrupt reading with unsolicited initial dictionary setup', async () => {
  const f = await fixture();
  try {
    assert.equal(f.controller.open, false);
    assert.equal(f.timers.size, 0);
    await f.contentReady();
    assert.equal(f.timers.size, 1);
    await f.expire();
    assert.equal(f.controller.open, false);
    assert.equal(f.controller.savedChoice(), null);
    assert.equal(f.controller.checked, true);
    assert.equal(f.observers[0].target, f.dom.window.document.documentElement);
    await f.bridgeReady();
    assert.equal(f.controller.open, false, 'Extension appearance alone is not a setup request');
  } finally {
    f.close();
  }
});

test('dictionary setup remains available on demand before and after its initial readiness check', async () => {
  const f = await fixture();
  try {
    f.controller.show();
    assert.equal(f.controller.open, true);
    f.controller.choose('skip');
    assert.equal(f.controller.open, false);
    assert.equal(f.values.get(key), 'skip');
    await f.contentReady();
    await f.expire();
    assert.equal(f.controller.open, false);
    f.controller.show();
    assert.equal(f.controller.open, true);
  } finally {
    f.close();
  }
});

test('user-requested preferred extension resumes setup once its bridge becomes ready', async () => {
  const f = await fixture('preferred', true);
  try {
    await f.expire();
    assert.equal(f.controller.open, false);
    await f.bridgeReady();
    assert.equal(f.controller.open, true);
    f.controller.choose('done');
    assert.equal(f.controller.open, false);
    await f.bridgeReady();
    assert.equal(f.controller.open, false, 'Completed setup must not reopen');
  } finally {
    f.close();
  }
});

test('already-ready preferred extension completes the pending user-requested setup after the bounded initial check', async () => {
  const f = await fixture('preferred');
  try {
    await f.bridgeReady();
    assert.equal(f.controller.open, false, 'Wait for readable content');
    await f.contentReady();
    await f.expire();
    assert.equal(f.controller.open, true);
  } finally {
    f.close();
  }
});

test('dictionary setup disposal cancels its readiness timer and disconnects extension observation', async () => {
  const f = await fixture('preferred', true);
  try {
    assert.equal(f.timers.size, 1);
    assert.equal(f.observers[0].connected, true);
    f.controller.controller.destroy();
    assert.equal(f.timers.size, 0);
    assert.equal(f.observers[0].connected, false);
    await f.bridgeReady();
    await f.expire();
    assert.equal(f.controller.open, false);
  } finally {
    f.close();
  }
});
