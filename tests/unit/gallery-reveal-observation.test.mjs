import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { compileFunction } from 'node:vm';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import test from 'node:test';
import ts from 'typescript';

// Complete production modules, with explicit structural DOM/store/event-stream
// boundaries. This exercises eager observation on reader rebinding, not layout
// or RxJS scheduling. The corresponding delayed-font journey uses the real app.
const directory = 'apps/web/src/lib/components/book-reader/';
const root = new URL('../../', import.meta.url);

function fixture(kind) {
  let pictures = [
    { url: 'blob:first', unspoilered: true },
    { url: 'blob:second', unspoilered: true }
  ];
  const queued = new Map();
  const queue = ({ url, unspoilered }) => queued.set(url, unspoilered);
  const stream = () => ({ pipe: () => stream() });
  const rx = { NEVER: stream(), merge: stream, fromEvent: stream, tap: stream, take: stream };
  const modules = new Map();
  function load(path) {
    if (modules.has(path)) return modules.get(path);
    const source = process.env.GALLERY_OBSERVATION_BASELINE
      ? execFileSync('git', ['show', `${process.env.GALLERY_OBSERVATION_BASELINE}:${path}`], {
          cwd: fileURLToPath(root),
          encoding: 'utf8'
        })
      : readFileSync(new URL(path, root), 'utf8');
    const { outputText, diagnostics } = ts.transpileModule(source, {
      fileName: path,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      reportDiagnostics: true
    });
    assert.equal(diagnostics.length, 0);
    const module = { exports: {} };
    compileFunction(outputText, ['require', 'module', 'exports'])(
      (name) => {
        if (name === 'rxjs') return rx;
        if (name === '../../data/furigana-style') return { FuriganaStyle: { Hide: 0 } };
        if (name.endsWith('/book-toc/book-toc'))
          return { nextChapter$: { next: () => assert.fail('unexpected navigation') } };
        if (name === '$lib/functions/range-util')
          return { pulseElement: () => assert.fail('unexpected image opening') };
        if (name.endsWith('/book-reader-image-gallery/book-reader-image-gallery'))
          return {
            readerImageGalleryPictures$: { getValue: () => pictures },
            toggleImageGalleryPictureSpoiler$: { next: queue }
          };
        if (name === './book-reader-image-gallery/reveal-gallery-picture')
          return load(directory + 'book-reader-image-gallery/reveal-gallery-picture.ts');
        throw new Error(`Unexpected dependency: ${name}`);
      },
      module,
      module.exports
    );
    modules.set(path, module.exports);
    return module.exports;
  }
  const wrappers = ['blob:first', 'blob:second'].map((url) => {
    const image =
      kind === 'img' ? { localName: kind, src: url } : { localName: kind, href: { baseVal: url } };
    const label = { parentNode: {}, classList: { add() {} }, setAttribute() {} };
    return { querySelector: (selector) => (selector === 'img,image' ? image : label) };
  });
  const content = {
    getElementsByTagName: () => [],
    querySelectorAll: (selector) => (selector === '[data-ttu-spoiler-img]' ? wrappers : [])
  };
  const document = { createElement: () => assert.fail('existing labels must be reused') };
  const { reactiveElements } = load(directory + 'reactive-elements.ts');
  const { revealGalleryPicture } = load(
    directory + 'book-reader-image-gallery/reveal-gallery-picture.ts'
  );
  return {
    observe: () => reactiveElements(document, 0, true, false)(content),
    reveal: () => {
      pictures = revealGalleryPicture(pictures, 'blob:second', queue);
    },
    reset: () => {
      pictures = pictures.map(({ url }) => ({ url, unspoilered: true }));
    },
    drain: () => {
      for (const picture of pictures)
        if (queued.has(picture.url)) picture.unspoilered = queued.get(picture.url);
      queued.clear();
    },
    states: () => pictures.map((picture) => picture.unspoilered)
  };
}

for (const kind of ['img', 'image']) {
  test(`${kind}: actual reader rebinding preserves a later explicit gallery reveal`, () => {
    const h = fixture(kind);
    h.observe();
    h.drain();
    assert.deepEqual(h.states(), [false, false]);
    h.reveal();
    h.drain();
    assert.deepEqual(h.states(), [false, true]);
    for (let rebind = 0; rebind < 3; rebind++) {
      h.observe();
      h.drain();
      assert.deepEqual(h.states(), [false, true]);
    }
  });
  test(`${kind}: replacing the snapshot permits initial hidden observations again`, () => {
    const h = fixture(kind);
    h.observe();
    h.reveal();
    h.drain();
    h.reset();
    h.observe();
    h.drain();
    assert.deepEqual(h.states(), [false, false]);
  });
}
