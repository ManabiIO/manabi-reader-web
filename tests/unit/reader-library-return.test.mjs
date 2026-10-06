/** @license BSD-3-Clause */
import test from 'node:test';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(
  readFileSync(
    new URL('../../apps/web/src/shared-ui/navigation-context.ts', import.meta.url),
    'utf8'
  ),
  { compilerOptions: { module: ts.ModuleKind.ESNext } }
).outputText;
const { readerLibraryReturnPath } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);

test('reader Library return preserves the admitted local shelf without decoding its identity twice', () => {
  const current = new URL('https://reader.test/reader-web/b?id=7');
  const shelf =
    '/reader-web/manage?series=personal-series%3AJapanese%2520Reading&collection=A%25B&source=local-1&q=%E4%BA%AC%E9%83%BD#shelf';
  assert.equal(readerLibraryReturnPath(current, shelf, '/reader-web'), shelf);
  assert.equal(
    readerLibraryReturnPath(current, 'https://reader.test' + shelf, '/reader-web'),
    shelf
  );
  assert.equal(
    readerLibraryReturnPath(new URL('https://reader.test/b?id=7'), '/manage?series=x', ''),
    '/manage?series=x'
  );
});

test('cold, unrelated and external reader arrivals return to local Books', () => {
  const current = new URL('https://reader.test/reader-web/b?id=7');
  for (const previous of [
    undefined,
    '/reader-web/settings',
    '/reader-web/b?id=8',
    '/reader-web/manage/extra',
    '//evil.test/reader-web/manage',
    'https://user:secret@reader.test/reader-web/manage',
    '/other/manage',
    'http://['
  ])
    assert.equal(readerLibraryReturnPath(current, previous, '/reader-web'), '/reader-web/manage');
});
