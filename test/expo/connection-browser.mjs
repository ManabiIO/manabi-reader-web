/** @license BSD-3-Clause */
// Real exported app, native IndexedDB and service worker. Device-offline emulation
// is a browser test, not Windows installation or physical Android acceptance.
import assert from 'node:assert/strict';
import { realpath, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit, expect } from '@playwright/test';

const origin = process.env.MANABI_WEB_PREVIEW_URL ?? 'http://127.0.0.1:4197';
assert.equal(new URL(origin).hostname, '127.0.0.1');
assert.ok(process.env.MANABI_WEB_EVIDENCE, 'Choose a fresh evidence directory outside Git');
const output = await realpath(process.env.MANABI_WEB_EVIDENCE);
const repository = await realpath(new URL('../../', import.meta.url));
assert.ok(!output.startsWith(repository + path.sep) && output !== repository);
const results = [];
const launch = (engine) => ({
  headless: true,
  ...(engine === chromium && process.platform === 'darwin'
    ? { args: ['--disable-features=MacAppCodeSignClone'] }
    : {})
});
const book = {
  name: 'オフライン読書.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from('日本語の本を読みます。今日は暖かい一日です。\n'.repeat(120))
};

async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  assert.ok(overflow <= 1, `${name}: horizontal overflow ${overflow}`);
  await page.screenshot({ path: path.join(output, name + '.png'), animations: 'disabled' });
}

async function matrix(engine, width, mode, enlarged = false) {
  const browser = await engine.launch(launch(engine));
  let context;
  const name = `${engine.name()}-${width}-${mode}${enlarged ? '-large-text' : ''}`;
  try {
    context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: mode });
    await context.route('**/*', (route) =>
      new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()
    );
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin + '/reader-web/manage');
    await expect(page.getByText('No books in your library', { exact: true })).toBeVisible();
    if (enlarged) await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
    const notice = page.getByRole('button', { name: /Connection details$/ });
    await expect(notice).toHaveCount(0);
    await page.locator('input[type=file][multiple]').first().setInputFiles(book);
    await expect(page.getByText('オフライン読書', { exact: true }).first()).toBeVisible();
    if (!enlarged) {
      const rail = page.locator('.library-rail');
      if (width >= 768) await expect(rail).toBeVisible();
      else await expect(rail).toBeHidden();
    }
    await capture(page, name + '-online');
    await context.setOffline(true);
    await expect(notice).toBeVisible();
    const box = await notice.boundingBox();
    assert.ok(box.height >= 44 && box.width >= 44 && box.x >= 0 && box.x + box.width <= width + 1);
    await capture(page, name + '-offline');
    await notice.click();
    const dialog = page.getByRole('dialog', { name: 'Reading on this device' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Reading progress is saved on this device');
    await expect(dialog).toContainText('doesn’t mean everything has synced');
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      assert.ok(await page.evaluate(() => !!document.activeElement?.closest('dialog[open]')));
    }
    await capture(page, name + '-details');
    if (enlarged) {
      await dialog.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      const close = page.getByRole('button', { name: 'Close connection details' });
      const closeBox = await close.boundingBox();
      assert.ok(closeBox.y >= 0 && closeBox.y + closeBox.height <= 900);
      await capture(page, name + '-details-scrolled');
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(notice).toBeFocused();
    await notice.click();
    await context.setOffline(false);
    await expect(dialog).toContainText('Your device is connected');
    await page.getByRole('button', { name: 'Close connection details' }).click();
    await expect(notice).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(notice).toHaveCount(0);
    assert.deepEqual(errors, []);
    results.push({ name, status: 'pass' });
  } catch (error) {
    results.push({ name, status: 'fail', error: String(error) });
    throw error;
  } finally {
    try {
      if (context) await context.close();
    } finally {
      await browser.close();
    }
    await writeFile(path.join(output, 'connection-results.json'), JSON.stringify(results, null, 2));
  }
}

async function offlineRestart() {
  const profile = await mkdtemp(path.join(output, 'offline-profile-'));
  const options = { ...launch(chromium), viewport: { width: 1024, height: 800 } };
  let context;
  const blockRemote = (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort();
  try {
    context = await chromium.launchPersistentContext(profile, options);
    await context.route('**/*', blockRemote);
    const page = await context.newPage();
    await page.goto(origin + '/reader-web/manage');
    await page.locator('input[type=file][multiple]').first().setInputFiles(book);
    await expect(page.getByText('オフライン読書', { exact: true }).first()).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await context.close();
    context = undefined;
    context = await chromium.launchPersistentContext(profile, { ...options, offline: true });
    await context.route('**/*', blockRemote);
    const reopened = await context.newPage();
    const response = await reopened.goto(origin + '/reader-web/manage');
    assert.ok(response.fromServiceWorker());
    await expect(reopened.getByRole('button', { name: /Connection details$/ })).toBeVisible();
    await reopened.getByText('オフライン読書', { exact: true }).first().click();
    const notNow = reopened.getByRole('button', { name: 'Not now', exact: true });
    if (await notNow.isVisible()) await notNow.click();
    await expect(reopened.locator('.react-reader-book-reader')).toContainText(
      '日本語の本を読みます'
    );
    await expect(reopened.locator('.react-reader-session .fixed.inset-0.text-7xl')).toHaveCount(0);
    await capture(reopened, 'chromium-offline-restart-reader');
    const notice = reopened.getByRole('button', { name: /Connection details$/ });
    assert.equal(
      await notice.evaluate((node) => window.getComputedStyle(node).writingMode),
      'horizontal-tb'
    );
    await notice.click();
    const dialog = reopened.getByRole('dialog', { name: 'Reading on this device' });
    await expect(dialog).toBeVisible();
    assert.equal(
      await dialog.evaluate((node) => window.getComputedStyle(node).writingMode),
      'horizontal-tb'
    );
    await capture(reopened, 'chromium-offline-restart-details');
    await reopened.keyboard.press('Escape');
    await expect(notice).toBeFocused();
    await reopened.getByRole('button', { name: 'Library', exact: true }).click();
    await reopened
      .locator('input[type=file][multiple]')
      .first()
      .setInputFiles({
        name: '保存の確認.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('接続がなくても新しい本を保存します。\n'.repeat(30))
      });
    await expect(reopened.getByText('保存の確認', { exact: true }).first()).toBeVisible();
    await reopened.reload();
    await expect(reopened.getByText('保存の確認', { exact: true }).first()).toBeVisible();
    results.push({ name: 'chromium-persistent-offline-restart', status: 'pass' });
  } finally {
    if (context) await context.close();
    await writeFile(path.join(output, 'connection-results.json'), JSON.stringify(results, null, 2));
  }
}

for (const engine of [chromium, webkit]) {
  for (const [width, mode, enlarged] of [
    [390, 'light', false],
    [820, 'light', false],
    [1440, 'dark', false],
    [320, 'light', true]
  ])
    await matrix(engine, width, mode, enlarged);
}
await offlineRestart();
console.log(`${results.length} browser scenarios passed; evidence: ${output}`);
