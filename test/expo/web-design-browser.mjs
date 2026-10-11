/** @license BSD-3-Clause */
// Web-only qualification against an already exported, locally served Expo app.
// MANABI_WEB_EVIDENCE must point outside the repository. No account traffic is allowed.
import assert from 'node:assert/strict';
import { realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit } from '@playwright/test';

const origin = process.env.MANABI_WEB_PREVIEW_URL || 'http://127.0.0.1:4183';
assert.equal(new URL(origin).hostname, '127.0.0.1');
assert.ok(process.env.MANABI_WEB_EVIDENCE, 'Choose an existing, fresh evidence directory');
const output = await realpath(process.env.MANABI_WEB_EVIDENCE);
const repository = await realpath(new URL('../../', import.meta.url));
assert.ok(
  output !== repository && !output.startsWith(repository + path.sep),
  'Keep generated pixels out of Git'
);
const results = [];
const books = ['春の読書', '短い物語', '旅の記録', '日本語の練習', '夏の便り', '日々の文章'].map(
  (title) => ({
    name: `${title}.txt`,
    mimeType: 'text/plain',
    buffer: Buffer.from(`${title}\n\n日本語の本を読みます。今日は暖かい一日です。\n`.repeat(60))
  })
);
const catalogIndex = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>All Books</title><link rel="subsection" href="/static/reader/books/opds/feeds/qa.xml"/></entry></feed>`;
const catalogBooks = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>qa-1</id><title>読書の練習</title><author><name>Local QA fixture</name></author><summary>Generated catalog fixture for layout review.</summary><link rel="http://opds-spec.org/acquisition" type="application/epub+zip" href="/static/reader/books/library/qa.epub"/></entry></feed>`;

async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  assert.ok(overflow <= 1, `${name}: ${overflow}px horizontal page overflow`);
  await page.screenshot({
    path: path.join(output, name + '.png'),
    fullPage: true,
    animations: 'disabled'
  });
  results.push({ name, overflow });
}

