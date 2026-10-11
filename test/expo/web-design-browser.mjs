/** @license BSD-3-Clause */
// Web-only qualification against an already exported, locally served Expo app.
// MANABI_WEB_EVIDENCE must point outside the repository. No account traffic is allowed.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit } from '@playwright/test';

const origin = process.env.MANABI_WEB_PREVIEW_URL || 'http://127.0.0.1:4183';
assert.equal(new URL(origin).hostname, '127.0.0.1');
const output = path.resolve(process.env.MANABI_WEB_EVIDENCE || '../evidence');
const repository = path.resolve('.');
assert.ok(!output.startsWith(repository + path.sep), 'Keep generated pixels out of Git');
await mkdir(output, { recursive: true });
const results = [];
const book = {
  name: '春の読書.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from('春の読書\n\n日本語の本を読みます。今日は暖かい一日です。\n'.repeat(60))
};

async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(overflow <= 1, `${name}: ${overflow}px horizontal page overflow`);
  await page.screenshot({
    path: path.join(output, name + '.png'),
    fullPage: true,
    animations: 'disabled'
  });
  results.push({ name, overflow });
}

async function qualify(engine, width, appearance, full) {
  const browser = await engine.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      colorScheme: appearance
    });
    await context.addInitScript((mode) => localStorage.setItem('appearance', mode), appearance);
    await context.route('**/*', (route) =>
      new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()
    );
    const page = await context.newPage();
    const suffix = `${width}-${appearance}${full ? '' : '-webkit'}`;
    await page.goto(origin + '/reader-web/manage');
    await page.getByText('No books in your library', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Try Again', exact: true }).waitFor();
    await capture(page, 'after-empty-' + suffix);
    if (width < 768) {
      const trigger = page.getByRole('button', { name: 'Collections', exact: true });
      assert.ok((await trigger.boundingBox()).width >= 44);
      await trigger.click();
      const modal = page.locator('dialog[open]');
      await modal.waitFor();
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Edit');
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('Tab');
        assert.ok(await page.evaluate(() => !!document.activeElement.closest('dialog[open]')));
      }
      await capture(page, 'after-collections-' + suffix);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('dialog[open]').count(), 0);
      assert.equal(
        await page.evaluate(() => document.activeElement.getAttribute('aria-label')),
        'Collections'
      );
      await trigger.click();
      await page.getByRole('button', { name: 'Close collections', exact: true }).click();
      assert.equal(await page.locator('dialog[open]').count(), 0);
    } else {
      assert.ok(await page.locator('.library-rail').isVisible());
      await page.getByRole('button', { name: 'New Collection…', exact: true }).click();
      await page.locator('dialog[open]').waitFor();
      await capture(page, 'after-collections-' + suffix);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('dialog[open]').count(), 0);
    }
    await page.locator('input[type=file][multiple]').first().setInputFiles(book);
    await page.getByText('春の読書', { exact: true }).first().waitFor();
    await capture(page, 'after-populated-' + suffix);
    if (full) {
      await page.goto(origin + '/reader-web/settings');
      await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
      await capture(page, 'after-settings-' + suffix);
      await page.goto(origin + '/reader-web/import-ttu');
      await page
        .getByRole('heading', { name: 'Import from Ttu Ebook Reader', exact: true })
        .waitFor();
      await capture(page, 'after-import-' + suffix);
    }
    await context.close();
  } finally {
    await browser.close();
    await writeFile(path.join(output, 'browser-checks.json'), JSON.stringify(results, null, 2));
  }
}

for (const appearance of ['light', 'dark']) {
  for (const width of [320, 390, 820, 1440]) await qualify(chromium, width, appearance, true);
}
for (const width of [390, 1440]) await qualify(webkit, width, 'light', false);
console.log(
  JSON.stringify({ captures: results.length, engines: ['Chromium', 'WebKit'], results }, null, 2)
);
