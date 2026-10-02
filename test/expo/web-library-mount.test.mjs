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

test('the actual browser runtime and library mount, update and remount without starving IndexedDB', async () => {
  const output = mkdtempSync(join(tmpdir(), 'web-library-mount-'));
  try {
    const outfile = join(output, 'library.cjs');
    await build({
      stdin: {
        contents: `
          export { LibraryScreen } from './apps/web/src/library-react/screen';
          export { BrowserRuntime } from './apps/web/src/runtime/BrowserRuntime';
          export { database } from './apps/web/src/lib/data/store';
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
      tsconfig: 'apps/web/tsconfig.json',
      loader: { '.css': 'empty', '.woff2': 'file', '.woff': 'file' },
      logLevel: 'silent',
      plugins: [
        {
          name: 'host-react',
          setup(b) {
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
    rmSync(output, { recursive: true, force: true });
  }
});
