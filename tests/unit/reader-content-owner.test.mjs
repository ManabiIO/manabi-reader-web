/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MessageChannel } from 'node:worker_threads';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const directory = mkdtempSync(join(tmpdir(), 'reader-content-owner-'));
let createAudioPanel;
try {
  await build({
    entryPoints: ['apps/web/src/reader-react/audio-panel-controller.ts'],
    outfile: join(directory, 'audio.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    tsconfig: 'apps/web/tsconfig.json',
    logLevel: 'silent'
  });
  ({ createAudioPanel } = createRequire(import.meta.url)(join(directory, 'audio.cjs')));
} finally {
  rmSync(directory, { recursive: true, force: true });
}

test('the actual audio controller observes its admitted content rather than an earlier retained book', () => {
  const dom = new JSDOM(
    '<article class="book-content" id="old" hidden>Old book</article><article class="book-content" id="current">Current book</article>'
  );
  const old = dom.window.document.getElementById('old');
  const current = dom.window.document.getElementById('current');
  assert.equal(
    dom.window.document.querySelector('.book-content'),
    old,
    'the stale global-selector hazard is present'
  );
  let root = current;
  const c = createAudioPanel({
    bookId: 1,
    bookTitle: 'Current book',
    htmlContent: '<p>Current book</p>',
    layoutKey: 0,
    getContentElement: () => root,
    onFollow() {},
    returnFocus() {}
  });
  const observed = [];
  let disconnects = 0;
  c.liveObserver = {
    disconnect() {
      disconnects++;
    },
    observe(node) {
      observed.push(node);
    }
  };
  try {
    c.observeLiveBook();
    assert.deepEqual(observed, [current]);
    root = undefined;
    c.observeLiveBook();
    assert.deepEqual(observed, [current], 'no admitted root must never fall back to the old book');
    root = current;
    current.remove();
    c.observeLiveBook();
    assert.deepEqual(observed, [current], 'a detached spine is no longer a live content owner');
    const next = dom.window.document.createElement('article');
    next.className = 'book-content';
    dom.window.document.body.append(next);
    c.updateProps({ getContentElement: () => next });
    c.observeLiveBook();
    assert.deepEqual(
      observed,
      [current, next],
      'new prop input selects only the new admitted spine'
    );
    assert.equal(disconnects, 4);
  } finally {
    c.controller.destroy();
    dom.window.close();
  }
});

const { outputFiles } = await build({
  stdin: {
    contents: `
      import React, {act} from 'react';
      import {createRoot} from 'react-dom/client';
      import {AudiobookLauncher} from './reader-react/extras';
      const root = createRoot(document.getElementById('root'));
      window.launcher = {
        async mount(getContentElement) { await act(async () => root.render(<AudiobookLauncher bookId={1} bookTitle="Owned book" htmlContent="" layoutKey={0} getContentElement={getContentElement} onFollow={() => {}} />)); },
        async open() { await act(async () => { document.querySelector('[aria-label="Audiobook"]').click(); }); },
        async unmount() { await act(async () => root.unmount()); }
      };
    `,
    resolveDir: fileURLToPath(new URL('../../apps/web/src', import.meta.url)),
    loader: 'tsx'
  },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
  jsx: 'automatic',
  tsconfig: 'apps/web/tsconfig.json',
  loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
  plugins: [
    {
      name: 'audio-storage-boundary',
      setup(b) {
        b.onResolve({ filter: /^\.\/audio-panel$/ }, (args) =>
          args.importer.endsWith('/extras.tsx')
            ? { path: args.path, namespace: 'audio-storage-boundary' }
            : undefined
        );
        b.onLoad({ filter: /.*/, namespace: 'audio-storage-boundary' }, () => ({
          contents:
            'import React from "react"; export const AudiobookPanel = props => React.createElement("output", {"data-selection": props.selectionHint?.toString() ?? ""});',
          loader: 'js',
          resolveDir: process.cwd()
        }));
      }
    }
  ]
});

for (const mode of ['current', 'old', 'cross-root', 'iframe'])
  test(`mounted audiobook launcher scopes its ${mode} selection to the admitted content document`, async () => {
    const dom = new JSDOM(
      '<div id="root"></div><article class="book-content" id="old">Old text</article><article class="book-content" id="current">Current text</article><iframe></iframe>',
      {
        url: 'https://reader.example/reader-web/b?id=1',
        runScripts: 'outside-only',
        pretendToBeVisual: true
      }
    );
    const ports = [];
    dom.window.MessageChannel = class extends MessageChannel {
      constructor() {
        super();
        ports.push(this.port1, this.port2);
      }
    };
    dom.window.IS_REACT_ACT_ENVIRONMENT = true;
    dom.window.eval(outputFiles[0].text);
    const document = dom.window.document;
    const old = document.getElementById('old');
    let current = document.getElementById('current');
    if (mode === 'iframe') {
      const inner = document.querySelector('iframe').contentDocument;
      inner.body.innerHTML = '<article class="book-content">Current text</article>';
      current = inner.querySelector('article');
    }
    const range = current.ownerDocument.createRange();
    if (mode === 'old') range.selectNodeContents(old);
    else if (mode === 'cross-root') {
      range.setStart(old.firstChild, 0);
      range.setEnd(current.firstChild, current.textContent.length);
    } else range.selectNodeContents(current);
    const selection = current.ownerDocument.defaultView.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    try {
      await dom.window.launcher.mount(() => current);
      await dom.window.launcher.open();
      assert.equal(
        document.querySelector('output').dataset.selection,
        mode === 'current' || mode === 'iframe' ? 'Current text' : ''
      );
    } finally {
      await dom.window.launcher.unmount();
      for (const port of ports) port.close();
      dom.window.close();
    }
  });
