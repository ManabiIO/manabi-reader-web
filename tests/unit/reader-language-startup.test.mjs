/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import createDOMPurify from '../../apps/web/node_modules/dompurify/dist/purify.es.mjs';
import { ReaderLanguageBook } from '../../apps/web/src/lib/preprocessing/reader-book.mjs';
import { loadOfflineModule } from './fixtures/offline-module.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function runtime(events, name) {
  const noop = async () => {};
  return {
    render() {},
    installDefault: noop,
    recommendations: noop,
    client: Object.fromEntries(
      [
        'status',
        'search',
        'importDictionary',
        'deleteDictionary',
        'setEnabled',
        'recordDefaultInstall',
        'close'
      ].map((key) => [key, key === 'close' ? async () => events.push(`close:${name}`) : noop])
    )
  };
}
async function harness(open, { edition = 'manabi', hash, strict = false } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://reader.example/reader-web/' });
  const saved = new Map();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const timers = new Map(),
    books = [];
  let timerID = 0,
    state,
    props = Object.freeze({
      bookKey: 'first',
      htmlContent: '<div id="chapter-one"><p>猫𠮷</p></div><div id="chapter-two"><p>本</p></div>',
      viewMode: 'paginated',
      imageBindings: new Map(),
      publicationManifest: {
        version: 1,
        resources: [
          { sectionId: 'chapter-one', href: 'first.xhtml', spineIndex: 0 },
          { sectionId: 'chapter-two', href: 'second.xhtml', spineIndex: 1 }
        ]
      },
      bookmarkData: Promise.resolve({ exploredCharCount: 3 }),
      exploredCharCount: 3
    });
  class ObservedBook extends ReaderLanguageBook {
    constructor(input) {
      super(input);
      books.push(this);
    }
  }
  const { api } = loadOfflineModule('apps/web/src/reader-react/reader-language.ts', {
    globals: {
      document: dom.window.document,
      setTimeout(callback, ms) {
        assert.equal(ms, 60000);
        timers.set(++timerID, callback);
        return timerID;
      },
      clearTimeout(id) {
        timers.delete(id);
      }
    },
    modules: {
      react: React,
      dompurify: createDOMPurify,
      '$lib/preprocessing/reader-book.mjs': { ReaderLanguageBook: ObservedBook },
      '$lib/search/reader-dictionary-interaction': {
        attachReaderDictionaryInteraction: () => () => {}
      },
      '../runtime/edition': { readerEdition: edition },
      './dictionary-provider-selection': { openDictionaryProvider: open },
      ...(hash ? { '$lib/preprocessing/contracts.mjs': { sha256: hash } } : {})
    }
  });
  const root = createRoot(dom.window.document.getElementById('root'));
  function Host() {
    state = api.useReaderLanguageBook(props);
    return React.createElement('p', null, state.error ?? (state.loading ? 'opening' : 'ready'));
  }
  const drain = async () => {
    await act(async () => {
      for (let i = 0; i < 8; i++) await setImmediate();
    });
  };
  const ready = async () => {
    const deadline = Date.now() + 2000;
    while (state.loading && Date.now() < deadline) await drain();
    assert.equal(state.loading, false, 'The current opening must settle');
  };
  await act(async () => {
    root.render(
      strict
        ? React.createElement(React.StrictMode, null, React.createElement(Host))
        : React.createElement(Host)
    );
  });
  await drain();
  return {
    get state() {
      return state;
    },
    get props() {
      return props;
    },
    books,
    timers,
    async update(next) {
      props = Object.freeze({ ...props, ...next });
      await act(async () => {
        root.render(
          strict
            ? React.createElement(React.StrictMode, null, React.createElement(Host))
            : React.createElement(Host)
        );
      });
      await drain();
    },
    async run(action) {
      await act(async () => {
        action();
      });
      await drain();
    },
    async expire() {
      await act(async () => {
        for (const callback of [...timers.values()]) callback();
      });
      await drain();
    },
    drain,
    ready,
    async close() {
      await act(async () => {
        root.unmount();
      });
      await drain();
      dom.window.close();
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  };
}

test('failed provider admission never silently opens original text; explicit choice preserves source and bookmark inputs', async () => {
  const pending = deferred(),
    events = [];
  let opens = 0;
  const h = await harness(() => {
    opens++;
    return pending.promise;
  });
  try {
    assert.equal(h.state.loading, true);
    assert.equal(h.state.canReadOriginal, true);
    await h.run(() => pending.reject(new Error('fixture network failure')));
    assert.equal(h.state.loading, false);
    assert.ok(h.state.error);
    assert.equal(h.state.book, undefined);
    const initial = h.props;
    await h.run(() => h.state.readOriginal());
    await h.ready();
    assert.equal(h.state.loading, false);
    assert.equal(h.state.error, undefined);
    assert.equal(h.state.original, true);
    assert.equal(h.state.book.hasAnalysis, false);
    assert.equal(h.state.book.runtime, undefined);
    assert.equal(opens, 1);
    assert.equal(h.state.book.chapters[1].id, 'chapter-two');
    assert.equal(h.state.book.chapters[0].html, '<p>猫𠮷</p>');
    assert.equal(h.props, initial);
    assert.equal(h.props.exploredCharCount, 3);
    assert.equal((await h.props.bookmarkData).exploredCharCount, 3);
    const original = h.state.book;
    await h.update({ viewMode: 'continuous', imageBindings: new Map() });
    await h.ready();
    assert.equal(h.state.original, true);
    assert.equal(opens, 1);
    assert.equal(original.disposed, true);
    assert.equal(h.state.book.hasAnalysis, false);
    assert.deepEqual(events, []);
  } finally {
    await h.close();
  }
});

test('timeout releases its pending lease; retry stays bounded and replacement waits for late owner disposal', async () => {
  const pending = deferred(),
    events = [];
  let opens = 0;
  const h = await harness(() => {
    events.push(`open:${++opens}`);
    return opens === 1 ? pending.promise : Promise.resolve(runtime(events, 'second'));
  });
  try {
    await h.expire();
    assert.match(h.state.error, /taking too long/);
    assert.equal(h.state.loading, false);
    await h.run(() => h.state.retry());
    assert.equal(h.state.loading, true);
    assert.equal(opens, 1);
    await h.expire();
    assert.match(h.state.error, /taking too long/);
    await h.run(() => pending.resolve(runtime(events, 'first')));
    assert.equal(h.state.book, undefined);
    assert.match(h.state.error, /taking too long/);
    assert.deepEqual(events, ['open:1', 'close:first']);
    await h.run(() => h.state.retry());
    await h.ready();
    assert.ok(h.state.book);
    assert.deepEqual(events, ['open:1', 'close:first', 'open:2']);
  } finally {
    await h.close();
  }
  assert.deepEqual(events, ['open:1', 'close:first', 'open:2', 'close:second']);
});

test('original-text choice during pending startup retires late runtime without replacing the visible book', async () => {
  const pending = deferred(),
    events = [];
  const h = await harness(() => pending.promise);
  try {
    await h.run(() => h.state.readOriginal());
    await h.ready();
    const original = h.state.book;
    assert.ok(original);
    assert.equal(original.hasAnalysis, false);
    assert.equal(h.timers.size, 0);
    await h.run(() => pending.resolve(runtime(events, 'late')));
    assert.equal(h.state.book, original);
    assert.equal(original.disposed, false);
    assert.deepEqual(events, ['close:late']);
    assert.equal(h.books.length, 1);
  } finally {
    await h.close();
  }
});

test('a book created after cancellation is disposed rather than published', async () => {
  const hash = deferred(),
    events = [];
  let hashes = 0;
  const h = await harness(async () => runtime(events, 'first'), {
    hash: () => (++hashes === 1 ? hash.promise : Promise.resolve('identity'))
  });
  try {
    await h.run(() => h.state.readOriginal());
    await h.ready();
    const original = h.state.book;
    assert.ok(original);
    assert.deepEqual(events, ['close:first']);
    await h.run(() => hash.resolve('late-fingerprint'));
    assert.equal(h.state.book, original);
    assert.equal(h.books.length, 2);
    assert.equal(h.books.find((book) => book !== original).disposed, true);
    assert.equal(original.disposed, false);
  } finally {
    await h.close();
  }
});

test('returning to an identical book cannot revive its previously disposed language book', async () => {
  const pending = deferred(),
    events = [];
  let opens = 0;
  const h = await harness(() =>
    ++opens === 2 ? pending.promise : Promise.resolve(runtime(events, String(opens)))
  );
  try {
    await h.ready();
    const first = h.state.book;
    assert.ok(first);
    await h.update({ bookKey: 'second' });
    assert.equal(first.disposed, true);
    assert.equal(h.state.loading, true);
    await h.update({ bookKey: 'first' });
    assert.equal(h.state.book, undefined);
    assert.equal(h.state.loading, true);
    await h.run(() => pending.resolve(runtime(events, '2')));
    await h.ready();
    assert.ok(h.state.book);
    assert.notEqual(h.state.book, first);
    assert.equal(h.state.book.disposed, false);
    assert.deepEqual(events, ['close:1', 'close:2']);
  } finally {
    await h.close();
  }
});

test('unmount retires unresolved startup, closes its late runtime, and leaves no startup timer', async () => {
  const pending = deferred(),
    events = [];
  const h = await harness(() => pending.promise);
  await h.close();
  assert.equal(h.timers.size, 0);
  pending.resolve(runtime(events, 'late'));
  for (let i = 0; i < 8; i++) await setImmediate();
  assert.deepEqual(events, ['close:late']);
  assert.equal(h.books.length, 0);
});

test('public reader attaches identity interactions without provider startup or a recovery bypass', async () => {
  let opens = 0;
  const h = await harness(
    () => {
      opens++;
      throw new Error('Public reading must stay lazy');
    },
    { edition: 'manabitan' }
  );
  try {
    await h.ready();
    assert.ok(h.state.book);
    assert.equal(opens, 0);
    assert.equal(h.timers.size, 0);
    assert.equal(h.state.canReadOriginal, false);
    assert.equal(h.state.book.hasAnalysis, false);
  } finally {
    await h.close();
  }
});

test('Strict Mode replay retires its abandoned pending startup before the surviving owner opens', async () => {
  const events = [];
  let opens = 0;
  const h = await harness(
    async () => {
      opens++;
      return runtime(events, 'strict');
    },
    { strict: true }
  );
  try {
    await h.ready();
    assert.equal(opens, 1);
    assert.ok(h.state.book);
    assert.equal(h.state.book.disposed, false);
    assert.equal(h.timers.size, 0);
    assert.deepEqual(events, []);
  } finally {
    await h.close();
  }
  assert.deepEqual(events, ['close:strict']);
});
