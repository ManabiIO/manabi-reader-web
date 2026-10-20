/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, mkdir, mkdtemp, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(here, '../../apps/web/package.json'));
const upstream = JSON.parse(await readFile(path.join(here, 'upstream.json'), 'utf8'));
const installed = path.dirname(require.resolve('@expo/ui/package.json'));
const patch = path.join(here, 'expo-ui-56.0.26.patch');
const work = await mkdtemp(path.join(tmpdir(), 'reader-ui-contract-'));

test('the accessibility backport applies only to the reviewed Expo UI source bytes', async () => {
  assert.equal(
    JSON.parse(await readFile(path.join(installed, 'package.json'))).version,
    upstream.version
  );
  for (const name of Object.keys(upstream.files)) {
    await mkdir(path.dirname(path.join(work, name)), { recursive: true });
    await copyFile(path.join(installed, name), path.join(work, name));
  }
  execFileSync('git', ['apply', '--reverse', patch], { cwd: work });
  for (const [name, hash] of Object.entries(upstream.files)) {
    assert.equal(
      createHash('sha256')
        .update(await readFile(path.join(work, name)))
        .digest('hex'),
      hash,
      name
    );
  }
  execFileSync('git', ['apply', '--check', patch], { cwd: work });
  execFileSync('git', ['apply', patch], { cwd: work });
});

test('the installed modifier serializes labels without dropping autofill semantics', async () => {
  const output = path.join(work, 'modifiers.cjs');
  await build({
    entryPoints: [path.join(installed, 'src/jetpack-compose/modifiers/index.ts')],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external'
  });
  const { semantics } = createRequire(import.meta.url)(output);
  for (const params of [
    {},
    { contentType: 'email' },
    { contentDescription: 'Enable statistics' },
    { contentType: 'email', contentDescription: 'Email address' }
  ]) {
    assert.deepEqual(semantics(params), { $type: 'semantics', ...params });
  }
});

console.log(`Retained Expo UI patch evidence: ${work}`);
