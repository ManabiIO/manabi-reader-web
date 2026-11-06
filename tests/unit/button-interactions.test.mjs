/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = fileURLToPath(new URL('../../', import.meta.url));
// Bundle the production wrappers and the real navigation guard. Only the DOM
// environment is simulated: these are not duplicate components or hook mocks.
const { outputFiles } = await build({
  stdin: {
    contents: `
      import React, { act } from 'react';
      import { createRoot } from 'react-dom/client';
      import { Button as Reader, CloseButton as ReaderClose } from './reader-react/dom';
      import { Button as Library, CloseButton as LibraryClose } from './library-react/primitives';
      import { Button as Snippet } from './snippets-react/primitives';
      import { Input, InputGroupButton, InputGroupInput } from './ui/form-controls';
      import { beforeNavigate, installRouter } from './runtime/navigation';
      import { buttonVariants } from './snippets-react/button-styles';
      const components = { Reader, Library, Snippet, ReaderClose, LibraryClose, Input, InputGroupButton, InputGroupInput };
      const root = createRoot(document.getElementById('root'));
      const routes = [];
      installRouter({ push: path => routes.push(path), replace: path => routes.push(path) });
      window.controls = {
        routes, beforeNavigate, buttonVariants,
        render: (kind, props) => {
          act(() => root.render(<React.StrictMode>{React.createElement(components[kind], props)}</React.StrictMode>));
        },
        unmount: () => { act(() => root.unmount()); }
      };
    `,
    resolveDir: path.join(root, 'apps/web/src'),
    loader: 'tsx'
  },
  tsconfig: path.join(root, 'apps/web/tsconfig.json'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
  jsx: 'automatic',
  loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' }
});

async function fixture(run) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', (error) => errors.push(error.message));
  console.on('error', (...parts) => errors.push(parts.map(String).join(' ')));
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'https://reader.example/reader-web/manage',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: console
  });
  const { window } = dom;
  window.IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
  window.eval(outputFiles[0].text);
  const api = window.controls;
  let bubbled;
  window.document.addEventListener('click', (event) => {
    bubbled = { prevented: event.defaultPrevented, target: event.target };
    // Observe native link semantics without asking JSDOM to navigate pages.
    event.preventDefault();
  });
  const click = (node, options = {}) => {
    bubbled = undefined;
    const event = new window.MouseEvent('click', { bubbles: true, cancelable: true, ...options });
    node.dispatchEvent(event);
    return { event, bubbled };
  };
  const render = async (kind, props) => {
    await api.render(kind, props);
    return window.document.querySelector('#root > *');
  };
  try {
    await run({ window, api, render, click });
  } finally {
    await api.unmount();
    window.close();
  }
  assert.deepEqual(errors, [], 'components must not emit React or DOM errors');
}

for (const kind of ['Reader', 'Library', 'Snippet']) {
  test(`${kind} disabled links block repeated clicks, preserve refs, and restore enabled activation`, async () => {
    await fixture(async ({ window, api, render, click }) => {
      const calls = [];
      const ref = { current: null };
      const props = {
        href: '/reader-web/library?filter=recent',
        disabled: true,
        tabIndex: 3,
        ref,
        onClick: (event) => calls.push({ target: event.currentTarget, detail: event.detail })
      };
      let node = await render(kind, props);
      assert.equal(ref.current, node);
      assert.equal(node.tagName, 'A');
      assert.equal(node.hasAttribute('href'), false);
      assert.equal(node.getAttribute('role'), 'link');
      assert.equal(node.getAttribute('aria-disabled'), 'true');
      assert.equal(node.tabIndex, -1);
      for (let index = 0; index < 3; index++) {
        const result = click(node);
        assert.equal(result.event.defaultPrevented, true);
        assert.equal(result.bubbled, undefined);
      }
      assert.equal(calls.length, 0);
      assert.equal(api.routes.length, 0);
      node = await render(kind, { ...props, disabled: false });
      assert.equal(ref.current, node);
      assert.equal(node.tabIndex, 3);
      for (let index = 0; index < 2; index++) click(node, { detail: index + 1 });
      assert.deepEqual(
        calls.map(({ detail }) => detail),
        [1, 2]
      );
      assert.ok(calls.every(({ target }) => target === node));
      assert.equal(api.routes.length, kind === 'Reader' ? 0 : 2);
      await render(kind, { ...props, disabled: true });
      click(node);
      assert.equal(calls.length, 2);
      await api.unmount();
      assert.equal(ref.current, null);
      assert.equal(window.document.querySelector('#root > *'), null);
    });
  });

  test(`${kind} buttons keep caller tab order, types, aria and disabled native behavior`, async () => {
    await fixture(async ({ render, click }) => {
      let calls = 0;
      const props = { type: 'submit', tabindex: -1, 'aria-disabled': true, onClick: () => calls++ };
      let node = await render(kind, props);
      assert.equal(node.type, 'submit');
      assert.equal(node.tabIndex, -1);
      assert.equal(node.getAttribute('aria-disabled'), 'true');
      click(node);
      assert.equal(calls, 1);
      node = await render(kind, { ...props, disabled: true });
      node.click();
      click(node);
      assert.equal(calls, 1);
      assert.equal(node.disabled, true);
    });
  });
}

