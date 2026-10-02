/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../..', import.meta.url));
const app = path.join(root, 'apps/web');
const appRequire = createRequire(path.join(app, 'package.json'));
const expoRequire = createRequire(appRequire.resolve('expo/package.json'));
const metroRequire = createRequire(expoRequire.resolve('@expo/metro-config/package.json'));
const babel = metroRequire('@babel/core');
const metroConfig = appRequire('./metro.config.cjs');
const dom = path.join(app, 'src/platform/reader-runtime.dom.tsx');
const transform = () =>
  babel.transformFileSync(dom, {
    cwd: app,
    filename: dom,
    caller: {
      name: 'metro',
      platform: 'android',
      isDev: false,
      isServer: false,
      isNodeModule: false,
      supportsStaticESM: true,
      projectRoot: app
    },
    configFile: path.join(app, 'babel.config.cjs'),
    babelrc: false
  });
test('actual Expo Android DOM transform disconnects all browser imports', () => {
  const output = transform();
  assert(output.metadata.expoDomComponentReference.endsWith('/reader-runtime.dom.tsx'));
  assert.match(output.code, /expo\/dom\/internal/);
  assert.doesNotMatch(output.code, /BrowserRuntime|native-snippets|reader-react|database|onnx/);
});
test('shared Android icon leaves use actual Metro-supported vector assets', () => {
  assert.ok(metroConfig.resolver.assetExts.includes('xml'));
  assert.ok(!metroConfig.resolver.sourceExts.includes('xml'));
  const iconDirectory = path.join(app, 'src/shared-ui/icons');
  const assets = readdirSync(iconDirectory).filter((file) => file.endsWith('.xml'));
  assert.ok(assets.length > 0);
  for (const asset of assets) {
    const source = readFileSync(path.join(iconDirectory, asset), 'utf8');
    assert.match(source, /<vector\s/);
    assert.match(source, /<path\s/);
    assert.doesNotMatch(source, /<!DOCTYPE|<!ENTITY|\b(?:href|src)\s*=/i);
  }
});
for (const platform of ['android', 'web'])
  test(`${platform} routes include the shared Statistics composition without leaking platform owners`, async () => {
    const routes = readdirSync(path.join(app, 'src/app')).filter(
      (name) => name.endsWith('.tsx') && !name.startsWith('_') && !name.includes('.web.')
    );
    const result = await build({
      entryPoints: routes.map((file) => path.join(app, 'src/app', file)),
      outdir: '/tmp/manabi-route-graph-unwritten',
      write: false,
      bundle: true,
      metafile: true,
      platform: 'browser',
      format: 'esm',
      packages: 'external',
      jsx: 'automatic',
      resolveExtensions:
        platform === 'web'
          ? ['.web.tsx', '.web.ts', '.tsx', '.ts', '.js', '.mjs']
          : ['.android.tsx', '.native.tsx', '.native.ts', '.tsx', '.ts', '.js', '.mjs'],
      alias: {
        $lib: path.join(app, 'src/lib'),
        $app: path.join(app, 'src/runtime'),
        $runtime: path.join(app, 'src/runtime')
      },
      loader: {
        '.css': 'empty',
        '.scss': 'empty',
        '.woff': 'file',
        '.woff2': 'file',
        '.onnx': 'file',
        '.wasm': 'file',
        '.svg': 'file',
        '.xml': 'file'
      },
      plugins:
        platform === 'android'
          ? [
              {
                name: 'actual-expo-dom-boundary',
                setup(b) {
                  b.onLoad({ filter: /reader-runtime\.dom\.tsx$/ }, () => ({
                    contents: transform().code,
                    loader: 'js',
                    resolveDir: path.dirname(dom)
                  }));
                }
              }
            ]
          : []
    });
    const inputs = Object.keys(result.metafile.inputs).map((file) => file.replaceAll('\\', '/'));
    for (const shared of ['StatisticsScreen.tsx', 'controller.ts'])
      assert(
        inputs.some((file) => file.endsWith(`/features/statistics/${shared}`)),
        `${platform} must execute the same production Statistics ${shared}`
      );
    for (const oldPresentation of [
      '/statistics-react/statistics-screen.tsx',
      '/statistics-react/native-screen.tsx'
    ])
      assert(
        !inputs.some((file) => file.includes(oldPresentation)),
        `Shared Statistics must not hide an old whole-screen renderer: ${oldPresentation}`
      );
    if (platform === 'android') {
      assert.ok(
        inputs.some((file) => file.includes('/shared-ui/icons/') && file.endsWith('.xml')),
        'Android shared controls must retain their real vector assets in the route graph'
      );
      for (const forbidden of [
        '/reader-react/',
        '/native-library/view-model.ts',
        '/lib/library/tree.ts',
        '/lib/data/store.ts',
        '/lib/data/database/books-db/database.service.ts',
        '/lib/data/database/books-db/factory.ts',
        '/lib/data/database/books-db/admitted-book-read.ts',
        '/lib/data/database/books-db/reader-statistics.ts',
        '/lib/snippets/database.ts',
        '/lib/manabi/client.ts'
      ])
        assert(
          !inputs.some((file) => file.includes(forbidden)),
          `Native shell traversed the DOM/storage owner ${forbidden}`
        );
      assert(!inputs.some((file) => /\.web\.[cm]?[jt]sx?$/.test(file)));
      assert(
        !inputs.some(
          (file) =>
            /\.dom\.[cm]?[jt]sx?$/.test(file) && !file.endsWith('/platform/reader-runtime.dom.tsx')
        ),
        'DOM-only helper must remain behind the transformed persistent reader owner'
      );
      const externals = Object.values(result.metafile.inputs).flatMap((input) =>
        input.imports.filter((item) => item.external).map((item) => item.path)
      );
      for (const imported of externals)
        assert.doesNotMatch(
          imported,
          /^(?:react-dom|@tiptap|idb|@sqlite.org\/sqlite-wasm)(?:\/|$)/,
          `Native shared route reached a browser-only renderer/storage package: ${imported}`
        );
    } else {
      assert.ok(
        !inputs.some((file) => file.includes('/shared-ui/icons/') && file.endsWith('.xml'))
      );
      assert(!inputs.some((file) => /\.native\.[cm]?[jt]sx?$/.test(file)));
      assert(!inputs.some((file) => file.endsWith('/platform/reader-runtime.dom.tsx')));
    }
  });

