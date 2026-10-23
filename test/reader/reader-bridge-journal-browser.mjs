/** @license BSD-3-Clause */
// Production IndexedDB factory/journal, not a replacement Reader application.
// The companion actual-app jobs still qualify rendering, reading and imports.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, realpath, rename } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from '@playwright/test';

const engine = process.env.JOURNAL_BROWSER || 'chromium';
assert.ok(['chromium', 'webkit'].includes(engine));
const fixtures = await Promise.all(
  [
    'books-schema-cases.mjs',
    'reader-bridge-journal-cases.mjs',
    'reader-bridge-local-book-cases.mjs',
    'reader-bridge-receive-cases.mjs'
  ].map((name) =>
    build({
      entryPoints: [new URL(name, import.meta.url).pathname],
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'fixture',
      platform: 'browser',
      alias: { $lib: new URL('../../apps/web/src/lib', import.meta.url).pathname }
    })
  )
);
const server = createServer((_request, response) => {
  response.setHeader('content-type', 'text/html');
  response.end('<!doctype html><title>Reader sync recovery</title>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser, context, profile;
// Historical fixtures contain legacy Blob rows. A persistent browser profile
// exercises ordinary durable storage; WebKit private storage has separate Blob
// limitations covered by the book-save tests. Never reuse a user's profile.
try {
  profile = await mkdtemp(path.join(await realpath(tmpdir()), 'reader-sync-recovery-'));
  context = await { chromium, webkit }[engine].launchPersistentContext(profile, {
    headless: true,
    ...(engine === 'chromium' && process.platform === 'darwin'
      ? { args: ['--disable-features=MacAppCodeSignClone'] }
      : {})
  });
  browser = context.browser();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  let count = 0;
  for (const fixture of fixtures) {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.addScriptTag({ content: fixture.outputFiles[0].text });
    for (const name of await page.evaluate(() => globalThis.fixture.caseNames)) {
      const outcome = await page.evaluate(async (name) => {
        let timeout;
        try {
          return await Promise.race([
            globalThis.fixture.runCase(name),
            new Promise((_, reject) => {
              timeout = setTimeout(() => reject(new Error(`Timed out: ${name}`)), 20000);
            })
          ]);
        } finally {
          clearTimeout(timeout);
        }
      }, name);
      assert.equal(outcome.state, 'passed', name);
      count++;
    }
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  }
  assert.deepEqual(errors, []);
  console.log(`${engine}: ${count} native IndexedDB schema/recovery cases passed.`);
} finally {
  try {
    await context?.close();
  } finally {
    try {
      await browser?.close();
    } finally {
      await new Promise((resolve) => server.close(resolve));
      if (profile) {
        const trash = path.join(await realpath(homedir()), '.Trash');
        await mkdir(trash, { recursive: true });
        await rename(
          profile,
          path.join(
            await realpath(trash),
            `${path.basename(profile)}-${globalThis.crypto.randomUUID()}`
          )
        );
      }
    }
  }
}
