/** @license BSD-3-Clause; Copyright (c) 2026, ッツ Reader Authors */
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = process.cwd(),
  dir = await mkdtemp(join(tmpdir(), 'manabi-snippet-react-'));
try {
  await build({
    entryPoints: ['test/snippets/react.test.mjs'],
    outfile: join(dir, 'tests.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    conditions: ['browser'],
    external: ['node:*'],
    jsx: 'automatic',
    alias: {
      $lib: `${root}/apps/web/src/lib`,
      $app: `${root}/apps/web/src/runtime`,
      $runtime: `${root}/apps/web/src/runtime`,
      'fake-indexeddb/auto': `${root}/apps/web/node_modules/fake-indexeddb/auto/index.mjs`
    },
    plugins: [
      {
        name: 'snippet-ui-boundaries',
        setup(b) {
          b.onResolve({ filter: /^jsdom$/ }, () => ({
            path: require.resolve('jsdom'),
            external: true
          }));
          b.onResolve(
            {
              filter:
                /\/lib\/(?:manabi\/(?:client|persistence|sources)|library\/(?:catalog|organization)|snippets\/(?:service|storage|transfers|reading-state|search|portability))$/
            },
            () => ({ path: `${root}/test/snippets/fixtures/react-environment.ts` })
          );
          b.onResolve({ filter: /\/library-react\/navigation$/ }, () => ({
            path: `${root}/test/snippets/fixtures/navigation-shell.tsx`
          }));
          b.onResolve({ filter: /^snippet-ui-fixture$/ }, () => ({
            path: `${root}/test/snippets/fixtures/react-environment.ts`
          }));
        }
      }
    ]
  });
  const result = spawnSync(process.execPath, ['--test', join(dir, 'tests.cjs')], {
    stdio: 'inherit',
    env: process.env
  });
  if (result.error) throw result.error;
  if (result.signal) console.error(`React tests exited with ${result.signal}`);
  process.exitCode = result.status ?? 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
