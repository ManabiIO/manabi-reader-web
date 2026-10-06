/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { MessageChannel } from 'node:worker_threads';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';
const root = fileURLToPath(new URL('../../', import.meta.url));
const { outputFiles } = await build({
  stdin: {
    contents: `
    import React, {act} from 'react';
    import {createRoot} from 'react-dom/client';
    import {ReaderScrubber} from './reader-react/scrubber';
    const root=createRoot(document.getElementById('root'));
    let controller;
    window.view={
      mount: async () => { await act(async()=>root.render(<ReaderScrubber open rawHtml="<p>Readable book text</p>" bookKey="book-1" bindings={{this:value=>controller=value}}/>)); },
      error: async () => { await act(async()=>{controller.selectionError='Position unavailable';}); },
      escape: async () => { await act(async()=>document.querySelector('input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))); },
      unmount: async () => {await act(async()=>root.unmount());}
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

test('mounted Browse Book keeps a reserved close lane, scrollable explanation and fixed-height range outside that scrollport', async () => {
  const errors = [],
    virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(error.message));
  virtualConsole.on('error', (...parts) => errors.push(parts.map(String).join(' ')));
  const css = readFileSync(path.join(root, 'apps/web/src/reader-react/reader.css'), 'utf8').replace(
    /^@charset [^;]+;/,
    ''
  );
  const dom = new JSDOM(
    '<!doctype html><style>' +
      css +
      '</style><button data-reader-controls>Reader controls</button><div id="root"></div>',
    {
      url: 'https://reader.example/reader-web/b?id=1',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      virtualConsole
    }
  );
  const w = dom.window;
  w.IS_REACT_ACT_ENVIRONMENT = true;
  const ports = [];
  w.MessageChannel = class extends MessageChannel {
    constructor() {
      super();
      ports.push(this.port1, this.port2);
    }
  };
  w.eval(outputFiles[0].text);
  try {
    await w.view.mount();
    const panel = w.document.querySelector('[role=dialog]'),
      title = panel.querySelector('[data-slot=sheet-title]'),
      close = panel.querySelector('[data-modal-dismiss]'),
      range = panel.querySelector('input[type=range]');
    assert.equal(panel.getAttribute('aria-labelledby'), title.id);
    assert.equal(w.getComputedStyle(panel).display, 'grid');
    assert.equal(w.getComputedStyle(panel).gridTemplateRows, 'auto minmax(0, 1fr) auto');
    assert.equal(w.getComputedStyle(title.parentElement).paddingInlineEnd, '56px');
    assert.equal(w.getComputedStyle(close).top, '12px');
    const scrollport = panel.querySelector('.scrubber-description');
    assert.equal(w.getComputedStyle(scrollport).overflowY, 'auto');
    assert.equal(scrollport.contains(range), false);
    assert.equal(w.getComputedStyle(range).height, '44px');
    assert.equal(range.disabled, false);
    assert.equal(range.getAttribute('aria-label'), 'Book position');
    assert.equal(panel.getAttribute('aria-describedby'), scrollport.querySelector('p').id);
    await w.view.error();
    assert.ok(
      scrollport.querySelector('[role=alert]'),
      'errors remain reachable inside the bounded explanation scrollport'
    );
    range.focus();
    await w.view.escape();
    assert.equal(w.document.querySelector('[role=dialog]'), null);
    assert.equal(w.document.activeElement, w.document.querySelector('[data-reader-controls]'));
  } finally {
    await w.view.unmount();
    for (const port of ports) port.close();
    dom.window.close();
  }
  assert.deepEqual(errors, []);
});
