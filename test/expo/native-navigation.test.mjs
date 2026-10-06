/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(
  readFileSync(
    new URL('../../apps/web/src/platform/native-navigation.ts', import.meta.url),
    'utf8'
  ),
  { compilerOptions: { module: ts.ModuleKind.ESNext } }
).outputText;
const { nativeNavigationPath } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);
test('native route adapter preserves deployment prefix, query and hash without URL navigation', () => {
  for (const [input, output] of [
    ['/reader-web/manage', '/manage'],
    ['/reader-web/b?id=4#note', '/b?id=4#note'],
    ['/settings', '/settings']
  ])
    assert.equal(nativeNavigationPath(input, '/reader-web'), output);
  for (const input of [
    '//evil.test/manage',
    'https://example.org/manage',
    '/reader-web-evil/manage',
    '/manage/more',
    '/reader-web/../b',
    '/b\\evil'
  ])
    assert.equal(nativeNavigationPath(input, '/reader-web'), undefined);
});
