import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(new globalThis.URL('../../package.json', import.meta.url));
const { build } = require('esbuild');
const { chromium } = require('@playwright/test');
const root = fileURLToPath(new globalThis.URL('../../', import.meta.url));
const built = await build({
  stdin: {
    contents:
      "export { createBookPresentationSource } from './apps/web/src/lib/functions/book-data-loader/book-presentation-source.ts';" +
      "export { BlurMode } from './apps/web/src/lib/data/blur-mode.ts';",
    resolveDir: root,
    loader: 'ts'
  },
  alias: { $lib: `${root}apps/web/src/lib` },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'BookPresentationFixture',
  platform: 'browser'
});
const script = built.outputFiles[0].text;
const server = createServer((request, response) => {
  if (request.url === '/fixture.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript' });
    response.end(script);
  } else {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><html><body><script src="/fixture.js"></script></body></html>');
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Missing fixture server address');
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const remoteRequests = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://')) remoteRequests.push(request.url());
  });
  await page.goto(`http://127.0.0.1:${address.port}`);
  const checks = await page.evaluate(async () => {
    const { createBookPresentationSource, BlurMode } = globalThis.BookPresentationFixture;
    const document = globalThis.document;
    const image = new globalThis.Blob(['fixture'], { type: 'image/png' });
    const placeholder = (key) =>
      `data:image/gif;ttu:${key};base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==`;
    const key = '猫&犬.png';
    const book = {
      blobs: { [key]: image, 'unused.png': image },
      elementHtml:
        '<section id="ttu-1"><p>猫<ruby>漢字<rt>かんじ</rt></ruby>。</p>' +
        `<img src="ttu:${key}"><img src="https://forbidden.invalid/tracker">` +
        '<m-m data-reader-lookup="forged">読書</m-m><script>globalThis.injected=true</script></section>'
    };
    const make = () => createBookPresentationSource(book, document, () => 'image/png');
    const first = make();
    const canonical = first.sourceHtml;
    const beforeResources = !canonical.includes('blob:');
    const forgedStripped = !canonical.includes('<m-m') && !canonical.includes('data-reader-lookup');
    const networkStripped = !canonical.includes('forbidden.invalid') && !canonical.includes('<script');
    const canonicalImage = document.createElement('template');
    canonicalImage.innerHTML = canonical;
    const stableImage = canonicalImage.content.querySelector('img').getAttribute('src');
    await first.prepare();
    const plain = first.render(canonical, BlurMode.AFTER_TOC);
    const plainDom = document.createElement('div');
    plainDom.innerHTML = plain;
    const firstURL = plainDom.querySelector('img').getAttribute('src');
    const retainedRuby = plainDom.querySelector('rt')?.textContent === 'かんじ';
    const ordinaryHasNoAnnotations = !plainDom.querySelector('m-m');
    const gallery = first.pictures(true);
    const annotated =
      '<section id="ttu-1"><m-c pid="p1"><m-s sid="s1">' +
      '<m-m id="m1" data-reader-lookup="forged">猫</m-m>。</m-s></m-c>' +
      `<img src="${placeholder(key)}"></section>`;
    const processedDom = document.createElement('div');
    processedDom.innerHTML = first.render(annotated, BlurMode.AFTER_TOC, true);
    const annotationsSurvive =
      processedDom.querySelector('m-m')?.id === 'm1' &&
      processedDom.querySelector('m-s')?.getAttribute('sid') === 's1' &&
      processedDom.querySelector('m-c')?.getAttribute('pid') === 'p1';
    const forgedRuntimeStripped = !processedDom.querySelector('[data-reader-lookup]');
    const second = make();
    await second.prepare();
    const secondDom = document.createElement('div');
    secondDom.innerHTML = second.render(second.sourceHtml, BlurMode.AFTER_TOC);
    const secondURL = secondDom.querySelector('img').getAttribute('src');
    first.dispose();
    let oldRevoked = false;
    try {
      await globalThis.fetch(firstURL);
    } catch {
      oldRevoked = true;
    }
    const successorStillOwned = (await globalThis.fetch(secondURL)).ok;
    second.dispose();
    return {
      beforeResources,
      forgedStripped,
      networkStripped,
      stableImage: stableImage === placeholder(key),
      canonicalUnchanged: first.sourceHtml === canonical,
      realURL: firstURL.startsWith('blob:'),
      retainedRuby,
      ordinaryHasNoAnnotations,
      gallery: gallery.length === 1 && gallery[0].url === firstURL && !gallery[0].unspoilered,
      annotationsSurvive,
      forgedRuntimeStripped,
      uniqueReadLifetimes: firstURL !== secondURL,
      oldRevoked,
      successorStillOwned,
      noScriptExecution: globalThis.injected !== true
    };
  });
  for (const [name, passed] of Object.entries(checks)) {
    assert.equal(passed, true, name);
    globalThis.console.log(`PASS ${name}`);
  }
  assert.deepEqual(remoteRequests, [], 'source or rendered images must not make remote requests');
  globalThis.console.log('PASS no remote requests');
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
