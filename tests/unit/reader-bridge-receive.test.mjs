/** @license BSD-3-Clause */
import test from 'node:test';
import { createRequire } from 'node:module';
import { compileFunction } from 'node:vm';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const dom = new JSDOM('<!doctype html><title>Reader book comparison</title>');
globalThis.document = dom.window.document;
const { outputFiles } = await build({
  entryPoints: [
    new URL('../../test/reader/reader-bridge-receive-cases.mjs', import.meta.url).pathname
  ],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  write: false,
  alias: { $lib: new URL('../../apps/web/src/lib', import.meta.url).pathname }
});
const module = { exports: {} };
compileFunction(outputFiles[0].text, ['require', 'module', 'exports'])(
  require,
  module,
  module.exports
);
for (const name of module.exports.caseNames)
  test(`reader receive: ${name}`, { timeout: 15000 }, () => module.exports.runCase(name));
test.after(() => {
  dom.window.close();
  delete globalThis.document;
});