test('both Statistics routes explicitly re-export the identical shared screen', () => {
  const modules = ['statistics.tsx', 'statistics.web.tsx'].map((name) => {
    const file = path.join(app, 'src/screens/routes', name);
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    const exports = source.statements.filter(
      (node) => ts.isExportDeclaration(node) && node.moduleSpecifier
    );
    assert.equal(exports.length, 1, `${name}: one shared screen export`);
    assert.ok(
      exports[0].exportClause?.elements.some((item) => item.name.text === 'default'),
      `${name}: the shared screen must be the active default export`
    );
    return exports[0].moduleSpecifier.text;
  });
  assert.deepEqual(modules, [
    '../../features/statistics/StatisticsScreen',
    '../../features/statistics/StatisticsScreen'
  ]);
});

test('shared Statistics composition and controller contain no direct browser renderer or owner', () => {
  const directory = path.join(app, 'src/features/statistics');
  const files = [];
  function visit(folder) {
    for (const item of readdirSync(folder, { withFileTypes: true })) {
      if (item.isDirectory()) {
        if (item.name !== 'ports') visit(path.join(folder, item.name));
      } else if (/\.tsx?$/.test(item.name) && !/\.(?:web|native|android|dom)\./.test(item.name)) {
        files.push(path.join(folder, item.name));
      }
    }
  }
  visit(directory);
  assert.ok(files.some((file) => file.endsWith('/StatisticsScreen.tsx')));
  assert.ok(files.some((file) => file.endsWith('/controller.ts')));
  const globals = new Set(['window', 'document', 'navigator', 'localStorage', 'indexedDB']);
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    function inspect(node) {
      assert.ok(
        !(
          ts.isExpressionStatement(node) &&
          ts.isStringLiteral(node.expression) &&
          node.expression.text === 'use dom'
        ),
        `${file}: shared nonreader composition must not become a whole-screen WebView`
      );
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        assert.ok(
          !ts.isJsxNamespacedName(node.tagName) &&
            !(ts.isIdentifier(node.tagName) && /^[a-z]/.test(node.tagName.text)),
          `${file}: DOM tags belong only in bounded web primitive adapters`
        );
      }
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
        assert.ok(
          !globals.has(node.expression.text) &&
            !(node.expression.text === 'globalThis' && globals.has(node.name.text)),
          `${file}: browser operations belong in typed platform ports`
        );
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        assert.doesNotMatch(
          node.moduleSpecifier.text,
          /^(?:react-dom|@tiptap)(?:\/|$)|(?:^|\/)lib\/(?:data\/store|manabi\/client)/,
          `${file}: shared feature imports a browser renderer/owner`
        );
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source);
  }
});
