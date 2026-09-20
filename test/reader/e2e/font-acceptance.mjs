import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';

// This suite uses the actual built Reader and browser font loader. Computed
// stacks prove selection policy, not availability of proprietary Apple faces.
export async function runFontAcceptance({ page, context, origin, bookURL, check, output }) {
  const css = () =>
    page
      .locator('.book-content')
      .first()
      .evaluate((el) => {
        const style = getComputedStyle(el);
        return { font: style.fontFamily, writingMode: style.writingMode, size: style.fontSize };
      });
  const openSettings = async () => {
    await page.goto(origin + '/settings');
    await expect(page.getByLabel('Primary / Serif font', { exact: true })).toBeVisible();
  };
  const choose = async (family, writingMode = 'horizontal-tb', viewMode = 'paginated') => {
    await openSettings();
    await page.getByLabel('Primary / Serif font', { exact: true }).fill(family);
    await page.locator(`button[title="${writingMode}"]`).click();
    await page.locator(`button[title="${viewMode}"]`).click();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('fontFamilyGroupOne')))
      .toBe(family);
    await page.goto(bookURL);
    await expect(page.locator('.book-content').first()).toBeVisible();
    await expect(page.locator('.book-content').first()).toContainText('学校');
    await page.waitForFunction(() => document.fonts.status === 'loaded');
  };
  const fontCache = () =>
    page.evaluate(async () => {
      const names = (await caches.keys()).filter(
        (name) => name.startsWith('manabi-reader:') && name.endsWith(':packaged-fonts:v1')
      );
      const keys = [];
      for (const name of names) {
        for (const request of await (await caches.open(name)).keys()) {
          const response = await (await caches.open(name)).match(request);
          keys.push({ url: request.url, bytes: (await response.arrayBuffer()).byteLength });
        }
      }
      return { names, keys };
    });
  const yuKyokashoAvailable = await page.evaluate(async () => {
    const load = async (source) => {
      try {
        const face = new FontFace('__manabi_yukyokasho_acceptance__', source);
        await face.load();
        return face.status === 'loaded';
      } catch {
        return false;
      }
    };
    return (
      (await load('local("YuKyokasho Medium"), local("YuKyokasho")')) &&
      (await load('local("YuKyokasho Yoko Medium"), local("YuKyokasho Yoko")'))
    );
  });
  await check('fonts: YuKyokasho is the conditional default and selector option', async () => {
    await openSettings();
    await page.evaluate(() => localStorage.removeItem('fontFamilyGroupOne'));
    await page.reload();
    // The portable preference remains YuKyokasho; only the device-effective
    // selection falls back, so another synced Apple device can still use Yu.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('fontFamilyGroupOne')))
      .toBe(null);
    await expect(page.getByLabel('Primary / Serif font', { exact: true })).toHaveValue(
      yuKyokashoAvailable ? 'YuKyokasho' : 'Klee One'
    );
    await page
      .getByRole('button', { name: 'Show available primary / serif fonts', exact: true })
      .click();
    await expect(page.getByText('YuKyokasho', { exact: true })).toHaveCount(
      yuKyokashoAvailable ? 1 : 0
    );
    await page
      .getByRole('button', { name: 'Show available primary / serif fonts', exact: true })
      .click();
    return { yuKyokashoAvailable };
  });
  if (yuKyokashoAvailable) {
    for (const viewMode of ['paginated', 'continuous']) {
      for (const writingMode of ['horizontal-tb', 'vertical-rl']) {
        await check(`fonts: YuKyokasho ${writingMode} in ${viewMode} Reader`, async () => {
          await choose('YuKyokasho', writingMode, viewMode);
          const style = await css();
          assert.equal(style.writingMode, writingMode);
          assert.equal(
            style.font.split(',')[0].trim().replaceAll('"', ''),
            writingMode === 'vertical-rl' ? 'YuKyokasho' : 'YuKyokasho Yoko'
          );
          assert.ok(await page.locator('.book-content ruby').count());
          return style;
        });
      }
    }
  }
  await check('fonts: explicit Klee One uses the real packaged fallback', async () => {
    await choose('Klee One');
    assert.match((await css()).font, /^"?Klee One"?,/);
    const loaded = await page.evaluate(() =>
      [...document.fonts]
        .filter((face) => face.family.replaceAll('"', '') === 'Klee One')
        .map((face) => ({ status: face.status, weight: face.weight }))
    );
    assert.ok(loaded.some((face) => face.status === 'loaded'));
    const cdp = await context.newCDPSession(page);
    try {
      await cdp.send('DOM.enable');
      await cdp.send('CSS.enable');
      const { root } = await cdp.send('DOM.getDocument');
      const { nodeId } = await cdp.send('DOM.querySelector', {
        nodeId: root.nodeId,
        selector: '.book-content p'
      });
      const actual = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      assert.ok(
        actual.fonts.some(
          (font) => font.isCustomFont && /Klee/i.test(font.familyName) && font.glyphCount > 0
        )
      );
      return { loaded, actual };
    } finally {
      await cdp.detach();
    }
  });
  await check('fonts: only requested packaged font faces enter their own cache', async () => {
    const result = await fontCache();
    assert.equal(result.names.length, 1);
    assert.ok(result.keys.some((item) => /KleeOne-Regular.*\.woff2$/.test(item.url)));
    assert.ok(result.keys.length < 16, 'The entire optional catalog must not be downloaded');
    assert.ok(result.keys.every((item) => /\.woff2$/.test(item.url)));
    return result;
  });
  await check('fonts: controlled Reader retains Klee One for offline reload', async () => {
    assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller));
    await context.setOffline(true);
    try {
      await page.reload();
      await expect(page.locator('.book-content').first()).toContainText('学校');
      await page.waitForFunction(() => document.fonts.status === 'loaded');
      assert.ok(
        await page.evaluate(() =>
          [...document.fonts].some(
            (face) => face.family.replaceAll('"', '') === 'Klee One' && face.status === 'loaded'
          )
        )
      );
    } finally {
      await context.setOffline(false);
    }
  });
  await check('fonts: existing explicit Noto choice survives settings reload', async () => {
    await choose('Noto Serif JP');
    assert.match((await css()).font, /^"?Noto Serif JP"?,/);
    await openSettings();
    await page.reload();
    await expect(page.getByLabel('Primary / Serif font', { exact: true })).toHaveValue(
      'Noto Serif JP'
    );
  });
  await check('fonts: absent custom face falls back rather than blocking Reader', async () => {
    await choose('ReaderE2EMissingFont');
    const style = await css();
    assert.ok(style.font.includes('YuKyokasho Yoko') && style.font.includes('Klee One'));
    await page
      .locator('.book-content')
      .first()
      .click({ position: { x: 30, y: 30 } });
    await page.keyboard.press('PageDown');
    await expect(page.locator('.book-content').first()).toContainText('学校');
    return style;
  });
  await check('fonts: late font completion does not block initial reading', async () => {
    // A slow real asset response, not a replacement FontFaceSet/Reader store.
    await openSettings();
    await page.getByLabel('Primary / Serif font', { exact: true }).fill('Klee One SemiBold');
    const hideFurigana = page
      .locator('section')
      .filter({ has: page.locator('h2').filter({ hasText: /^Hide furigana$/ }) });
    await hideFurigana.locator('button[title="true"]').click();
    await page.locator('button[title="toggle"]').click();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.clearBrowserCache');
    await cdp.detach();
    await page.evaluate(async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('manabi-reader:') && name.endsWith(':packaged-fonts:v1')) {
          const cache = await caches.open(name);
          for (const request of await cache.keys()) {
            if (/KleeOne-SemiBold/.test(request.url)) await cache.delete(request);
          }
        }
      }
    });
    await page.request.get(origin + '/__test-font-delay?ms=4000');
    try {
      await page.goto(bookURL);
      await expect(page.locator('.book-content').first()).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe('loading');
      await page
        .locator('.book-content')
        .first()
        .click({ position: { x: 30, y: 30 } });
      await page.keyboard.press('PageDown');
      await page.waitForFunction(() => document.fonts.status === 'loaded');
      await expect(page.locator('.book-content').first()).toContainText('学校');
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      );
      const ruby = page.locator('.book-content ruby').first();
      await ruby.scrollIntoViewIfNeeded();
      const revealed = await ruby.evaluate((element) => element.classList.contains('reveal-rt'));
      await ruby.click();
      await expect
        .poll(() => ruby.evaluate((element) => element.classList.contains('reveal-rt')))
        .toBe(!revealed);
    } finally {
      await page.request.get(origin + '/__test-font-delay?ms=0');
    }
  });
  await choose(yuKyokashoAvailable ? 'YuKyokasho' : 'Klee One');
  await fs.writeFile(
    path.join(output, 'typography-cache.json'),
    JSON.stringify(await fontCache(), null, 2)
  );
}
