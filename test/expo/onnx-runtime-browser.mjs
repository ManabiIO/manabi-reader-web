/** @license BSD-3-Clause */
// Focused genuine-inference smoke, not a full Expo export or Android WebView test.
// ORT passes through the installed production Expo Babel config and collector;
// esbuild assembles the test worker with the actual SwiftF0 runtime code.
// Run: node test/expo/onnx-runtime-browser.mjs
// Requires the declared @playwright/test dependency and its Chromium installation,
// or PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH. --build-only validates both fixtures.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { readerContentSecurityPolicy } from '../../apps/web/src/platform/content-security-policy.mjs';
import {
  app,
  collect,
  expoRequire,
  generate,
  ortFile,
  transformORT
} from './onnx-runtime-fixture.mjs';

const directory = await mkdtemp(path.join(tmpdir(), 'manabi-onnx-browser-'));
const requests = [];
let server;
let browser;
const fixtures = [
  { name: 'web', base: '/reader-web/', dom: false },
  { name: 'Android DOM asset paths', base: '/www.bundle/', dom: true }
];

try {
  for (const fixture of fixtures) {
    const output = path.join(directory, fixture.base);
    await mkdir(output, { recursive: true });
    const ast = transformORT({ dom: fixture.dom });
    collect(ast);
    const ortCode = generate(ast).code;
    assert.match(ortCode, /import\(\/\* webpackIgnore: true \*\//);
    fixture.assets = [];
    await build({
      entryPoints: [path.join(app, 'src/lib/features/whispersync/pitch/voice-pitch.worker.ts')],
      outdir: output,
      entryNames: '_expo/static/js/web/[name]',
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      minify: true,
      // Reproduce the absence of a usable ESM module URL after Metro's rewrite.
      banner: {
        js: `globalThis.__ExpoImportMetaRegistry = { url: undefined };
        if (typeof Worker !== 'undefined') {
          const OriginalWorker = Worker;
          globalThis.Worker = class extends OriginalWorker {
            constructor(...args) { super(...args); postMessage({ type: 'unexpected-nested-worker' }); }
          };
        }`
      },
      plugins: [
        {
          name: 'expo-ort-and-document-relative-assets',
          setup(bundle) {
            bundle.onResolve({ filter: /^onnxruntime-web\/wasm$/ }, () => ({
              path: ortFile,
              namespace: 'expo-ort'
            }));
            bundle.onLoad({ filter: /.*/, namespace: 'expo-ort' }, () => ({
              contents: ortCode,
              resolveDir: path.dirname(ortFile)
            }));
            // Resolve Expo-inserted helpers through their declared dependency owner.
            bundle.onResolve({ filter: /^@babel\/runtime\// }, (args) => ({
              path: expoRequire.resolve(args.path)
            }));
            bundle.onLoad({ filter: /\.(?:onnx|wasm)$/ }, async (args) => {
              const bytes = await readFile(args.path);
              const extension = path.extname(args.path);
              const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
              const asset = `assets/${path.basename(args.path, extension)}-${hash}${extension}`;
              await mkdir(path.join(output, 'assets'), { recursive: true });
              await writeFile(path.join(output, asset), bytes);
              fixture.assets.push(fixture.base + asset);
              // Web exports use the application prefix; DOM exports are relative to
              // www.bundle's document. Neither is relative to the worker directory.
              return {
                contents: `export default ${JSON.stringify(fixture.dom ? asset : fixture.base + asset)};`,
                loader: 'js'
              };
            });
          }
        }
      ]
    });
    await writeFile(
      path.join(output, 'index.html'),
      `<!doctype html><meta http-equiv="Content-Security-Policy" content="${readerContentSecurityPolicy()}"><title>SwiftF0 production transform smoke</title>`
    );
  }
  if (process.argv.includes('--build-only')) {
    console.log(
      'SwiftF0 browser fixtures built with production Expo web and Android DOM transforms; runtime not run'
    );
  } else {
    const { chromium } = await import('@playwright/test');
    const executablePath =
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
      (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {})
    });
    server = createServer(async (request, response) => {
      const url = new URL(request.url, 'http://localhost');
      requests.push(url.pathname);
      const file = path.join(directory, decodeURIComponent(url.pathname));
      if (!file.startsWith(directory + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      try {
        const type = file.endsWith('.js')
          ? 'text/javascript'
          : file.endsWith('.wasm')
            ? 'application/wasm'
            : file.endsWith('.html')
              ? 'text/html'
              : 'application/octet-stream';
        response.setHeader('Content-Type', type);
        response.setHeader('Content-Security-Policy', readerContentSecurityPolicy());
        response.end(await readFile(file));
      } catch {
        response.writeHead(404).end();
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const fixture of fixtures) {
      const page = await browser.newPage();
      const errors = [];
      const browserRequests = [];
      page.context().on('request', (request) => browserRequests.push(request.url()));
      page.on('pageerror', (error) => errors.push(error.message));
      const start = requests.length;
      await page.goto(origin + fixture.base + 'index.html');
      await page.evaluate(() => {
        window.pitchMessages = [];
        window.pitchWorker = new Worker(
          new URL('_expo/static/js/web/voice-pitch.worker.js', document.baseURI),
          { type: 'module' }
        );
        window.pitchWorker.onmessage = ({ data }) => window.pitchMessages.push(data);
        window.pitchWorker.onerror = (event) =>
          window.pitchMessages.push({ type: 'error', error: event.message });
      });
      await page.waitForTimeout(150);
      assert.ok(
        !requests.slice(start).some((url) => /\.(?:onnx|wasm)$/.test(url)),
        `${fixture.name}: model/runtime fetched before init`
      );
      await page.evaluate(() =>
        window.pitchWorker.postMessage({ type: 'init', assetBaseURL: document.baseURI })
      );
      await page.waitForFunction(
        () => window.pitchMessages.some((message) => ['ready', 'error'].includes(message.type)),
        undefined,
        { timeout: 30000 }
      );
      const ready = await page.evaluate(() => window.pitchMessages);
      assert.deepEqual(
        ready,
        [{ type: 'ready', detector: 'swift-f0-0.3.0' }],
        `${fixture.name}: model initialization failed`
      );
      await page.evaluate(() => {
        const rate = 16000;
        const samples = Float32Array.from(
          { length: 8800 },
          (_, i) => 0.6 * Math.sin((2 * Math.PI * 220 * i) / rate)
        );
        window.pitchWorker.postMessage({ type: 'analyze', samples, rate, epoch: 1, id: 1 }, [
          samples.buffer
        ]);
      });
      await page.waitForFunction(
        () => window.pitchMessages.some((message) => ['result', 'error'].includes(message.type)),
        undefined,
        { timeout: 30000 }
      );
      const messages = await page.evaluate(() => window.pitchMessages);
      assert.deepEqual(
        messages.map((message) => message.type),
        ['ready', 'result']
      );
      const result = messages.find((message) => message.type === 'result');
      assert.ok(result, JSON.stringify(messages));
      assert.ok(result.result.hz > 210 && result.result.hz < 230, JSON.stringify(result));
      const fetched = requests.slice(start);
      for (const asset of fixture.assets)
        assert.ok(fetched.includes(asset), `${fixture.name}: missing real asset request ${asset}`);
      assert.ok(
        !fetched.some((url) => /\/_expo\/.*\.(?:wasm|onnx)$/.test(url)),
        `${fixture.name}: assets resolved against worker path`
      );
      assert.ok(
        !fetched.some((url) => /\.mjs$/.test(url)),
        `${fixture.name}: unexpectedly needed external ORT JavaScript`
      );
      assert.equal(
        fetched.filter((url) => /\.js$/.test(url)).length,
        1,
        `${fixture.name}: unexpectedly created another worker/script`
      );
      assert.ok(
        browserRequests.every((url) => url.startsWith(origin + '/')),
        `${fixture.name}: unexpected remote resource request`
      );
      assert.deepEqual(errors, []);
      console.log(
        `${fixture.name}: real SwiftF0 inference ${result.result.hz.toFixed(2)} Hz; one worker, embedded ORT factory, document-root model/WASM assets, unchanged CSP`
      );
      await page.close();
    }
  }
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
