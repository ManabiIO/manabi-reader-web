/** @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors. All rights reserved. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as fakeIndexedDB from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';

const root = fileURLToPath(new URL('../../', import.meta.url));
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ReaderScreen } from './apps/web/src/reader-react/index';
import { DialogHost } from './apps/web/src/ui/dialogs';
import { database } from './apps/web/src/lib/data/store';
void (async () => {
  const text = '<h1>共通の章</h1><p><ruby>日本語<rt>にほんご</rt></ruby>の文章を読みます。</p>' + Array.from({length: 150}, (_, i) => '<p>段落' + i + '。日本語の本を読みます。文章を丁寧に読んで、次のページに進みます。</p>').join('');
  const manifest = {version: 1, resources: [{href: 'chapter1.xhtml', spineIndex: 0, sectionId: 'ttu-chapter1'}, {href: 'chapter2.xhtml', spineIndex: 1, sectionId: 'ttu-chapter2'}]};
  const db = await database.db;
  const book = {id: 1, title: 'React reader acceptance', sourceFormat: 'epub', language: 'ja', styleSheet: '', elementHtml: '<div id="ttu-chapter1">' + text + '</div><div id="ttu-chapter2">' + text + '</div>', blobs: {}, hasThumb: false, characters: 15000, sections: [{reference: 'ttu-chapter1', label: '第一章', charactersWeight: 7500, characters: 7500, startCharacter: 0}, {reference: 'ttu-chapter2', label: '第二章', charactersWeight: 7500, characters: 7500, startCharacter: 7500}], publicationManifest: manifest, lastBookModified: 1, lastBookOpen: 1};
  await db.put('data', book);
  await db.put('data', {...book, id: 2, title: 'Another React reader'});
  const reactRoot = createRoot(document.getElementById('root'));
  window.__unmount = () => reactRoot.unmount();
  const open = bookId => reactRoot.render(<React.StrictMode><ReaderScreen bookId={bookId} registerHandle={handle => {window.__readerHandle = handle;}}/><DialogHost/></React.StrictMode>);
  window.__openReader = open;
  open(1);
})().catch(error => { window.__fixtureError = error; });
`;

test(
  'active React reader survives Strict Mode, bound panel edits, repeated chapter markup and dismissal',
  { timeout: 30000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'manabi-react-reader-'));
    const errors = [];
    const console = new VirtualConsole();
    console.on('jsdomError', (error) => errors.push(error.message));
    console.on('error', (...parts) => errors.push(parts.map(String).join(' ')));
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      url: 'http://localhost/reader-web/b?id=1',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      virtualConsole: console
    });
    const window = dom.window;
    try {
      for (const [name, value] of Object.entries(fakeIndexedDB))
        if (name.startsWith('IDB') || name === 'indexedDB')
          Object.defineProperty(window, name, { value, configurable: true });
      Object.assign(window, {
        process: { env: {} },
        TextEncoder,
        TextDecoder,
        structuredClone,
        Response,
        Request,
        Headers,
        fetch: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
        CSS: {
          escape: (value) =>
            String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => '\\' + character)
        },
        ResizeObserver: class {
          observe() {}
          unobserve() {}
          disconnect() {}
        },
        IntersectionObserver: class {
          observe() {}
          disconnect() {}
        },
        BroadcastChannel: class {
          postMessage() {}
          addEventListener() {}
          removeEventListener() {}
          close() {}
        }
      });
      Object.defineProperty(window, 'crypto', { value: webcrypto });
      window.matchMedia = (query) => ({
        matches: query.includes('min-width'),
        media: query,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {}
      });
      Object.defineProperty(window.document, 'fonts', {
        value: {
          ready: Promise.resolve(),
          check: () => true,
          forEach() {},
          status: 'loaded',
          addEventListener() {},
          removeEventListener() {}
        }
      });
      // JSDOM has no layout. These shims permit DOM/lifetime qualification only;
      // the unchanged browser suite remains authoritative for page geometry.
      window.scrollTo = window.scrollBy = () => {};
      window.Element.prototype.scrollTo = window.Element.prototype.scrollBy = () => {};
      window.HTMLElement.prototype.scrollIntoView = () => {};
      window.Range.prototype.getBoundingClientRect = () => new window.DOMRect(0, 0, 1, 20);
      window.Range.prototype.getClientRects = () => [];
      window.URL.createObjectURL = () => 'blob:http://localhost/fixture';
      window.URL.revokeObjectURL = () => {};
      window.HTMLDialogElement.prototype.showModal = function () {
        this.open = true;
      };
      window.HTMLDialogElement.prototype.close = function () {
        this.open = false;
      };
      for (const [key, value] of Object.entries({
        viewMode: 'paginated',
        fontFamilyGroupOne: 'serif',
        statisticsEnabled: '0',
        confirmClose: 'false',
        'manabi-reader-dictionary-setup-v1': 'skip'
      }))
        window.localStorage.setItem(key, value);
      await build({
        stdin: {
          contents: entry,
          resolveDir: root,
          loader: 'tsx',
          sourcefile: 'react-reader-fixture.tsx'
        },
        bundle: true,
        platform: 'browser',
        format: 'iife',
        outdir: directory,
        entryNames: 'reader',
        tsconfig: join(root, 'apps/web/tsconfig.json'),
        loader: { '.wasm': 'file', '.onnx': 'file', '.css': 'empty' },
        define: {
          'process.env.NODE_ENV': '"development"',
          'import.meta.url': '"http://localhost/reader.js"'
        },
        logLevel: 'warning'
      });
      window.eval(await readFile(join(directory, 'reader.js'), 'utf8'));
      const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
      const until = async (predicate, message) => {
        for (let attempt = 0; attempt < 40; attempt++) {
          if (predicate()) return;
          await pause();
        }
        assert.ok(predicate(), message);
      };
      const click = (label) => {
        const button = window.document.querySelector(`button[aria-label="${label}"]`);
        assert.ok(button, label);
        button.click();
      };
      const reveal = async () => {
        const toggle = window.document.querySelector('button[data-reader-controls]');
        if (toggle?.getAttribute('aria-expanded') === 'false') {
          toggle.click();
          await pause();
        }
      };
      await until(
        () => window.document.querySelector('.book-content')?.getAttribute('aria-busy') === 'false',
        'the active React reader becomes ready'
      );
      assert.equal(window.__fixtureError, undefined);
      const originalRuby = window.document.querySelector('.book-content ruby');
      assert.ok(originalRuby);
      originalRuby.classList.add('reveal-rt');
      originalRuby.dataset.readerTestMutation = 'preserve';
      click('Themes & Settings');
      await pause();
      const appearance = window.document.querySelector('.reader-modal');
      assert.ok(appearance);
      assert.ok(window.document.getElementById(appearance.getAttribute('aria-labelledby')));
      const beforeFont = window.localStorage.getItem('fontSize');
      click('Increase text size');
      await pause();
      assert.notEqual(window.localStorage.getItem('fontSize'), beforeFont);
      assert.equal(window.document.querySelector('.book-content ruby'), originalRuby);
      assert.equal(originalRuby.dataset.readerTestMutation, 'preserve');
      click('Close reading appearance');
      await pause();
      assert.equal(window.document.querySelector('.reader-modal'), null);
      await reveal();
      click('Contents');
      await pause();
      const contents = window.document.querySelector('.reader-modal');
      assert.ok(contents);
      const chapter = [...contents.querySelectorAll('button')].find((button) =>
        button.textContent.includes('第二章')
      );
      assert.ok(chapter);
      chapter.click();
      await until(
        () =>
          window.document
            .querySelector('[data-manabi-spine-index]')
            ?.getAttribute('data-manabi-spine-index') === '1',
        'the second identical-markup spine mounts'
      );
      await until(
        () => window.document.querySelector('.book-content')?.getAttribute('aria-busy') === 'false',
        'new identical markup gets a fresh geometry owner'
      );
      assert.notEqual(window.document.querySelector('.book-content ruby'), originalRuby);
      assert.equal(
        window.document.querySelector('.book-content ruby')?.dataset.readerTestMutation,
        undefined
      );
      window.document.querySelector('button[aria-label="Close Table of Contents"]')?.click();
      await pause();
      await reveal();
      click('Reading tools');
      await pause();
      const tools = window.document.querySelector('[role="menu"]');
      assert.ok(tools);
      const browse = [...tools.querySelectorAll('button')].find((button) =>
        button.textContent.includes('Browse Book')
      );
      assert.ok(browse);
      browse.click();
      await until(
        () => !!window.document.querySelector('.reader-modal'),
        'scrubber opens after retiring menu'
      );
      window.document.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
      await pause();
      assert.equal(window.document.querySelector('.reader-modal'), null);
      await reveal();
      click('Bookmarks and Notes');
      await until(() => !!window.document.querySelector('.reader-modal'), 'annotations open');
      window.document.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
      await pause();
      assert.equal(window.document.querySelector('.reader-modal'), null);
      const closing = window.__readerHandle.requestClose();
      assert.equal(
        window.__readerHandle.requestClose(),
        closing,
        'repeated Back shares the pending close operation'
      );
      assert.equal(
        await closing,
        true,
        'native close waits for the saved reader exit path: ' +
          window.document.body.textContent.slice(-1200) +
          JSON.stringify(errors)
      );
      window.__openReader(2);
      await until(
        () =>
          window.document.title.includes('Another React reader') &&
          window.document.querySelector('.book-content')?.getAttribute('aria-busy') === 'false',
        'a replacement book mounts with its own route identity'
      );
      assert.deepEqual(errors, []);
    } finally {
      window.__unmount?.();
      await Promise.resolve();
      window.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
);
