/** @license BSD-3-Clause */
// Real DOM-owned storage, image decoding and bounded native projection; not Android acceptance.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium, webkit } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const engine = process.env.BACKGROUND_BROWSER || 'chromium';
assert.ok(['chromium', 'webkit'].includes(engine));
const { outputFiles } = await build({
  stdin: {
    contents: `export * from './apps/web/src/native-settings/background-service.dom'; export * from './apps/web/src/native-settings/background-contract'; export {libraryBackgroundOptions$,readerBackgroundOptions$} from './apps/web/src/lib/appearance/state';`,
    resolveDir: process.cwd(),
    loader: 'ts'
  },
  bundle: true,
  format: 'iife',
  globalName: 'backgroundFixture',
  write: false,
  tsconfig: 'apps/web/tsconfig.json',
  logLevel: 'silent'
});
const requests = [];
const server = createServer((req, res) => {
  requests.push(req.url);
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><title>Background resource fixture</title>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser, context, profile;
try {
  if (engine === 'webkit') {
    profile = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'reader-background-webkit-'))
    );
    context = await webkit.launchPersistentContext(profile, { headless: true });
  } else {
    browser = await chromium.launch({
      headless: true,
      args: process.platform === 'darwin' ? ['--disable-features=MacAppCodeSignClone'] : []
    });
    context = await browser.newContext();
  }
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.addScriptTag({ content: outputFiles[0].text });
  const result = await page.evaluate(async () => {
    const api = globalThis.backgroundFixture;
    const controller = new AbortController(),
      authority = {
        signal: controller.signal,
        assertCurrent() {
          controller.signal.throwIfAborted();
        }
      };
    const canvas = document.createElement('canvas');
    canvas.width = 2400;
    canvas.height = 1200;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'red';
    ctx.fillRect(0, 0, 1200, 1200);
    const create = (type) =>
      new Promise((resolve) =>
        canvas.toBlob(
          (blob) =>
            resolve(new File([blob], 'synthetic.' + type.split('/')[1], { type: blob.type })),
          type
        )
      );
    const summary = [];
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      const file = await create(type);
      // A platform without this encoder does not supply an unrelated MIME type.
      if (file.type !== type) continue;
      const target = { target: 'library', mode: 'light', type };
      const state = await api.importNativeBackground(target, file, authority);
      if (!api.isNativeBackgroundState(state)) throw new Error('Invalid metadata');
      api.libraryBackgroundOptions$.next({ fade: true, amount: 37 });
      const resource = await api.readNativeBackgroundResource(
        { target: 'library', mode: 'light' },
        authority
      );
      const image = new window.Image();
      image.src = resource.image.uri;
      await image.decode();
      const sample = document.createElement('canvas');
      sample.width = image.naturalWidth;
      sample.height = image.naturalHeight;
      const sampleCtx = sample.getContext('2d');
      sampleCtx.drawImage(image, 0, 0);
      const alpha = sampleCtx.getImageData(
        image.naturalWidth - 1,
        Math.floor(image.naturalHeight / 2),
        1,
        1
      ).data[3];
      summary.push({
        type,
        bytes: window.atob(resource.image.uri.split(',')[1]).length,
        width: image.naturalWidth,
        height: image.naturalHeight,
        fade: resource.fade,
        alpha
      });
      sample.width = sample.height = 0;
      image.src = '';
    }
    const lightBefore = await api.readNativeBackgroundResource(
      { target: 'library', mode: 'light' },
      authority
    );
    const dark = await create('image/png');
    await api.importNativeBackground(
      { target: 'library', mode: 'dark', type: 'image/png' },
      dark,
      authority
    );
    const lightAfter = await api.readNativeBackgroundResource(
      { target: 'library', mode: 'light' },
      authority
    );
    const metadata = await api.readNativeBackgroundState({}, authority);
    const rejected = [];
    for (const file of [
      new File(['<svg><image href="/escaped"/></svg>'], 'bad.png', { type: 'image/png' }),
      new File(['bad'], 'bad.webp', { type: 'image/webp' }),
      new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })
    ]) {
      try {
        await api.importNativeBackground(
          { target: 'library', mode: 'light', type: file.type },
          file,
          authority
        );
        rejected.push(false);
      } catch {
        rejected.push(true);
      }
    }
    const unchanged = await api.readNativeBackgroundResource(
      { target: 'library', mode: 'light' },
      authority
    );
    const cancelled = new AbortController();
    cancelled.abort();
    let cancellation = false;
    try {
      await api.importNativeBackground(
        { target: 'library', mode: 'light', type: 'image/png' },
        dark,
        { signal: cancelled.signal, assertCurrent() {} }
      );
    } catch {
      cancellation = true;
    }
    canvas.width = canvas.height = 0;
    return {
      summary,
      metadata,
      rejected,
      cancellation,
      independent: lightBefore.image.uri === lightAfter.image.uri,
      preserved: unchanged.image.uri === lightBefore.image.uri
    };
  });
  assert.equal(result.independent, true);
  assert.equal(result.preserved, true);
  assert.equal(result.cancellation, true);
  assert.deepEqual(result.rejected, [true, true, true]);
  assert.doesNotMatch(JSON.stringify(result.metadata), /data:|blob:|https:|file:/);
  assert.equal(result.metadata.slots.filter((slot) => slot.present).length, 2);
  for (const image of result.summary) {
    assert.ok(image.bytes <= 384 * 1024);
    assert.ok(image.width <= 2048);
    assert.equal(image.width / image.height, 2);
    assert.equal(image.fade, 0.37);
    if (image.type !== 'image/jpeg') assert.equal(image.alpha, 0);
  }
  assert.ok(result.summary.some((image) => image.type === 'image/png'));
  await page.reload();
  await page.addScriptTag({ content: outputFiles[0].text });
  const reopened = await page.evaluate(async () => {
    const api = globalThis.backgroundFixture,
      authority = { signal: new AbortController().signal, assertCurrent() {} };
    const before = await api.readNativeBackgroundState({}, authority);
    const image = await api.readNativeBackgroundResource(
      { target: 'library', mode: 'dark' },
      authority
    );
    const removed = await api.changeNativeBackground(
      { type: 'remove', target: 'library', mode: 'light' },
      authority
    );
    const both = await api.changeNativeBackground(
      { type: 'remove', target: 'library', mode: 'both' },
      authority
    );
    const opening = indexedDB.open('manabi-reader-appearance', 1);
    const db = await new Promise((resolve, reject) => {
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const tx = db.transaction('backgrounds', 'readwrite');
    tx.objectStore('backgrounds').put(
      { light: { name: 'restored.png', dataUrl: location.origin + '/escaped-source' } },
      'reader'
    );
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = reject;
    });
    let corrupt = false;
    try {
      await api.readNativeBackgroundResource({ target: 'reader', mode: 'light' }, authority);
    } catch {
      corrupt = true;
    }
    const recovered = await api.changeNativeBackground(
      { type: 'remove', target: 'reader', mode: 'both' },
      authority
    );
    db.close();
    return {
      before,
      valid: api.isNativeBackgroundResource(image),
      removed,
      both,
      corrupt,
      recovered
    };
  });
  assert.equal(reopened.before.slots.filter((slot) => slot.present).length, 2);
  assert.equal(reopened.valid, true);
  assert.deepEqual(
    reopened.removed.slots.filter((slot) => slot.present).map((slot) => slot.mode),
    ['dark']
  );
  assert.equal(
    reopened.both.slots.some((slot) => slot.present),
    false
  );
  assert.equal(reopened.corrupt, true);
  assert.equal(
    reopened.recovered.slots.some((slot) => slot.present),
    false
  );
  assert.equal(
    requests.some((url) => url.startsWith('/escaped')),
    false
  );
  assert.deepEqual(errors, []);
  console.log(
    `${engine}: actual local background import, independent mode slots, alpha/aspect, bounded native resources, rejected input preservation, cancellation, document restart and removal passed`
  );
} finally {
  await context?.close();
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  if (profile) {
    const trash = path.join(os.homedir(), '.Trash');
    await fs.mkdir(trash, { recursive: true });
    await fs.rename(profile, path.join(await fs.realpath(trash), path.basename(profile)));
  }
}
