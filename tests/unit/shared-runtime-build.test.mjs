/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildSharedRuntime,
  runtimeModules
} from '../../test/expo/shared-storage-runtime-build.mjs';

test('isolated shared-storage fixture mounts real React owners and reexports one production module graph', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shared-runtime-'));
  try {
    const meta = await buildSharedRuntime(directory);
    const inputs = Object.keys(meta.inputs);
    for (const source of [
      ...Object.keys(runtimeModules),
      'library-react/screen.tsx',
      'runtime/BrowserRuntime.tsx'
    ])
      assert.equal(inputs.filter((input) => input === `apps/web/src/${source}`).length, 1, source);
    assert.equal(
      inputs.some((input) => /\.svelte(?:\.|$)|node_modules\/vite\//.test(input)),
      false
    );
    const script = Object.entries(meta.outputs).find(([output]) =>
      output.endsWith('/shared-runtime.js')
    )[1];
    assert.deepEqual(script.exports.sort(), Object.values(runtimeModules).flat().sort());
    for (const [source, names] of Object.entries(runtimeModules))
      assert.equal(
        await fs.readFile(path.join(directory, 'src', source), 'utf8'),
        `export { ${names.join(', ')} } from '/reader-web/shared-runtime.js';\n`
      );
    for (const file of [
      'test_shared_safety.py',
      'test_library_deletion.py',
      'test_book_save_cancellation.py',
      'test_book_last_read.py',
      'test_library_open_commit.py'
    ]) {
      const source = await fs.readFile(new URL(`../browser/${file}`, import.meta.url), 'utf8');
      for (const [, module] of source.matchAll(/import\('\/reader-web\/src\/([^']+)'\)/g))
        assert.ok(Object.hasOwn(runtimeModules, module), `${file} imports ${module}`);
    }
    const html = await fs.readFile(path.join(directory, 'manage.html'), 'utf8');
    assert.equal(html.match(/id="root"/g).length, 1);
    assert.equal(html.match(/<script /g).length, 1);
    assert.match(html, /type="module" src="\/reader-web\/shared-runtime\.js"/);
    assert.match(html, /href="\/reader-web\/shared-runtime\.css"/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
