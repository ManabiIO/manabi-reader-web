/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import React, { act } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

function production(path, dependencies = {}) {
  const { outputText } = ts.transpileModule(
    readFileSync(new URL(`../../apps/web/src/${path}`, import.meta.url), 'utf8'),
    {
      fileName: path,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX
      }
    }
  );
  const module = { exports: {} };
  compileFunction(outputText, ['require', 'module', 'exports'])(
    (name) => {
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (name.endsWith('.css')) return {};
      assert.ok(Object.hasOwn(dependencies, name), `${path}: ${name}`);
      return dependencies[name];
    },
    module,
    module.exports
  );
  return module.exports;
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const turn = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};

async function fixture(run) {
  const dom = new JSDOM('<div id="root"></div>', {
    url: 'https://reader.example/reader-web/b?id=1',
    pretendToBeVisual: true
  });
  const prior = new Map();
  for (const key of ['window', 'location', 'history', 'document', 'HTMLElement', 'Node']) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.scrollTo = () => {};
  const order = [],
    paths = [],
    live = new Set();
  const save = deferred();
  let number = 0,
    saves = 0,
    resumes = 0,
    currentEpoch = 1;
  const pathsModule = { base: '/reader-web' };
  const { writable } = production('lib/state/store.ts');
  const page = writable({ url: new URL(location.href), params: {}, state: {}, data: {} });
  const navigation = production('runtime/navigation.ts', {
    './paths': pathsModule,
    './stores': { refreshLocation() {} }
  });
  function Session(props) {
    const [id] = React.useState(() => ++number);
    React.useEffect(() => {
      live.add(id);
      order.push(['mount', id]);
      props.bindings.this({
        setExitHandler() {},
        requestClose: () => save.promise,
        requestSuspend: () => {
          saves++;
          return save.promise;
        },
        resumeAfterCanceledSuspend: () => {
          resumes++;
        }
      });
      return () => {
        live.delete(id);
        order.push(['cleanup', id]);
        props.bindings.this(undefined);
      };
    }, []);
    return React.createElement(
      'article',
      { className: 'book-content', 'data-owner': id },
      new URL(props.routeUrl).searchParams.get('id')
    );
  }
  const screen = production('reader-react/index.tsx', {
    '../runtime/stores': { page },
    '../runtime/paths': pathsModule,
    './session': { ReaderScreen: Session },
    './book-reader': { BookReader: () => null }
  });
  const { WebReaderLifetime } = production('reader-react/web-reader-lifetime.tsx', {
    '../runtime/navigation': navigation,
    './index': screen,
    './web-reader-departure': production('reader-react/web-reader-departure.ts')
  });
  navigation.installRouter({
    push: (path) => {
      assert.equal(live.size, 0, 'the old controller must retire before another route can mount');
      assert.equal(
        dom.window.document.querySelector('.book-content'),
        null,
        'global legacy queries cannot find a retained old container'
      );
      paths.push(path);
      order.push(['dispatch', path]);
    },
    replace: (path) => paths.push(path)
  });
  const root = createRoot(dom.window.document.getElementById('root'));
  let props = {
    routeUrl: location.href,
    focused: true,
    ownerEpoch: 1,
    isCurrentOwner: () => currentEpoch === 1
  };
  const render = async (changes) => {
    props = { ...props, ...changes };
    await act(async () => {
      root.render(
        React.createElement(React.StrictMode, null, React.createElement(WebReaderLifetime, props))
      );
      await turn();
    });
  };
  const settle = async (callback) => {
    await act(async () => {
      callback?.();
      await turn();
    });
  };
  try {
    await render();
    await run({
      dom,
      render,
      settle,
      save,
      ...navigation,
      paths,
      order,
      live,
      saves: () => saves,
      resumes: () => resumes,
      revoke: () => {
        currentEpoch++;
      }
    });
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
}

for (const nextId of [1, 2])
  test(`close → Library → book ${nextId} retires every old DOM/controller and freshly admits one current container`, async () =>
    fixture(async (h) => {
      const original = h.dom.window.document.querySelector('.book-content');
      assert.equal(h.live.size, 1, 'StrictMode leaves one owner');
      await h.settle(() => {
        void h.goto('/reader-web/manage');
      });
      assert.equal(
        h.dom.window.document.querySelector('.book-content'),
        original,
        'save pending keeps the same reader visible'
      );
      assert.deepEqual(h.paths, []);
      await h.settle(() => h.save.resolve(true));
      assert.deepEqual(h.paths, ['/manage']);
      assert.equal(h.live.size, 0);
      assert.equal(original.isConnected, false);
      await h.render({ focused: false });
      assert.equal(h.dom.window.document.querySelector('.book-content'), null);
      await h.render({
        focused: true,
        routeUrl: `https://reader.example/reader-web/b?id=${nextId}`
      });
      const current = h.dom.window.document.querySelector('.book-content');
      assert.ok(current);
      assert.notEqual(current, original);
      assert.equal(current.textContent, String(nextId));
      assert.equal(h.dom.window.document.querySelectorAll('.book-content').length, 1);
      assert.equal(h.live.size, 1);
    }));

for (const failure of [false, true])
  test(`${failure ? 'failed' : 'canceled'} departure retains the exact mounted reader`, async () =>
    fixture(async (h) => {
      const original = h.dom.window.document.querySelector('.book-content');
      await h.settle(() => {
        void h.goto('/reader-web/settings');
      });
      await h.settle(() =>
        failure ? h.save.reject(new Error('Save failed')) : h.save.resolve(false)
      );
      assert.deepEqual(h.paths, []);
      assert.equal(h.dom.window.document.querySelector('.book-content'), original);
      assert.equal(h.live.size, 1);
      assert.equal(h.resumes(), 1);
      if (failure)
        assert.equal(
          h.dom.window.document.querySelector('[role=alert]').textContent,
          'Save failed'
        );
    }));

test('an unrelated guard cancels replay before the original mounted controller is retired', async () =>
  fixture(async (h) => {
    const original = h.dom.window.document.querySelector('.book-content');
    const stop = h.beforeNavigate((event) => event.cancel());
    await h.settle(() => {
      void h.goto('/reader-web/settings');
    });
    await h.settle(() => h.save.resolve(true));
    assert.deepEqual(h.paths, []);
    assert.equal(h.dom.window.document.querySelector('.book-content'), original);
    assert.equal(h.resumes(), 1);
    stop();
  }));

test('an account replacement fences old save settlement and keeps only the new admission', async () =>
  fixture(async (h) => {
    const original = h.dom.window.document.querySelector('.book-content');
    await h.settle(() => {
      void h.goto('/reader-web/settings');
    });
    h.revoke();
    await h.render({ ownerEpoch: 2, isCurrentOwner: () => true });
    const current = h.dom.window.document.querySelector('.book-content');
    assert.notEqual(current, original);
    await h.settle(() => h.save.resolve(true));
    assert.deepEqual(h.paths, []);
    assert.equal(h.dom.window.document.querySelector('.book-content'), current);
    assert.equal(h.live.size, 1);
  }));

test('tracked fragment Back and Forward keep the same mounted content when Expo route props stay unchanged', async () =>
  fixture(async (h) => {
    const route = location.href;
    const original = h.dom.window.document.querySelector('.book-content');
    h.pushState(route + '#chapter', globalThis.history.state);
    for (const destination of [route, route + '#chapter']) {
      await h.settle(() => {
        void h.navigateBrowserHistory({
          from: location.href,
          to: destination,
          isCurrent: () => true,
          replay: async () => {
            globalThis.history.replaceState(globalThis.history.state, '', destination);
            return true;
          }
        });
      });
      await h.render({ focused: true, routeUrl: route });
      assert.equal(h.dom.window.document.querySelector('.book-content'), original);
      assert.equal(original.isConnected, true);
      assert.equal(h.live.size, 1);
      assert.equal(h.saves(), 0);
    }
  }));
