/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { setTimeout as pause } from 'node:timers/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';
import { ReaderLanguageBook } from '../../apps/web/src/lib/preprocessing/reader-book.mjs';

const source = new URL('../../', import.meta.url).pathname;
const built = await build({
  stdin: {
    contents: `export {createPaginated} from './apps/web/src/reader-react/paginated-controller';
    export {createContinuous} from './apps/web/src/reader-react/continuous-controller';`,
    resolveDir: source
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  tsconfig: `${source}/apps/web/tsconfig.json`,
  jsx: 'automatic',
  conditions: ['browser'],
  loader: { '.css': 'empty' },
  logLevel: 'silent'
});
const defer = () => {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const html = '<div id="ttu-a"><p>猫</p></div><div id="ttu-b"><p>犬</p></div>';
const rect = { left: 0, right: 100, top: 0, bottom: 20, width: 100, height: 20 };

function fixture(mode, withLanguage = true) {
  const dom = new JSDOM('<div id="scroll"><div id="content"></div></div>', {
    url: 'https://reader.test/manabitan-reader/',
    pretendToBeVisual: true
  });
  const window = dom.window;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.scrollBy = () => {};
  window.scrollTo = () => {};
  window.Range.prototype.getBoundingClientRect = () => rect;
  window.Range.prototype.getClientRects = () => [rect];
  const values = {
    window,
    document: window.document,
    localStorage: window.localStorage,
    MutationObserver: window.MutationObserver,
    getComputedStyle: window.getComputedStyle,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window)
  };
  const descriptors = Object.fromEntries(
    Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  );
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', built.outputFiles[0].text)(
    createRequire(import.meta.url),
    module,
    module.exports
  );
  const events = [],
    entered = defer(),
    gate = defer();
  const language = new ReaderLanguageBook({
    bookKey: 'book',
    resourceVersion: '1',
    chapters: [
      { id: 'ttu-a', baseURL: 'https://book.invalid/a', html: '<p>猫</p>' },
      { id: 'ttu-b', baseURL: 'https://book.invalid/b', html: '<p>犬</p>' }
    ],
    runtime: {
      preprocessor: {
        protocol: 1,
        id: 'test-only-provider',
        release: '1',
        fingerprint: async () => '1',
        preprocess: async (input) => {
          events.push(`analyze:${input.chapterID}`);
          return {
            protocol: 1,
            fingerprint: '1',
            html: input.html.replace('<p>', '<p><m-m>').replace('</p>', '</m-m></p>'),
            sidecar: {},
            vocabulary: []
          };
        },
        mount: async () => {
          events.push('mount');
          entered.resolve();
          await gate.promise;
          return () => events.push('unmount');
        },
        dispose() {}
      }
    },
    renderHTML: (value) => value,
    interaction: (_root, { chapterID }) => {
      events.push(`attach:${chapterID}`);
      return () => events.push(`detach:${chapterID}`);
    }
  });
  const props = {
    languageBook: withLanguage ? language : undefined,
    htmlContent: html,
    width: 800,
    height: 600,
    verticalMode: false,
    bookmarkData: Promise.resolve({ exploredCharCount: withLanguage ? 1 : 0, bookCharCount: 2 }),
    loadingState: false,
    fontFeatureSettings: '',
    verticalTextOrientation: 'mixed',
    textMarginMode: 'auto',
    fontFamilyGroupOne: 'serif',
    fontFamilyGroupTwo: 'sans-serif',
    pageColumns: 1,
    firstDimensionMargin: 0,
    autoBookmarkTime: 3,
    fontSize: 18,
    lineHeight: 1.7,
    textIndentation: 0,
    furiganaStyle: 'full',
    multiplier: 1,
    autoBookmark: false,
    exploredCharCount: 0,
    bookCharCount: 0,
    customReadingPoint: 0,
    customReadingPointScrollOffset: 0
  };
  const controller =
    mode === 'paginated'
      ? module.exports.createPaginated(props)
      : module.exports.createContinuous(props);
  const root = window.document.getElementById('content');
  controller.contentEl = root;
  if (mode === 'paginated') controller.scrollEl = window.document.getElementById('scroll');
  else root.innerHTML = html;
  controller.controller.start();
  return {
    dom,
    root,
    controller,
    events,
    entered,
    gate,
    language,
    close() {
      controller.controller.destroy();
      language.dispose();
      dom.window.close();
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    }
  };
}
async function until(predicate) {
  for (let i = 0; i < 80; i++) {
    if (predicate()) return;
    await pause(10);
  }
  assert.fail('The actual reader controller did not reach its expected state.');
}
for (const mode of ['paginated', 'continuous']) {
  test(`${mode} processes the saved chapter first and keeps analysis mounted before layout/reveal`, async () => {
    const f = fixture(mode);
    try {
      if (mode === 'paginated') {
        await until(() => f.controller.currentSpineIndex === 1 && !!f.controller.displayedHtml);
        f.root.innerHTML = f.controller.displayedHtml;
      }
      f.controller.onHtmlLoad();
      await f.entered.promise;
      assert.equal(f.events[0], 'analyze:ttu-b');
      assert.equal(f.controller.allowDisplay, false);
      assert.ok(f.root.querySelector('m-m'));
      assert.equal(
        f.events.some((event) => event.startsWith('attach:')),
        false
      );
      f.gate.resolve();
      await until(() => f.controller.allowDisplay);
      assert.equal(f.controller.openingError, '');
      assert.ok(f.events.includes('attach:ttu-b'));
      if (mode === 'continuous') assert.ok(f.events.includes('attach:ttu-a'));
      f.controller.controller.destroy();
      assert.ok(f.events.includes('detach:ttu-b'));
      assert.ok(f.events.includes('unmount'));
    } finally {
      f.gate.resolve();
      f.close();
    }
  });
  test(`${mode} teardown during real provider mount prevents delayed publication`, async () => {
    const f = fixture(mode);
    try {
      if (mode === 'paginated') {
        await until(() => f.controller.currentSpineIndex === 1 && !!f.controller.displayedHtml);
        f.root.innerHTML = f.controller.displayedHtml;
      }
      f.controller.onHtmlLoad();
      await f.entered.promise;
      f.controller.controller.destroy();
      f.gate.resolve();
      await until(() => f.events.includes('unmount'));
      assert.equal(f.controller.allowDisplay, false);
      assert.equal(
        f.events.some((event) => event.startsWith('attach:')),
        false
      );
    } finally {
      f.gate.resolve();
      f.close();
    }
  });
}

