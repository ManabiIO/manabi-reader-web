/* SPDX-License-Identifier: GPL-3.0-or-later */
/** Build-time only. Reader serves static output; this process never handles user books. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('..', import.meta.url));
const lock = JSON.parse(await fs.readFile(path.join(root, 'apps/web/src/lib/dictionary/runtime-lock.json'), 'utf8'));
if (lock.repository !== 'ManabiIO/manabitan' || !/^[a-f0-9]{40}$/.test(lock.revision) || /^0+$/.test(lock.revision)) throw new Error('Pin a tested ManabiTan source commit before building Reader');
const destination = path.join(root, 'apps/web/static/vendor/manabitan', lock.revision);
const sha = (data) => createHash('sha256').update(data).digest('hex');
async function verify(dir) {
  const m = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  if (m.package !== 'manabitan-web' || m.apiVersion !== lock.apiVersion || m.revision !== lock.revision || !Array.isArray(m.assets) || !m.assets.length || m.assets.length > 1024) throw new Error('ManabiTan artifact does not match the pinned runtime');
  const names = new Set(); let total = 0;
  for (const a of m.assets) {
    if (typeof a.path !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(a.path) || a.path.split('/').some((p) => !p || p === '.' || p === '..') || names.has(a.path)) throw new Error('Unsafe runtime asset path');
    names.add(a.path);
    const filename = path.join(dir, a.path);
    if (!(await fs.lstat(filename)).isFile()) throw new Error('Runtime assets must be regular files');
    const data = await fs.readFile(filename); total += data.length;
    if (data.length > 32 * 1024 * 1024 || total > 100 * 1024 * 1024 || data.length !== a.bytes || sha(data) !== a.sha256) throw new Error(`Runtime asset integrity failed: ${a.path}`);
  }
  return m;
}
let manifest;
try { manifest = await verify(destination); } catch { /* Never reuse mismatched assets. */ }
if (!manifest) {
  let artifact = process.env.MANABITAN_ARTIFACT;
  if (!artifact) {
    const source = process.env.MANABITAN_SOURCE ?? path.join(root, '.cache/manabitan-source', lock.revision);
    if (!process.env.MANABITAN_SOURCE) {
      await fs.mkdir(source, { recursive: true });
      try { await fs.access(path.join(source, '.git')); }
      catch {
        execFileSync('git', ['init', source], { stdio: 'inherit' });
        execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/ManabiIO/manabitan.git'], { cwd: source, stdio: 'inherit' });
        execFileSync('git', ['fetch', '--depth=1', 'origin', lock.revision], { cwd: source, stdio: 'inherit' });
        execFileSync('git', ['checkout', '--detach', lock.revision], { cwd: source, stdio: 'inherit' });
      }
    }
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
    if (revision !== lock.revision) throw new Error('ManabiTan source does not match the lock');
    execFileSync('npm', ['ci'], { cwd: source, stdio: 'inherit' });
    execFileSync('npm', ['run', 'build:libs'], { cwd: source, stdio: 'inherit' });
    execFileSync(process.execPath, ['web/build.mjs'], { cwd: source, stdio: 'inherit' });
    artifact = path.join(source, 'builds/manabitan-web');
  }
  manifest = await verify(artifact);
  const stage = destination + '.preparing';
  await fs.rm(stage, { force: true, recursive: true }); await fs.mkdir(stage, { recursive: true });
  for (const a of manifest.assets) {
    const target = path.join(stage, a.path); await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(artifact, a.path), target);
  }
  await fs.copyFile(path.join(artifact, 'manifest.json'), path.join(stage, 'manifest.json'));
  await fs.rm(destination, { force: true, recursive: true }); await fs.rename(stage, destination);
}
const dictionary = manifest.defaultDictionary;
if (!dictionary || dictionary.name !== 'Jitendex' || !/^[A-Za-z0-9._-]+\.zip$/.test(dictionary.fileName) ||
    !Number.isSafeInteger(dictionary.bytes) || dictionary.bytes <= 0 || dictionary.bytes > 64 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(dictionary.sha256) ||
    !String(dictionary.source).startsWith('https://github.com/stephenmk/stephenmk.github.io/releases/download/')) throw new Error('Missing verified default dictionary manifest');
const archiveDir = path.join(root, 'apps/web/static/dictionary-archives'); await fs.mkdir(archiveDir, { recursive: true });
const archivePath = path.join(archiveDir, dictionary.fileName);
let valid = false;
try { const data = await fs.readFile(archivePath); valid = data.length === dictionary.bytes && sha(data) === dictionary.sha256; } catch { /* Download the exact release below. */ }
if (!valid) {
  const input = process.env.JITENDEX_ARCHIVE;
  const target = archivePath + '.preparing';
  try {
    if (input) await fs.copyFile(input, target);
    else {
      const response = await fetch(dictionary.source, { signal: AbortSignal.timeout(180000) });
      if (!response.ok || !response.body) throw new Error(`Jitendex download failed: ${response.status}`);
      const file = await fs.open(target, 'w'); let bytes = 0;
      try {
        for await (const chunk of response.body) {
          bytes += chunk.byteLength;
          if (bytes > dictionary.bytes) throw new Error('Default dictionary exceeds the pinned size');
          await file.write(chunk);
        }
      } finally { await file.close(); }
    }
    const data = await fs.readFile(target);
    if (data.length !== dictionary.bytes || sha(data) !== dictionary.sha256) throw new Error('Default dictionary release integrity failed');
    await fs.rename(target, archivePath);
  } finally { await fs.rm(target, { force: true }); }
}
console.log(`Static dictionary runtime ${lock.revision} and verified Jitendex are ready; neither belongs to shell precaching.`);
