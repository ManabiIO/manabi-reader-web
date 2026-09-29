/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { ensureDictionaryRepository } from '../../scripts/dictionary-source.mjs';
const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
async function fixture(t) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'dictionary-boundary-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  git(parent, ['init', '--quiet']);
  await fs.writeFile(path.join(parent, 'sentinel'), 'Reader must not change.');
  git(parent, ['add', 'sentinel']);
  git(parent, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'Reader'
  ]);
  return parent;
}
test('fresh nested cache owns its repository and cannot change Reader HEAD', async (t) => {
  const parent = await fixture(t),
    before = git(parent, ['rev-parse', 'HEAD']);
  const nested = path.join(parent, '.cache', 'dictionary', 'source');
  const actual = await ensureDictionaryRepository(nested, true);
  assert.equal(git(nested, ['rev-parse', '--show-toplevel']), await fs.realpath(nested));
  await fs.writeFile(path.join(nested, 'dictionary'), 'Dictionary');
  git(nested, ['add', 'dictionary']);
  git(nested, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'Dictionary'
  ]);
  git(nested, ['checkout', '--detach']);
  assert.equal(git(parent, ['rev-parse', 'HEAD']), before);
  assert.equal(await fs.readFile(path.join(parent, 'sentinel'), 'utf8'), 'Reader must not change.');
  assert.equal(await ensureDictionaryRepository(nested, true), actual);
});
test('explicit source cannot inherit a containing repository', async (t) => {
  const parent = await fixture(t),
    nested = path.join(parent, 'not-a-repository');
  await fs.mkdir(nested);
  await assert.rejects(ensureDictionaryRepository(nested), /repository root/);
  await assert.rejects(fs.lstat(path.join(nested, '.git')), { code: 'ENOENT' });
  assert.equal(await ensureDictionaryRepository(parent), await fs.realpath(parent));
});
test('cache refuses symbolic metadata and symbolic repository roots', async (t) => {
  const parent = await fixture(t),
    nested = path.join(parent, 'misdirected');
  await fs.mkdir(nested);
  await fs.symlink(path.join(parent, '.git'), path.join(nested, '.git'), 'dir');
  await assert.rejects(ensureDictionaryRepository(nested, true), /independent repository metadata/);
  const link = path.join(parent, 'root-link');
  await fs.symlink(nested, link, 'dir');
  await assert.rejects(ensureDictionaryRepository(link, true), /symbolic repository root/);
});
