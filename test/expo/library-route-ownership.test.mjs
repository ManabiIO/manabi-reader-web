/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);

test('mounted Library routes own their series, shallow search and return navigation', async () => {
  const output = mkdtempSync(join(tmpdir(), 'library-route-ownership-'));
  try {
    const outfile = join(output, 'library.cjs');
    await build({
      stdin: {
        contents: `
          export { default as ManageRoute } from './apps/web/src/screens/routes/manage.web';
          export { LibraryScreen } from './apps/web/src/library-react/screen';
          export { BrowserRuntime } from './apps/web/src/runtime/BrowserRuntime';
          export { database } from './apps/web/src/lib/data/store';
          export { presentBook, createCollection } from './apps/web/src/lib/library/organization';
          export { refreshLocation } from './apps/web/src/runtime/stores';
          export { installRouter } from './apps/web/src/runtime/navigation';
          export { account } from './apps/web/src/lib/manabi/client';
          export { snippetItems } from './apps/web/src/lib/snippets/service';
          export { RouteParams } from 'expo-router';
        `,
        resolveDir: process.cwd()
      },
      outfile,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      jsx: 'automatic',
      conditions: ['browser'],
      tsconfig: 'apps/web/tsconfig.json',
      loader: { '.css': 'empty', '.woff2': 'file', '.woff': 'file' },
      logLevel: 'silent',
      plugins: [
        {
          name: 'host-react-and-route-context',
          setup(builder) {
            builder.onResolve({ filter: /^react(?:\/.*)?$|^react-dom(?:\/.*)?$/ }, (args) => ({
              path: require.resolve(args.path),
              external: true
            }));
            // Only Expo's route context is substituted. The actual route, screen,
            // controllers, views, stores and IndexedDB transactions are bundled.
            builder.onResolve({ filter: /^expo-router$/ }, () => ({
              path: 'local-route-context',
              namespace: 'local-route-context'
            }));
            builder.onLoad({ filter: /.*/, namespace: 'local-route-context' }, () => ({
              contents: `
                import { createContext, useContext } from 'react';
                export const RouteParams = createContext({});
                export const useLocalSearchParams = () => useContext(RouteParams);
              `,
              loader: 'js'
            }));
          }
        }
      ]
    });
    for (const strict of [false, true]) {
      const result = spawnSync(
        process.execPath,
        [
          new URL('./fixtures/library-route-ownership.mjs', import.meta.url).pathname,
          outfile,
          String(strict)
        ],
        { encoding: 'utf8', timeout: 30000 }
      );
      assert.equal(result.error, undefined, result.error?.message + '\n' + result.stderr);
      assert.equal(result.status, 0, `Strict Mode: ${strict}\n${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /Library route ownership completed/);
    }
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
