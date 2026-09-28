/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileFunction } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Load the complete production progress/traversal/counter modules. Only DOM
// nodes and range comparisons are controlled; no progress algorithm is replaced.
const root = new URL('../../apps/web/src/lib/', import.meta.url);
const modules = new Map();
function load(url) {
  const key = url.href;
  if (modules.has(key)) return modules.get(key);
  const { outputText, diagnostics } = ts.transpileModule(readFileSync(url, 'utf8'), {
    fileName: fileURLToPath(url),
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true
  });
  assert.equal(diagnostics.length, 0);
  const module = { exports: {} };
  modules.set(key, module.exports);
  compileFunction(outputText, ['require', 'module', 'exports'])(
    (name) => {
      assert.ok(name.startsWith('$lib/') || name.startsWith('.'), name);
      const resolved = new URL(
        name.startsWith('$lib/') ? name.slice(5) : name,
        name.startsWith('$lib/') ? root : url
      );
      if (!resolved.pathname.endsWith('.ts')) resolved.pathname += '.ts';
      assert.ok(resolved.href.startsWith(root.href));
      return load(resolved);
    },
    module,
    module.exports
  );
  return module.exports;
}
const { FoliateCharacterProgress } = load(
  new URL('foliate-epub/foliate-character-progress.ts', root)
);

const text = (value) => ({
  nodeType: 3,
  textContent: value,
  data: value,
  childNodes: [],
  hasChildNodes: () => false
});
const element = (localName, childNodes = [], attributes = {}) => ({
  nodeType: 1,
  localName,
  childNodes,
  classList: [],
  hasChildNodes: () => childNodes.length > 0,
  hasAttribute: (name) => Object.hasOwn(attributes, name)
});
function fixture(length = 9) {
  const nodes = Array.from({ length }, () => text('あいうえ'));
  const content = element(
    'div',
    nodes.map((node) => element('p', [node]))
  );
  return { nodes, content, progress: new FoliateCharacterProgress([content]) };
}
function range(nodes, first, last, startOffset = 0, endOffset = nodes[last].data.length) {
  return {
    collapsed: first === last && startOffset === endOffset,
    startContainer: nodes[first],
    startOffset,
    endContainer: nodes[last],
    endOffset,
    intersectsNode: (node) => nodes.indexOf(node) >= first && nodes.indexOf(node) <= last,
    comparePoint: (node) => (nodes.indexOf(node) < first ? -1 : nodes.indexOf(node) > last ? 1 : 0)
  };
}

test('first visible page is anchored before its first text, not a binary-search midpoint', () => {
  const { nodes, content, progress } = fixture();
  assert.equal(progress.exploredCharacterCount(0, content, range(nodes, 0, 6)), 0);
});

test('later-page progress counts only text before the first intersecting node', () => {
  const { nodes, content, progress } = fixture();
  assert.equal(progress.exploredCharacterCount(0, content, range(nodes, 2, 6)), 8);
});

test('unread text appended after the viewport cannot change the current reading point', () => {
  for (const length of [7, 9, 13, 17, 31]) {
    const { nodes, content, progress } = fixture(length);
    assert.equal(
      progress.exploredCharacterCount(0, content, range(nodes, 1, 5)),
      4,
      String(length)
    );
  }
});

test('one intersecting node retains the historical whole-node count contract', () => {
  const { nodes, content, progress } = fixture();
  assert.equal(progress.exploredCharacterCount(0, content, range(nodes, 5, 5, 1, 3)), 20);
});

test('a range starting at a text-node end does not claim that preceding node as visible', () => {
  const { nodes, content, progress } = fixture(3);
  assert.equal(progress.exploredCharacterCount(0, content, range(nodes, 0, 1, 4, 3)), 4);
});

test('collapsed custom points stay attached to their containing node', () => {
  const { nodes, content, progress } = fixture(3);
  assert.equal(progress.exploredCharacterCount(0, content, range(nodes, 1, 1, 4, 4)), 4);
});

test('ruby is excluded and repeated spine occurrences retain their prefix count', () => {
  const nodes = [text('漢'), text('字'), text('𠮷あ'), text('次')];
  const content = element('div', [
    element('p', [element('ruby', [nodes[0], element('rt', [text('かん')])]), nodes[1]]),
    element('p', [nodes[2]]),
    element('p', [nodes[3]])
  ]);
  const progress = new FoliateCharacterProgress([content, content]);
  assert.deepEqual(progress.sectionEnds, [5, 10]);
  assert.equal(progress.exploredCharacterCount(1, content, range(nodes, 0, 3)), 5);
  assert.equal(progress.exploredCharacterCount(1, content, range(nodes, 2, 3)), 7);
});

test('absent or unrelated ranges preserve the existing section-start fallback', () => {
  const { content, progress } = fixture();
  assert.equal(progress.exploredCharacterCount(0, content), 0);
  const other = fixture();
  assert.equal(progress.exploredCharacterCount(0, content, range(other.nodes, 0, 1)), 0);
});
