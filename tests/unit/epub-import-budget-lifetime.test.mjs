/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

const root = new URL('../../apps/web/src/lib/foliate-epub/', import.meta.url);
const maximum = 4 * 1024 * 1024;

// Execute complete production modules. Only the archive, DOM shell and unrelated
// rendering/metadata dependencies are controlled here; this is not a DOM or ZIP
// integration suite. Both old and repaired imports use the same dependency API.
function loadModule(path, name, dependencies = {}) {
  const code = stripTypeScriptTypes(readFileSync(new URL(path, root), 'utf8'))
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export /gm, '');
  return new Function(...Object.keys(dependencies), `${code}\nreturn ${name}`)(
    ...Object.values(dependencies)
  );
}

const EpubStyleBudget = loadModule('style-budget.ts', 'EpubStyleBudget');
const assertSupportedEpubRendition = loadModule(
  'epub-import-policy.ts',
  'assertSupportedEpubRendition'
);
const normalizeEpubSpineLinear = loadModule('epub-import-policy.ts', 'normalizeEpubSpineLinear');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function element() {
  return {
    classList: { add() {} },
    getAttribute: () => null,
    setAttribute() {},
    append() {},
    querySelectorAll: () => [],
    innerHTML: '<p>日本語</p>',
    outerHTML: '<div><p>日本語</p></div>'
  };
}

function fixture({ sources = [], sheets = {}, chapters = 1, close, readFailure } = {}) {
  const reads = [];
  const cssInputs = [];
  const packed = [];
  let closeCount = 0;
  const chapterItems = Array.from({ length: chapters }, (_, index) => ({
    id: `chapter-${index}`,
    href: `chapter-${index}.xhtml`,
    mediaType: 'application/xhtml+xml'
  }));
  const manifest = [
    ...chapterItems,
    ...Object.keys(sheets).map((href, index) => ({
      id: `style-${index}`,
      href,
      mediaType: 'text/css'
    }))
  ];
  const publication = {
    book: {
      resources: { manifest, spine: chapterItems.map(({ id }) => ({ idref: id })) },
      metadata: { title: 'Import boundary fixture', language: 'ja' }
    },
    async readText(href) {
      reads.push(href);
      if (readFailure) throw readFailure;
      if (chapterItems.some((item) => item.href === href))
        return '<html><body>日本語</body></html>';
      return sheets[href] ?? null;
    },
    async close() {
      closeCount++;
      await close?.();
    }
  };
  const document = { createElement: element };
  const importEpubPublication = loadModule('import-publication.ts', 'importEpubPublication', {
    EpubStyleBudget,
    assertSupportedEpubRendition,
    normalizeEpubSpineLinear,
    openFoliateEpub: async () => publication,
    epubPublicationManifest: ({ resources }) => ({ version: 1, resources }),
    packEpubResources: (resources) => {
      packed.push(resources.map((resource) => ({ ...resource })));
      return { elementHtml: '<div>日本語</div>', epubPublication: { version: 1, resources } };
    },
    epubCompatibilityStyles: () => '',
    repairEpubHtml: (value) => value,
    sanitizeBookHtml: (value, policy) => {
      if (policy.wholeDocument) {
        for (const source of sources) {
          if ('css' in source) policy.onEmbeddedStyle(source.css);
          else policy.onStyleSheetReference(source.href);
        }
      }
      return value;
    },
    sanitizeBookStyleSheet: (value) => {
      cssInputs.push(value);
      // Match the real sanitizer's input cap. Observing an oversized input here
      // means the importer already allocated the oversized concatenation.
      if (value.length > maximum) throw new Error('Book stylesheet exceeds the size limit');
      return value;
    },
    resolveArchivePath: (_owner, href) => href,
    buildDummyBookImage: () => {
      throw new Error('Unexpected image work');
    },
    resolveEpubLinkTarget: () => {
      throw new Error('Unexpected anchor work');
    },
    getParagraphNodes: (node) => [node],
    getCharacterCount: () => 3,
    extractCreators: () => [],
    extractBookMetadata: () => ({}),
    epubDirection: () => 'ltr',
    DOMParser: class {
      parseFromString() {
        return { documentElement: element(), body: element() };
      }
    }
  });
  return {
    reads,
    cssInputs,
    packed,
    get closeCount() {
      return closeCount;
    },
    run: (signal) =>
      importEpubPublication(new File(['fixture'], 'fixture.epub'), document, 123, {
        signal,
        repairMode: 'none',
        anchorsOnly: false
      })
  };
}

