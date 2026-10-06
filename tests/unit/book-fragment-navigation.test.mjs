/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
const directory = mkdtempSync(join(tmpdir(), 'book-fragment-navigation-'));
let production;
try {
  await build({
    stdin: {
      contents: `
    export {sanitizeBookHtml} from './apps/web/src/lib/functions/book-security/book-content-security';
    export {bookFragmentElement} from './apps/web/src/lib/functions/book-security/book-fragment';
    export {reactiveElements} from './apps/web/src/lib/components/book-reader/reactive-elements';
    export {createContinuous} from './apps/web/src/reader-react/continuous-controller';
    export {importEpubPublication} from './apps/web/src/lib/foliate-epub/import-publication';
    export {setTestPublication} from './apps/web/src/lib/foliate-epub/open-foliate-epub';
  `,
      resolveDir: process.cwd()
    },
    outfile: join(directory, 'production.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    conditions: ['browser'],
    tsconfig: 'apps/web/tsconfig.json',
    loader: { '.css': 'empty', '.woff': 'file', '.woff2': 'file' },
    // Only the archive boundary is controlled. Import, sanitization, wrapper
    // construction, link mapping and publication packing use production code.
    plugins: [
      {
        name: 'fragment-import-archive-fixture',
        setup(build) {
          build.onResolve({ filter: /\/open-foliate-epub$/ }, () => ({
            path: 'fragment-import-archive-fixture',
            namespace: 'fragment-import-archive-fixture'
          }));
          build.onLoad({ filter: /.*/, namespace: 'fragment-import-archive-fixture' }, () => ({
            contents: `let publication;
            export const setTestPublication = value => { publication = value; };
            export const openFoliateEpub = async () => publication;`,
            loader: 'js'
          }));
        }
      }
    ],
    logLevel: 'silent'
  });
  production = createRequire(import.meta.url)(join(directory, 'production.cjs'));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
const {
  sanitizeBookHtml,
  bookFragmentElement,
  reactiveElements,
  createContinuous,
  importEpubPublication,
  setTestPublication
} = production;

function fixture(t) {
  const dom = new JSDOM('<!doctype html><main></main>', {
    url: 'https://reader.example/reader-web/b?id=1'
  });
  dom.window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {}
  });
  dom.window.cleanups = [];
  const saved = new Map();
  for (const name of [
    'window',
    'document',
    'CustomEvent',
    'HTMLElement',
    'DOMParser',
    'NodeFilter',
    'Node'
  ]) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: name === 'window' ? dom.window : dom.window[name]
    });
  }
  t.after(() => {
    for (const cleanup of dom.window.cleanups) cleanup();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    dom.window.close();
  });
  return dom.window;
}

test('sanitization retains bounded inert aliases without restoring DOM-clobbering IDs', (t) => {
  const w = fixture(t);
  const html =
    '<p id="target">Target</p><p id="location">Location</p><p id="ordinary">Ordinary</p><a href="#target">Jump</a><p data-manabi-fragment-id="' +
    'x'.repeat(513) +
    '">Oversized</p>';
  const safe = sanitizeBookHtml(html, { document: w.document });
  const root = w.document.querySelector('main');
  root.innerHTML = safe;
  assert.equal(root.querySelector('[id="target"]'), null);
  assert.equal(root.querySelector('[id="location"]'), null);
  assert.equal(root.querySelectorAll('[data-manabi-fragment-id]').length, 2);
  for (const [id, text] of [
    ['target', 'Target'],
    ['location', 'Location'],
    ['ordinary', 'Ordinary']
  ])
    assert.equal(bookFragmentElement(root, id)?.textContent, text);
  assert.equal(
    sanitizeBookHtml(safe, { document: w.document }),
    safe,
    'stored/read sanitization preserves the safe mapping'
  );
  assert.equal(bookFragmentElement(root, 'main'), null);
  assert.equal(bookFragmentElement(root, 'x'.repeat(513)), null);
  assert.equal(w.location.href, 'https://reader.example/reader-web/b?id=1');
});

