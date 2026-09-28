import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

await build({
  entryPoints: [
    fileURLToPath(new URL('../../test/reader/books-schema-cases.mjs', import.meta.url))
  ],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'BooksSchemaCases',
  outfile: fileURLToPath(new URL('../../test-results/books-schema/fixture.js', import.meta.url))
});
// Retain a runnable Node variant too. Both variants execute the same production
// factory and fixture; only this one substitutes fake-indexeddb for the browser.
await build({
  stdin: {
    contents:
      "import 'fake-indexeddb/auto'; export * from '../../test/reader/books-schema-cases.mjs';",
    resolveDir: fileURLToPath(new URL('../../apps/web/', import.meta.url))
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: fileURLToPath(
    new URL('../../test-results/books-schema/fixture.node.cjs', import.meta.url)
  )
});
