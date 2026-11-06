/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { observeBrowserConnectivity } from '../../apps/web/src/runtime/browser-connectivity.ts';

function fixture(initial) {
  const window = new EventTarget();
  const document = new EventTarget();
  document.visibilityState = 'visible';
  const navigator = { onLine: initial };
  const values = [];
  const stop = observeBrowserConnectivity((value) => values.push(value), {
    window,
    document,
    navigator
  });
  return { window, document, navigator, values, stop };
}

test('offline startup is published without waiting for a network event', () => {
  const f = fixture(false);
  assert.deepEqual(f.values, [false]);
  f.window.dispatchEvent(new Event('offline'));
  f.window.dispatchEvent(new Event('focus'));
  assert.deepEqual(f.values, [false]);
  f.navigator.onLine = true;
  f.window.dispatchEvent(new Event('online'));
  assert.deepEqual(f.values, [false, true]);
  f.stop();
});

test('foregrounding resamples missed transitions and disposal removes every listener', () => {
  const f = fixture(true);
  f.navigator.onLine = false;
  f.document.visibilityState = 'hidden';
  f.document.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(f.values, [true]);
  f.document.visibilityState = 'visible';
  f.document.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(f.values, [true, false]);
  f.navigator.onLine = true;
  f.window.dispatchEvent(new Event('focus'));
  assert.deepEqual(f.values, [true, false, true]);
  f.stop();
  f.navigator.onLine = false;
  for (const name of ['offline', 'online', 'focus']) f.window.dispatchEvent(new Event(name));
  f.document.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(f.values, [true, false, true]);
});

test('missing or denied hints never invent online success', () => {
  const f = fixture(undefined);
  assert.deepEqual(f.values, []);
  Object.defineProperty(f.navigator, 'onLine', {
    get() {
      throw new Error('Denied');
    }
  });
  f.window.dispatchEvent(new Event('online'));
  assert.deepEqual(f.values, []);
  f.window.dispatchEvent(new Event('offline'));
  assert.deepEqual(f.values, [false]);
  f.stop();
});
