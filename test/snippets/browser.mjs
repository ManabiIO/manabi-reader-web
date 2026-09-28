/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 *
 * Assembled production UI, actual TipTap and native IndexedDB. Only the authenticated
 * HTTP storage boundary is substituted; these are not live-provider/OAuth tests.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium, webkit, expect as baseExpect } from '@playwright/test';
const url = process.env.SNIPPETS_URL ?? 'http://127.0.0.1:4178/reader-web';
const engine = process.env.SNIPPETS_BROWSER ?? 'chromium';
const browser = await (engine === 'webkit' ? webkit : chromium).launch({
  headless: true,
  ...(engine === 'chromium' && existsSync('/usr/bin/chromium')
    ? { executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] }
    : {})
});
const expect = baseExpect.configure({ timeout: 15000 });
const providers = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    provider: 'dropbox',
    roots: ['Dropbox snippets'],
    needs_reconnect: false
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    provider: 'google',
    roots: ['Drive snippets'],
    needs_reconnect: false
  }
];
const files = new Map(),
  states = new Map();
let serial = 0,
  failCleanup = false,
  holdMkdir = false,
  releaseMkdir,
  deniedFolderSource = '';
const counts = { writes: 0, removes: 0, stateWrites: 0 };
const errors = [];
const canonical = (v) =>
  JSON.stringify(v, function (_key, value) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, value[k]])
        )
      : value;
  });
