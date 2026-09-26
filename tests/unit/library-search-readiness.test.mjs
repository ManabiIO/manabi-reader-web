import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(
  new URL(
    '../../apps/web/src/lib/components/book-card/book-manager-header.svelte',
    import.meta.url
  ),
  'utf8'
);

test('both search inputs reject interaction until hydration and the query owner are ready', () => {
  assert.match(header, /let hydrated = false/);
  assert.match(header, /onMount\(\(\) => \{\s*hydrated = true/);
  const inputs = [...header.matchAll(/<input\b[\s\S]*?\/>/g)]
    .map(([input]) => input)
    .filter((input) => input.includes('type="search"'));
  assert.equal(inputs.length, 2);
  for (const input of inputs) {
    assert.match(input, /disabled=\{!hydrated \|\| !libraryMenu\}/);
    assert.doesNotMatch(input, /disabled=\{[^}]*\b(?:busy|scanning|loading)\b/);
  }
});
