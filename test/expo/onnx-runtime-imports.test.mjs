/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  babel,
  collect,
  generate,
  nativeImports,
  ortFile,
  ortSource,
  plugin,
  transformORT
} from './onnx-runtime-fixture.mjs';

function transform(source, filename = ortFile, parserOpts = {}) {
  return babel.transformSync(source, {
    filename,
    configFile: false,
    babelrc: false,
    ast: true,
    parserOpts,
    plugins: [plugin]
  }).ast;
}

test('normalizes only intentional ORT runtime imports, preserving their browser-native import()', () => {
  for (const expression of [
    'import(/*webpackIgnore:true*/ /*@vite-ignore*/ url)',
    'import(/* webpackIgnore :\ttrue */ url)',
    'import(//webpackIgnore:true\n url)',
    '/*webpackIgnore:true*/ import(url)',
    'import(/* webpackIgnore: true */ url)'
  ]) {
    const ast = transform(`export function load(url) { return ${expression}; }`);
    const before = nativeImports(ast)[0];
    assert.equal(before.arguments[0].name, 'url');
    assert.match(generate(ast).code, /webpackIgnore: true/);
    assert.deepEqual(collect(ast).dependencies, []);
    assert.equal(
      nativeImports(ast)[0],
      before,
      'Expo must leave the native import expression intact'
    );
  }
});

test('handles Windows/pnpm package paths and Babel ImportExpression ASTs', () => {
  const source = 'import(/*webpackIgnore:true*/ url)';
  const filename =
    'C:\\app\\node_modules\\.pnpm\\onnxruntime-web@1.29.0\\node_modules\\onnxruntime-web\\dist\\ort.wasm.bundle.min.mjs';
  assert.match(generate(transform(source, filename)).code, /webpackIgnore: true/);
  assert.match(
    generate(transform(source, ortFile, { createImportExpressions: true })).code,
    /webpackIgnore: true/
  );
});

test('unmarked and unrelated dynamic imports remain Metro errors', () => {
  for (const expression of [
    'import(url)',
    'import(/*@vite-ignore*/ url)',
    'import(/*webpackIgnore:false*/ url)',
    'import(/*example webpackIgnore:true text*/ url)'
  ]) {
    assert.throws(
      () => collect(transform(`function load(url) { return ${expression}; }`)),
      /Invalid call/
    );
  }
  for (const filename of [
    '/app/src/onnxruntime-web/dist/ort.wasm.bundle.min.mjs',
    '/app/node_modules/other/dist/ort.wasm.bundle.min.mjs',
    '/app/node_modules/onnxruntime-web-other/dist/ort.wasm.bundle.min.mjs',
    '/app/node_modules/onnxruntime-web/lib/wasm-utils-import.js'
  ]) {
    const ast = transform(
      'function load(url) { return import(/*webpackIgnore:true*/ url); }',
      filename
    );
    assert.doesNotMatch(generate(ast).code, /webpackIgnore: true/);
    assert.throws(() => collect(ast), /Invalid call/);
  }
});

test('ordinary static imports are bundled and non-import comments are unchanged', () => {
  const ast = transform('import("./ordinary.js"); consume(/*webpackIgnore:true*/ url);');
  assert.match(generate(ast).code, /webpackIgnore:true/);
  assert.ok(collect(ast).dependencies.some((dependency) => dependency.name === './ordinary.js'));
  assert.equal(nativeImports(ast).length, 0);
});

test('the installed ORT browser bundle reproduces the unnormalized Expo failure', () => {
  assert.equal(path.basename(ortFile), 'ort.wasm.bundle.min.mjs');
  assert.match(ortSource, /import\(\/\*webpackIgnore:true\*\//);
  const ast = babel.parseSync(ortSource, { filename: ortFile, configFile: false, babelrc: false });
  assert.throws(() => collect(ast), /Invalid call.*import/s);
});

for (const dom of [false, true]) {
  test(`the production Expo ${dom ? 'Android DOM' : 'web'} Babel config preserves ORT runtime imports through the installed collector`, () => {
    const ast = transformORT({ dom });
    const before = nativeImports(ast);
    assert.equal(before.length, 1);
    assert.equal(before[0].arguments[0].type, 'Identifier');
    const result = collect(ast);
    assert.deepEqual(nativeImports(ast), before);
    assert.ok(
      result.dependencies.every((dependency) => dependency.name.startsWith('@babel/runtime/'))
    );
    assert.match(generate(ast).code, /import\(\/\* webpackIgnore: true \*\//);
    assert.doesNotMatch(generate(ast).code, /Dynamic require defined at line/);
    assert.doesNotMatch(generate(ast).code, /__ExpoImportMetaRegistry|import\.meta/);
  });
}

test('only the embedded ORT WASM factory treats its optional module URL as unavailable', () => {
  const source = 'export const moduleURL = import.meta.url;';
  assert.match(generate(transform(source)).code, /moduleURL = void 0/);
  for (const filename of [
    '/app/src/worker.ts',
    '/app/node_modules/other/dist/ort.wasm.bundle.min.mjs',
    '/app/node_modules/onnxruntime-web/dist/ort.all.min.mjs',
    '/app/node_modules/onnxruntime-web/dist/ort.wasm.min.mjs'
  ])
    assert.match(generate(transform(source, filename)).code, /import\.meta\.url/);
  assert.match(
    generate(transform('export const env = import.meta.env;')).code,
    /import\.meta\.env/
  );
});