for (const kind of ['Library', 'Snippet']) {
  test(`${kind} links navigate once per ordinary click and preserve native alternate activations`, async () => {
    await fixture(async ({ api, render, click }) => {
      let node = await render(kind, { href: '/reader-web/library?filter=recent#books' });
      let result = click(node);
      assert.equal(result.bubbled.prevented, true);
      assert.deepEqual(Array.from(api.routes), ['/library?filter=recent#books']);
      for (const options of [
        { ctrlKey: true },
        { metaKey: true },
        { shiftKey: true },
        { altKey: true },
        { button: 1 }
      ]) {
        result = click(node, options);
        assert.equal(result.bubbled.prevented, false, JSON.stringify(options));
      }
      for (const props of [
        { download: '' },
        { download: 'book.epub' },
        { target: '_blank' },
        { rel: 'nofollow external noopener' },
        { href: 'https://example.com/guide' }
      ]) {
        node = await render(kind, { href: '/reader-web/library', ...props });
        assert.equal(click(node).bubbled.prevented, false, JSON.stringify(props));
      }
      assert.equal(api.routes.length, 1);
      node = await render(kind, {
        href: '/reader-web/library',
        onClick: (event) => event.preventDefault()
      });
      assert.equal(click(node).bubbled.prevented, true);
      assert.equal(api.routes.length, 1);
      const stop = api.beforeNavigate((navigation) => navigation.cancel());
      node = await render(kind, { href: '/reader-web/library' });
      click(node);
      click(node);
      assert.equal(api.routes.length, 1, 'the real navigation guard cancels repeated requests');
      stop();
      click(node);
      assert.equal(api.routes.length, 2);
    });
  });
}

for (const kind of ['Reader', 'Snippet']) {
  test(`${kind} native event callbacks stay current and cannot bypass the disabled guard`, async () => {
    await fixture(async ({ window, render, click }) => {
      const calls = [];
      const refs = [];
      const bindings = { ref: (node) => refs.push(node) };
      const props = {
        href: '/reader-web/library',
        bindings,
        events: {
          click: (event) => {
            assert.ok(event instanceof window.MouseEvent);
            calls.push('original');
          }
        }
      };
      let node = await render(kind, props);
      click(node);
      click(node);
      assert.deepEqual(calls, ['original', 'original']);
      node = await render(kind, {
        ...props,
        onClick: (event) => {
          assert.ok(event instanceof window.MouseEvent);
          calls.push('latest');
        }
      });
      click(node);
      assert.deepEqual(
        calls,
        ['original', 'original', 'latest'],
        'one authoritative click handler runs'
      );
      await render(kind, { ...props, disabled: true, onClick: () => calls.push('bypass') });
      click(node);
      click(node);
      assert.equal(calls.length, 3);
      assert.equal(refs.at(-1), node);
    });
  });
}

