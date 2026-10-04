/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { JSDOM } from 'jsdom';

async function fixture(run, base = '/reader-web') {
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
      if (name === './paths') return { base };
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

test('retirement runs after all guards admit and finishes before the router can mount its destination', async () => {
  await fixture(async ({ goto, beforeNavigate, installRouter }) => {
    const order = [];
    let allow = false,
      finish;
    const cleaned = new Promise((resolve) => {
      finish = resolve;
    });
    beforeNavigate((event) => {
      event.beforeCommit(async () => {
        order.push('retiring');
        await cleaned;
        order.push('retired');
      });
    });
    beforeNavigate((event) => {
      order.push('guard');
      if (!allow) event.cancel();
    });
    installRouter({ push: () => order.push('dispatch'), replace: () => order.push('replace') });
    await goto('/reader-web/manage');
    assert.deepEqual(order, ['guard'], 'another guard cannot destroy the current reader');
    allow = true;
    const leaving = goto('/reader-web/manage');
    await Promise.resolve();
    assert.deepEqual(order, ['guard', 'guard', 'retiring']);
    finish();
    await leaving;
    assert.deepEqual(order, ['guard', 'guard', 'retiring', 'retired', 'dispatch']);
  });
});

test('a newer owner can cancel an admitted attempt while asynchronous retirement finishes', async () => {
  await fixture(async ({ goto, beforeNavigate, installRouter }) => {
    const paths = [];
    let finish, event;
    const cleaned = new Promise((resolve) => {
      finish = resolve;
    });
    installRouter({ push: (path) => paths.push(path), replace: (path) => paths.push(path) });
    beforeNavigate((value) => {
      event = value;
      value.beforeCommit(() => cleaned);
    });
    const leaving = goto('/reader-web/settings');
    event.cancel();
    finish();
    await leaving;
    assert.deepEqual(paths, [], 'late old cleanup cannot dispatch over a newer navigation owner');
  });
});

test('a newly mounted destination can capture its exact immutable arrival before browser URL commit', async () => {
  await fixture(async ({ goto, installRouter, readNavigationArrival }) => {
    const destination = 'https://reader.example/reader-web/settings?pane=reader#fonts';
    let captured;
    installRouter({
      push() {
        captured ??= readNavigationArrival(destination);
        assert.equal(location.pathname, '/reader-web/b', 'the browser URL has not committed');
      },
      replace() {}
    });
    assert.equal(
      readNavigationArrival(destination),
      undefined,
      'direct entry has no invented origin'
    );
    const browserLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    delete globalThis.location;
    assert.equal(
      readNavigationArrival(destination),
      undefined,
      'server rendering has no browser location'
    );
    Object.defineProperty(globalThis, 'location', browserLocation);
    await goto(destination);
    assert.equal(captured.from, 'https://reader.example/reader-web/b?id=7');
    assert.equal(captured.to, destination);
    assert.equal(Object.isFrozen(captured), true);
    assert.equal(readNavigationArrival('/reader-web/settings#other'), undefined);
    await goto('/reader-web/manage');
    assert.equal(
      readNavigationArrival(destination),
      undefined,
      'another visit supersedes the global snapshot'
    );
    assert.equal(
      captured.from,
      'https://reader.example/reader-web/b?id=7',
      'the route-owned snapshot remains unchanged'
    );
  });
});

test('canceled navigation and failed dispatch cannot publish an incoming route origin', async () => {
  await fixture(async ({ goto, beforeNavigate, installRouter, readNavigationArrival }) => {
    const stop = beforeNavigate((event) => event.cancel());
    await goto('/reader-web/settings');
    assert.equal(readNavigationArrival('/reader-web/settings'), undefined);
    stop();
    installRouter({
      push() {
        throw new Error('Dispatch failed');
      },
      replace() {}
    });
    await assert.rejects(goto('/reader-web/settings'), /Dispatch failed/);
    assert.equal(readNavigationArrival('/reader-web/settings'), undefined);
  });
});

for (const base of ['/reader-web', '/', ''])
  test(`Expo navigation maps exact deployment root ${JSON.stringify(base)} to / without losing suffixes or replay options`, async () => {
    await fixture(async ({ goto, installRouter, beforeNavigate, scrolling }) => {
      const calls = [],
        events = [];
      installRouter({
        push: (path) => calls.push(['push', path]),
        replace: (path) => calls.push(['replace', path])
      });
      let allowed = false;
      beforeNavigate((event) => {
        events.push(event);
        if (!allowed) event.cancel();
      });
      const options = { replaceState: true, noScroll: true };
      await goto((base || '/') + '?tag=one&tag=two#root', options);
      assert.deepEqual(calls, []);
      allowed = true;
      options.replaceState = false;
      options.noScroll = false;
      await events[0].retry();
      assert.deepEqual(calls, [['replace', '/?tag=one&tag=two#root']]);
      assert.deepEqual(scrolling, []);
      const outside = base === '/reader-web' ? '/reader-web-other/settings' : '/outside/settings';
      await goto(outside + '?x=1#section');
      assert.deepEqual(calls.at(-1), ['push', outside + '?x=1#section']);
    }, base);
  });
