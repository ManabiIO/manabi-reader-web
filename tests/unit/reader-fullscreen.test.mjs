import assert from 'node:assert/strict';
import test from 'node:test';
import { ReaderFullscreen } from '../../apps/web/src/lib/reader-fullscreen.ts';
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(initial = null) {
  const root = { tagName: 'HTML' },
    states = [],
    requests = [];
  let exits = 0;
  const port = {
    fullscreenEnabled: true,
    fullscreenElement: initial,
    requestFullscreen(element) {
      assert.equal(element, root);
      const pending = deferred();
      requests.push(pending);
      return pending.promise;
    },
    async exitFullscreen() {
      exits++;
      port.fullscreenElement = null;
    }
  };
  const reader = new ReaderFullscreen(port, root, (state) => states.push(state));
  function enter(index = 0) {
    port.fullscreenElement = root;
    reader.sync();
    requests[index].resolve();
  }
  return { root, port, states, requests, reader, enter, exits: () => exits };
}
test('fullscreen request starts within the initiating gesture; duplicate toggles join no new request', async () => {
  const f = fixture();
  const pending = f.reader.toggle();
  assert.equal(f.requests.length, 1);
  assert.equal(f.states.at(-1).busy, true);
  await f.reader.toggle();
  assert.equal(f.requests.length, 1);
  f.enter();
  await pending;
  assert.deepEqual(f.states.at(-1), { available: true, active: true, busy: false, error: '' });
  f.reader.dispose();
  assert.equal(f.exits(), 1);
});
test('disposing a reader does not exit a pre-existing root fullscreen session', () => {
  const f = fixture();
  f.port.fullscreenElement = f.root;
  f.reader.sync();
  f.reader.dispose();
  assert.equal(f.exits(), 0);
});
test('any active fullscreen is labelled Exit, including a foreign target and disabled entry capability', async () => {
  const foreign = { tagName: 'VIDEO' },
    f = fixture(foreign);
  f.port.fullscreenEnabled = false;
  f.reader.sync();
  assert.equal(f.states.at(-1).active, true);
  assert.equal(f.states.at(-1).available, true);
  await f.reader.toggle();
  assert.equal(f.exits(), 1);
  assert.equal(f.states.at(-1).available, false);
  f.reader.dispose();
  assert.equal(f.exits(), 1);
});
test('an unmounted pending entry cleans up its own eventual fullscreen without publishing to dead UI', async () => {
  const f = fixture(),
    pending = f.reader.toggle();
  f.reader.dispose();
  const count = f.states.length;
  f.enter();
  await pending;
  assert.equal(f.exits(), 1);
  assert.equal(f.states.length, count);
});
test('an older pending entry cannot exit a successor reader fullscreen session', async () => {
  const f = fixture(),
    old = f.reader.toggle();
  f.reader.dispose();
  const newer = new ReaderFullscreen(f.port, f.root, () => undefined);
  const current = newer.toggle();
  assert.equal(f.requests.length, 2);
  f.port.fullscreenElement = f.root;
  newer.sync();
  f.requests[1].resolve();
  await current;
  f.requests[0].resolve();
  await old;
  assert.equal(f.exits(), 0);
  assert.equal(f.port.fullscreenElement, f.root);
  newer.dispose();
  assert.equal(f.exits(), 1);
});
test('a browser exit before the entry promise settles revokes later automatic cleanup', async () => {
  const f = fixture(),
    pending = f.reader.toggle();
  f.port.fullscreenElement = f.root;
  f.reader.sync();
  f.port.fullscreenElement = null;
  f.reader.sync();
  // Another UI can use the same document root after the browser exited ours.
  f.port.fullscreenElement = f.root;
  f.requests[0].resolve();
  await pending;
  f.reader.dispose();
  assert.equal(f.exits(), 0);
});
test('a foreign fullscreen target replacing an owned root is not exited during disposal', async () => {
  const f = fixture(),
    pending = f.reader.toggle();
  f.enter();
  await pending;
  f.port.fullscreenElement = { tagName: 'VIDEO' };
  f.reader.sync();
  f.reader.dispose();
  assert.equal(f.exits(), 0);
});
test('request rejection clears busy state, reports a recoverable error and permits a new gesture', async () => {
  const f = fixture(),
    pending = f.reader.toggle();
  f.requests[0].reject(new Error('Denied'));
  await pending;
  assert.equal(f.states.at(-1).busy, false);
  assert.match(f.states.at(-1).error, /Denied/);
  const retry = f.reader.toggle();
  assert.equal(f.states.at(-1).error, '');
  f.enter(1);
  await retry;
  f.reader.dispose();
  assert.equal(f.exits(), 1);
});
test('entry may resolve without becoming fullscreen; no ownership is invented', async () => {
  const f = fixture(),
    pending = f.reader.toggle();
  f.requests[0].resolve();
  await pending;
  f.port.fullscreenElement = f.root;
  f.reader.dispose();
  assert.equal(f.exits(), 0);
});
test('dispose is idempotent and cannot admit another fullscreen request', async () => {
  const f = fixture();
  f.reader.dispose();
  f.reader.dispose();
  await f.reader.toggle();
  assert.equal(f.requests.length, 0);
});
