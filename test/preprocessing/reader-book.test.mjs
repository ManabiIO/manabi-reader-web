/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { ReaderLanguageBook } from '../../apps/web/src/lib/preprocessing/reader-book.mjs';
import { waitForChapterLayout } from '../../apps/web/src/lib/preprocessing/layout-readiness.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const chapters = [
  { id: 'a', baseURL: 'https://book.invalid/a', html: '<p>猫</p>' },
  { id: 'b', baseURL: 'https://book.invalid/b', html: '<p>犬</p>' }
];
function makeBook(options = {}) {
  return new ReaderLanguageBook({
    bookKey: 'content:fixture',
    resourceVersion: '1',
    chapters,
    renderHTML: (html) => html,
    ...options
  });
}
test('the production book composition preserves identity DOM and attaches before geometry and reveal', async () => {
  const dom = new JSDOM('<div id="chapter"><p>猫</p></div>');
  const root = dom.window.document.getElementById('chapter');
  const original = root.firstChild;
  const events = [];
  const book = makeBook({
    interaction: (element, context) => {
      assert.equal(context.bookKey, 'content:fixture');
      assert.equal(context.chapterID, 'a');
      assert.equal(context.analysis, null);
      events.push('attach');
      return () => events.push('detach');
    }
  });
  try {
    await book.open(0, root, {
      prepare: async () => events.push('layout'),
      commit: () => events.push('reveal')
    });
    assert.equal(root.firstChild, original);
    assert.deepEqual(events, ['attach', 'layout', 'reveal']);
    book.retire();
    assert.deepEqual(events, ['attach', 'layout', 'reveal', 'detach']);
  } finally {
    book.dispose();
    dom.window.close();
  }
});
test('real provider contracts transform, mount and attach before restoration, with independent source HTML', async () => {
  const dom = new JSDOM('<div id="chapter"><p>犬</p></div>');
  const root = dom.window.document.getElementById('chapter');
  const events = [];
  let disposed = 0;
  const runtime = {
    preprocessor: {
      protocol: 1,
      id: 'test-only-provider',
      release: '1',
      fingerprint: async () => 'generation',
      preprocess: async (input) => {
        assert.equal(input.html, '<p>犬</p>');
        events.push('analyze');
        return {
          protocol: 1,
          fingerprint: input.fingerprint,
          html: '<p><m-m>犬</m-m></p>',
          sidecar: { segment: 1 },
          vocabulary: []
        };
      },
      mount: (element, sidecar) => {
        assert.ok(element.querySelector('m-m'));
        assert.equal(sidecar.segment, 1);
        events.push('mount');
        return () => events.push('unmount');
      },
      dispose: () => disposed++
    },
    attachChapter: (element, context) => {
      assert.equal(context.chapterID, 'b');
      assert.equal(context.analysis.segment, 1);
      events.push('attach');
      return () => events.push('detach');
    }
  };
  const book = makeBook({ chapters: [chapters[1]], runtime });
  try {
    await book.open(0, root, {
      prepare: async () => events.push('restore'),
      commit: () => events.push('reveal')
    });
    assert.deepEqual(events, ['analyze', 'mount', 'attach', 'restore', 'reveal']);
    book.dispose();
    assert.deepEqual(events.slice(-2), ['detach', 'unmount']);
    assert.equal(disposed, 0, 'deployment lease owns provider disposal');
  } finally {
    book.dispose();
    dom.window.close();
  }
});
test('disposing during asynchronous interaction cannot publish and releases its late bindings', async () => {
  const entered = deferred(),
    gate = deferred();
  const events = [];
  const book = makeBook({
    interaction: async () => {
      entered.resolve();
      await gate.promise;
      return () => events.push('detach');
    }
  });
  const opening = book.open(
    0,
    {},
    { prepare: async () => events.push('layout'), commit: () => events.push('reveal') }
  );
  await entered.promise;
  book.dispose();
  gate.resolve();
  await assert.rejects(opening, { name: 'AbortError' });
  assert.deepEqual(events, ['detach']);
});
test('retiring reusable roots releases old ownership before a successor mutates the root', async () => {
  const events = [];
  const book = makeBook({
    interaction: (_root, { chapterID, signal }) => {
      events.push(`attach:${chapterID}`);
      return () => {
        assert.equal(signal.aborted, true);
        events.push(`detach:${chapterID}`);
      };
    }
  });
  try {
    await book.open(0, {}, { prepare: async () => {}, commit() {} });
    book.retire();
    events.push('replace-root-children');
    await book.open(1, {}, { prepare: async () => {}, commit() {} });
    assert.deepEqual(events, ['attach:a', 'detach:a', 'replace-root-children', 'attach:b']);
  } finally {
    book.dispose();
  }
});
test('layout failure remains an opening error, disposes interaction and cannot reveal', async () => {
  const events = [];
  const book = makeBook({ interaction: () => () => events.push('detach') });
  try {
    await assert.rejects(
      book.open(
        0,
        {},
        {
          prepare: async () => {
            throw new Error('geometry failed');
          },
          commit: () => events.push('reveal')
        }
      ),
      /geometry failed/
    );
    assert.deepEqual(events, ['detach']);
  } finally {
    book.dispose();
  }
});
test('chapter layout waits for actual images and cleans up after cancellation and timeout', async () => {
  const dom = new JSDOM('<div><img src="https://image.invalid/pending"></div>');
  const root = dom.window.document.querySelector('div');
  const controller = new AbortController();
  try {
    const waiting = waitForChapterLayout(root, controller.signal);
    controller.abort();
    await assert.rejects(waiting, { name: 'AbortError' });
    await assert.rejects(waitForChapterLayout(root, new AbortController().signal, 5), /too long/);
    const settled = waitForChapterLayout(root, new AbortController().signal);
    root.querySelector('img').dispatchEvent(new dom.window.Event('error'));
    await settled;
  } finally {
    dom.window.close();
  }
});
test('an unresolved optional font permits fallback layout without bypassing pending images', async () => {
  const dom = new JSDOM('<div><p>猫</p></div>');
  const root = dom.window.document.querySelector('div');
  Object.defineProperty(dom.window.document, 'fonts', {
    value: { ready: new Promise(() => {}) }
  });
  try {
    await waitForChapterLayout(root, new AbortController().signal, 100, 5);
    const image = dom.window.document.createElement('img');
    image.src = 'https://image.invalid/pending';
    root.append(image);
    await assert.rejects(
      waitForChapterLayout(root, new AbortController().signal, 15, 1),
      /too long/
    );
    const abort = new AbortController();
    const waiting = waitForChapterLayout(root, abort.signal, 100, 50);
    abort.abort();
    await assert.rejects(waiting, { name: 'AbortError' });
  } finally {
    dom.window.close();
  }
});
test('a rejected font-ready signal preserves reading with fallback typography', async () => {
  const dom = new JSDOM('<div><p>猫</p></div>');
  Object.defineProperty(dom.window.document, 'fonts', {
    value: { ready: Promise.reject(new Error('Optional font unavailable')) }
  });
  try {
    await waitForChapterLayout(
      dom.window.document.querySelector('div'),
      new AbortController().signal
    );
  } finally {
    dom.window.close();
  }
});
