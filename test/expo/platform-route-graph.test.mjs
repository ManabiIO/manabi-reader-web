/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
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
for (const platform of ['android', 'web'])
  test(`${platform} route dependency graph excludes the other presentation and storage owner`, async () => {
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
        '.svg': 'file'
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
    const inputs = Object.keys(result.metafile.inputs);
    if (platform === 'android')
      for (const forbidden of [
        '/reader-react/',
        '/library-react/',
        '/settings-react/',
        '/snippets-react/',
        '/lib/data/store.ts',
        '/lib/manabi/client.ts'
      ])
        assert(
          !inputs.some((file) => file.includes(forbidden)),
          `Native shell traversed ${forbidden}`
        );
    else
      for (const forbidden of [
        '/native-library/',
        '/native-settings/',
        '/native-snippets/',
        'RuntimeProvider.native.tsx'
      ])
        assert(
          !inputs.some((file) => file.includes(forbidden)),
          `Web routes traversed ${forbidden}`
        );
  });
