import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const root = fileURLToPath(new URL('../..', import.meta.url));
const publicationBase = '/reader-web';

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === '__pycache__' ? [] : sourceFiles(filename);
    return /\.(?:py|mjs|[cm]?ts|ya?ml)$/.test(entry.name) ? [filename] : [];
  });
}

function noncanonicalPaths(source) {
  return [...source.matchAll(/\/reader-web\b/gi)]
    .map(([value]) => value)
    .filter((value) => value !== publicationBase);
}

test('publication path checker rejects case variants without rejecting the canonical app path', () => {
  assert.deepEqual(noncanonicalPaths(publicationBase + '/manage'), []);
  const obsolete = '/' + 'Reader-Web';
  assert.deepEqual(noncanonicalPaths(`page.goto(origin + '${obsolete}/connections')`), [obsolete]);
});

test('all composed browser fixtures and build workflows use the deployed case-sensitive app path', () => {
  const config = readFileSync(path.join(root, 'apps/web/svelte.config.js'), 'utf8');
  assert.match(config, /process\.env\.BASE_PATH\s*\?\?\s*['"]\/reader-web['"]/);
  const failures = ['tests/browser', 'test/reader', '.github/workflows'].flatMap((directory) =>
    sourceFiles(path.join(root, directory)).flatMap((filename) => {
      const invalid = noncanonicalPaths(readFileSync(filename, 'utf8'));
      return invalid.length ? [`${path.relative(root, filename)}: ${invalid.join(', ')}`] : [];
    })
  );
  assert.deepEqual(
    failures,
    [],
    'A fixture or build has drifted from the production publication path'
  );
});
