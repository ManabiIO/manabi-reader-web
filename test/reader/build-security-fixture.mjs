import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { build } = createRequire(new URL('../../package.json', import.meta.url))('esbuild');
await build({
  stdin: {
    contents:
      "export * from './book-content-security.ts'; export * from './dialog-content-security.ts';",
    resolveDir: fileURLToPath(
      new URL('../../apps/web/src/lib/functions/book-security/', import.meta.url)
    )
  },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'BookSecurity',
  outfile: fileURLToPath(new URL('../../.reader-tests/book-security.js', import.meta.url))
});

await build({
  stdin: {
    contents: `export {default as loadEpub} from './src/lib/functions/file-loaders/epub/load-epub.ts';
      export {default as loadHtmlz} from './src/lib/functions/file-loaders/htmlz/load-htmlz.ts';
      export {BlobWriter, TextReader, ZipWriter, configure} from '@zip.js/zip.js';`,
    resolveDir: fileURLToPath(new URL('../../apps/web/', import.meta.url))
  },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'ReaderImport',
  plugins: [
    {
      name: 'isolated-reader-preferences',
      setup(plugin) {
        plugin.onResolve({ filter: /^\$lib\/data\/store$/ }, () => ({
          path: 'preferences',
          namespace: 'test'
        }));
        plugin.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
          contents:
            "export const importHTMLFixMode$={getValue:()=> 'Standard'}; export const restrictImportFixToAnchor$={getValue:()=>false};"
        }));
        plugin.onResolve({ filter: /^\$lib\// }, ({ path }) => ({
          path: fileURLToPath(
            new URL('../../apps/web/src/lib/' + path.slice(5) + '.ts', import.meta.url)
          )
        }));
      }
    }
  ],
  outfile: fileURLToPath(new URL('../../.reader-tests/reader-import.js', import.meta.url))
});
