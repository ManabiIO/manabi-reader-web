/** @license BSD-3-Clause */
// Composition/interaction contracts. Actual browser menus and native rendering
// have separate mounted, exported-app and packaged-device qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const output = await build({
  entryPoints: ['apps/web/src/features/library/LibrarySortControls.tsx'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'],
  tsconfig: 'apps/web/tsconfig.json'
});
const module = { exports: {} };
new Function('module', 'exports', 'require', output.outputFiles[0].text)(
  module,
  module.exports,
  require
);
const { LibrarySortControls } = module.exports;
function composition(overrides = {}) {
  const groups = [],
    sorts = [],
    finished = [];
  let separators = 0;
  renderToStaticMarkup(
    React.createElement(LibrarySortControls, {
      layout: {
        Choices: (props) => {
          groups.push(props);
          return null;
        },
        Separator: () => {
          separators++;
          return null;
        }
      },
      property: 'author',
      direction: 'asc',
      onSort: (...args) => sorts.push(args),
      onFinishedOrder: (value) => finished.push(value),
      ...overrides
    })
  );
  return { groups, sorts, finished, separators };
}

test('both presentations receive all eight sorts and preserve the other half of the saved preference', () => {
  const f = composition();
  assert.deepEqual(
    f.groups.map((group) => [group.label, group.value]),
    [
      ['Sort by', 'author'],
      ['Sort order', 'asc']
    ]
  );
  const [property, direction] = f.groups;
  assert.deepEqual(
    [...property.options, ...property.moreOptions].map((choice) => choice.label),
    ['Recent', 'Title', 'Author', 'Added', 'Progress', 'Characters', 'Last Update', 'Bookmarked']
  );
  assert.equal(f.separators, 1);
  for (const value of ['author', '__proto__', 'not-a-field']) property.onChange(value);
  direction.onChange('asc');
  direction.onChange('invalid');
  assert.deepEqual(f.sorts, []);
  property.onChange('characters');
  direction.onChange('desc');
  assert.deepEqual(f.sorts, [
    ['characters', 'asc'],
    ['author', 'desc']
  ]);
  assert.deepEqual(f.finished, []);
  assert.equal(property.value, 'author', 'The owner must confirm a saved selection');
});

test('a Finished shelf exposes only finished-date order and never changes the ordinary sort', () => {
  const f = composition({ finishedOrder: 'desc' });
  assert.equal(f.groups.length, 1);
  assert.equal(f.separators, 0);
  const [group] = f.groups;
  assert.equal(group.label, 'Finished date');
  assert.equal(group.showHeading, true);
  assert.deepEqual(group.options, [
    { value: 'desc', label: 'Newest first' },
    { value: 'asc', label: 'Oldest first' }
  ]);
  group.onChange('desc');
  group.onChange('title');
  assert.deepEqual(f.finished, []);
  group.onChange('asc');
  assert.deepEqual(f.finished, ['asc']);
  assert.deepEqual(f.sorts, []);
});

test('pending controls refuse callbacks and damaged preferences use the existing read-only fallback', () => {
  for (const finishedOrder of [undefined, 'desc']) {
    const f = composition({ disabled: true, compact: true, finishedOrder });
    for (const group of f.groups) {
      assert.equal(group.disabled, true);
      assert.equal(group.compact, true);
      for (const choice of [...group.options, ...(group.moreOptions ?? [])])
        group.onChange(choice.value);
    }
    assert.deepEqual(f.sorts, []);
    assert.deepEqual(f.finished, []);
  }
  const damaged = composition({ property: 'not-a-field', direction: 'invalid' });
  assert.deepEqual(
    damaged.groups.map((group) => group.value),
    ['lastBookOpen', 'desc']
  );
  assert.deepEqual(damaged.sorts, []);
});