test('actual imported-link listener and continuous controller navigate a sanitized fragment inside their owned resource', (t) => {
  const w = fixture(t);
  const content = w.document.querySelector('main');
  content.className = 'book-content';
  content.innerHTML = sanitizeBookHtml(
    '<div><p id="target">Other resource</p></div><div><a href="#target" data-manabi-target-spine-index="1" data-manabi-target-fragment="target">Jump</a><p id="target">Owned target</p></div>',
    { document: w.document, preserveReaderLinks: true }
  );
  const impostor = w.document.createElement('p');
  impostor.id = 'target';
  w.document.body.prepend(impostor);
  const owned = bookFragmentElement(content.children[1], 'target');
  assert.equal(owned.textContent, 'Owned target');
  owned.getBoundingClientRect = () => ({ top: 1500, right: 100 });
  const moves = [];
  w.scrollBy = (...args) => moves.push(args);
  const c = createContinuous({
    htmlContent: content.innerHTML,
    verticalMode: false,
    firstDimensionMargin: 20,
    customReadingPointScrollOffset: 0
  });
  c.contentEl = content;
  const subscription = reactiveElements(w.document, 0, false, false)(content).subscribe();
  w.cleanups.push(() => {
    subscription.unsubscribe();
    c.controller.destroy();
  });
  let bubbled = 0;
  w.addEventListener('click', () => bubbled++);
  const href = w.location.href,
    length = w.history.length;
  content.querySelector('a').click();
  assert.deepEqual(moves, [[0, 1480]]);
  assert.equal(bubbled, 0, 'the native hash/browser adapter never owns the EPUB link');
  assert.equal(w.location.href, href);
  assert.equal(w.history.length, length);
});

test('fragment aliases are literal resource-local targets with document-order duplicate behavior', (t) => {
  const w = fixture(t);
  const root = w.document.querySelector('main');
  const source = w.document.createElement('div');
  const literal = '注"] [id="reader-menu"], #other';
  const long = 'x'.repeat(512);
  source.innerHTML =
    '<p id="reader-menu">UI-shaped ID in book</p><p id="target" data-manabi-fragment-id="forged">First duplicate</p><p id="target">Second duplicate</p><script id="removed">unsafe</script><p data-manabi-fragment-id="">Empty alias</p>';
  for (const fragment of [literal, long]) {
    const target = w.document.createElement('p');
    target.setAttribute('data-manabi-fragment-id', fragment);
    target.textContent = fragment;
    source.append(target);
  }
  root.innerHTML = sanitizeBookHtml(source.innerHTML, { document: w.document });
  assert.equal(bookFragmentElement(root, 'target')?.textContent, 'First duplicate');
  assert.equal(
    bookFragmentElement(root, 'forged'),
    null,
    'an original removed ID overrides a supplied alias'
  );
  assert.equal(
    bookFragmentElement(root, 'removed'),
    null,
    'removed elements cannot remain navigation targets'
  );
  assert.equal(bookFragmentElement(root, ''), null);
  for (const fragment of [literal, long])
    assert.equal(bookFragmentElement(root, fragment)?.textContent, fragment);
  assert.equal(bookFragmentElement(root, 'other'), null);
  assert.equal(bookFragmentElement(root, '"] [id="reader-menu"]'), null);
  assert.equal(root.querySelectorAll('script, [id="target"]').length, 0);
});

test('import preserves sanitized HTML/body fragment aliases through wrapper construction and stored reads', async (t) => {
  const w = fixture(t);
  let closed = false;
  setTestPublication({
    book: {
      resources: {
        manifest: [{ id: 'chapter', href: 'chapter.xhtml', mediaType: 'application/xhtml+xml' }],
        spine: [{ idref: 'chapter' }]
      },
      metadata: { title: 'Root fragment fixture', language: 'ja' }
    },
    readText: async () =>
      '<html id="location"><body id="target"><a href="#location">HTML root</a><a href="#target">Body root</a><p id="ordinary">日本語</p></body></html>',
    close: async () => {
      closed = true;
    }
  });
  t.after(() => setTestPublication(undefined));
  const imported = await importEpubPublication(
    new File(['fixture'], 'root-fragment.epub'),
    w.document,
    123,
    {
      repairMode: 'Off',
      anchorsOnly: false
    }
  );
  assert.equal(closed, true);
  const root = w.document.querySelector('main');
  root.innerHTML = sanitizeBookHtml(imported.elementHtml, {
    document: w.document,
    preserveReaderLinks: true
  });
  const resource = root.firstElementChild;
  assert.equal(
    bookFragmentElement(resource, 'location'),
    resource.querySelector('.ttu-book-html-wrapper')
  );
  assert.equal(
    bookFragmentElement(resource, 'target'),
    resource.querySelector('.ttu-book-body-wrapper')
  );
  assert.equal(bookFragmentElement(resource, 'ordinary')?.textContent, '日本語');
  assert.equal(root.querySelector('[id="location"], [id="target"]'), null);
  assert.deepEqual(
    Array.from(root.querySelectorAll('a')).map((anchor) => [
      anchor.getAttribute('data-manabi-target-spine-index'),
      anchor.getAttribute('data-manabi-target-fragment')
    ]),
    [
      ['0', 'location'],
      ['0', 'target']
    ]
  );
  assert.equal(w.location.href, 'https://reader.example/reader-web/b?id=1');
});
