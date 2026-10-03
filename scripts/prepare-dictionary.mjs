/** @license BSD-3-Clause */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { selectedDictionaryProvider } from './dictionary-provider-selection.mjs';
import { pruneGeneratedDirectory, safeRelativePath } from './dictionary-generated-paths.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const provider = await selectedDictionaryProvider(root);
if (
  !provider ||
  !/^[a-z0-9][a-z0-9-]*$/.test(provider.id) ||
  !/^[a-f0-9]{40}$/.test(provider.revision) ||
  !safeRelativePath(provider.publicRuntimeDirectory) ||
  provider.publicRuntimeDirectory.includes('/') ||
  typeof provider.build !== 'function' ||
  !Array.isArray(provider.requiredDistributionFiles) ||
  provider.requiredDistributionFiles.some((file) => !safeRelativePath(file)) ||
  !Array.isArray(provider.obsoletePublicPaths) ||
  provider.obsoletePublicPaths.some(
    (file) =>
      !safeRelativePath(file) ||
      file === provider.publicRuntimeDirectory ||
      file === 'dictionary-archives'
  )
)
  throw new Error('Invalid dictionary provider configuration.');

const assets = path.join(root, 'apps/web/static');
const runtimeRoot = path.join(assets, provider.publicRuntimeDirectory);
const destination = path.join(runtimeRoot, provider.revision);
const cache = path.join(root, '.cache/dictionary-build', provider.id, provider.revision);
const runtimeMarkerName = 'reader-runtime.json';
const runtimeMarker = {
  schema: 1,
  provider: provider.id,
  revision: provider.revision
};

for (const obsolete of provider.obsoletePublicPaths)
  await fs.rm(path.join(assets, obsolete), { recursive: true, force: true });

await pruneGeneratedDirectory(runtimeRoot, new Set([provider.revision]));

async function filesUnder(directory, base = directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await filesUnder(target, base)));
    else if (entry.isFile()) result.push(path.relative(base, target).split(path.sep).join('/'));
    else throw new Error('Dictionary provider output contains a non-file entry.');
  }
  return result;
}

async function valid() {
  try {
    const metadata = await fs.lstat(destination);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) return false;
    const manifest = JSON.parse(await fs.readFile(path.join(destination, 'manifest.json'), 'utf8'));
    const marker = JSON.parse(
      await fs.readFile(path.join(destination, runtimeMarkerName), 'utf8')
    );
    if (
      marker.schema !== runtimeMarker.schema ||
      marker.provider !== runtimeMarker.provider ||
      marker.revision !== runtimeMarker.revision ||
      manifest.revision !== provider.revision ||
      manifest.searchVersion !== 1 ||
      manifest.apiVersion !== 1 ||
      !Array.isArray(manifest.assets)
    )
      return false;

    const manifestPaths = new Set();
    for (const item of manifest.assets) {
      if (
        typeof item.path !== 'string' ||
        !item.path ||
        path.isAbsolute(item.path) ||
        item.path.split('/').includes('..') ||
        manifestPaths.has(item.path) ||
        item.path === runtimeMarkerName ||
        !Number.isSafeInteger(item.bytes) ||
        item.bytes < 0 ||
        !/^[a-f0-9]{64}$/.test(item.sha256)
      )
        return false;
      manifestPaths.add(item.path);
      const bytes = await fs.readFile(path.join(destination, item.path));
      if (
        bytes.byteLength !== item.bytes ||
        createHash('sha256').update(bytes).digest('hex') !== item.sha256
      )
        return false;
    }

    for (const file of provider.requiredDistributionFiles)
      await fs.access(path.join(destination, file));

    const allowed = new Set([
      'manifest.json',
      runtimeMarkerName,
      ...manifestPaths,
      ...provider.requiredDistributionFiles
    ]);
    const actual = await filesUnder(destination);
    if (actual.length !== allowed.size || actual.some((file) => !allowed.has(file))) return false;

    return manifest;
  } catch {
    return false;
  }
}

let manifest = await valid();
if (!manifest) {
  await provider.build({ destination, cache });
  await fs.writeFile(
    path.join(destination, runtimeMarkerName),
    JSON.stringify(runtimeMarker, null, 2) + '\n'
  );
  manifest = await valid();
  if (!manifest) throw new Error('Dictionary provider output failed integrity verification.');
}

// A static archive is available for explicit user setup. It is NOT fetched by
// opening Reader/search and is excluded from shell service-worker caching.
const dictionary = manifest.defaultDictionary;
if (
  !dictionary ||
  !/^[a-zA-Z0-9._-]+\.zip$/.test(dictionary.fileName) ||
  !Number.isSafeInteger(dictionary.bytes) ||
  dictionary.bytes <= 0 ||
  !/^[a-f0-9]{64}$/.test(dictionary.sha256)
)
  throw new Error('Invalid dictionary descriptor.');

const archives = path.join(assets, 'dictionary-archives');
await pruneGeneratedDirectory(archives, new Set([dictionary.fileName]));
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
  `Prepared lazy dictionary provider ${provider.id}@${provider.revision}; no user dictionaries are installed at build time.`
);
