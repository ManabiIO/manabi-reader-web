/** @license BSD-3-Clause */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ensureDictionaryRepository } from './dictionary-source.mjs';
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const version = JSON.parse(
  await fs.readFile(path.join(root, 'apps/web/src/lib/search/manabitan-version.json'), 'utf8')
);
if (version.repository !== 'ManabiIO/manabitan' || !/^[a-f0-9]{40}$/.test(version.revision))
  throw new Error('Invalid pinned dictionary source.');
const assets = path.join(root, 'apps/web/static');
const destination = path.join(assets, 'manabitan', version.revision);
const cache = path.join(root, '.cache/dictionary-build', version.revision);
const run = (program, args, cwd) =>
  execFileSync(program, args, { cwd, stdio: 'inherit', timeout: 600000 });
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
async function valid() {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(destination, 'manifest.json'), 'utf8'));
    if (
      manifest.revision !== version.revision ||
      manifest.searchVersion !== 1 ||
      manifest.apiVersion !== 1
    )
      return false;
    for (const item of manifest.assets) {
      if (
        typeof item.path !== 'string' ||
        path.isAbsolute(item.path) ||
        item.path.split('/').includes('..')
      )
        return false;
      const bytes = await fs.readFile(path.join(destination, item.path));
      if (
        bytes.byteLength !== item.bytes ||
        createHash('sha256').update(bytes).digest('hex') !== item.sha256
      )
        return false;
    }
    await fs.access(path.join(destination, 'corresponding-source.tar.gz'));
    await fs.access(path.join(destination, 'SOURCE.txt'));
    return manifest;
  } catch {
    return false;
  }
}
await fs.mkdir(cache, { recursive: true });
let manifest = await valid();
if (!manifest) {
  const source = await ensureDictionaryRepository(
    process.env.MANABITAN_SOURCE
      ? path.resolve(process.env.MANABITAN_SOURCE)
      : path.join(cache, 'source'),
    !process.env.MANABITAN_SOURCE
  );
  if (!process.env.MANABITAN_SOURCE) {
    let current;
    try {
      current = git(['rev-parse', 'HEAD'], source);
    } catch {
      /* Initial checkout. */
    }
    if (current !== version.revision) {
      run(
        'git',
        ['fetch', '--depth=1', 'https://github.com/ManabiIO/manabitan.git', version.revision],
        source
      );
      run('git', ['checkout', '--detach', version.revision], source);
    }
  }
  if (
    git(['rev-parse', 'HEAD'], source) !== version.revision ||
    git(['status', '--porcelain', '--untracked-files=normal'], source)
  )
    throw new Error('Dictionary source must be the exact clean pinned commit.');
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], source);
  run('npm', ['run', 'build:libs'], source);
  run(process.execPath, ['web/build.mjs'], source);
  const built = path.join(source, 'builds/manabitan-web');
  const builtManifest = JSON.parse(await fs.readFile(path.join(built, 'manifest.json'), 'utf8'));
  if (builtManifest.revision !== version.revision || builtManifest.searchVersion !== 1)
    throw new Error('Built runtime does not implement the required search contract.');
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(built, destination, { recursive: true });
  // Distribute corresponding source and build instructions with the GPL runtime.
  run(
    'git',
    [
      'archive',
      '--format=tar.gz',
      `--output=${path.join(destination, 'corresponding-source.tar.gz')}`,
      version.revision
    ],
    source
  );
  await fs.writeFile(
    path.join(destination, 'SOURCE.txt'),
    `Manabitan ${version.revision}\nhttps://github.com/ManabiIO/manabitan/tree/${version.revision}\nGPL-3.0-or-later; retain LICENSE and per-file notices.\nCorresponding source: corresponding-source.tar.gz\nBuild: npm ci; npm run build:libs; node web/build.mjs\n`
  );
  manifest = await valid();
  if (!manifest) throw new Error('Dictionary output failed integrity verification.');
}
// Keep the released web archive URL and provide a byte-identical suffix which
// Android asset packaging preserves. APK qualification requires this actual file.
await fs.copyFile(
  path.join(destination, 'corresponding-source.tar.gz'),
  path.join(destination, 'corresponding-source.tgz')
);
await fs.writeFile(
  path.join(destination, 'SOURCE.txt'),
  `Manabitan ${version.revision}\nhttps://github.com/ManabiIO/manabitan/tree/${version.revision}\nGPL-3.0-or-later; retain LICENSE and per-file notices.\nCorresponding source: corresponding-source.tgz\nWeb compatibility URL: corresponding-source.tar.gz (identical gzip bytes)\nBuild: npm ci; npm run build:libs; node web/build.mjs\n`
);
// A static archive is available for explicit user setup. It is NOT fetched by
// opening Reader/search and is excluded from shell service-worker caching.
const dictionary = manifest.defaultDictionary;
if (
  !/^[a-zA-Z0-9._-]+\.zip$/.test(dictionary.fileName) ||
  !/^[a-f0-9]{64}$/.test(dictionary.sha256)
)
  throw new Error('Invalid dictionary descriptor.');
const archives = path.join(assets, 'dictionary-archives');
await fs.mkdir(archives, { recursive: true });
const archivePath = path.join(archives, dictionary.fileName);
const matches = (bytes) =>
  bytes.byteLength === dictionary.bytes &&
  createHash('sha256').update(bytes).digest('hex') === dictionary.sha256;
let existing;
try {
  existing = await fs.readFile(archivePath);
} catch {
  /* First build. */
}
if (!existing || !matches(existing)) {
  const source = new URL(dictionary.source);
  if (
    source.protocol !== 'https:' ||
    source.hostname !== 'github.com' ||
    source.username ||
    source.password
  )
    throw new Error('Unapproved default dictionary source.');
  const response = await fetch(source, {
    signal: AbortSignal.timeout(120000),
    credentials: 'omit'
  });
  if (!response.ok || !response.body)
    throw new Error('Could not fetch the pinned default dictionary.');
  const reader = response.body.getReader(),
    chunks = [];
  let count = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > dictionary.bytes) throw new Error('Default dictionary exceeds its pinned size.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks);
  if (!matches(bytes)) throw new Error('Default dictionary checksum mismatch.');
  const temporary = `${archivePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, bytes);
  await fs.rename(temporary, archivePath);
}
console.log(
  `Prepared lazy dictionary runtime ${version.revision}; no user dictionaries are installed at build time.`
);
