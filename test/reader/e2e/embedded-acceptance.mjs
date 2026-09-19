/* SPDX-License-Identifier: GPL-3.0-or-later */
// Production Reader UI, real Worker/SQLite/OPFS and unmodified ManabiTan core.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {expect} from '@playwright/test';

export async function runEmbeddedAcceptance({getPage, getContext, restart, origin, fixtures, output, check, importBook, openBook, controlSW, requests}) {
  const metadata = JSON.parse(await fs.readFile(path.join(fixtures, 'jmdict.json'), 'utf8'));
  let page = getPage();
  const panel = () => page.locator('[data-dictionary-settings]');
  const popup = () => page.locator('[data-manabitan-web-popup]');
  async function settings() {
    if (!await panel().isVisible()) await page.getByRole('button', {name: 'Dictionary settings', exact: true}).click();
    await expect(panel()).toBeVisible();
  }
  async function active() {
    await expect(panel()).toHaveAttribute('data-provider-state', 'active', {timeout: 120000});
    await expect(panel().getByLabel('Import custom dictionary')).toBeEnabled();
  }
  async function closePopup() {
    if (await popup().isVisible()) await popup().getByRole('button', {name: 'Close dictionary lookup'}).click();
  }
  async function install(filename, title) {
    await closePopup(); await settings(); await active();
    await panel().getByLabel('Import custom dictionary').setInputFiles(path.join(fixtures, filename));
    await expect(panel().locator('[data-dictionary-title]').filter({hasText: title})).toBeVisible({timeout: 600000});
    await expect(panel().getByLabel('Import custom dictionary')).toBeEnabled({timeout: 600000});
  }
  async function find(text, expected) {
    await closePopup(); await settings(); await active();
    await panel().getByLabel('Japanese lookup text').fill(text);
    await panel().getByRole('button', {name: 'Look up', exact: true}).click();
    await expect(popup()).toBeVisible();
    await expect(popup()).toContainText(expected, {timeout: 30000});
  }
  async function scan(word) {
    await closePopup(); await settings(); await active();
    const consent = panel().getByRole('button', {name: 'Enable built-in scanning', exact: true});
    if (await consent.count()) await consent.click();
    await panel().getByRole('button', {name: 'Close dictionary settings'}).click();
    const content = page.locator('.book-content').first();
    await expect(content).not.toHaveText('');
    await content.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    const point = await content.evaluate((el, word) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node;
      while ((node = walker.nextNode())) {
        if (node.parentElement.closest('rt,rp')) continue;
        const at = node.textContent.indexOf(word); if (at < 0) continue;
        node.parentElement.scrollIntoView({block: 'center', inline: 'center'});
        const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + 1);
        const r = range.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2;
        const hit = document.elementFromPoint(x, y);
        if (hit && el.contains(hit) && r.width && r.height) return {x, y};
      }
      throw new Error('No visible Japanese scan target');
    }, word);
    await page.mouse.move(0,0); await page.keyboard.down('Shift');
    try {
      await page.mouse.move(point.x, point.y);
      await expect(popup()).toBeVisible();
      await expect(popup().locator('.headword').first()).toContainText(word);
    } finally { await page.keyboard.up('Shift'); }
  }
  await check('embedded: extension/off selection never fetches built-in runtime or dictionaries', async () => {
    await page.goto(origin + '/manage'); const seen = [];
    page.on('request', r => seen.push(r.url()));
    await settings();
    await panel().getByLabel('Lookup provider').selectOption('extension');
    await expect(panel()).toHaveAttribute('data-provider-state', 'active');
    await page.reload();
    const start = seen.length;
    await settings(); await panel().getByLabel('Lookup provider').selectOption('off');
    await page.reload(); await settings();
    assert.deepEqual(seen.slice(start).filter(u => /vendor\/manabitan|dictionary-archives/.test(u)), []);
    assert.equal(await page.evaluate(() => !!globalThis.chrome?.runtime?.id), false);
  });
  await check('embedded: built-in runtime initializes only on explicit selection', async () => {
    await panel().getByLabel('Lookup provider').selectOption('builtin'); await active();
    await expect(panel()).toContainText('No dictionaries installed.');
    await expect(panel().getByRole('button', {name: 'Enable built-in scanning'})).toBeVisible();
    await expect(panel().getByRole('button', {name: 'Install Jitendex', exact: true})).toBeEnabled();
  });
  await check('embedded: full official JMdict imports through the Reader file input', async () => {
    await install('JMdict_english.zip', metadata.index.title);
    await expect(panel().locator('[data-dictionary-title]').filter({hasText: metadata.index.title})).toContainText(`${metadata.termRows} term records`);
    assert.equal(await page.evaluate(() => crossOriginIsolated), false);
  });
  await check('embedded: Japanese EPUB and real ManabiTan text scanner work together', async () => {
    await panel().getByRole('button', {name: 'Close dictionary settings'}).click();
    await importBook('japanese.epub', 'E2E Japanese EPUB'); await openBook('E2E Japanese EPUB');
    await scan('猫'); await expect(popup()).toContainText(/cat/i);
    await page.screenshot({path: path.join(output, 'reader-embedded-jmdict.png')});
  });
  await check('embedded: deinflection uses the shared dictionary core', async () => {
    await find('食べました', '食べる'); await expect(popup()).toContainText(metadata.index.title);
  });
  await check('embedded: frequency ZIP appears in the actual Reader popup', async () => {
    await install('web-frequency.zip', 'Web Frequency'); await find('猫', '猫');
    await expect(popup().locator('.frequency')).toContainText('42');
  });
  await check('embedded: provider switching closes a lookup and rejects stale results', async () => {
    await closePopup(); await settings();
    await panel().getByLabel('Japanese lookup text').fill('学校');
    await panel().getByRole('button', {name: 'Look up', exact: true}).click();
    await page.keyboard.press('Escape'); await settings();
    for (const provider of ['off', 'builtin', 'extension', 'builtin', 'off']) {
      await panel().getByLabel('Lookup provider').selectOption(provider);
    }
    await expect(panel()).toHaveAttribute('data-provider-state', 'active');
    await expect(popup()).not.toBeVisible();
    await panel().getByLabel('Lookup provider').selectOption('builtin'); await active();
    await find('学校', '学校');
  });
  await check('embedded: second Reader tab reports ownership and recovers after release', async () => {
    await closePopup(); await settings();
    const first = page; const tab = await getContext().newPage();
    try {
      await tab.goto(origin + '/manage'); page = tab; await settings();
      await expect(panel()).toHaveAttribute('data-provider-state', 'failed', {timeout: 30000});
      await expect(panel().getByRole('alert')).toContainText(/another|tab|busy|own/i);
      page = first; await panel().getByLabel('Lookup provider').selectOption('off');
      await expect(panel()).toHaveAttribute('data-provider-state', 'active');
      page = tab; await panel().getByRole('button', {name: 'Retry dictionary initialization'}).click(); await active();
      await find('猫', '猫');
      await closePopup(); await panel().getByLabel('Lookup provider').selectOption('off');
      await expect(panel()).toHaveAttribute('data-provider-state', 'active');
    } finally { page = first; await tab.close(); }
    await panel().getByLabel('Lookup provider').selectOption('builtin'); await active();
  });
  await check('embedded: cold offline reload opens OPFS and performs lookup from cached tools', async () => {
    await closePopup(); await controlSW();
    await getContext().setOffline(true);
    try {
      await page.reload(); await settings(); await active();
      await find('学校', '学校');
    } finally { await getContext().setOffline(false); }
  });
  await check('embedded: full browser restart retains custom dictionary and provider choice', async () => {
    await restart(); page = getPage(); await page.goto(origin + '/manage'); await settings(); await active();
    await expect(panel().getByLabel('Lookup provider')).toHaveValue('builtin');
    await find('猫', '猫');
    await closePopup();
  });
  await check('embedded: explicit default decline does not download or reinstall on reload', async () => {
    await settings(); await active(); const start = requests.length;
    await panel().getByRole('button', {name: 'Not now', exact: true}).click();
    await expect(panel()).toContainText('Your previous Jitendex choice is respected.');
    await page.reload(); await settings(); await active();
    assert.deepEqual(requests.slice(start).filter(u => /dictionary-archives/.test(typeof u === 'string' ? u : u.url)), []);
  });
  await check('embedded: default Jitendex installs from the verified static archive', async () => {
    await panel().getByRole('button', {name: 'Install Jitendex', exact: true}).click();
    const row = panel().locator('[data-dictionary-title]').filter({hasText: 'Jitendex'});
    await expect(row).toBeVisible({timeout: 900000});
    await expect(panel().getByLabel('Import custom dictionary')).toBeEnabled({timeout: 900000});
    await find('猫', 'Jitendex'); await closePopup();
  });
  await check('embedded: disabled/deleted dictionaries stay disabled/deleted after restart', async () => {
    const row = panel().locator('[data-dictionary-title]').filter({hasText: 'Jitendex'});
    await row.getByRole('checkbox').uncheck();
    await expect(row.getByRole('checkbox')).not.toBeChecked();
    page.once('dialog', d => d.accept()); await row.getByRole('button', {name: 'Delete', exact: true}).click();
    await expect(row).toHaveCount(0);
    await page.reload(); await settings(); await active();
    await expect(panel()).toContainText('Your previous Jitendex choice is respected.');
    const custom = panel().locator('[data-dictionary-title]').filter({hasText: metadata.index.title});
    await custom.getByRole('checkbox').uncheck();
    await page.reload(); await settings(); await active();
    await expect(panel().locator('[data-dictionary-title]').filter({hasText: metadata.index.title}).getByRole('checkbox')).not.toBeChecked();
    await find('猫', 'No matching dictionary entries.');
  });
}
