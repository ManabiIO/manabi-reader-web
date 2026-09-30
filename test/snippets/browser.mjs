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

  // Stress the actual reader controls and vertical layout at enlarged UI text.
  await page.setViewportSize({ width: 320, height: 480 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  const moreActions = page.getByRole('button', { name: 'More actions', exact: true });
  await expect(moreActions).toBeVisible();
  const readingToolbar = page.getByRole('toolbar', { name: 'Snippet reading controls' });
  await expect(readingToolbar).toBeVisible();
  const articleTop = (await page.getByRole('article', { name: 'Snippet content' }).boundingBox()).y;
  assert(
    articleTop <= 480 * 2.5,
    `Secondary actions push reading content too far below the fold: ${articleTop}px`
  );
  moreActions.focus();
  await moreActions.press('Enter');
  const actionMenu = page.getByRole('menu');
  await expect(actionMenu).toBeVisible();
  const mobileActions = [
    'Collections…',
    'Add text',
    'Move to…',
    'Duplicate',
    'Export JSON',
    'HTML',
    'Markdown',
    'Trash'
  ];
  await expect(
    actionMenu.getByRole('menuitem', { name: mobileActions[0], exact: true })
  ).toBeFocused();
  for (const [index, name] of mobileActions.entries()) {
    if (index > 0) await page.keyboard.press('ArrowDown');
    const item = actionMenu.getByRole('menuitem', { name, exact: true });
    await expect(item).toBeFocused();
    const box = await item.boundingBox();
    assert(box && box.height >= 43.5, `${name} menu item must remain at least 44 CSS px high`);
    if (index === mobileActions.length - 1) {
      assert(
        box.y >= -1 && box.y + box.height <= 481,
        `Last Snippets action must scroll into the short viewport: ${JSON.stringify(box)}`
      );
      assert(
        await item.evaluate((node) => {
          const r = node.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!hit && (hit === node || node.contains(hit));
        }),
        'Last Snippets action must remain hit-testable after keyboard scrolling'
      );
    }
  }
  await page.keyboard.press('Escape');
  await expect(actionMenu).toHaveCount(0);
  await expect(moreActions).toBeFocused();
  assert(
    (await readingToolbar.evaluate((node) => node.scrollWidth - node.clientWidth)) <= 1,
    'Snippet reading controls must not overflow horizontally at 200% text'
  );
  for (const name of [
    'Smaller text',
    'Larger text',
    'Vertical reading',
    'Save selection to snippet…'
  ]) {
    const control = readingToolbar.getByRole('button', { name, exact: true });
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    assert(box && box.height >= 43.5, `${name} must remain at least 44 CSS px high`);
    assert(box.x >= -1 && box.x + box.width <= 321, `${name} must stay inside the viewport`);
    assert(box.y >= -1 && box.y + box.height <= 481, `${name} must be vertically reachable`);
    assert(
      await control.evaluate((node) => {
        const r = node.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!hit && (hit === node || node.contains(hit));
      }),
      `${name} must remain hit-testable after enlarged-text scrolling`
    );
  }
  const verticalToggle = readingToolbar.getByRole('button', {
    name: 'Vertical reading',
    exact: true
  });
  await verticalToggle.click();
  await expect(verticalToggle).toHaveAttribute('aria-pressed', 'true');
  const readingArticle = page.getByRole('article', { name: 'Snippet content' });
  assert.equal(
    await readingArticle.evaluate((node) => window.getComputedStyle(node).writingMode),
    'vertical-rl'
  );
  assert(
    (await page.locator('html').evaluate((node) => node.scrollWidth - node.clientWidth)) <= 1,
    'Vertical snippet reader must not make the page overflow horizontally'
  );
  const articleBox = await readingArticle.boundingBox();
  assert(
    articleBox.x >= -1 && articleBox.x + articleBox.width <= 321,
    'Vertical snippet reader must remain inside the narrow viewport'
  );
  const readerEvidence = process.env.SNIPPETS_SCREENSHOT;
  if (readerEvidence) {
    const path = readerEvidence.replace(/\.png$/i, '-reader-vertical-200.png');
    await mkdir(dirname(path), { recursive: true });
    await page.screenshot({ path, fullPage: true });
  }
  await verticalToggle.click();
  await expect(verticalToggle).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  passed('reader controls and vertical mode reflow at 200% text');

  // Stress the real TipTap toolbar and annotation form, not a substitute editor.
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 480 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  const formatting = page.getByRole('toolbar', { name: 'Text formatting' });
  await expect(formatting).toBeVisible();
  assert(
    (await formatting.evaluate((node) => node.scrollWidth - node.clientWidth)) <= 1,
    'Formatting toolbar must wrap without horizontal overflow at 200% text'
  );
  for (const button of await formatting.getByRole('button').all()) {
    const box = await button.boundingBox();
    assert(box && box.height >= 43.5, 'Formatting actions must remain at least 44 CSS px high');
    assert(box.x >= -1 && box.x + box.width <= 321, 'Formatting actions must stay in the viewport');
  }
  const editable = page.getByRole('textbox', { name: 'Snippet text', exact: true });
  await editable
    .locator('p')
    .first()
    .evaluate((paragraph) => {
      paragraph.closest('[contenteditable]').focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
  await formatting.getByRole('button', { name: 'Furigana', exact: true }).click();
  const readingInput = page.getByRole('textbox', { name: 'Furigana reading', exact: true });
  await expect(readingInput).toBeFocused();
  const annotationForm = readingInput.locator('xpath=ancestor::form');
  assert(
    (await annotationForm.evaluate((node) => node.scrollWidth - node.clientWidth)) <= 1,
    'Annotation form must wrap without horizontal overflow at 200% text'
  );
  for (const name of ['Apply', 'Cancel']) {
    const control = annotationForm.getByRole('button', { name, exact: true });
    const box = await control.boundingBox();
    assert(box && box.height >= 43.5, `${name} annotation action must be at least 44 CSS px high`);
  }
  const editorEvidence = process.env.SNIPPETS_SCREENSHOT;
  if (editorEvidence) {
    const path = editorEvidence.replace(/\.png$/i, '-editor-annotation-200.png');
    await mkdir(dirname(path), { recursive: true });
    await page.screenshot({ path, fullPage: true });
  }
  await annotationForm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editable).toBeFocused();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard draft and leave', exact: true }).click();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  passed('editor toolbar and annotation form reflow at 200% text');

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

  const selectionToggleLarge = page.getByRole('button', { name: 'Select', exact: true });
  selectionToggleLarge.focus();
  await selectionToggleLarge.press('Enter');
  const enlargedBatch = page.getByRole('toolbar', {
    name: 'Selected snippet actions',
    exact: true
  });
  await expect(enlargedBatch).toBeVisible();
  assert(
    (await enlargedBatch.evaluate((node) => node.scrollWidth - node.clientWidth)) <= 1,
    'Snippet batch actions must not overflow horizontally at 200% text'
  );
  const batchBox = await enlargedBatch.boundingBox();
  assert(
    batchBox.x >= -1 && batchBox.x + batchBox.width <= 321,
    'Snippet batch toolbar must remain inside the narrow viewport'
  );
  const batchStatus = enlargedBatch.getByRole('status');
  await expect(batchStatus).toHaveAttribute('aria-atomic', 'true');
  await expect(batchStatus).toHaveText('0 selected');
  const selectAllLarge = enlargedBatch.getByRole('button', {
    name: 'Select all visible',
    exact: true
  });
  selectAllLarge.focus();
  await selectAllLarge.press('Enter');
  await expect(batchStatus).toHaveText('1 selected');
  const enlargedSelection = page.getByRole('checkbox', { name: 'Select 散歩の記録', exact: true });
  await expect(enlargedSelection).toBeChecked();
  for (const name of [
    'Select all visible',
    'Collections…',
    'Move to…',
    'Export selected',
    'Move to Trash'
  ]) {
    const control = enlargedBatch.getByRole('button', { name, exact: true });
    const box = await control.boundingBox();
    assert(box && box.height >= 43.5, `${name} must remain at least 44 CSS px high`);
    assert(box.x >= -1 && box.x + box.width <= 321, `${name} must stay inside the viewport`);
  }
  if (largeTextEvidence) {
    const selectionPath = largeTextEvidence.replace(/\.png$/i, '-selection-large-text.png');
    await page.screenshot({ path: selectionPath, fullPage: true });
  }
  selectAllLarge.press('Escape');
  await expect(enlargedBatch).toHaveCount(0);
  await expect(selectionToggleLarge).toHaveText('Select');
  await expect(selectionToggleLarge).toBeFocused();

  await selectionToggleLarge.press('Enter');
  const checkboxEscape = page.getByRole('checkbox', { name: 'Select 散歩の記録', exact: true });
  checkboxEscape.focus();
  await checkboxEscape.press('Space');
  await expect(
    page.getByRole('toolbar', { name: 'Selected snippet actions', exact: true }).getByRole('status')
  ).toHaveText('1 selected');
  await checkboxEscape.press('Escape');
  await expect(page.getByRole('toolbar', { name: 'Selected snippet actions', exact: true })).toHaveCount(
    0
  );
  await expect(selectionToggleLarge).toBeFocused();
  passed('snippet selection reflows and exits consistently by keyboard at 200% text');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  const localTitle = page.locator('.snippet-shelf .title').filter({ hasText: '散歩の記録' });
  assert(
    (await localTitle.boundingBox()).height >= 43.5,
    'Snippet title link must remain at least 44 CSS px high'
  );
  // Control-click opens the native context menu on macOS; Command is its
  // normal multiselect modifier. Linux/Windows use Control.
  await localTitle.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
  await expect(
    page.getByRole('toolbar', { name: 'Selected snippet actions', exact: true })
  ).toBeVisible();
  await expect(page.getByRole('list', { name: 'Snippets', exact: true })).toBeVisible();
  const selectedCheckbox = page.getByRole('checkbox', { name: 'Select 散歩の記録' });
  await expect(selectedCheckbox).toBeChecked();
  const selectionTarget = selectedCheckbox.locator('..');
  const selectionBox = await selectionTarget.boundingBox();
  assert(
    selectionBox.width >= 43.5 && selectionBox.height >= 43.5,
    'Snippet selection target must remain at least 44x44 CSS px'
  );
  assert(
    await selectionTarget.evaluate((label) => {
      const r = label.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (hit === label || label.contains(hit));
    }),
    'Snippet selection target center must be hit-testable'
  );
  await page.getByRole('button', { name: 'Done selecting', exact: true }).click();
  passed('modifier-click enters visible selection mode');
  const search = page.getByRole('searchbox', { name: 'Search snippets' });

  await search.fill('𠮷'.repeat(512));
  await expect(search).toHaveValue('𠮷'.repeat(512));
  await expect(search).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByText(
      'Some snippet contents could not be searched. Title matches are still available.'
    )
  ).toHaveCount(0, { timeout: 15000 });
  await expect(page.getByText('No matching snippets.', { exact: true })).toBeVisible();

  await search.fill('𠮷'.repeat(513));
  await expect(search).toHaveValue('𠮷'.repeat(513));
  await expect(search).toHaveAttribute('aria-invalid', 'true');
  await expect(search).toHaveAttribute('aria-describedby', 'snippet-search-limit-error');
  await expect(
    page.getByRole('alert').filter({ hasText: 'Use a search of 512 characters or fewer.' })
  ).toBeVisible();

  await search.fill('珍しい言葉');
  await expect(search).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByText(
      'Some snippet contents could not be searched. Title matches are still available.'
    )
  ).toHaveCount(0);
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
  const passageLink = page.locator('.snippet-shelf .passage').first();
  assert(
    (await passageLink.boundingBox()).height >= 43.5,
    'Snippet passage link must remain at least 44 CSS px high'
  );
  await passageLink.click();
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
  const collectionMembership = page.getByRole('checkbox', { name: '日本語の文章' });
  await expect(collectionMembership).toBeChecked();
  const collectionTarget = collectionMembership.locator('..');
  assert(
    (await collectionTarget.boundingBox()).height >= 43.5,
    'Collection membership label must remain at least 44 CSS px high'
  );
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
  const conflictingImport = structuredClone(importedSaved);
  conflictingImport.revision = crypto.randomUUID();
  conflictingImport.parents = [imported.revision];
  conflictingImport.title = { mode: 'custom', text: '別の端末の版' };
  conflictingImport.content.content[0].content[0].text = '別の端末で編集した本文です。';
  await openLibrary(page);
  await page.locator('input[type=file]').setInputFiles({
    name: 'conflicting.manabi-snippet.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(conflictingImport))
  });
  await expect(page.locator('section.conflicts')).toBeVisible();
  await expect(
    page.getByText('A different version was imported. Both versions are kept until you choose one.')
  ).toBeVisible();
  const conflictedRecord = (await records(page)).find((r) => r.document.id === imported.id);
  assert.equal(conflictedRecord.document.revision, importedSaved.revision);
  assert(
    conflictedRecord.conflicts.some((version) => version.revision === conflictingImport.revision)
  );
  passed('single-document conflicting import keeps both versions instead of rejecting the file');
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

  await page.setViewportSize({ width: 320, height: 320 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  const pickerScroll = picker.locator('[data-snippet-picker-scroll]');
  await expect
    .poll(() => pickerScroll.evaluate((element) => element.scrollHeight > element.clientHeight))
    .toBe(true);
  await pickerScroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(() => pickerScroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const enlargedPickerClose = picker.getByRole('button', { name: 'Close', exact: true });
  // Resizing the viewport animates the dialog from its previous max-height.
  // Check the settled position so this measures reachability, not a transition frame.
  await expect
    .poll(async () => {
      const box = await enlargedPickerClose.boundingBox();
      return (
        !!box && box.x >= -1 && box.y >= -1 && box.x + box.width <= 321 && box.y + box.height <= 321
      );
    })
    .toBe(true);
  const closeBox = await enlargedPickerClose.boundingBox();
  assert(
    closeBox.width >= 43.5 && closeBox.height >= 43.5,
    'Save-location close target must remain at least 44x44 CSS px'
  );
  assert(
    closeBox.x >= -1 &&
      closeBox.y >= -1 &&
      closeBox.x + closeBox.width <= 321 &&
      closeBox.y + closeBox.height <= 321,
    'Save-location close target must remain inside the short visual viewport'
  );
  assert(
    await enlargedPickerClose.evaluate((button) => {
      const r = button.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (hit === button || button.contains(hit));
    }),
    'Save-location close target must remain hit-testable after picker scrolling'
  );
  assert(
    (await picker.evaluate((element) => element.scrollWidth - element.clientWidth)) <= 1,
    'Save-location dialog must not overflow horizontally at 200% text'
  );
  const enlargedEvidence = process.env.SNIPPETS_SCREENSHOT;
  if (enlargedEvidence) {
    const pickerPath = enlargedEvidence.replace(/\.png$/i, '-picker-large-text.png');
    await mkdir(dirname(pickerPath), { recursive: true });
    await page.screenshot({ path: pickerPath, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  await pickerScroll.evaluate((element) => {
    element.scrollTop = 0;
  });

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
  const rememberLocation = picker.getByRole('checkbox', {
    name: 'Use this location for new snippets'
  });
  const rememberTarget = rememberLocation.locator('..');
  assert(
    (await rememberTarget.boundingBox()).height >= 43.5,
    'Remember-location label must remain at least 44 CSS px high'
  );
  await rememberLocation.check();
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
  // Only genuine reader navigation may create position intent. Programmatic
  // restoration/layout scrolling is deliberately ignored by the production reader.
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.press('End');
  await page.mouse.wheel(0, 1200);
  await expect.poll(() => [...states.values()].some((s) => s.value?.id === cloudID)).toBe(true);

  const stateEntry = [...states.entries()].find(
      ([key, state]) => key.includes(providers[0].id) && state.value?.id === cloudID
    ),
    cloudFile = [...files.values()].find((file) => file.document.id === cloudID);
  assert(stateEntry, 'The Dropbox reading state must exist before reconnect hydration.');
  assert(cloudFile, 'The cloud snippet file must still exist.');
  const targetBlock = cloudFile.document.content.content.find(
      (node) => node.type === 'paragraph' && node.attrs?.id
    ),
    targetText = (targetBlock?.content ?? []).map((node) => node.text ?? '').join('');
  assert(targetBlock?.attrs?.id, 'A stable target block is required for the reading-state test.');
  const stateWritesBeforeHydration = counts.stateWrites;
  states.set(stateEntry[0], {
    value: {
      ...stateEntry[1].value,
      readAt: Date.now() + 1_000_000,
      locator: {
        blockId: targetBlock.attrs.id,
        quote: targetText.slice(0, 80),
        before: '',
        offset: 0,
        revision: cloudFile.document.revision
      }
    },
    revision: String(Number(stateEntry[1].revision) + 1)
  });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(
    page
      .getByRole('article', { name: 'Snippet content' })
      .locator(`[data-id="${targetBlock.attrs.id}"]`)
  ).toHaveClass(/snippet-match/);
  await expect
    .poll(
      async () => (await records(page)).find((r) => r.document.id === cloudID)?.progress?.blockId
    )
    .toBe(targetBlock.attrs.id);
  await page.waitForTimeout(1200);
  assert.equal(
    counts.stateWrites,
    stateWritesBeforeHydration,
    'Adopting/restoring a remote cursor must not echo it back as a newer local write.'
  );
  assert.equal((await records(page)).find((r) => r.document.id === cloudID)?.progressDirty, false);
  passed('open reader adopts a newer remote cursor after reconnect without echoing restoration');

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
