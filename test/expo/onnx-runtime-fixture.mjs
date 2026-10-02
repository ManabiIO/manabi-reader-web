/** @license BSD-3-Clause */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const app = path.join(root, 'apps/web');
export const appRequire = createRequire(path.join(app, 'package.json'));
export const expoRequire = createRequire(appRequire.resolve('expo/package.json'));
const metroRequire = createRequire(expoRequire.resolve('@expo/metro-config/package.json'));
export const babel = metroRequire('@babel/core');
export const generate = metroRequire('@babel/generator').default;
export const collectDependencies = metroRequire('./build/transform-worker/collect-dependencies.js').default;
const transformer = metroRequire('./build/babel-transformer.js');
export const plugin = appRequire('../../scripts/babel/onnx-runtime-imports.cjs');
export const ortRoot = path.dirname(path.dirname(appRequire.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm')));
export const ortPackage = JSON.parse(readFileSync(path.join(ortRoot, 'package.json'), 'utf8'));
// Match ORT's browser ESM export, rather than Node's require() export.
export const ortFile = path.resolve(ortRoot, ortPackage.exports['./wasm'].import.default);
export const ortSource = readFileSync(ortFile, 'utf8');

export function collect(ast) {
  return collectDependencies(ast, {
    asyncRequireModulePath: 'expo-async-require',
    dynamicRequires: 'reject',
    inlineableCalls: [],
    keepRequireNames: true,
    allowOptionalDependencies: false,
    unstable_allowRequireContext: false
  });
}

export function transformORT({ dom = false } = {}) {
  return transformer.transform({
    filename: ortFile,
    src: ortSource,
    options: {
      projectRoot: app,
      platform: 'web',
      dev: false,
      minify: true,
      enableBabelRCLookup: true,
      experimentalImportSupport: true,
      customTransformOptions: dom ? { dom: '1' } : {}
    },
    plugins: []
  }).ast;
}

export function nativeImports(ast) {
  const imports = [];
  babel.traverse(ast, {
    CallExpression(importPath) {
      if (babel.types.isImport(importPath.node.callee)) imports.push(importPath.node);
    }
  });
  return imports;
}
