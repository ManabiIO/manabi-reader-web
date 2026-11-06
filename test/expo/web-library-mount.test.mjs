/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, renameSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const appRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));

test('the actual browser runtime and library mount, update and remount without starving IndexedDB', async () => {
  const output = mkdtempSync(join(tmpdir(), 'web-library-mount-'));
  try {
    const outfile = join(output, 'library.cjs');
    await build({
      stdin: {
        contents: `
          export { LibraryScreen } from './apps/web/src/library-react/screen';
          export { BrowserRuntime } from './apps/web/src/runtime/BrowserRuntime';
          export { createNativeLibraryService } from './apps/web/src/native-library/dom-service';
          export { StorageKey } from './apps/web/src/lib/data/storage/storage-types';
          export { database, userFonts$, booklistSortOptions$ } from './apps/web/src/lib/data/store';
          export { refreshLocation } from './apps/web/src/runtime/stores';
          export { installRouter, beforeNavigate } from './apps/web/src/runtime/navigation';
        `,
        resolveDir: process.cwd()
      },
      outfile,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      jsx: 'automatic',
      conditions: ['browser'],
      resolveExtensions: ['.web.tsx', '.tsx', '.web.ts', '.ts', '.web.js', '.js'],
      tsconfig: 'apps/web/tsconfig.json',
      loader: { '.css': 'empty', '.woff2': 'file', '.woff': 'file' },
      logLevel: 'silent',
      plugins: [
        {
          name: 'host-react',
          setup(b) {
            b.onResolve({ filter: /^react-native$/ }, () => ({
              path: appRequire.resolve('react-native-web'),
              external: true
            }));
            b.onResolve({ filter: /^expo-router$/ }, () => ({
              path: 'router',
              namespace: 'router'
            }));
            b.onLoad({ filter: /.*/, namespace: 'router' }, () => ({
              contents:
                "export const useIsFocused = () => true; export const Link = () => { throw new Error('Unexpected Link in mount fixture'); };",
              loader: 'js'
            }));
            b.onResolve({ filter: /^react(?:\/.*)?$|^react-dom(?:\/.*)?$/ }, (args) => ({
              path: require.resolve(args.path),
              external: true
            }));
          }
        }
      ]
    });
    // A timer inside the mounted process cannot diagnose microtask starvation.
    // Keep the deadline outside it, just as a browser automation client would.
    const result = spawnSync(
      process.execPath,
      [new URL('./fixtures/web-library-mount.mjs', import.meta.url).pathname, outfile],
      { encoding: 'utf8', timeout: 20000 }
    );
    assert.equal(result.error, undefined, result.error?.message + '\n' + result.stderr);
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
    assert.match(result.stdout, /Library startup and remount completed/);
  } finally {
    const trash = join(homedir(), '.Trash');
    mkdirSync(trash, { recursive: true });
    renameSync(output, join(mkdtempSync(join(trash, 'web-library-mount-')), 'output'));
  }
});
