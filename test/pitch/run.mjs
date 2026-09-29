import process from 'node:process';
/** Dependency-free execution of the actual TypeScript sources, not copied algorithms. */
import { stripTypeScriptTypes } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../..', import.meta.url));
const source = join(root, 'apps/web/src/lib/features/whispersync/pitch');
const argument = process.argv.find((arg) => arg.startsWith('--emit='));
const output = argument ? resolve(argument.slice(7)) : mkdtempSync(join(tmpdir(), 'manabi-pitch-'));
const { mkdirSync } = await import('node:fs');
mkdirSync(output, { recursive: true });
try {
  for (const name of readdirSync(source).filter((name) => name.endsWith('.ts'))) {
    const code = stripTypeScriptTypes(readFileSync(join(source, name), 'utf8'))
      .replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'")
      .replace("'./voice-pitch.worker.ts'", "'./voice-pitch.worker.mjs'");
    writeFileSync(join(output, name.replace(/\.ts$/, '.mjs')), code);
  }
  const result = spawnSync(process.execPath, ['--test', join(root, 'test/pitch/pitch.test.mjs')], {
    stdio: 'inherit',
    env: { ...process.env, PITCH_COMPILED: pathToFileURL(output + '/').href }
  });
  process.exitCode = result.status ?? 1;
} finally {
  if (!argument) rmSync(output, { recursive: true, force: true });
}