for (const mode of ['paginated', 'continuous']) {
  for (const cancel of ['retire', 'invalidate']) {
    test(`${mode} ${cancel} cancels bookmark layout without changing the calculator`, async () => {
      const f = fixture(mode);
      const bookmark = defer();
      try {
        if (mode === 'paginated') {
          await until(() => f.controller.currentSpineIndex === 1 && !!f.controller.displayedHtml);
          f.root.innerHTML = f.controller.displayedHtml;
        }
        f.controller.onHtmlLoad();
        await f.entered.promise;
        f.gate.resolve();
        await until(() => f.controller.allowDisplay);
        const calculator = f.controller.calculator;
        const manager = f.controller.bookmarkManager;
        let scrolls = 0;
        manager.scrollToBookmark = () => {
          scrolls++;
          return true;
        };
        f.controller.bookmarkData = bookmark.promise;
        f.controller.scrollWhenReady = true;
        const ready = f.controller.contentReadyEvent;
        const task = f.controller.onContentDisplayChange(calculator);
        let scrollSubscriptions = 0;
        const addEventListener = f.dom.window.addEventListener.bind(f.dom.window);
        f.dom.window.addEventListener = (name, ...args) => {
          if (name === 'scroll') scrollSubscriptions++;
          return addEventListener(name, ...args);
        };
        const signal = f.language.activeSignal;
        if (cancel === 'retire') f.language.retire();
        else f.language.session.invalidate();
        assert.equal(signal.aborted, true);
        bookmark.resolve({ exploredCharCount: 1, bookCharCount: 2 });
        await task;
        assert.equal(f.controller.calculator, calculator);
        assert.equal(scrolls, 0, 'a retired opening must not restore its bookmark');
        if (mode === 'continuous') {
          assert.equal(f.controller.contentReadyEvent, ready);
          assert.equal(scrollSubscriptions, 0, 'a retired opening must not subscribe to sections');
        }
        await f.controller.onContentDisplayChange(calculator);
        assert.equal(scrolls, 0, 'queued layout callbacks must stay cancelled');
      } finally {
        bookmark.resolve();
        f.gate.resolve();
        f.close();
      }
    });
  }
}

for (const mode of ['paginated', 'continuous']) {
  test(`${mode} keeps ordinary layouts working without language preprocessing`, async () => {
    const f = fixture(mode, false);
    try {
      if (mode === 'paginated') {
        await until(() => f.controller.currentSpineIndex === 0 && !!f.controller.displayedHtml);
        f.root.innerHTML = f.controller.displayedHtml;
      }
      f.controller.onHtmlLoad();
      await until(() => f.controller.allowDisplay);
      let scrolls = 0;
      f.controller.bookmarkManager.scrollToBookmark = () => {
        scrolls++;
        return true;
      };
      f.controller.scrollWhenReady = true;
      await f.controller.onContentDisplayChange(f.controller.calculator);
      assert.equal(scrolls, 1);
    } finally {
      f.close();
    }
  });
}
