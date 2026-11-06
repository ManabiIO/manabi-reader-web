import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  ensureGeneratedDirectory,
  pruneGeneratedDirectory,
  safeRelativePath
} from '../../scripts/dictionary-generated-paths.mjs';

test('generated dictionary paths reject traversal, roots and backslash aliases', () => {
  for (const value of ['', '.', '..', '../x', 'x/../y', '/absolute', 'x\\y', 'x/./y'])
    assert.equal(safeRelativePath(value), false, value);
  for (const value of ['LICENSE', 'provider/source.tar.gz', 'old-runtime'])
    assert.equal(safeRelativePath(value), true, value);
});

test('generated dictionary directory refuses a symlink root', async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'dictionary-generated-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));

  const target = path.join(parent, 'target');
  const link = path.join(parent, 'link');
  await fs.mkdir(target);
  await fs.symlink(target, link, 'dir');

  await assert.rejects(ensureGeneratedDirectory(link), /real directory/);
});

test('generated dictionary pruning preserves only the named current artifacts', async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'dictionary-generated-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));

  const root = path.join(parent, 'runtime');
  await fs.mkdir(path.join(root, 'current'), { recursive: true });
  await fs.writeFile(path.join(root, 'current', 'manifest.json'), '{}');
  await fs.mkdir(path.join(root, 'old'), { recursive: true });
  await fs.writeFile(path.join(root, 'old', 'manifest.json'), '{}');
  await fs.writeFile(path.join(root, 'stale.zip'), 'stale');

  await pruneGeneratedDirectory(root, new Set(['current']));

  assert.deepEqual(await fs.readdir(root), ['current']);
  assert.equal(await fs.readFile(path.join(root, 'current', 'manifest.json'), 'utf8'), '{}');
});
