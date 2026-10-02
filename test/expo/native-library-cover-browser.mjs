/** @license BSD-3-Clause */
// Real Chromium local-image decode/canvas smoke. Not an Android device qualification.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || '@playwright/test');
const { outputFiles } = await build({
  entryPoints: ['apps/web/src/native-library/cover-raster.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'coverFixture',
  write: false,
  tsconfig: 'apps/web/tsconfig.json',
  logLevel: 'silent'
});
const requests = [];
const server = createServer((request, response) => {
  requests.push(request.url);
  response.setHeader('content-type', 'text/html');
  response.end('<!doctype html><title>Native cover raster smoke</title>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.addScriptTag({ content: outputFiles[0].text });
  const result = await page.evaluate(async () => {
    const { rasterizeLocalCover, localCoverFingerprint, NATIVE_COVER_SOURCE_LIMIT } =
      globalThis.coverFixture;
    const controller = new AbortController();
    const authority = {
      key: 'fixture',
      signal: controller.signal,
      assertCurrent() {
        controller.signal.throwIfAborted();
      }
    };
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 900;
    const context = canvas.getContext('2d');
    context.fillStyle = 'red';
    context.fillRect(0, 0, 300, 900);
    context.fillStyle = 'blue';
    context.fillRect(300, 0, 300, 900);
    const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    let created = 0,
      revoked = 0;
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      created++;
      return create(blob);
    };
    URL.revokeObjectURL = (url) => {
      revoked++;
      return revoke(url);
    };
    const sharp = await rasterizeLocalCover(png, false, authority);
    const blur = await rasterizeLocalCover(png, true, authority);
    const legacy = await rasterizeLocalCover(canvas.toDataURL('image/png'), false, authority);
    const invalid = [];
    for (const input of [
      'https://provider.test/private?token=secret',
      'file:///private',
      'javascript:alert(1)',
      'blob:restored',
      'data:image/svg+xml;base64,AAAA',
      new Blob(['<html>private</html>'], { type: 'text/html' }),
      new Blob(['invalid raster'], { type: 'image/png' }),
      new Blob([new Uint8Array(NATIVE_COVER_SOURCE_LIMIT + 1)], { type: 'image/png' })
    ])
      invalid.push(await rasterizeLocalCover(input, false, authority));
    const svg = new Blob(
      [
        `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="90"><script>fetch('/escaped-script')</script><image href="${location.origin}/escaped-image" width="60" height="90"/><rect width="60" height="90" fill="green"/></svg>`
      ],
      { type: 'image/svg+xml' }
    );
    const svgResult = await rasterizeLocalCover(svg, false, authority);
    const wide = new Blob(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" width="9000" height="1"><rect width="9000" height="1"/></svg>'
      ],
      { type: 'image/svg+xml' }
    );
    const excessiveDimensions = await rasterizeLocalCover(wide, false, authority);
    const fingerprint = await localCoverFingerprint(png, authority);
    const cancellation = new AbortController();
    const pending = rasterizeLocalCover(png, false, {
      key: 'cancel',
      signal: cancellation.signal,
      assertCurrent() {}
    });
    cancellation.abort();
    let cancelled = false;
    try {
      await pending;
    } catch {
      cancelled = true;
    }
    async function sample(image, x) {
      const el = document.createElement('img');
      el.src = image.uri;
      await el.decode();
      const out = document.createElement('canvas');
      out.width = image.width;
      out.height = image.height;
      const ctx = out.getContext('2d');
      ctx.drawImage(el, 0, 0);
      return [...ctx.getImageData(x, Math.floor(out.height / 2), 1, 1).data];
    }
    return {
      sharp,
      blur,
      legacy,
      invalid,
      svgResult,
      excessiveDimensions,
      fingerprint,
      cancelled,
      created,
      revoked,
      sharpSample: await sample(sharp, 110),
      blurSample: await sample(blur, 110)
    };
  });
  for (const image of [result.sharp, result.blur, result.legacy, result.svgResult]) {
    assert.match(image.uri, /^data:image\/jpeg;base64,/);
    assert.ok(Buffer.from(image.uri.split(',')[1], 'base64').length <= 48 * 1024);
    assert.ok(image.width <= 240 && image.height <= 360);
    assert.doesNotMatch(image.uri, /https:|file:|<svg|escaped/);
  }
  assert.deepEqual(result.invalid, Array(8).fill(null));
  assert.equal(result.excessiveDimensions, null);
  assert.match(result.fingerprint, /^image\/png:[a-f0-9]{64}$/);
  assert.equal(result.cancelled, true);
  assert.equal(result.created, result.revoked, 'every created object URL is revoked');
  assert.ok(
    result.blurSample[2] > result.sharpSample[2] + 10,
    'saved blur visibly mixes pixels before bridging'
  );
  assert.equal(
    requests.some((url) => url.startsWith('/escaped-')),
    false,
    'SVG cover image cannot load external resources or execute scripts'
  );
  console.log(
    'Real Chromium: bounded raster/legacy/SVG conversion, pre-bridge blur, source/dimension rejection, cancellation, object-URL cleanup and no external cover requests passed'
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
