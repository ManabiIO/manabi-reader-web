import assert from 'node:assert/strict';
import test from 'node:test';
import { HtmlReadiness } from '../../apps/web/src/reader-react/html-readiness.ts';

// Execute the same committed-markup lifetime used by the active React Dom
// component. Parent ref assignment and actual geometry are covered in browser.
function fixture() {
  const waiting = new Map();
  const loads = [];
  let html;
  let nextFrame = 0;
  const readiness = new HtmlReadiness(
    (callback) => {
      waiting.set(++nextFrame, callback);
      return nextFrame;
    },
    (frame) => waiting.delete(frame),
    () => loads.push({ type: 'load', html })
  );
  return {
    update(next, identity) {
      html = next;
      readiness.update(next, identity);
    },
    destroy: () => readiness.destroy(),
    flush: async () => {
      const callbacks = [...waiting.values()];
      waiting.clear();
      callbacks.forEach((callback) => callback());
      await Promise.resolve();
    },
    loads
  };
}

test('HTML readiness does not publish before the parent binding flush', async () => {
  const h = fixture();
  h.update('<p>First</p>');
  assert.deepEqual(h.loads, []);
  await h.flush();
  assert.deepEqual(h.loads, [{ type: 'load', html: '<p>First</p>' }]);
});

test('superseded markup cannot initialize the geometry owner', async () => {
  const h = fixture();
  h.update('<p>Old</p>');
  h.update('<p>Current</p>');
  await h.flush();
  assert.deepEqual(h.loads, [{ type: 'load', html: '<p>Current</p>' }]);
});

test('unchanged markup still emits once across binding and font updates', async () => {
  const h = fixture();
  h.update('<p>Same</p>');
  await h.flush();
  for (let i = 0; i < 5; i++) {
    h.update('<p>Same</p>');
    await h.flush();
  }
  assert.equal(h.loads.length, 1);
});

test('destruction cancels an already queued ready notification', async () => {
  const h = fixture();
  h.update('<p>Gone</p>');
  h.destroy();
  await h.flush();
  assert.deepEqual(h.loads, []);
});

test('later genuine markup changes continue publishing once each', async () => {
  const h = fixture();
  for (const html of ['', '<p>A</p>', '<p>B</p>', '']) {
    h.update(html);
    await h.flush();
  }
  assert.deepEqual(
    h.loads.map((event) => event.html),
    ['', '<p>A</p>', '<p>B</p>', '']
  );
});

test('rapid return to previous markup publishes only its current lifetime', async () => {
  const h = fixture();
  h.update('<p>A</p>');
  h.update('<p>B</p>');
  h.update('<p>A</p>');
  await h.flush();
  assert.deepEqual(h.loads, [{ type: 'load', html: '<p>A</p>' }]);
});

test('equal markup in a new spine occurrence gets a fresh geometry owner', async () => {
  const h = fixture();
  h.update('<p>Repeated chapter</p>', 1);
  await h.flush();
  h.update('<p>Repeated chapter</p>', 2);
  await h.flush();
  assert.equal(h.loads.length, 2);
});
