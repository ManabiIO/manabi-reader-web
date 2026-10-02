/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { JSDOM } from 'jsdom';

function production(path, dependencies = {}) {
  const { outputText } = ts.transpileModule(
    readFileSync(new URL(`../../apps/web/src/${path}`, import.meta.url), 'utf8'),
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }
  );
  const module = { exports: {} };
  compileFunction(outputText, ['require', 'module', 'exports'])(
    (name) => {
      assert.ok(Object.hasOwn(dependencies, name), `${path}: ${name}`);
      return dependencies[name];
    },
    module,
    module.exports
  );
  return module.exports;
}
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const until = async (predicate) => {
  const end = Date.now() + 3000;
  while (!predicate()) {
    assert.ok(Date.now() < end, 'history condition timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};
async function fixture(run) {
  const dom = new JSDOM('<a href="#chapter">Chapter</a><div id="chapter">Chapter</div>', {
    url: 'https://reader.example/reader-web/manage',
    pretendToBeVisual: true
  });
  const prior = new Map();
  for (const key of ['window', 'location', 'history', 'document']) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  }
  dom.window.scrollTo = () => {};
  const commands = [];
  let holdCommands = false;
  const nativeGo = dom.window.history.go.bind(dom.window.history);
  dom.window.history.go = (offset) =>
    holdCommands ? commands.push(() => nativeGo(offset)) : nativeGo(offset);
  let accountEpoch = 0,
    profile = 'alice';
  const accountListeners = new Set();
  const accountStore = {
    subscribe(callback) {
      accountListeners.add(callback);
      callback();
      return () => accountListeners.delete(callback);
    }
  };
  const client = {
    account: accountStore,
    localUser: accountStore,
    accountGeneration: () => accountEpoch,
    localProfileUser: () => ({ id: profile })
  };
  const navigation = production('runtime/navigation.ts', {
    './paths': { base: '/reader-web' },
    './stores': { refreshLocation() {} }
  });
  const departure = production('reader-react/web-reader-departure.ts');
  const adapter = production('runtime/web-navigation-qualification.ts', {
    './navigation': navigation,
    './paths': { base: '/reader-web' },
    './web-app-link': production('runtime/web-app-link.ts'),
    './web-history-broker': production('runtime/web-history-broker.ts'),
    '../reader-react/web-reader-departure': departure,
    './stores': { refreshLocation() {} },
    '../lib/manabi/client': client
  });
  const errors = [],
    dispatched = [],
    observed = [];
  let route = 0;
  const stop = adapter.installQualifiedWebNavigation(
    dom.window,
    {
      push(path) {
        dispatched.push(path);
        dom.window.history.pushState({ id: `expo-${++route}` }, '', `/reader-web${path}`);
      },
      replace(path) {
        dispatched.push(path);
        dom.window.history.replaceState({ id: `expo-${++route}` }, '', `/reader-web${path}`);
      }
    },
    (error) => errors.push(error)
  );
  dom.window.addEventListener('popstate', () =>
    observed.push({
      href: location.href,
      state: dom.window.history.state,
      arrival: navigation.readNavigationArrival(location.href)
    })
  );
  const gates = [];
  function reader(suspend = async () => true, onRetire = () => {}) {
    const ownerEpoch = accountEpoch;
    let current = true,
      retired = false,
      saves = 0,
      restorations = 0;
    const gate = new departure.WebReaderDeparture({
      isCurrent: () => current && ownerEpoch === accountEpoch,
      suspend: () => {
        saves++;
        return suspend();
      },
      retire: async () => {
        retired = true;
        onRetire();
      },
      resume() {},
      restore: async () => {
        restorations++;
        retired = false;
      },
      failed: (error) => errors.push(error.message)
    });
    const unbind = navigation.beforeNavigate(gate.beforeNavigate);
    const dispose = () => {
      current = false;
      unbind();
      gate.dispose();
    };
    gates.push(dispose);
    return {
      gate,
      dispose,
      retired: () => retired,
      saves: () => saves,
      restorations: () => restorations
    };
  }
  try {
    await run({
      dom,
      ...navigation,
      errors,
      dispatched,
      observed,
      reader,
      commands,
      pauseCommands: () => {
        holdCommands = true;
      },
      flushCommand: () => {
        assert.ok(commands.length);
        commands.shift()();
      },
      changeAccount: (value) => {
        profile = value;
        accountEpoch++;
        for (const callback of accountListeners) callback();
      }
    });
  } finally {
    for (const dispose of gates) dispose();
    stop();
    dom.window.close();
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test('actual navigation/broker replay restores Settings original entry arrival before Forward consumers mount', async () =>
  fixture(async (h) => {
    await h.goto('/reader-web/b?id=7');
    const first = h.reader();
    await h.goto('/reader-web/settings#fonts');
    await first.gate.settled();
    const entry = globalThis.history.state.id;
    const original = h.readNavigationArrival(location.href);
    assert.equal(original.from, 'https://reader.example/reader-web/b?id=7');
    first.dispose();
    globalThis.history.back();
    await until(() => h.observed.length === 1);
    assert.equal(location.search, '?id=7');
    const returning = h.reader();
    globalThis.history.forward();
    await until(() => h.observed.length === 2);
    await returning.gate.settled();
    assert.equal(returning.saves(), 1);
    assert.equal(returning.retired(), true);
    assert.equal(globalThis.history.state.id, entry);
    assert.equal(
      h.observed[1].arrival.intent,
      original.intent,
      'Forward restores this entry’s original visit rather than a replacement arrival'
    );
    assert.equal(h.observed[1].arrival.from, original.from);
    assert.deepEqual(h.errors, []);
  }));

test('failed browser Back restores the exact live reader entry without exposing intermediate popstate', async () =>
  fixture(async (h) => {
    await h.goto('/reader-web/b?id=7');
    const state = globalThis.history.state;
    const reader = h.reader(async () => false);
    globalThis.history.back();
    await until(() => reader.saves() === 1);
    await reader.gate.settled();
    assert.equal(location.href, 'https://reader.example/reader-web/b?id=7');
    assert.deepEqual(globalThis.history.state, state);
    assert.equal(reader.retired(), false);
    assert.deepEqual(h.observed, []);
    assert.deepEqual(h.errors, []);
  }));

test('newer app navigation supersedes a pending browser departure and resolves against the restored reader', async () =>
  fixture(async (h) => {
    await h.goto('/reader-web/b?id=7');
    const save = deferred(),
      reader = h.reader(() => save.promise);
    globalThis.history.back();
    await until(() => reader.saves() === 1);
    await h.goto('settings?section=reader', { replaceState: true });
    save.resolve(true);
    await reader.gate.settled();
    assert.equal(location.href, 'https://reader.example/reader-web/settings?section=reader');
    assert.equal(reader.saves(), 1);
    assert.deepEqual(h.observed, []);
    assert.deepEqual(h.errors, []);
  }));

test('otherwise-native fragment links are tracked without closing the reader and scroll their real target', async () =>
  fixture(async (h) => {
    await h.goto('/reader-web/b?id=7');
    h.dom.window.document.querySelector('a').href = '#chapter';
    const reader = h.reader();
    let scrolled = 0;
    h.dom.window.document.getElementById('chapter').scrollIntoView = () => scrolled++;
    const before = globalThis.history.length;
    h.dom.window.document.querySelector('a').click();
    await until(() => scrolled === 1);
    assert.equal(location.hash, '#chapter');
    assert.equal(reader.saves(), 0);
    assert.equal(globalThis.history.length, before + 1);
    globalThis.history.back();
    await until(() => location.hash === '');
    await reader.gate.settled();
    assert.equal(location.hash, '');
    assert.equal(reader.retired(), false);
    assert.equal(reader.saves(), 0);
    assert.deepEqual(
      h.observed,
      [],
      'fragment replay never asks Expo to replace its unchanged reader route'
    );
    globalThis.history.forward();
    await until(() => location.hash === '#chapter');
    assert.equal(reader.retired(), false);
    assert.deepEqual(h.errors, []);
  }));

for (const change of ['account', 'route'])
  test(`${change} replacement after replay is issued cannot dispatch over the newest owner`, async () =>
    fixture(async (h) => {
      await h.goto('/reader-web/b?id=7');
      const identity = globalThis.history.state.id;
      const old = h.reader(async () => true, h.pauseCommands);
      globalThis.history.back();
      await until(() => h.commands.length === 1);
      assert.equal(old.retired(), true);
      if (change === 'account') h.changeAccount('bob');
      else old.dispose();
      const current = h.reader();
      h.flushCommand();
      await until(() => h.commands.length === 1);
      h.flushCommand();
      await until(() => location.href === 'https://reader.example/reader-web/b?id=7');
      await old.gate.settled();
      assert.equal(globalThis.history.state.id, identity);
      assert.deepEqual(h.observed, []);
      assert.equal(current.retired(), false);
      assert.equal(current.saves(), 0);
      assert.deepEqual(h.errors, []);
    }));

test('EPUB-owned prevented links retain their existing navigation behavior and do not create history', async () =>
  fixture(async (h) => {
    await h.goto('/reader-web/b?id=7');
    const reader = h.reader(),
      before = globalThis.history.length;
    const link = h.dom.window.document.querySelector('a');
    link.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    });
    link.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(globalThis.history.length, before);
    assert.equal(reader.saves(), 0);
    assert.deepEqual(h.errors, []);
  }));

test('a newer accepted fragment Back revokes an older app destination while the save is pending', async () =>
  fixture(async (h) => {
    await h.goto('/reader-web/b?id=7');
    const link = h.dom.window.document.querySelector('a');
    link.href = '#chapter';
    h.dom.window.document.getElementById('chapter').scrollIntoView = () => {};
    const save = deferred(),
      reader = h.reader(() => save.promise);
    link.click();
    await until(() => location.hash === '#chapter');
    await h.goto('/reader-web/settings');
    assert.equal(reader.saves(), 1);
    globalThis.history.back();
    await until(() => location.hash === '');
    save.resolve(true);
    await reader.gate.settled();
    assert.equal(location.href, 'https://reader.example/reader-web/b?id=7');
    assert.equal(reader.retired(), false);
    assert.deepEqual(h.dispatched, ['/b?id=7']);
    assert.deepEqual(h.errors, []);
  }));

test('an untracked native fragment reports a visible-recovery error without retiring or replacing the reader', async () =>
  fixture(async (h) => {
    await h.goto('/reader-web/b?id=7');
    const reader = h.reader();
    const before = globalThis.history.length;
    h.dom.window.location.hash = 'untracked';
    await until(() => h.errors.length === 1);
    assert.match(h.errors[0], /untracked/);
    assert.equal(
      globalThis.history.length,
      before + 1,
      'the adapter neither invents nor overwrites an entry'
    );
    assert.equal(reader.retired(), false);
    assert.equal(reader.saves(), 0);
    assert.deepEqual(h.observed, []);
    await h.goto('/reader-web/manage');
    await reader.gate.settled();
    assert.equal(reader.retired(), false, 'a later blocked close still keeps its live reader');
    assert.deepEqual(h.dispatched, ['/b?id=7']);
  }));

test('raw app links share the save barrier and preserve query/hash navigation options', async () =>
  fixture(async (h) => {
    await h.goto('/reader-web/b?id=7');
    const save = deferred(),
      reader = h.reader(() => save.promise);
    const anchor = h.dom.window.document.querySelector('a');
    anchor.href = '/reader-web/b?id=8&note=one&note=two#passage';
    anchor.setAttribute('data-sveltekit-replacestate', '');
    const length = globalThis.history.length;
    anchor.click();
    await until(() => reader.saves() === 1);
    assert.equal(location.search, '?id=7');
    assert.equal(reader.retired(), false);
    save.resolve(true);
    await reader.gate.settled();
    assert.equal(
      location.href,
      'https://reader.example/reader-web/b?id=8&note=one&note=two#passage'
    );
    assert.equal(globalThis.history.length, length, 'replace survives asynchronous replay');
    assert.equal(reader.retired(), true);
    assert.deepEqual(h.errors, []);
  }));

for (const outcome of [false, true])
  test(`raw app link ${outcome ? 'latest target wins' : 'cancellation keeps the reader'}`, async () =>
    fixture(async (h) => {
      await h.goto('/reader-web/b?id=7');
      const save = deferred(),
        reader = h.reader(() => save.promise);
      const anchor = h.dom.window.document.querySelector('a');
      anchor.href = '/reader-web/settings';
      anchor.click();
      await until(() => reader.saves() === 1);
      if (outcome) {
        anchor.href = '/reader-web/b?id=8';
        anchor.click();
        await Promise.resolve();
        await Promise.resolve();
      }
      save.resolve(outcome);
      await reader.gate.settled();
      assert.equal(location.pathname, '/reader-web/b');
      assert.equal(location.search, outcome ? '?id=8' : '?id=7');
      assert.equal(reader.retired(), outcome);
      assert.equal(reader.saves(), 1);
      assert.deepEqual(h.errors, []);
    }));

test('exact self-link revokes an older pending departure without bypassing its save settlement', async () =>
  fixture(async (h) => {
    await h.goto('/reader-web/b?id=7');
    const id = globalThis.history.state.id,
      length = globalThis.history.length;
    const save = deferred(),
      reader = h.reader(() => save.promise);
    const anchor = h.dom.window.document.querySelector('a');
    anchor.href = '/reader-web/settings';
    anchor.click();
    await until(() => reader.saves() === 1);
    anchor.href = '/reader-web/b?id=7';
    anchor.click();
    assert.equal(reader.retired(), false);
    save.resolve(true);
    await reader.gate.settled();
    assert.equal(location.search, '?id=7');
    assert.equal(reader.retired(), false);
    assert.equal(globalThis.history.state.id, id);
    assert.equal(globalThis.history.length, length);
    assert.deepEqual(h.dispatched, ['/b?id=7']);
    assert.deepEqual(h.errors, []);
  }));

test('a self-link admitted during retirement restores saved content before keeping the source entry', async () =>
  fixture(async (h) => {
    await h.goto('/reader-web/b?id=7');
    const identity = globalThis.history.state.id;
    const anchor = h.dom.window.document.querySelector('a');
    const reader = h.reader(
      async () => true,
      () => {
        anchor.href = '/reader-web/b?id=7';
        anchor.click();
      }
    );
    anchor.href = '/reader-web/settings';
    anchor.click();
    await until(() => reader.saves() === 1);
    await reader.gate.settled();
    assert.equal(
      reader.restorations(),
      1,
      'cleanup already started, so saved content is readmitted rather than claiming its old instance survived'
    );
    assert.equal(reader.retired(), false);
    assert.equal(globalThis.history.state.id, identity);
    assert.equal(location.search, '?id=7');
    assert.deepEqual(h.dispatched, ['/b?id=7']);
    assert.deepEqual(h.errors, []);
  }));
