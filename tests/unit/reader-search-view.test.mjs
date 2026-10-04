/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { MessageChannel } from 'node:worker_threads';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { outputFiles } = await build({
  stdin: {
    contents: `
      import React, { act } from 'react';
      import { createRoot } from 'react-dom/client';
      import { ReaderSearch } from './reader-react/search';
      const root = createRoot(document.getElementById('root'));
      let controller;
      window.searchView = {
        async mount() { await act(async () => root.render(<ReaderSearch open bookTitle="Example book" bindings={{ this: value => controller = value }} />)); },
        async result(total, truncated = false) {
          await act(async () => {
            controller.query = 'needle';
            controller.total = total;
            controller.truncated = truncated;
          });
        },
        async unmount() { await act(async () => root.unmount()); }
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
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
  plugins: [
    {
      name: 'unrelated-search-excerpt',
      setup(b) {
        b.onResolve({ filter: /^\.\/extras$/ }, (args) =>
          args.importer.endsWith('/search.tsx')
            ? { path: args.path, namespace: 'search-excerpt' }
            : undefined
        );
        b.onLoad({ filter: /.*/, namespace: 'search-excerpt' }, () => ({
          contents: 'export const SearchExcerpt = () => null;',
          loader: 'js'
        }));
      }
    }
  ]
});

test('mounted Search Book result counts preserve spoken singular, plural and truncated labels', async () => {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', (error) => errors.push(error.message));
  console.on('error', (...parts) => errors.push(parts.map(String).join(' ')));
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'https://reader.example/reader-web/b?id=1',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: console
  });
  dom.window.IS_REACT_ACT_ENVIRONMENT = true;
  const ports = [];
  dom.window.MessageChannel = class extends MessageChannel {
    constructor() {
      super();
      ports.push(this.port1, this.port2);
    }
  };
  dom.window.eval(outputFiles[0].text);
  const view = dom.window.searchView;
  try {
    await view.mount();
    const dialog = dom.window.document.querySelector('[role=dialog]');
    assert.ok(dialog, 'the production search sheet is mounted');
    const status = dialog.querySelector('[role=status]');
    for (const [total, truncated, expected] of [
      [1, false, '1 result'],
      [127, false, '127 results'],
      [0, false, '0 results'],
      [1000, true, 'At least 1000 results']
    ]) {
      await view.result(total, truncated);
      assert.equal(status.textContent.trim(), expected);
    }
  } finally {
    await view.unmount();
    for (const port of ports) port.close();
    dom.window.close();
  }
  assert.deepEqual(errors, []);
});
