import assert from 'node:assert/strict';
import test from 'node:test';

import { observeReaderFontLayout } from '../../apps/web/src/lib/functions/reader-font-layout.ts';

class FakeFontSet extends EventTarget {
  constructor(faces) {
    super();
    this.faces = faces;
    this.ready = Promise.resolve(this);
  }

  forEach(callback) {
    this.faces.forEach(callback);
  }
}

function harness(faces, family = '"Noto Serif JP", serif') {
  const fonts = new FakeFontSet(faces);
  const view = {
    requestAnimationFrame(callback) {
      return setTimeout(() => callback(performance.now()), 0);
    },
    cancelAnimationFrame(handle) {
      clearTimeout(handle);
    },
    setTimeout,
    clearTimeout,
    getComputedStyle() {
      return { fontFamily: family };
    }
  };
  const element = {
    ownerDocument: { defaultView: view, fonts },
    isConnected: true,
    getBoundingClientRect() {
      return {};
    }
  };
  let notifications = 0;
  const stop = observeReaderFontLayout(element, () => {
    notifications += 1;
  }, 10000);

  return {
    fonts,
    stop,
    count: () => notifications
  };
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('active WebKit-style error face notifies again when it becomes loaded', async () => {
  const face = {
    family: 'Noto Serif JP',
    status: 'error',
    loaded: Promise.resolve()
  };
  const state = harness([face]);

  await sleep(25);
  const initial = state.count();
  assert.ok(initial >= 1);

  face.status = 'loaded';
  await sleep(150);

  assert.ok(state.count() > initial, 'late loaded face must trigger another layout notification');
  state.stop();
});

test('transient error polling ignores a face outside the active reader family', async () => {
  const face = {
    family: 'Unused Font',
    status: 'error',
    loaded: Promise.resolve()
  };
  const state = harness([face]);

  await sleep(25);
  const initial = state.count();
  face.status = 'loaded';
  await sleep(150);

  assert.equal(state.count(), initial);
  state.stop();
});

test('disposing the observer cancels an error-to-loaded notification', async () => {
  const face = {
    family: 'Noto Serif JP',
    status: 'error',
    loaded: Promise.resolve()
  };
  const state = harness([face]);

  await sleep(25);
  const initial = state.count();
  state.stop();
  face.status = 'loaded';
  await sleep(150);

  assert.equal(state.count(), initial);
});
