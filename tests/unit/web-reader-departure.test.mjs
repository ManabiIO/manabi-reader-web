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
      assert.ok(Object.hasOwn(dependencies, name), `unexpected dependency ${name}`);
      return dependencies[name];
    },
    module,
    module.exports
  );
  return module.exports;
}
const { WebReaderDeparture } = production('reader-react/web-reader-departure.ts');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const turn = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

async function fixture(run) {
  const dom = new JSDOM('', { url: 'https://reader.example/reader-web/b?id=7' });
  const previous = new Map();
  for (const key of ['window', 'location', 'history']) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  }
  dom.window.scrollTo = () => {};
  const nav = production('runtime/navigation.ts', {
    './paths': { base: '/reader-web' },
    './stores': { refreshLocation() {} }
  });
  const order = [],
    paths = [],
    errors = [];
  const save = deferred(),
    unmount = deferred();
  let current = true;
  const owner = {
    isCurrent: () => current,
    suspend: () => {
      order.push('save');
      return save.promise;
    },
    resume: () => order.push('resume'),
    retire: async () => {
      order.push('retiring');
      await unmount.promise;
      order.push('retired');
    },
    restore: async () => {
      order.push('restore');
    },
    failed: (error) => errors.push(error.message)
  };
  const gate = new WebReaderDeparture(owner);
  const stop = nav.beforeNavigate(gate.beforeNavigate);
  nav.installRouter({
    push: (path) => {
      paths.push(['push', path]);
      order.push('dispatch');
    },
    replace: (path) => {
      paths.push(['replace', path]);
      order.push('dispatch');
    }
  });
  try {
    await run({
      ...nav,
      gate,
      owner,
      order,
      paths,
      errors,
      save,
      unmount,
      revoke: () => {
        current = false;
      }
    });
  } finally {
    stop();
    gate.dispose();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test('a departure holds the original reader through save and actual cleanup before exact replay', async () =>
  fixture(async (h) => {
    await h.goto('/reader-web/settings?returnTo=%2Fb%3Fid%3D7#fonts', { replaceState: true });
    assert.deepEqual(h.order, ['save']);
    assert.deepEqual(h.paths, []);
    h.save.resolve(true);
    await turn();
    assert.deepEqual(h.order, ['save', 'retiring']);
    h.unmount.resolve();
    await h.gate.settled();
    assert.deepEqual(h.paths, [['replace', '/settings?returnTo=%2Fb%3Fid%3D7#fonts']]);
    assert.deepEqual(h.order, ['save', 'retiring', 'retired', 'dispatch']);
    assert.equal(h.gate.departed, true);
  }));

for (const failed of [false, true])
  test(`${failed ? 'failed' : 'canceled'} save retains the original reader and permits a later retry`, async () =>
    fixture(async (h) => {
      await h.goto('/reader-web/manage');
      if (failed) h.save.reject(new Error('Storage failed'));
      else h.save.resolve(false);
      await h.gate.settled();
      assert.deepEqual(h.paths, []);
      assert.deepEqual(h.order, ['save', 'resume']);
      assert.deepEqual(h.errors, failed ? ['Storage failed'] : []);
      h.owner.suspend = async () => true;
      h.unmount.resolve();
      await h.goto('/reader-web/manage');
      await h.gate.settled();
      assert.deepEqual(h.paths, [['push', '/manage']]);
    }));

test('a newer destination coalesces the pending save and replaces the old intent', async () =>
  fixture(async (h) => {
    await h.goto('/reader-web/settings');
    await h.goto('/reader-web/manage', { replaceState: true });
    h.save.resolve(true);
    h.unmount.resolve();
    await h.gate.settled();
    assert.deepEqual(h.paths, [['replace', '/manage']]);
    assert.equal(h.order.filter((value) => value === 'save').length, 1);
  }));

test('a new intent during cleanup retires once and only dispatches the newest destination', async () =>
  fixture(async (h) => {
    await h.goto('/reader-web/settings');
    h.save.resolve(true);
    await turn();
    await h.goto('/reader-web/b?id=8');
    h.unmount.resolve();
    await h.gate.settled();
    assert.deepEqual(h.paths, [['push', '/b?id=8']]);
    assert.equal(h.order.filter((value) => value === 'retiring').length, 1);
  }));

for (const afterRetirement of [false, true])
  test(`another guard canceling ${afterRetirement ? 'after cleanup' : 'before cleanup'} keeps a usable reader`, async () =>
    fixture(async (h) => {
      h.beforeNavigate((event) => {
        if (afterRetirement) event.beforeCommit(() => event.cancel());
        else event.cancel();
      });
      await h.goto('/reader-web/settings');
      h.save.resolve(true);
      h.unmount.resolve();
      await h.gate.settled();
      assert.deepEqual(h.paths, []);
      assert.deepEqual(
        h.order,
        afterRetirement ? ['save', 'retiring', 'retired', 'restore'] : ['save', 'resume']
      );
      assert.equal(h.gate.departed, false);
    }));

for (const duringCleanup of [false, true])
  test(`account or route replacement ${duringCleanup ? 'during cleanup' : 'during save'} forbids stale replay and restoration`, async () =>
    fixture(async (h) => {
      await h.goto('/reader-web/settings');
      if (duringCleanup) {
        h.save.resolve(true);
        await turn();
      }
      h.revoke();
      h.save.resolve(true);
      h.unmount.resolve();
      await h.gate.settled();
      assert.deepEqual(h.paths, []);
      assert.equal(h.order.includes('resume'), false);
      assert.equal(h.order.includes('restore'), false);
    }));

test('controller disposal during save cannot replay the old destination', async () =>
  fixture(async (h) => {
    await h.goto('/reader-web/settings');
    h.gate.dispose();
    h.save.resolve(true);
    await h.gate.settled();
    assert.deepEqual(h.paths, []);
    assert.deepEqual(h.order, ['save']);
  }));
