/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readerEdition } from '../../config/reader-editions.mjs';
import { stageReaderAssets, trashGenerated } from '../../scripts/stage-reader-assets.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reader-editions-'));
  t.after(() => trashGenerated(root));
  const source = path.join(root, 'apps/web/static');
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(source, 'manifest.webmanifest'), '{}');
  await fs.writeFile(path.join(source, 'appearance-init.js'), 'localStorage.getItem(key)');
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', 'apps'], { cwd: root });
  async function provider(id) {
    const revision = id === 'manabi' ? 'b'.repeat(40) : 'a'.repeat(40);
    const relative = `${id}/${revision}`;
    const directory = path.join(source, relative);
    await fs.mkdir(directory, { recursive: true });
    const bytes = `// synthetic ${id} fixture; no implementation`;
    await fs.writeFile(path.join(directory, 'entry.js'), bytes);
    await fs.writeFile(
      path.join(directory, 'manifest.json'),
      JSON.stringify({
        revision,
        assets: [{ path: 'entry.js', bytes: Buffer.byteLength(bytes), sha256: digest(bytes) }]
      })
    );
    await fs.writeFile(
      path.join(directory, 'reader-runtime.json'),
      JSON.stringify({ provider: id, revision })
    );
    return { id, revision, publicRuntimeDirectory: id, requiredDistributionFiles: [] };
  }
  return { root, source, provider, output: path.join(root, 'apps/web/public') };
}
test('edition identity is explicit and unknown builds fail', () => {
  assert.equal(readerEdition('manabitan').basePath, '/manabitan-reader');
  assert.equal(readerEdition('manabi').basePath, '/reader-web');
  assert.notEqual(
    readerEdition('manabi').storageNamespace,
    readerEdition('manabitan').storageNamespace
  );
  assert.throws(() => readerEdition('preview'), /Unknown/);
});
test('alternating editions with stale assets publishes only the selected provider', async (t) => {
  const f = await fixture(t);
  const providers = {
    manabi: await f.provider('manabi'),
    manabitan: await f.provider('manabitan')
  };
  await fs.mkdir(path.join(f.source, 'dictionary-archives'));
  await fs.writeFile(path.join(f.source, 'dictionary-archives/stale.zip'), 'old archive');
  for (const id of ['manabitan', 'manabi', 'manabitan']) {
    await stageReaderAssets({ root: f.root, edition: readerEdition(id), provider: providers[id] });
    const files = await fs.readdir(f.output);
    assert(files.includes(id));
    assert(!files.includes(id === 'manabi' ? 'manabitan' : 'manabi'));
    assert(!files.includes('dictionary-archives'));
    const metadata = JSON.parse(await fs.readFile(path.join(f.output, 'reader-edition.json')));
    assert.equal(metadata.edition, id);
    assert.equal(
      JSON.parse(await fs.readFile(path.join(f.output, 'manifest.webmanifest'))).name,
      readerEdition(id).name
    );
    assert(
      (await fs.readFile(path.join(f.output, 'appearance-init.js'), 'utf8')).includes(
        readerEdition(id).storageNamespace
      )
    );
  }
});
test('corrupt or linked provider assets cannot replace the previous usable staging', async (t) => {
  const f = await fixture(t),
    provider = await f.provider('manabi');
  const options = { root: f.root, edition: readerEdition('manabi'), provider };
  await stageReaderAssets(options);
  const entry = path.join(f.source, provider.publicRuntimeDirectory, provider.revision, 'entry.js');
  await fs.writeFile(entry, 'corrupt');
  await assert.rejects(stageReaderAssets(options), /integrity/);
  assert(
    (
      await fs.readFile(path.join(f.output, 'manabi', provider.revision, 'entry.js'), 'utf8')
    ).includes('synthetic')
  );
  await fs.rename(entry, `${entry}.preserved`);
  await fs.symlink(`${entry}.preserved`, entry);
  await assert.rejects(stageReaderAssets(options), /regular files/);
});
