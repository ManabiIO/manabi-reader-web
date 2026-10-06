/** @license BSD-3-Clause */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
const files = readdirSync(new URL('.', import.meta.url))
  .filter((name) => name.endsWith('.test.mjs'))
  .map((name) => new URL(name, import.meta.url).pathname);
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
