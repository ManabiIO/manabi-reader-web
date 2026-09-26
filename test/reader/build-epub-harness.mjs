/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { build } = createRequire(new URL('../../package.json', import.meta.url))('esbuild');
const root = fileURLToPath(new URL('../../apps/web/', import.meta.url));
await build({
  stdin: {
    contents: `
      export {importEpubPublication} from './src/lib/foliate-epub/import-publication';
      export {createStoredFoliateBook} from './src/lib/foliate-epub/stored-foliate-book';
      export {Paginator} from './src/lib/foliate-epub/paginator.js';
      export {PageTurnController} from './src/lib/foliate-epub/page-turn-controller';
      export * from './src/lib/reader-location';
      export * from './src/lib/foliate-epub/publication-styles';
      export * from './src/lib/foliate-epub/publication-wire';
      export * from './src/lib/foliate-epub/reader-fonts';
      import {configure} from '@zip.js/zip.js';
      configure({useWebWorkers:false});
    `,
    resolveDir: root
  },
  alias: { $lib: `${root}/src/lib` },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'EpubTest',
  outfile: fileURLToPath(new URL('../../test-results/epub-harness.js', import.meta.url))
});