async function context(user = null, available = true) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block',
    acceptDownloads: true
  });
  const session = { user, available };
  await ctx.route('**/api/reader-web/**', async (route) => {
    const request = route.request(),
      u = new URL(request.url()),
      path = u.pathname.slice('/api/reader-web/'.length),
      method = request.method();
    const respond = (data, status = 200, extra = {}) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'no-store', 'X-Manabi-User': session.user ?? '', ...extra },
        body: JSON.stringify(data)
      });
    if (!session.available) return respond({ error: 'unavailable' }, 503);
    if (path === 'session/')
      return respond({
        user: session.user ? { id: session.user, username: session.user } : null,
        csrf_token: 'c'.repeat(64),
        providers: []
      });
    if (!session.user || request.headers()['x-manabi-user'] !== session.user)
      return respond({ error: 'account_changed' }, 409);
    if (method !== 'GET') assert.equal(request.headers()['x-csrftoken'], 'c'.repeat(64));
    if (path === 'connections/') return respond({ items: providers });
    if (path === 'preferences/')
      return respond({ user_id: session.user, schema_version: 1, revision: 0, settings: {} });
    const match = /^connections\/([^/]+)\/(files|documents|state)\/$/.exec(path);
    if (!match) return respond({ error: 'not_found' }, 404);
    const [, connection, operation] = match,
      provider = providers.find((p) => p.id === connection);
    if (!provider || !provider.roots.includes(u.searchParams.get('root')))
      return respond({ error: 'forbidden' }, 403);
    const parent = u.searchParams.get('parent') ?? provider.roots[0];
    if (operation === 'files' && deniedFolderSource === connection)
      return respond({ error: 'forbidden' }, 403);
    if (operation === 'files')
      return respond({
        items: [...files.values()]
          .filter(
            (f) =>
              f.connection === connection &&
              f.owner === session.user &&
              f.location.parent === parent
          )
          .map((f) => ({
            id: f.location.fileId,
            name: f.location.name,
            kind: 'file',
            size: Buffer.byteLength(JSON.stringify(f.document))
          })),
        cursor: ''
      });
    if (operation === 'state') {
      const key = session.user + connection + u.searchParams.get('key'),
        old = states.get(key) ?? { value: null, revision: '0' };
      if (method === 'GET') return respond(old);
      if (request.headers()['if-match'] !== old.revision)
        return respond({ error: 'conflict' }, 409);
      const next = { value: request.postDataJSON(), revision: String(Number(old.revision) + 1) };
      states.set(key, next);
      counts.stateWrites++;
      return respond(next);
    }
    const action = u.searchParams.get('action'),
      value = method === 'POST' ? request.postDataJSON() : undefined;
    if (action === 'capabilities')
      return respond({
        write: true,
        allocate: provider.provider === 'google',
        provider: provider.provider,
        reason: ''
      });
    if (action === 'allocate') return respond({ id: 'allocated-' + ++serial });
    if (action === 'mkdir') {
      if (holdMkdir)
        await new Promise((resolve) => {
          releaseMkdir = resolve;
        });
      return respond({ id: 'folder-' + ++serial, kind: 'folder', name: value.name });
    }
    if (action === 'read') {
      const f = files.get(u.searchParams.get('id'));
      return f && f.connection === connection && f.owner === session.user
        ? respond({ document: f.document, location: f.location })
        : respond({ error: 'not_found' }, 404);
    }
    if (action === 'write') {
      const id = value.id ?? value.createId ?? 'file-' + ++serial,
        old = files.get(id);
      if (old && canonical(old.document) === canonical(value.document))
        return respond({ document: old.document, location: old.location });
      if (
        old &&
        (!value.id ||
          value.expected !== old.location.token ||
          !value.document.parents.includes(old.document.revision))
      )
        return respond({ error: 'conflict' }, 409);
      if (!old && value.id) return respond({ error: 'not_found' }, 404);
      const result = {
        connection,
        owner: session.user,
        document: structuredClone(value.document),
        location: {
          fileId: id,
          name: value.name,
          parent: value.parent,
          token: '"token-' + ++serial + '"'
        }
      };
      files.set(id, result);
      counts.writes++;
      return respond({ document: result.document, location: result.location });
    }
    if (action === 'move') {
      const f = files.get(value.id);
      if (!f) return respond({ error: 'not_found' }, 404);
      if (
        f.document.revision !== value.revision ||
        (f.location.parent !== value.parent && f.location.token !== value.expected)
      )
        return respond({ error: 'conflict' }, 409);
      f.location = { ...f.location, parent: value.parent, token: '"token-' + ++serial + '"' };
      return respond({ document: f.document, location: f.location });
    }
    if (action === 'remove') {
      if (failCleanup) return respond({ error: 'unavailable' }, 503);
      const f = files.get(value.id);
      if (!f) return respond({ error: 'not_found' }, 404);
      if (f.location.token !== value.expected || f.document.revision !== value.revision)
        return respond({ error: 'conflict' }, 409);
      files.delete(value.id);
      counts.removes++;
      return respond({ removed: true });
    }
    return respond({ error: 'unsupported' }, 415);
  });
  ctx.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  return { ctx, session };
}
async function records(page, store = 'snippets') {
  return page.evaluate(
    (store) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('manabi-reader-integrations');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(store)) {
            db.close();
            resolve([]);
            return;
          }
          const tx = db.transaction(store),
            r = tx.objectStore(store).getAll();
          r.onerror = () => reject(r.error);
          r.onsuccess = () => resolve(r.result);
          tx.oncomplete = () => db.close();
        };
      }),
    store
  );
}
async function openLibrary(page) {
  await page.goto(url + '/snippets');
  await expect(page.getByRole('button', { name: 'New snippet', exact: true })).toBeEnabled();
}
async function commit(page, device = false) {
  await page.getByRole('button', { name: 'Save snippet', exact: true }).click();
  if (device) {
    await page.getByRole('button', { name: 'Keep on this device only', exact: true }).click();
    await page.getByRole('button', { name: 'Save snippet', exact: true }).click();
  }
  await expect(page.getByRole('article', { name: 'Snippet content' })).toBeVisible();
  return new URL(page.url()).searchParams.get('id');
}
let page,
  checks = 0;