async function qualify(engine, width, appearance, full) {
  const browser = await engine.launch({
    headless: true,
    ...(engine === chromium && process.platform === 'darwin'
      ? { args: ['--disable-features=MacAppCodeSignClone'] }
      : {})
  });
  let context;
  try {
    context = await browser.newContext({
      viewport: { width, height: 900 },
      colorScheme: appearance
    });
    await context.addInitScript(
      (mode) => window.localStorage.setItem('appearance', mode),
      appearance
    );
    let catalogError = false;
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/static/reader/books/opds/index.xml')
        return route.fulfill({
          status: catalogError ? 503 : 200,
          contentType: 'application/atom+xml',
          body: catalogError ? 'Intentional QA error fixture' : catalogIndex
        });
      if (url.pathname === '/static/reader/books/opds/feeds/qa.xml')
        return route.fulfill({ contentType: 'application/atom+xml', body: catalogBooks });
      return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    const suffix = `${width}-${appearance}${full ? '' : '-webkit'}`;
    await page.goto(origin + '/reader-web/manage');
    await page.getByText('No books in your library', { exact: true }).waitFor();
    await page.getByText('読書の練習', { exact: true }).waitFor();
    await capture(page, 'refined-empty-catalog-' + suffix);
    const secondaryImports = page.locator('.library-empty-import-options');
    const disclosure = secondaryImports.locator('summary');
    assert.equal(
      await secondaryImports.getByRole('button', { name: 'Import backup' }).isVisible(),
      false
    );
    if (width === 390 && appearance === 'light' && full) {
      catalogError = true;
      await page.reload();
      await page.getByRole('button', { name: 'Try Again', exact: true }).waitFor();
      await capture(page, 'refined-intentional-catalog-error-' + suffix);
      catalogError = false;
      await page.getByRole('button', { name: 'Try Again', exact: true }).click();
      await page.getByText('読書の練習', { exact: true }).waitFor();
    }
    await disclosure.focus();
    await page.keyboard.press('Space');
    assert.ok(await secondaryImports.getByRole('button', { name: 'Import backup' }).isVisible());
    assert.ok(
      await secondaryImports.getByRole('link', { name: 'Import from Ttu Ebook Reader' }).isVisible()
    );
    assert.ok(
      await secondaryImports.getByRole('link', { name: 'Import from Yatsu Reader' }).isVisible()
    );
    if (width === 390 && appearance === 'light' && full)
      await capture(page, 'refined-secondary-imports-' + suffix);
    await page.keyboard.press('Enter');
    assert.equal(
      await secondaryImports.getByRole('button', { name: 'Import backup' }).isVisible(),
      false
    );
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
      await capture(page, 'refined-collections-' + suffix);
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
      await capture(page, 'refined-collections-' + suffix);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('dialog[open]').count(), 0);
    }
    await page.locator('input[type=file][multiple]').first().setInputFiles(books);
    await page.getByText('春の読書', { exact: true }).first().waitFor();
    await page.getByText('6 books', { exact: true }).waitFor();
    await capture(page, 'refined-populated-' + suffix);
    {
      await page.getByText('春の読書', { exact: true }).first().click();
      await page.getByRole('button', { name: 'Not now', exact: true }).click();
      assert.equal(
        await page
          .locator('.react-reader-book-reader')
          .evaluate((node) => window.getComputedStyle(node).writingMode),
        'vertical-rl'
      );
      await capture(page, 'refined-reader-' + suffix);
      await page.getByRole('button', { name: 'Themes & Settings', exact: true }).click();
      await page.getByRole('dialog', { name: 'Themes & Settings', exact: true }).waitFor();
      for (const select of await page.locator('.react-reader-appearance select').all()) {
        assert.ok(
          (await select.boundingBox()).height >= 44,
          'Reading settings retain touch targets'
        );
      }
      await capture(page, 'refined-reader-appearance-' + suffix);
      for (let i = 0; i < 18; i++) {
        await page.keyboard.press('Tab');
        assert.ok(
          await page.evaluate(
            () => !!document.activeElement.closest('.reader-modal[role="dialog"]')
          )
        );
      }
      await page.getByRole('button', { name: 'Slate theme', exact: true }).click();
      assert.equal(
        await page
          .getByRole('button', { name: 'Slate theme', exact: true })
          .getAttribute('aria-pressed'),
        'true'
      );
      await page.getByRole('button', { name: 'Manabi theme', exact: true }).click();
      await page.keyboard.press('Escape');
      assert.equal(
        await page.getByRole('dialog', { name: 'Themes & Settings', exact: true }).count(),
        0
      );
      assert.equal(
        await page.evaluate(() => document.activeElement.getAttribute('aria-label')),
        'Themes & Settings'
      );
      await page.getByRole('button', { name: 'Themes & Settings', exact: true }).click();
      await page.getByRole('button', { name: 'Close reading appearance', exact: true }).click();
      assert.equal(
        await page.getByRole('dialog', { name: 'Themes & Settings', exact: true }).count(),
        0
      );
    }
    if (full) {
      await page.goto(origin + '/reader-web/settings');
      await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
      await capture(page, 'refined-settings-' + suffix);
      await page.goto(origin + '/reader-web/import-ttu');
      await page
        .getByRole('heading', { name: 'Import from Ttu Ebook Reader', exact: true })
        .waitFor();
      await capture(page, 'refined-import-' + suffix);
    }
  } finally {
    try {
      await context?.close();
    } finally {
      await browser.close();
      await writeFile(path.join(output, 'browser-checks.json'), JSON.stringify(results, null, 2));
    }
  }
}

for (const appearance of ['light', 'dark']) {
  for (const width of [320, 390, 820, 1440]) await qualify(chromium, width, appearance, true);
}
for (const width of [390, 1440]) await qualify(webkit, width, 'light', false);
console.log(
  JSON.stringify({ captures: results.length, engines: ['Chromium', 'WebKit'], results }, null, 2)
);
