/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

test('native selection initializes without browser Intl constructors and preserves reconciliation', async () => {
  const result = await build({
    entryPoints: ['apps/web/src/native-library/selection.ts'],
    bundle: true,
    write: false,
    metafile: true,
    platform: 'node',
    format: 'cjs',
    tsconfig: 'apps/web/tsconfig.json'
  });
  const module = { exports: {} };
  vm.runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, Intl: {} });
  const selected = module.exports.reconcileNativeSelection(
    ['book:2', 'gone', 'book:1', 'series:1', 'book:2'],
    [
      { kind: 'book', key: 'book:1' },
      { kind: 'series', key: 'series:1' },
      { kind: 'book', key: 'book:2' }
    ]
  );
  assert.deepEqual(Array.from(selected), ['book:2', 'book:1']);
  assert.deepEqual(Array.from(module.exports.reconcileNativeSelection(['book:1'], [])), []);
  assert.equal(
    Object.keys(result.metafile.inputs).length,
    1,
    'selection must remain a pure native leaf'
  );
});
