/** @license BSD-3-Clause */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readerEdition } from '../config/reader-editions.mjs';
import { selectedDictionaryProvider } from './dictionary-provider-selection.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));

export async function verifyReaderEdition(directory, edition, provider) {
  const output = await fs.realpath(directory);
  const metadata = JSON.parse(await fs.readFile(path.join(output, 'reader-product.json'), 'utf8'));
  const identity = JSON.parse(await fs.readFile(path.join(output, 'reader-edition.json'), 'utf8'));
  if (
    JSON.stringify(Object.keys(identity).sort()) !==
      JSON.stringify(['basePath', 'edition', 'provider', 'schema']) ||
    identity.schema !== 1 ||
    identity.edition !== metadata.edition ||
    identity.provider !== metadata.provider ||
    identity.basePath !== metadata.basePath
  )
    throw new Error('Reader publication identity mismatch.');
  if (
    metadata.schema !== 1 ||
    metadata.edition !== edition.id ||
    metadata.name !== edition.name ||
    metadata.storageNamespace !== edition.storageNamespace ||
    metadata.provider !== provider.id ||
    metadata.providerRevision !== provider.revision ||
    metadata.basePath !== (process.env.BASE_PATH ?? edition.basePath)
  )
    throw new Error('Mixed Reader edition, provider or base path.');
  const runtime = `${provider.publicRuntimeDirectory}/${provider.revision}/`;
  const manifest = JSON.parse(
    await fs.readFile(path.join(output, runtime, 'manifest.json'), 'utf8')
  );
  const assets = new Map((manifest.assets ?? []).map((asset) => [runtime + asset.path, asset]));
  const expectedRuntime = new Set([
    ...assets.keys(),
    runtime + 'manifest.json',
    runtime + 'reader-runtime.json',
    ...provider.requiredDistributionFiles.map((file) => runtime + file)
  ]);
  const files = [];
  async function walk(directory, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute, relative + '/');
      else if (entry.isFile()) {
        if (edition.id === 'manabi' && relative.endsWith('.map'))
          throw new Error('Source maps must not enter the private product artifact.');
        if (relative.startsWith(runtime) && !expectedRuntime.has(relative))
          throw new Error(`Undeclared provider asset: ${relative}`);
        if (edition.id === 'manabi' && /^(?:manabitan|dictionary-runtime)\//i.test(relative))
          throw new Error('Unselected dictionary implementation entered the private artifact.');
        const bytes = await fs.readFile(absolute);
        if (
          edition.id === 'manabi' &&
          /\.[cm]?js$/.test(relative) &&
          /\bManabiTanWebClient\b/.test(bytes.toString('utf8'))
        )
          throw new Error(
            'Unselected dictionary implementation entered the private JavaScript graph.'
          );
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const expected = assets.get(relative);
        if (expected && (bytes.length !== expected.bytes || sha256 !== expected.sha256))
          throw new Error(`Provider artifact integrity failure: ${relative}`);
        assets.delete(relative);
        files.push({ path: relative, bytes: bytes.length, sha256 });
      } else throw new Error('Product artifacts must contain only regular files.');
    }
  }
  await walk(output);
  if (assets.size) throw new Error('Product artifact is missing declared provider assets.');
  const html = await fs.readFile(path.join(output, 'index.html'), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="(\/[^"\s]*)"/g))
    if (!match[1].startsWith(`${metadata.basePath}/`))
      throw new Error('Product HTML contains assets from a different deployment base.');
  if (!html.includes(edition.name) || !html.includes(`${metadata.basePath}/appearance-init.js`))
    throw new Error('Product HTML does not match its edition.');
  const pwa = JSON.parse(await fs.readFile(path.join(output, 'manifest.webmanifest'), 'utf8'));
  if (pwa.name !== edition.name) throw new Error('Product PWA identity mismatch.');
  return { schema: 1, ...metadata, assets: files.sort((a, b) => a.path.localeCompare(b.path)) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyReaderEdition(
    path.join(root, 'apps/web/build'),
    readerEdition(),
    await selectedDictionaryProvider(root)
  );
  console.log(`Verified ${result.edition} with ${result.assets.length} declared product files.`);
}
