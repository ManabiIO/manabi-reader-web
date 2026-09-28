import assert from 'node:assert/strict';
import test from 'node:test';
import { ReaderChrome } from '../../apps/web/src/lib/reader-chrome.ts';
function fixture(protectedInteraction = () => false) {
  let next = 0;
  const callbacks = new Map(),
    states = [];
  const scheduler = {
    schedule(callback, delay) {
      assert.equal(delay, 3000);
      const key = ++next;
      callbacks.set(key, callback);
      return key;
    },
    cancel(key) {
      callbacks.delete(key);
    }
  };
  const chrome = new ReaderChrome((state) => states.push(state), protectedInteraction, scheduler);
  return {
    chrome,
    states,
    callbacks,
    fire() {
      const entry = callbacks.entries().next().value;
      if (entry) {
        callbacks.delete(entry[0]);
        entry[1]();
      }
    }
  };
}
test('initial and mouse reveals hide after idle', () => {
  const value = fixture();
  value.fire();
  assert.equal(value.chrome.mode, 'hidden');
  value.chrome.pointer();
  assert.equal(value.chrome.mode, 'transient');
  value.fire();
  assert.equal(value.chrome.mode, 'hidden');
});
test('explicit reveal stays pinned through mouse movement, never rearms the idle timer', () => {
  const value = fixture();
  value.fire();
  value.chrome.toggle();
  for (let i = 0; i < 50; i++) value.chrome.pointer();
  assert.equal(value.chrome.mode, 'pinned');
  assert.equal(value.callbacks.size, 0);
});
test('click while transient pins instead of unexpectedly disappearing', () => {
  const value = fixture();
  value.chrome.toggle();
  assert.equal(value.chrome.mode, 'pinned');
  value.chrome.toggle();
  assert.equal(value.chrome.mode, 'hidden');
});
test('cancelled queued timer cannot undo a newer explicit reveal', () => {
  const value = fixture(),
    stale = [...value.callbacks.values()][0];
  value.chrome.pin();
  stale();
  assert.equal(value.chrome.mode, 'pinned');
});
test('menus, text selections and focused controls protect against timeout', () => {
  let protectedState = true;
  const value = fixture(() => protectedState);
  value.fire();
  assert.equal(value.chrome.mode, 'transient');
  assert.equal(value.callbacks.size, 1);
  protectedState = false;
  value.fire();
  assert.equal(value.chrome.mode, 'hidden');
});
test('intentional reading motion hides controls, but not an active protected interaction', () => {
  let protectedState = false;
  const value = fixture(() => protectedState);
  value.chrome.pin();
  value.chrome.reading();
  assert.equal(value.chrome.mode, 'hidden');
  value.chrome.pin();
  protectedState = true;
  value.chrome.reading();
  assert.equal(value.chrome.mode, 'pinned');
});
test('disposal cancels callbacks and cannot affect a successor reader', () => {
  const value = fixture(),
    stale = [...value.callbacks.values()][0];
  value.chrome.dispose();
  stale();
  value.chrome.pointer();
  value.chrome.pin();
  assert.equal(value.callbacks.size, 0);
  assert.deepEqual(value.states, []);
});
