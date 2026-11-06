/** @license BSD-3-Clause */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { safeRelativePath } from './dictionary-generated-paths.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Deterministic edition transforms; final export checks use the source bytes. */
export function editionStaticBytes(name, bytes, edition) {
  if (name === 'manifest.webmanifest') {
    const manifest = JSON.parse(bytes.toString('utf8'));
    return Buffer.from(
      JSON.stringify({ ...manifest, name: edition.name, short_name: edition.name }, null, 2) + '\n'
    );
  }
  if (name === 'appearance-init.js') {
    const source = bytes.toString('utf8');
    if (!source.includes('localStorage.getItem(key)'))
      throw new Error('Appearance bootstrap no longer exposes its reviewed storage boundary.');
    return Buffer.from(
      source.replace(
        'localStorage.getItem(key)',
        `localStorage.getItem(${JSON.stringify(edition.storageNamespace + ':')} + key)`
      )
    );
  }
  return bytes;
}
export async function trashGenerated(directory) {
  try {
    await fs.lstat(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const parent = await fs.realpath(path.dirname(directory));
  const target = path.join(parent, path.basename(directory));
  if ((await fs.lstat(target)).isSymbolicLink())
    throw new Error('Refusing a symbolic generated directory.');
  await fs.mkdir(path.join(os.homedir(), '.Trash'), { recursive: true });
  const trash = await fs.realpath(path.join(os.homedir(), '.Trash'));
  await fs.rename(target, path.join(trash, `reader-${path.basename(target)}-${randomUUID()}`));
}

/** Copy only tracked public assets and one verified provider's declared output.
 * A previous edition's ignored runtime can never enter the next export. */
export async function stageReaderAssets({ root, edition, provider, video = false }) {
  const app = path.join(root, 'apps/web');
  const source = await fs.realpath(path.join(app, 'static'));
  const tracked = execFileSync('git', ['ls-files', '-z', '--', 'apps/web/static'], {
    cwd: root,
    encoding: 'utf8'
  })
    .split('\0')
    .filter(Boolean)
    .map((file) => file.slice('apps/web/static/'.length))
    .filter((file) => video || !file.startsWith('moss/'));
  const runtime = `${provider.publicRuntimeDirectory}/${provider.revision}`;
  if (!safeRelativePath(runtime)) throw new Error('Invalid provider output root.');
  const manifest = JSON.parse(
    await fs.readFile(path.join(source, runtime, 'manifest.json'), 'utf8')
  );
  const marker = JSON.parse(
    await fs.readFile(path.join(source, runtime, 'reader-runtime.json'), 'utf8')
  );
  if (
    marker.provider !== provider.id ||
    marker.revision !== provider.revision ||
    manifest.revision !== provider.revision ||
    !Array.isArray(manifest.assets)
  )
    throw new Error('Prepared provider does not match this edition.');
  const generated = new Map();
  for (const item of manifest.assets) {
    if (
      !safeRelativePath(item.path) ||
      !Number.isSafeInteger(item.bytes) ||
      item.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(item.sha256) ||
      generated.has(`${runtime}/${item.path}`)
    )
      throw new Error('Invalid provider asset inventory.');
    generated.set(`${runtime}/${item.path}`, item);
  }
  for (const file of [
    'manifest.json',
    'reader-runtime.json',
    ...provider.requiredDistributionFiles
  ]) {
    if (!safeRelativePath(file)) throw new Error('Invalid distribution file.');
    const bytes = await fs.readFile(path.join(source, runtime, file));
    generated.set(`${runtime}/${file}`, { bytes: bytes.length, sha256: sha256(bytes) });
  }
  if (manifest.defaultDictionary) {
    const item = manifest.defaultDictionary;
    if (!/^[A-Za-z0-9._-]+\.zip$/.test(item.fileName)) throw new Error('Invalid default archive.');
    generated.set(`dictionary-archives/${item.fileName}`, item);
  }
  const destination = await fs.mkdtemp(path.join(app, '.reader-public-'));
  try {
    for (const file of new Set([...tracked, ...generated.keys()])) {
      if (!safeRelativePath(file)) throw new Error('Invalid static asset path.');
      const original = path.join(source, file);
      const resolved = await fs.realpath(original);
      if (
        resolved !== original ||
        !resolved.startsWith(source + path.sep) ||
        !(await fs.lstat(original)).isFile()
      )
        throw new Error('Static assets must be regular files.');
      const bytes = await fs.readFile(original);
      const expected = generated.get(file);
      if (expected && (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256))
        throw new Error(`Provider asset integrity failure: ${file}`);
      const output = path.join(destination, file);
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, bytes);
    }
    const manifestPath = path.join(destination, 'manifest.webmanifest');
    await fs.writeFile(
      manifestPath,
      editionStaticBytes('manifest.webmanifest', await fs.readFile(manifestPath), edition)
    );
    const appearance = path.join(destination, 'appearance-init.js');
    await fs.writeFile(
      appearance,
      editionStaticBytes('appearance-init.js', await fs.readFile(appearance), edition)
    );
    await fs.writeFile(
      path.join(destination, 'reader-product.json'),
      JSON.stringify(
        {
          schema: 1,
          edition: edition.id,
          name: edition.name,
          basePath: process.env.BASE_PATH ?? edition.basePath,
          storageNamespace: edition.storageNamespace,
          provider: provider.id,
          providerRevision: provider.revision
        },
        null,
        2
      ) + '\n'
    );
    await fs.writeFile(
      path.join(destination, 'reader-edition.json'),
      JSON.stringify(
        {
          schema: 1,
          edition: edition.id,
          provider: provider.id,
          basePath: process.env.BASE_PATH ?? edition.basePath
        },
        null,
        2
      ) + '\n'
    );
    await trashGenerated(path.join(app, 'public'));
    await fs.rename(destination, path.join(app, 'public'));
  } catch (error) {
    await trashGenerated(destination);
    throw error;
  }
}
