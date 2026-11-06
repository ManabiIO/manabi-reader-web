/** @license BSD-3-Clause */
/* global caches, localStorage, fetch */
// Real cache, owner save/remove, embedded stylesheet and font decoding. This
// complements, and never substitutes for, the packaged Android picker journey.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, mkdir, rename, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from '@playwright/test';

const engine = process.env.FONT_BROWSER || 'chromium';
assert.ok(['chromium', 'webkit'].includes(engine));
const root = new URL('../../', import.meta.url);
const font = await readFile(
  new URL('apps/web/src/lib/assets/fonts/KZUDMincho-Regular.woff2', root)
);
const probe = (await readFile(new URL('tests/android/font-probe.js', root), 'utf8'))
  .trim()
  .replace(/;$/, '');
const { outputFiles } = await build({
  stdin: {
    contents: `export * from './apps/web/src/runtime/embedded-fonts'; export * from './apps/web/src/lib/components/settings/user-font-actions';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'fontFixture',
  tsconfig: 'apps/web/tsconfig.json',
  logLevel: 'silent'
});
const requests = [];
const server = createServer((req, res) => {
  requests.push(req.url);
  if (req.url === '/www.bundle/fixture.woff2') {
    res.setHeader('Content-Type', 'font/woff2');
    res.end(font);
  } else {
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<!doctype html><title>Embedded custom font codec</title><style id="manabi-packaged-fonts">@font-face{font-family:Packaged;src:url("./fixture.woff2")}</style>'
    );
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser, context, page, profile;
try {
  if (engine === 'webkit') {
    profile = await realpath(await mkdtemp(path.join(os.tmpdir(), 'reader-font-webkit-')));
    context = await webkit.launchPersistentContext(profile, { headless: true });
  } else {
    browser = await chromium.launch({
      headless: true,
      ...(engine === 'chromium' && process.platform === 'darwin'
        ? { args: ['--disable-features=MacAppCodeSignClone'] }
        : {})
    });
    context = await browser.newContext();
  }
  page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/www.bundle/index.html`);
  const load = async () => {
    await page.addScriptTag({ content: outputFiles[0].text });
    await page.addScriptTag({ content: `globalThis.inspectFont=(${probe});` });
  };
  await load();
  const id = '1234567890abcdef1234567890abcdef';
  const imported = await page.evaluate(async (id) => {
    const fixture = await globalThis.inspectFont({ id, operation: 'prepare' });
    await globalThis.inspectFont({ id, operation: 'cancelled' });
    const cache = await caches.open('ttu-userfonts');
    const catalog = {
      read: () => JSON.parse(localStorage.getItem('userfonts') || '[]'),
      write: (fonts) => localStorage.setItem('userfonts', JSON.stringify(fonts))
    };
    const source = await (await fetch('/' + fixture.assetPath)).blob();
    await globalThis.fontFixture.saveUserFont(
      cache,
      catalog,
      fixture.name,
      new File([source], fixture.fileName, { type: 'font/woff2' }),
      new Set()
    );
    const resource = await globalThis.fontFixture.embeddedFontStyleSheet(
      catalog.read(),
      cache,
      new AbortController().signal
    );
    const style = document.createElement('style');
    style.id = 'ttu-userfonts';
    style.textContent = resource.css;
    document.head.append(style);
    const imported = await globalThis.inspectFont({ id, operation: 'imported' });
    localStorage.setItem('fontFamilyGroupOne', fixture.name);
    const selected = await globalThis.inspectFont({ id, operation: 'selected' });
    resource.dispose();
    style.remove();
    return { imported, selected };
  }, id);
  assert.equal(imported.imported.selected, false);
  assert.equal(imported.selected.selected, true);
  await page.reload();
  await load();
  const restored = await page.evaluate(async (id) => {
    const catalog = {
      read: () => JSON.parse(localStorage.getItem('userfonts') || '[]'),
      write: (fonts) => localStorage.setItem('userfonts', JSON.stringify(fonts))
    };
    const cache = await caches.open('ttu-userfonts');
    const resource = await globalThis.fontFixture.embeddedFontStyleSheet(
      catalog.read(),
      cache,
      new AbortController().signal
    );
    const style = document.createElement('style');
    style.id = 'ttu-userfonts';
    style.textContent = resource.css;
    document.head.append(style);
    try {
      const restored = await globalThis.inspectFont({ id, operation: 'selected' });
      await globalThis.fontFixture.removeUserFont(cache, catalog, catalog.read()[0], {
        read: () => localStorage.getItem('fontFamilyGroupOne'),
        write: (name) => localStorage.setItem('fontFamilyGroupOne', name)
      });
      resource.dispose();
      style.remove();
      const cleanup = await globalThis.inspectFont({ id, operation: 'cleanup' });
      return { restored, cleanup };
    } finally {
      resource.dispose();
      style.remove();
    }
  }, id);
  assert.deepEqual(restored.restored, imported.selected);
  assert.deepEqual(restored.cleanup, { removed: true, restored: true });
  assert.ok(
    requests.every((path) =>
      ['/www.bundle/index.html', '/www.bundle/fixture.woff2', '/favicon.ico'].includes(path)
    ),
    JSON.stringify(requests)
  );
  console.log(
    `${engine}: real WOFF2 bytes, cache import without selection, embedded blob CSS decoding, selected-font reload and exact removal passed`
  );
} catch (error) {
  if (page)
    console.error(
      'Font fixture failure:',
      await page
        .evaluate(async () => ({
          url: location.href,
          catalog: localStorage.getItem('userfonts'),
          caches: await caches.keys(),
          entries: await Promise.all(
            (await (await caches.open('ttu-userfonts')).keys()).map(async (request) => {
              const response = await (await caches.open('ttu-userfonts')).match(request);
              return {
                path: new URL(request.url).pathname,
                mime: response?.headers.get('content-type'),
                bytes: (await response?.arrayBuffer())?.byteLength
              };
            })
          )
        }))
        .catch(() => 'Browser diagnostics unavailable')
    );
  throw error;
} finally {
  try {
    if (context) await context.close();
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      try {
        await new Promise((resolve) => server.close(resolve));
      } finally {
        if (profile) {
          const trash = path.join(os.homedir(), '.Trash');
          await mkdir(trash, { recursive: true });
          await rename(profile, path.join(await realpath(trash), path.basename(profile)));
        }
      }
    }
  }
}
