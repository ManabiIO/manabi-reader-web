/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { JSDOM } from 'jsdom';

async function fixture(run) {
  const dom = new JSDOM('', { url: 'https://reader.example/reader-web/b?id=7' });
  const previous = new Map();
  for (const key of ['window', 'location', 'history']) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  }
  let refreshes = 0;
  const scrolling = [];
  dom.window.scrollTo = (...args) => scrolling.push(args);
  const { outputText } = ts.transpileModule(
    readFileSync(new URL('../../apps/web/src/runtime/navigation.ts', import.meta.url), 'utf8'),
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }
  );
  const module = { exports: {} };
  compileFunction(outputText, ['require', 'module', 'exports'])(
    (name) => {
      if (name === './paths') return { base: '/reader-web' };
      if (name === './stores') return { refreshLocation: () => refreshes++ };
      throw new Error('Unexpected dependency: ' + name);
    },
    module,
    module.exports
  );
  try {
    await run({ ...module.exports, scrolling, refreshes: () => refreshes });
  } finally {
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test('a canceled navigation replays its exact resolved URL, history mode and snapshotted state', async () => {
  await fixture(async ({ goto, beforeNavigate, afterNavigate, scrolling, refreshes }) => {
    const events = [],
      completed = [];
    let permitted = false;
    beforeNavigate((event) => {
      events.push(event);
      if (!permitted) event.cancel();
    });
    afterNavigate((event) => completed.push(event.intent));
    const options = {
      replaceState: true,
      state: { pane: 'fonts', nested: { revision: 2 } },
      noScroll: true,
      keepFocus: true
    };
    await goto('/reader-web/settings#fonts', options);
    assert.equal(location.pathname, '/reader-web/b');
    assert.equal(refreshes(), 0);
    assert.equal(completed.length, 0);
    options.replaceState = false;
    options.noScroll = false;
    options.state.nested.revision = 99;
    permitted = true;
    await events[0].retry();
    assert.equal(events[0].intent, events[1].intent);
    assert.equal(location.href, 'https://reader.example/reader-web/settings#fonts');
    assert.equal(
      globalThis.history.length,
      1,
      'replace remains replace rather than adding a history entry'
    );
    assert.deepEqual(globalThis.history.state, { pane: 'fonts', nested: { revision: 2 } });
    assert.equal(scrolling.length, 0);
    assert.deepEqual(completed, [events[0].intent]);
    await goto('/reader-web/manage');
    assert.notEqual(
      events[2].intent,
      events[0].intent,
      'a newer request cannot consume the older approval'
    );
    assert.equal(globalThis.history.length, 2);
    assert.deepEqual(scrolling, [[0, 0]]);
  });
});

test('router replay preserves the admitted subpath/query/hash and remains cancelable by every guard', async () => {
  await fixture(async ({ goto, beforeNavigate, installRouter, refreshes }) => {
    const paths = [],
      events = [];
    installRouter({
      push: (path) => paths.push(['push', path]),
      replace: (path) => paths.push(['replace', path])
    });
    let saved = false,
      otherAllows = false;
    beforeNavigate((event) => {
      events.push(event);
      if (!saved) event.cancel();
    });
    beforeNavigate((event) => {
      if (!otherAllows) event.cancel();
    });
    await goto('/reader-web/settings?returnTo=%2Fb%3Fid%3D7#fonts', {
      replaceState: true,
      noScroll: true
    });
    saved = true;
    await events[0].retry();
    assert.deepEqual(paths, [], 'one approval does not bypass an independent guard');
    otherAllows = true;
    await events[0].retry();
    assert.deepEqual(paths, [['replace', '/settings?returnTo=%2Fb%3Fid%3D7#fonts']]);
    assert.equal(refreshes(), 1);
    assert.ok(events.every((event) => event.intent === events[0].intent));
  });
});
