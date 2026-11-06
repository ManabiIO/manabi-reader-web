/** @license BSD-3-Clause */
import test from 'node:test';
import { createRequire } from 'node:module';
import { compileFunction } from 'node:vm';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';
const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const dom = new JSDOM('<!doctype html><title>Reader connection</title>');
globalThis.document = dom.window.document;
const root = new URL('../../', import.meta.url).pathname;
const { outputFiles } = await build({
  entryPoints: [root + 'test/reader/reader-bridge-connection-cases.mjs'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  write: false,
  alias: { $lib: root + 'apps/web/src/lib' },
  plugins: [
    {
      name: 'connection-io',
      setup(builder) {
        builder.onResolve({ filter: /^\.\/(client|operation-scope)$/ }, (args) =>
          args.importer.endsWith('/reader-bridge-source.ts')
            ? { path: root + 'test/reader/reader-bridge-connection-io.mjs' }
            : undefined
        );
      }
    }
  ]
});
const module = { exports: {} };
compileFunction(outputFiles[0].text, ['require', 'module', 'exports'])(
  require,
  module,
  module.exports
);
for (const name of module.exports.caseNames)
  test(`reader connection: ${name}`, { timeout: 20000 }, () => module.exports.runCase(name));
test.after(() => {
  dom.window.close();
  delete globalThis.document;
});