test('embedded fields preserve value/ref bindings and native input/composition event payloads', async () => {
  await fixture(async ({ window, render, api }) => {
    const order = [];
    const refs = [];
    const ref = { current: null };
    let value = '';
    const props = {
      type: 'search',
      value,
      ref,
      bindings: {
        value: (next) => {
          value = next;
          order.push('binding');
        },
        ref: (node) => refs.push(node)
      },
      onInput: (event) => {
        assert.ok(event instanceof window.InputEvent);
        assert.equal(value, event.currentTarget.value);
        order.push('input');
      },
      onCompositionEnd: (event) => {
        assert.equal(event.data, '日本語');
        order.push('composition');
      }
    };
    const node = await render('InputGroupInput', props);
    assert.equal(ref.current, node);
    assert.equal(refs.at(-1), node);
    assert.ok(node.classList.contains('min-h-0'));
    assert.equal(node.classList.contains('min-h-[44px]'), false);
    for (const next of ['日', '日本語']) {
      node.value = next;
      node.dispatchEvent(
        new window.InputEvent('input', { bubbles: true, data: next, isComposing: true })
      );
      await render('InputGroupInput', { ...props, value });
      assert.equal(node.value, next);
    }
    node.dispatchEvent(
      new window.CompositionEvent('compositionend', { bubbles: true, data: '日本語' })
    );
    assert.deepEqual(order, ['binding', 'input', 'binding', 'input', 'composition']);
    await api.unmount();
    assert.equal(ref.current, null);
    assert.equal(refs.at(-1), null);
  });
});

for (const kind of ['Reader', 'Library', 'Snippet']) {
  test(`${kind} renders the original button tokens for every variant, size and shape`, async () => {
    await fixture(async ({ api, render }) => {
      for (const variant of ['default', 'outline', 'secondary', 'destructive', 'ghost', 'link']) {
        for (const size of ['xs', 'sm', 'default', 'lg', 'icon-xs', 'icon-sm', 'icon', 'icon-lg']) {
          for (const shape of ['auto', 'rounded', 'capsule', 'circle']) {
            const props = { variant, size, shape };
            const node = await render(kind, props);
            for (const token of api.buttonVariants(props).split(/\s+/)) {
              assert.ok(
                node.classList.contains(token),
                `${kind}/${variant}/${size}/${shape}: ${token}`
              );
            }
            assert.equal(node.dataset.slot, 'button');
            assert.equal(node.dataset.variant, variant);
            assert.equal(node.dataset.size, size);
            assert.equal(node.dataset.shape, shape);
          }
        }
      }
    });
  });
}

test('dismiss and compact embedded controls retain source icons, touch targets and caller overrides', async () => {
  await fixture(async ({ render }) => {
    for (const kind of ['ReaderClose', 'LibraryClose']) {
      const node = await render(kind, { disabled: true, 'aria-label': 'Close search' });
      assert.equal(node.getAttribute('aria-label'), 'Close search');
      assert.equal(node.disabled, true);
      assert.equal(node.dataset.shape, kind === 'LibraryClose' ? 'rounded' : 'circle');
      assert.equal(node.dataset.variant, kind === 'LibraryClose' ? 'ghost' : 'secondary');
      assert.equal(node.hasAttribute('data-modal-dismiss'), true);
      for (const token of [
        'size-[44px]',
        'min-h-[44px]',
        'min-w-[44px]',
        'pointer-coarse:min-h-[44px]',
        'pointer-coarse:min-w-[44px]',
        'text-muted-foreground'
      ]) {
        assert.ok(node.classList.contains(token), `${kind}: ${token}`);
      }
      assert.equal(node.querySelector('svg').getAttribute('aria-hidden'), 'true');
      assert.ok(node.querySelector('svg').classList.contains('size-[18px]'));
    }
    const compact = await render('InputGroupButton', { className: 'text-lg' });
    assert.equal(compact.dataset.size, 'xs');
    assert.equal(compact.dataset.shape, 'rounded');
    assert.ok(compact.classList.contains("[&>svg:not([class*='size-'])]:size-3.5"));
    assert.ok(compact.classList.contains('text-lg'));
    assert.equal(compact.classList.contains('text-sm'), false);
    const field = await render('Input', {
      className: 'min-h-0 rounded-none',
      'data-slot': 'custom-field'
    });
    assert.equal(field.dataset.slot, 'custom-field');
    assert.ok(field.classList.contains('min-h-0'));
    assert.ok(field.classList.contains('rounded-none'));
    assert.equal(field.classList.contains('min-h-[44px]'), false);
    assert.equal(field.classList.contains('rounded-[10px]'), false);
  });
});
