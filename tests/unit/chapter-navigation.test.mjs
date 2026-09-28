import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChapterNavigation } from '../../apps/web/src/lib/components/book-reader/book-toc/chapter-navigation.ts';

function fixture(t, navigate) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events = new EventTarget();
  const listeners = new Set();
  const add = events.addEventListener.bind(events);
  const remove = events.removeEventListener.bind(events);
  events.addEventListener = (type, listener) => {
    listeners.add(listener);
    add(type, listener);
  };
  events.removeEventListener = (type, listener) => {
    listeners.delete(listener);
    remove(type, listener);
  };
  const calls = [];
  const page = () => events.dispatchEvent(new Event('page'));
  const navigation = createChapterNavigation(
    events,
    'page',
    (reference) => {
      calls.push(['navigate', reference]);
      navigate?.(reference, page, navigation);
    },
    () => calls.push(['close'])
  );
  return { navigation, page, calls, listeners };
}

test('immediate close publishes the chapter before closing and keeps no listener', (t) => {
  const h = fixture(t);
  h.navigation.select('next', true, false);
  assert.deepEqual(h.calls, [['navigate', 'next'], ['close']]);
  assert.equal(h.listeners.size, 0);
});

test('previous/next keep Contents open without creating a settlement listener', (t) => {
  const h = fixture(t);
  h.navigation.select('next', false, true);
  h.page();
  t.mock.timers.tick(1000);
  assert.deepEqual(h.calls, [['navigate', 'next']]);
  assert.equal(h.listeners.size, 0);
});

test('page settlement debounces once and removes its listener', (t) => {
  const h = fixture(t);
  h.navigation.select('next', true, true);
  assert.equal(h.listeners.size, 1);
  h.page();
  t.mock.timers.tick(199);
  h.page();
  t.mock.timers.tick(199);
  assert.deepEqual(h.calls, [['navigate', 'next']]);
  t.mock.timers.tick(1);
  h.page();
  t.mock.timers.tick(1000);
  assert.deepEqual(h.calls, [['navigate', 'next'], ['close']]);
  assert.equal(h.listeners.size, 0);
});

test('a synchronous cached navigation is observed because enrollment comes first', (t) => {
  const h = fixture(t, (_reference, page) => page());
  h.navigation.select('cached', true, true);
  t.mock.timers.tick(200);
  assert.deepEqual(h.calls, [['navigate', 'cached'], ['close']]);
});

for (const afterEvent of [false, true]) {
  test(`dismissal cancels ${afterEvent ? 'the queued close' : 'the pending listener'}`, (t) => {
    const h = fixture(t);
    h.navigation.select('old', true, true);
    if (afterEvent) h.page();
    h.navigation.cancel();
    h.page();
    t.mock.timers.tick(1000);
    assert.deepEqual(h.calls, [['navigate', 'old']]);
    assert.equal(h.listeners.size, 0);
  });
}

test('a newer keep-open gesture revokes an older delayed row close', (t) => {
  const h = fixture(t);
  h.navigation.select('old', true, true);
  h.page();
  h.navigation.select('new', false, true);
  h.page();
  t.mock.timers.tick(1000);
  assert.deepEqual(h.calls, [
    ['navigate', 'old'],
    ['navigate', 'new']
  ]);
  assert.equal(h.listeners.size, 0);
});

test('a newer waiting choice owns the only listener and the only eventual close', (t) => {
  const h = fixture(t);
  h.navigation.select('old', true, true);
  h.page();
  t.mock.timers.tick(150);
  h.navigation.select('new', true, true);
  t.mock.timers.tick(1000);
  assert.deepEqual(h.calls, [
    ['navigate', 'old'],
    ['navigate', 'new']
  ]);
  assert.equal(h.listeners.size, 1);
  h.page();
  t.mock.timers.tick(200);
  assert.deepEqual(h.calls.at(-1), ['close']);
  assert.equal(h.listeners.size, 0);
});

test('a dismissed opening cannot close a reopened panel', (t) => {
  const h = fixture(t);
  h.navigation.select('old', true, true);
  h.page();
  h.navigation.cancel();
  h.navigation.select('reopened', false, false);
  t.mock.timers.tick(1000);
  h.page();
  t.mock.timers.tick(1000);
  assert.deepEqual(h.calls, [
    ['navigate', 'old'],
    ['navigate', 'reopened']
  ]);
});

test('disposal clears pending work and permanently rejects future selections', (t) => {
  const h = fixture(t);
  h.navigation.select('old', true, true);
  h.page();
  h.navigation.dispose();
  h.navigation.select('late', true, false);
  t.mock.timers.tick(1000);
  assert.deepEqual(h.calls, [['navigate', 'old']]);
  assert.equal(h.listeners.size, 0);
});

test('synchronous navigation failure cannot leak a pending close', (t) => {
  const h = fixture(t, () => {
    throw new Error('navigation rejected');
  });
  assert.throws(() => h.navigation.select('bad', true, true), /navigation rejected/);
  h.page();
  t.mock.timers.tick(1000);
  assert.equal(h.listeners.size, 0);
  assert.deepEqual(h.calls, [['navigate', 'bad']]);
});

test('reentrant dismissal during navigation prevents its obsolete immediate close', (t) => {
  const h = fixture(t, (_reference, _page, navigation) => navigation.cancel());
  h.navigation.select('next', true, false);
  assert.deepEqual(h.calls, [['navigate', 'next']]);
});
