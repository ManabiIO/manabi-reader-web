/** @license BSD-3-Clause */
// These are isolated real-adapter cases, separate from built-Expo acceptance.
// One ESM graph mounts the real web Library and exports its own storage/account
// instances. No Vite/Svelte runtime, mock adapter, or production debug entry.
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const runtimeModules = {
  'lib/data/store.ts': ['database'],
  'lib/manabi/shared-library.ts': ['transferSharedBooks'],
  'lib/manabi/persistence.ts': ['integrationDB'],
  'lib/manabi/client.ts': ['account'],
  'lib/manabi/ttu-folder-contract.ts': ['resolveTtuRoot'],
  'lib/data/storage/handler/filesystem-handler.ts': ['FilesystemStorageHandler'],
  'lib/data/storage/handler/browser-handler.ts': ['BrowserStorageHandler'],
  'lib/data/database/books-db/database.service.ts': ['DatabaseService'],
  'lib/data/database/books-db/book-records.ts': ['updateBookLastRead'],
  'lib/data/storage/storage-types.ts': ['StorageKey'],
  'lib/data/merge-mode.ts': ['MergeMode'],
  'lib/functions/replication/replication-options.ts': ['ReplicationSaveBehavior'],
  'lib/functions/replication/replication-progress.ts': ['replicationProgress$'],
  'lib/data/storage/storage-handler-factory.ts': ['getStorageHandler']
};

export async function buildSharedRuntime(directory) {
  const outdir = path.resolve(directory);
  await fs.mkdir(outdir, { recursive: true });
  const result = await build({
    absWorkingDir: root,
    stdin: {
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { LibraryScreen } from './apps/web/src/library-react/screen';
        import { BrowserRuntime } from './apps/web/src/runtime/BrowserRuntime';
        ${Object.entries(runtimeModules)
          .map(
            ([source, names]) => `export { ${names.join(', ')} } from './apps/web/src/${source}';`
          )
          .join('\n')}
        createRoot(document.getElementById('root')).render(
          <><BrowserRuntime embedded /><LibraryScreen /></>
        );
      `,
      resolveDir: root,
      loader: 'tsx'
    },
    outfile: path.join(outdir, 'shared-runtime.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    tsconfig: path.join(root, 'apps/web/tsconfig.json'),
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env.EXPO_PUBLIC_READER_BASE_PATH': '"/reader-web"',
      'process.env.EXPO_BASE_URL': '"/reader-web"',
      'process.env': '{}'
    },
    loader: { '.woff': 'file', '.woff2': 'file' },
    metafile: true,
    logLevel: 'silent'
  });
  for (const [source, names] of Object.entries(runtimeModules)) {
    const destination = path.join(outdir, 'src', source);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(
      destination,
      `export { ${names.join(', ')} } from '/reader-web/shared-runtime.js';\n`
    );
  }
  await fs.writeFile(
    path.join(outdir, 'manage.html'),
    '<!doctype html><html><head><meta charset="utf-8"><title>Shared storage adapter integration</title>' +
      '<link rel="stylesheet" href="/reader-web/shared-runtime.css"></head><body>' +
      '<div id="root"></div><script type="module" src="/reader-web/shared-runtime.js"></script>' +
      '</body></html>'
  );
  return result.metafile;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3)
    throw new Error('Usage: node shared-storage-runtime-build.mjs OUTPUT');
  await buildSharedRuntime(process.argv[2]);
}
