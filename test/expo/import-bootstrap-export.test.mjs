/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../', import.meta.url));
test('real postbuild emits the early picker only for import and versions its offline HTML', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'manabi-import-postbuild-'));
  try {
    await fs.mkdir(path.join(temp, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(temp, 'apps/web/build'), { recursive: true });
    await fs.mkdir(path.join(temp, 'apps/web/src/platform'), { recursive: true });
    await fs.writeFile(path.join(temp, 'package.json'), '{"type":"module"}');
    await fs.symlink(path.join(root, 'node_modules'), path.join(temp, 'node_modules'));
    await fs.symlink(path.join(root, 'apps/web/src/lib'), path.join(temp, 'apps/web/src/lib'));
    for (const file of [
      'scripts/expo-postbuild.mjs',
      'scripts/import-bootstrap.mjs',
      'apps/web/src/platform/content-security-policy.mjs'
    ])
      await fs.copyFile(path.join(root, file), path.join(temp, file));
    const original =
      '<!doctype html><html><head><title>Reader fixture</title></head><body><div id="root"></div><script src="/reader-web/_expo/static/js/web/entry-fixture.js"></script></body></html>';
    const run = async () => {
      await fs.writeFile(path.join(temp, 'apps/web/build/index.html'), original);
      execFileSync(process.execPath, [path.join(temp, 'scripts/expo-postbuild.mjs')], {
        cwd: temp,
        env: { ...process.env, BASE_PATH: '/reader-web' },
        stdio: 'pipe'
      });
      return JSON.parse(
        await fs.readFile(path.join(temp, 'apps/web/build/expo-build-manifest.json'), 'utf8')
      );
    };
    const first = await run();
    for (const route of [...first.routes, '404']) {
      const html = await fs.readFile(
        path.join(temp, 'apps/web/build', route ? `${route}.html` : 'index.html'),
        'utf8'
      );
      assert.equal(
        html.includes('id="manabi-import-bootstrap"'),
        route === 'import-ttu',
        route || 'index'
      );
      assert.equal(html.match(/id="root"/g)?.length, 1);
      assert.match(html, /Content-Security-Policy/);
      assert.match(html, /_expo\/static\/js\/web\/entry-fixture\.js/);
    }
    assert.ok(first.config.files.includes('/reader-web/import-ttu.html'));
    assert.ok(first.config.prerendered.includes('/reader-web/import-ttu'));
    const helper = path.join(temp, 'scripts/import-bootstrap.mjs');
    await fs.writeFile(
      helper,
      (await fs.readFile(helper, 'utf8')).replace(
        'Starting the importer.',
        'Starting the updated importer.'
      )
    );
    const second = await run();
    assert.notEqual(
      second.config.version,
      first.config.version,
      'a bootstrap-only HTML change invalidates the offline shell'
    );
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
