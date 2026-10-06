import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync, copyFileSync } from 'node:fs';
const run = (command, args, env = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
const source = 'apps/web/src/lib/media',
  out = '.cache/media-test-build';
mkdirSync(out, { recursive: true });
run('tsc', [
  '--target',
  'ES2022',
  '--module',
  'ES2022',
  '--moduleResolution',
  'bundler',
  '--lib',
  'ES2023,DOM,DOM.Iterable',
  // Expo replaces process.env flags in the actual app; this isolated strict
  // module compile needs the same declared environment as the app tsconfig.
  '--types',
  'node',
  // The independent CPU CI job installs its compiler/types in a fresh runner
  // directory; it intentionally does not install the full Expo dependency graph.
  ...(process.env.MEDIA_TYPES_ROOT ? ['--typeRoots', process.env.MEDIA_TYPES_ROOT] : []),
  '--strict',
  '--skipLibCheck',
  '--outDir',
  out,
  '--rootDir',
  source,
  ...readdirSync(source)
    .filter((n) => n.endsWith('.ts'))
    .map((n) => source + '/' + n)
]);
writeFileSync(out + '/package.json', '{"type":"module"}\n');
copyFileSync(source + '/media.css', out + '/media.css');
run(process.execPath, [
  '--test',
  ...readdirSync('tests/media')
    .filter((n) => n.endsWith('.test.mjs'))
    .sort()
    .map((n) => 'tests/media/' + n)
]);
