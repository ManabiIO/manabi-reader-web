import test from 'node:test';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
require('fake-indexeddb/auto');
const { outputFiles } = await build({
  entryPoints: [new URL('../../test/reader/books-schema-cases.mjs', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false
});
const { caseNames, runCase } = await import(
  'data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64')
);
for (const name of caseNames) {
  test(`complete schema / retained data: ${name}`, { timeout: 10000 }, () => runCase(name));
}
