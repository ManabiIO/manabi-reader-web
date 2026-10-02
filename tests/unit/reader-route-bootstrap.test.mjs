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

function production(path, dependencies) {
  const source = readFileSync(new URL(`../../apps/web/src/${path}`, import.meta.url), 'utf8');
  const result = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX
    },
    reportDiagnostics: true
  });
  assert.equal(result.diagnostics.length, 0);
  const module = { exports: {} };
  compileFunction(result.outputText, ['require', 'module', 'exports'])(
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
const { writable, get } = production('lib/state/store.ts', {});
const paths = { base: '/reader-web' };

async function fixture(run) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'https://reader.example/reader-web/manage',
    pretendToBeVisual: true
  });
  const saved = new Map();
  for (const name of ['window', 'document', 'location', 'history', 'HTMLElement', 'Node']) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: dom.window[name]
    });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const page = writable({ url: new URL(location.href), params: {}, state: {}, data: {} });
  const observed = [];
  let destroyed = 0;
  const routeState = {
    params: { id: '1', 'library-search': 'passage token', note: ['one', 'two'], '#': 'chapter-2' },
    focused: true
  };
  function Session(props) {
    React.useEffect(() => {
      observed.push({
        routeUrl: props.routeUrl,
        pageUrl: get(page).url.href,
        expectedBook: props.expectedBook,
        bookAuthority: props.bookAuthority
      });
      props.bindings?.this?.({ setExitHandler() {}, requestClose: async () => true });
      return () => {
        destroyed++;
        props.bindings?.this?.(undefined);
      };
    }, []);
    return React.createElement('article', { 'data-session': '' });
  }
  const screen = production('reader-react/index.tsx', {
    '../runtime/stores': { page },
    '../runtime/paths': paths,
    './session': { ReaderScreen: Session },
    './book-reader': { BookReader: () => null }
  });
  const route = production('screens/routes/b.web.tsx', {
    'expo-router': {
      useLocalSearchParams: () => routeState.params,
      useIsFocused: () => routeState.focused
    },
    '../../reader-react': screen,
    '../../runtime/paths': paths
  }).default;
  const root = createRoot(dom.window.document.getElementById('root'));
  const render = async (component = route, props = {}) => {
    await act(async () => root.render(React.createElement(component, props)));
  };
  try {
    await run({ dom, page, observed, routeState, screen, render, destroyed: () => destroyed });
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
}

test('the mounted web reader starts from route-local URL before Expo commits browser history', async () => {
  await fixture(async ({ render, observed, page }) => {
    await render();
    assert.equal(
      location.pathname,
      '/reader-web/manage',
      'browser history is deliberately still on the old screen'
    );
    assert.equal(observed.length, 1);
    const url = new URL(observed[0].routeUrl ?? observed[0].pageUrl);
    assert.equal(url.pathname, '/reader-web/b');
    assert.equal(
      url.searchParams.get('id'),
      '1',
      'the session must never start a transient id0 read'
    );
    assert.equal(url.searchParams.get('library-search'), 'passage token');
    assert.deepEqual(url.searchParams.getAll('note'), ['one', 'two']);
    assert.equal(url.hash, '#chapter-2');
    page.set({ ...get(page), url: new URL('https://reader.example/reader-web/manage') });
    assert.equal(
      new URL(observed[0].routeUrl).searchParams.get('id'),
      '1',
      'a later global refresh cannot change the admitted route snapshot'
    );
  });
});

test('a retained web route keeps its own session while another screen updates the global page', async () => {
  await fixture(async ({ render, observed, page, routeState, destroyed }) => {
    await render();
    routeState.focused = false;
    page.set({ ...get(page), url: new URL('https://reader.example/reader-web/settings#fonts') });
    await render();
    assert.equal(observed.length, 1);
    assert.equal(
      destroyed(),
      0,
      'a route must not drop unsaved work just because it is retained offscreen'
    );
    assert.equal(new URL(observed[0].routeUrl).searchParams.get('id'), '1');
    routeState.focused = true;
    await render();
    assert.equal(observed.length, 1);
  });
});

test('web missing and malformed IDs retain explicit URL semantics instead of borrowing prior browser state', async () => {
  for (const params of [{}, { id: 'not-a-book' }, { id: ['2', '3'] }]) {
    await fixture(async ({ render, routeState, observed }) => {
      globalThis.history.replaceState({}, '', '/reader-web/b?id=99');
      routeState.params = params;
      await render();
      const url = new URL(observed[0].routeUrl);
      assert.equal(
        url.searchParams.get('id'),
        Array.isArray(params.id) ? params.id[0] : (params.id ?? null)
      );
    });
  }
});

test('native reader still reconstructs only its admitted book and retains identity guards', async () => {
  await fixture(async ({ render, screen, observed }) => {
    globalThis.history.replaceState({}, '', '/reader-web/manage?foreign=not-reader-data');
    const expectedBook = { bookId: 7, title: 'Native admission' };
    const bookAuthority = { signal: new AbortController().signal, assertCurrent() {} };
    await render(screen.ReaderScreen, {
      bookId: 7,
      expectedBook,
      bookAuthority,
      libraryLocationToken: 'native passage'
    });
    const url = new URL(observed[0].pageUrl);
    assert.equal(url.pathname, '/reader-web/b');
    assert.equal(url.searchParams.get('id'), '7');
    assert.equal(url.searchParams.get('library-search'), 'native passage');
    assert.equal(url.searchParams.has('foreign'), false);
    assert.equal(observed[0].expectedBook, expectedBook);
    assert.equal(observed[0].bookAuthority, bookAuthority);
  });
});