for (const [name, sources, sheets] of [
  ['one oversized linked sheet', [{ href: 'a.css' }], { 'a.css': 'x'.repeat(maximum + 1) }],
  [
    'separator characters at the exact boundary',
    [{ href: 'a.css' }, { href: 'b.css' }],
    { 'a.css': 'a'.repeat(maximum / 2), 'b.css': 'b'.repeat(maximum / 2) }
  ],
  [
    'repeated cached stylesheet references',
    Array.from({ length: 10 }, () => ({ href: 'a.css' })),
    { 'a.css': 'a'.repeat(maximum / 4) }
  ],
  [
    'mixed inline and linked styles',
    [{ css: 'a'.repeat(maximum / 2) }, { href: 'b.css' }],
    { 'b.css': 'b'.repeat(maximum / 2) }
  ]
]) {
  test(`rejects ${name} before handing an oversized join to the sanitizer`, async () => {
    const state = fixture({ sources, sheets });
    await assert.rejects(state.run(), /style.*size limit/);
    assert.equal(state.cssInputs.length, 0);
    assert.equal(state.packed.length, 0);
    assert.equal(state.closeCount, 1);
  });
}

test('budget failure stops later archive reads and preserves the first failure', async () => {
  const state = fixture({
    sources: [{ href: 'a.css' }, { href: 'b.css' }, { href: 'missing.css' }],
    sheets: {
      'a.css': 'a'.repeat(maximum / 2),
      'b.css': 'b'.repeat(maximum / 2),
      'missing.css': null
    }
  });
  await assert.rejects(state.run(), /style.*size limit/);
  assert.deepEqual(state.reads, ['chapter-0.xhtml', 'a.css', 'b.css']);
  assert.equal(state.closeCount, 1);
});

test('retains linked/inline cascade order and intentional repeated references', async () => {
  const state = fixture({
    sources: [{ href: 'a.css' }, { css: 'p{color:blue}' }, { href: 'a.css' }],
    sheets: { 'a.css': 'p{color:red}' }
  });
  const value = await state.run();
  assert.equal(value.title, 'Import boundary fixture');
  assert.deepEqual(state.cssInputs, ['p{color:red}\np{color:blue}\np{color:red}']);
  assert.deepEqual(state.reads, ['chapter-0.xhtml', 'a.css']);
  assert.equal(state.closeCount, 1);
});

test('accepts the existing exact four-Mi-character CSS input boundary', async () => {
  const state = fixture({ sources: [{ href: 'a.css' }], sheets: { 'a.css': 'a'.repeat(maximum) } });
  await state.run();
  assert.equal(state.cssInputs[0].length, maximum);
  assert.equal(state.closeCount, 1);
});

test('a new chapter gets its own existing per-stylesheet budget', async () => {
  const state = fixture({
    chapters: 2,
    sources: [{ href: 'a.css' }],
    sheets: { 'a.css': 'a'.repeat((3 * maximum) / 4) }
  });
  await state.run();
  assert.equal(state.cssInputs.length, 2);
  assert.equal(state.packed[0].length, 2);
  assert.deepEqual(state.reads, ['chapter-0.xhtml', 'a.css', 'chapter-1.xhtml']);
});

test('normal success is not reported until archive close finishes', async () => {
  const started = deferred();
  const finish = deferred();
  const state = fixture({
    close: async () => {
      started.resolve();
      await finish.promise;
    }
  });
  let settled = false;
  const result = state.run().finally(() => {
    settled = true;
  });
  await started.promise;
  assert.equal(settled, false);
  finish.resolve();
  assert.equal((await result).sourceFormat, 'epub');
  assert.equal(state.closeCount, 1);
});

for (const reason of [
  new DOMException('Import cancelled', 'AbortError'),
  new Error('Selection changed')
]) {
  test(`cancellation during archive close rejects with the original ${reason.name}`, async () => {
    const controller = new AbortController();
    const started = deferred();
    const finish = deferred();
    const state = fixture({
      close: async () => {
        started.resolve();
        await finish.promise;
      }
    });
    let settled = false;
    const result = state.run(controller.signal).finally(() => {
      settled = true;
    });
    const rejected = assert.rejects(result, (error) => error === reason);
    await started.promise;
    controller.abort(reason);
    await Promise.resolve();
    assert.equal(settled, false, 'close must still drain before rejection');
    finish.resolve();
    await rejected;
    assert.equal(state.closeCount, 1);
  });
}

test('archive close failure is not reclassified as a successful import', async () => {
  const failure = new Error('close failed');
  const state = fixture({
    close: async () => {
      throw failure;
    }
  });
  await assert.rejects(state.run(), (error) => error === failure);
  assert.equal(state.closeCount, 1);
});

test('an import failure retains its cause even when cleanup also fails', async () => {
  const failure = new Error('read failed');
  const state = fixture({
    readFailure: failure,
    close: async () => {
      throw new Error('close failed');
    }
  });
  await assert.rejects(state.run(), (error) => error === failure);
  assert.equal(state.closeCount, 1);
});