function passed(name) {
  checks++;
  console.log(`PASS ${engine}: ${name}`);
}
try {
  const local = await context();
  page = await local.ctx.newPage();
  await openLibrary(page);
  await page.getByRole('button', { name: 'New snippet', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Snippet text', exact: true })
    .fill('京都の街を歩きます。\n検索だけに使う珍しい言葉。');
  await page.getByRole('textbox', { name: 'Snippet title', exact: true }).fill('散歩の記録');
  const id = await commit(page, true);
  await expect.poll(async () => (await records(page)).length).toBe(1);
  assert.equal((await records(page))[0].document.id, id);
  await page.reload();
  await expect(page.getByRole('article', { name: 'Snippet content' })).toContainText('京都');
  passed('create, durable native IndexedDB save and reader reload');
  await openLibrary(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  assert(
    (await page.locator('html').evaluate((node) => node.scrollWidth - node.clientWidth)) <= 1,
    'Snippets workspace must not overflow horizontally at 320px / 200% text'
  );
  await expect(page.getByRole('button', { name: 'Navigate', exact: true })).toBeVisible();
  const largeTextEvidence = process.env.SNIPPETS_SCREENSHOT;
  if (largeTextEvidence) {
    const largeTextPath = largeTextEvidence.replace(/\.png$/i, '-large-text.png');
    await mkdir(dirname(largeTextPath), { recursive: true });
    await page.screenshot({ path: largeTextPath, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  const localTitle = page.locator('.snippet-shelf .title').filter({ hasText: '散歩の記録' });
  // Control-click opens the native context menu on macOS; Command is its
  // normal multiselect modifier. Linux/Windows use Control.
  await localTitle.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
  await expect(
    page.getByRole('toolbar', { name: 'Selected snippet actions', exact: true })
  ).toBeVisible();
  await expect(page.getByRole('list', { name: 'Snippets', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Select 散歩の記録' })).toBeChecked();
  await page.getByRole('button', { name: 'Done selecting', exact: true }).click();
  passed('modifier-click enters visible selection mode');
  await page.getByRole('searchbox', { name: 'Search snippets' }).fill('珍しい言葉');
  await expect(page.locator('.snippet-shelf .title')).toHaveText(['散歩の記録']);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.locator('.snippet-shelf .passage').first().click();
  await expect(
    page.getByRole('checkbox', { name: 'Select 散歩の記録', exact: true })
  ).toBeChecked();
  await expect(page.getByRole('searchbox', { name: 'Search snippets' })).toHaveValue('珍しい言葉');
  await expect(page.getByRole('article', { name: 'Snippet content' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Done selecting', exact: true }).click();
  passed('search passages honor selection mode without navigating away');
  await page.locator('.snippet-shelf .passage').first().click();
  await expect(page.getByRole('article', { name: 'Snippet content' })).toContainText('珍しい言葉');
  await page.getByRole('link', { name: '← Back to library', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search snippets' })).toHaveValue('珍しい言葉');
  passed('worker body search, passage navigation and retained query');
  await page.locator('.snippet-shelf .title').click();
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await page.getByRole('textbox', { name: 'Snippet text', exact: true }).fill('追加した文章です。');
  await page.getByRole('button', { name: 'Append text', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Snippet content' })).toContainText(
    '追加した文章です。'
  );
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('散歩の記録');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('textbox', { name: 'Snippet text', exact: true }).fill('保存しない編集');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const discardDraft = page.getByRole('button', { name: 'Discard draft and leave', exact: true });
  await expect(discardDraft).toHaveAttribute('data-variant', 'destructive');
  await discardDraft.click();
  await expect(page.getByRole('article', { name: 'Snippet content' })).toContainText(
    '追加した文章です。'
  );
  passed('append keeps title and Cancel preserves committed content');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('textbox', { name: 'Snippet title', exact: true }).fill('復元した下書き');
  await page.getByRole('button', { name: 'Keep draft', exact: true }).click();
  await openLibrary(page);
  const recoveryLink = page.getByRole('link').filter({ hasText: '復元した下書き' });
  const previousDraftURL = await recoveryLink.getAttribute('href');
  await recoveryLink.click();
  await expect(page.getByRole('textbox', { name: 'Snippet title', exact: true })).toHaveValue(
    '復元した下書き'
  );
  assert.notEqual(page.url(), new URL(previousDraftURL, page.url()).href);
  // Real document reload, not a JS module reset. A recovered editor must point at its new session.
  page.once('dialog', (d) => d.accept());
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Snippet title', exact: true })).toHaveValue(
    '復元した下書き'
  );
  // A second handoff must not reopen or resurrect either discarded session.
  const recoveredURL = page.url();
  page.once('dialog', (d) => d.accept());
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Snippet title', exact: true })).toHaveValue(
    '復元した下書き'
  );
  assert.notEqual(page.url(), recoveredURL);
  await commit(page);
  passed('draft recovery survives repeated reloads without stale session URLs');
  await page.getByRole('button', { name: 'Collections…', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'New collection name', exact: true })
    .fill('日本語の文章');
  await page.getByRole('button', { name: 'Create collection', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '日本語の文章' })).toBeChecked();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const metadata = await records(page, 'metadata');
  assert(
    metadata.some((v) =>
      v?.collections?.some((c) => c.name === '日本語の文章' && c.members.includes('snippet:' + id))
    )
  );
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  const confirmTrash = page.getByRole('button', { name: 'Move to Trash', exact: true });
  await expect(confirmTrash).toHaveAttribute('data-variant', 'destructive');
  await confirmTrash.click();
  await expect(page.getByRole('button', { name: 'Restore snippet', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restore snippet', exact: true }).click();
  passed('shared collections and recoverable trash/restore');
  const imported = structuredClone(
    (await records(page)).find((r) => r.document.id === id).document
  );
  imported.id = crypto.randomUUID();
  imported.revision = crypto.randomUUID();
  imported.parents = [];
  imported.captures = [];
  imported.title = { mode: 'custom', text: '持ち込んだ原本' };
  delete imported.trashedAt;
  await openLibrary(page);
  await page.locator('input[type=file]').setInputFiles({
    name: 'original.manabi-snippet.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(imported))
  });
  await expect(page.getByRole('textbox', { name: 'Snippet title', exact: true })).toHaveValue(
    '持ち込んだ原本'
  );
  await page.getByRole('textbox', { name: 'Snippet title', exact: true }).fill('編集した持ち込み');
  await page
    .getByRole('textbox', { name: 'Snippet text', exact: true })
    .fill('持ち込み後の編集も別の版です。');
  assert.equal(await commit(page, true), imported.id);
  const importedSaved = (await records(page)).find((r) => r.document.id === imported.id).document;
  assert.notEqual(importedSaved.revision, imported.revision);
  assert(importedSaved.parents.includes(imported.revision));
  assert.equal(importedSaved.title.text, '編集した持ち込み');
  await expect(page.getByRole('article', { name: 'Snippet content' })).toContainText(
    '持ち込み後の編集も別の版です。'
  );
  passed('editing a portable import preserves identity but creates a successor revision');
  await local.ctx.close();

  const cloud = await context('alice');
  page = await cloud.ctx.newPage();
  await openLibrary(page);
  await page.locator('input[type=file]').setInputFiles({
    name: 'ruby.html',
    mimeType: 'text/html',
    buffer: Buffer.from(
      '<h2>東京の朝</h2><p><ruby>東京<rt>とうきょう</rt></ruby>で勉強します。</p><p>移動しても読み続けます。</p>' +
        Array.from({ length: 35 }, (_, i) => `<p>読書の練習を続けます。第${i + 1}段落。</p>`).join(
          ''
        )
    )
  });
  await expect(page.getByRole('textbox', { name: 'Snippet text' }).locator('ruby')).toBeVisible();
  await page.getByRole('textbox', { name: 'Snippet title' }).fill('日本語の抜粋');
  await page.getByRole('button', { name: 'Save snippet', exact: true }).click();
  const picker = page.getByRole('dialog');
  const sourceSelect = picker.getByLabel('Storage source');
  await expect(sourceSelect).toBeVisible();
  assert((await sourceSelect.boundingBox()).height >= 43.5);
  await sourceSelect.selectOption({ label: 'Dropbox · Dropbox snippets' });
  const rootCrumb = picker.getByRole('button', { name: 'Dropbox snippets', exact: true });
  await expect(rootCrumb).toHaveAttribute('data-slot', 'button');
  await expect(rootCrumb).toHaveAttribute('aria-current', 'page');
  assert((await rootCrumb.boundingBox()).height >= 43.5);
  holdMkdir = true;
  await picker.getByLabel('New folder name').fill('Study folder');
  await picker.getByRole('button', { name: 'Create folder', exact: true }).click();
  const pickerClose = picker.getByRole('button', { name: 'Close', exact: true });
  await expect(pickerClose).toBeDisabled();
  releaseMkdir?.();
  releaseMkdir = undefined;
  holdMkdir = false;
  const createdCrumb = picker.getByRole('button', { name: 'Study folder', exact: true });
  await expect(createdCrumb).toHaveAttribute('aria-current', 'page');
  await expect(createdCrumb).toBeFocused();
  await expect(pickerClose).toBeEnabled();
  await expect(picker.getByRole('button', { name: 'Use this folder', exact: true })).toBeEnabled();
  const writesBeforeDestinationFailure = counts.writes;
  deniedFolderSource = providers[1].id;
  await sourceSelect.selectOption({ label: 'Google Drive · Drive snippets' });
  await expect(picker.getByRole('alert')).toBeVisible();
  await expect(
    picker.locator('button:enabled').filter({ hasText: /^Use this folder$/ })
  ).toHaveCount(0);
  assert.equal(counts.writes, writesBeforeDestinationFailure);
  deniedFolderSource = '';
  await picker.getByRole('button', { name: 'Retry folder', exact: true }).click();
  await expect(picker.getByRole('button', { name: 'Use this folder', exact: true })).toBeEnabled();
  await expect(sourceSelect).toHaveValue(
    JSON.stringify(['alice', providers[1].id, providers[1].roots[0]])
  );
  await sourceSelect.selectOption({ label: 'Dropbox · Dropbox snippets' });
  await expect(picker.getByRole('button', { name: 'Use this folder', exact: true })).toBeEnabled();
  passed('failed destination switch cannot reuse the previously writable folder');
  await picker.getByRole('checkbox', { name: 'Use this location for new snippets' }).check();
  await picker.getByRole('button', { name: 'Use this folder', exact: true }).click();
  const cloudID = await commit(page);
  await expect
    .poll(() => [...files.values()].filter((f) => f.document.id === cloudID).length)
    .toBe(1);
  await expect
    .poll(async () => (await records(page)).find((r) => r.document.id === cloudID)?.dirty)
    .toBe(false);
  await expect(
    page.getByRole('article', { name: 'Snippet content' }).locator('ruby rt')
  ).toHaveText('とうきょう');
  passed('HTML ruby import through actual TipTap and chosen Dropbox document save');
  await openLibrary(page);
  await page.getByRole('button', { name: 'Default save location…', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Clear default location', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'New snippet', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Choose storage location…', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard draft and leave', exact: true }).click();
  await page.locator('.snippet-shelf .title').filter({ hasText: '日本語の抜粋' }).click();
  await expect(page.getByRole('article', { name: 'Snippet content' })).toBeVisible();
  passed('cleared default does not silently select the previous cloud destination');
  const fresh = await context('alice'),
    freshPage = await fresh.ctx.newPage();
  await openLibrary(freshPage);
  await freshPage.getByRole('searchbox', { name: 'Search snippets' }).fill('とうきょう');
  await expect(freshPage.locator('.snippet-shelf .title')).toHaveText(['日本語の抜粋']);
  await freshPage.locator('.snippet-shelf .title').click();
  await expect(
    freshPage.getByRole('article', { name: 'Snippet content' }).locator('ruby rt')
  ).toHaveText('とうきょう');
  passed('fresh browser discovers external file and searches furigana without opening first');
  await fresh.ctx.close();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const textbox = page.getByRole('textbox', { name: 'Snippet text', exact: true });
  await textbox
    .locator('p')
    .filter({ hasText: '移動しても読み続けます。' })
    .first()
    .evaluate((paragraph) => {
      paragraph.closest('[contenteditable]').focus();
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
  await page.getByRole('button', { name: 'Furigana', exact: true }).click();
  const reading = page.getByRole('textbox', { name: 'Furigana reading', exact: true });
  await reading.fill('いどう');
  await expect(page.getByRole('button', { name: 'Save snippet', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Keep draft', exact: true })).toBeDisabled();
  await reading.dispatchEvent('compositionstart');
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await reading.press('Enter');
  await reading.press('Escape');
  await expect(reading).toBeVisible();
  await reading.dispatchEvent('compositionend');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save snippet', exact: true })).toBeEnabled();
  passed('unapplied annotation cannot be silently omitted by Save or Keep draft');
  // The upstream blur-to-dismiss editor must not bypass the guarded annotation form.
  await textbox.locator('ruby rt').first().click();
  await expect(textbox.locator('rt input')).toHaveCount(0);
  // Place an actual DOM caret inside an existing mark. Editing it must replace the whole reading.
  await textbox
    .locator('ruby')
    .first()
    .evaluate((ruby) => {
      const walker = document.createTreeWalker(ruby, window.NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!node.parentElement?.closest('rt, rp') && node.textContent?.length) {
          ruby.closest('[contenteditable]').focus();
          const selection = window.getSelection();
          selection.removeAllRanges();
          const range = document.createRange();
          range.setStart(node, Math.min(1, node.textContent.length));
          range.collapse(true);
          selection.addRange(range);
          document.dispatchEvent(new Event('selectionchange'));
          return;
        }
      }
      throw new Error('The existing ruby has no base text.');
    });
  await page.getByRole('button', { name: 'Furigana', exact: true }).click();
  await expect(reading).toHaveValue('とうきょう');
  await reading.fill('トウキョウ');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(textbox.locator('ruby rt').first()).toHaveText('トウキョウ');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(textbox.locator('ruby rt').first()).toHaveText('とうきょう');
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
  passed('caret edits the existing ruby mark and toolbar undo restores its reading');
  await commit(page);
  await expect
    .poll(async () => (await records(page)).find((r) => r.document.id === cloudID)?.dirty)
    .toBe(false);
  passed('ruby editor composition Enter guard and explicit commit');
  await page
    .getByRole('article', { name: 'Snippet content' })
    .locator('p')
    .last()
    .scrollIntoViewIfNeeded();
  await expect.poll(() => [...states.values()].some((s) => s.value?.id === cloudID)).toBe(true);
  // Movement exercises real durable client journals and conditional HTTP cleanup.
  failCleanup = true;
  const writesBefore = counts.writes;
  await page.getByRole('button', { name: 'Move to…', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Storage source')
    .selectOption({ label: 'Google Drive · Drive snippets' });
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Use this folder', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Resume move', exact: true })).toBeEnabled();
  assert.equal([...files.values()].filter((f) => f.document.id === cloudID).length, 2);
  assert.equal(counts.writes, writesBefore + 1);
  failCleanup = false;
  await page.getByRole('button', { name: 'Resume move', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume move', exact: true })).toHaveCount(0);
  assert.equal([...files.values()].filter((f) => f.document.id === cloudID).length, 1);
  assert.equal(counts.writes, writesBefore + 1);
  assert.equal(
    [...files.values()].find((f) => f.document.id === cloudID).connection,
    providers[1].id
  );
  passed('cross-provider verified copy, failed cleanup, journal resume without duplicate upload');
  const moved = await context('alice'),
    movedPage = await moved.ctx.newPage();
  await openLibrary(movedPage);
  await movedPage.locator('.snippet-shelf .title').filter({ hasText: '日本語の抜粋' }).click();
  await expect.poll(() => new URL(movedPage.url()).searchParams.get('id')).toBe(cloudID);
  await expect(
    movedPage.getByRole('article', { name: 'Snippet content' }).locator('ruby').first()
  ).toBeVisible();
  assert(
    [...states.entries()].some(
      ([key, state]) => key.includes(providers[1].id) && state.value?.id === cloudID
    )
  );
  passed('post-move fresh browser retains logical identity, ruby and source reading state');
  const screen = process.env.SNIPPETS_SCREENSHOT;
  if (screen) {
    await mkdir(dirname(screen), { recursive: true });
    await movedPage.screenshot({ path: screen, fullPage: true });
  }
  await moved.ctx.close();
  await openLibrary(page);
  const accountSwitchTitle = page
    .locator('.snippet-shelf .title')
    .filter({ hasText: '日本語の抜粋' });
  await accountSwitchTitle.click({
    modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control']
  });
  await page.getByRole('button', { name: 'Move to Trash', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  cloud.session.user = 'bob';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Selected snippet actions')).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Snippet content' })).toHaveCount(0);
  await expect(page.locator('.snippet-shelf .title')).toHaveCount(0);
  passed('account switch hides documents and clears old-account transient UI');
  assert.deepEqual(errors, [], 'Uncaught production-page errors');
  console.log(
    `${checks} assembled ${engine} cases passed; fixture HTTP, not live OAuth/provider acceptance.`
  );
} catch (error) {
  console.error('FAILED', error);
  if (page && !page.isClosed()) {
    console.error((await page.locator('body').innerText()).slice(0, 18000));
    const screen = process.env.SNIPPETS_SCREENSHOT ?? '/tmp/snippet-browser-failure.png';
    await mkdir(dirname(screen), { recursive: true });
    await page.screenshot({ path: screen, fullPage: true }).catch(() => undefined);
  }
  console.error('Page errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
