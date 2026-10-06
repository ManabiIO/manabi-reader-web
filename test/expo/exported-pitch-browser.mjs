/** @license BSD-3-Clause */
// Execute byte-for-byte Metro output, without importing the application or
// injecting Expo globals. APK mode proves its asset layout in Chromium only;
// Android WebView/device qualification remains a separate instrumentation gate.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readerContentSecurityPolicy } from '../../apps/web/src/platform/content-security-policy.mjs';
const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
const platform = value('--platform');
assert.ok(['web', 'apk'].includes(platform), '--platform web|apk is required');
assert.ok(args.includes('--output') && args.includes('--qualification'));
const output = path.resolve(value('--output'));
const qualification = JSON.parse(await readFile(value('--qualification'), 'utf8'));
assert.equal(qualification.platform, platform);
assert.equal(qualification.passed, true, 'Artifact verification must pass first');
const prefix = platform === 'web' ? `${qualification.base}/` : '/www.bundle/';
const artifactPrefix = platform === 'apk' ? 'assets/www.bundle/' : '';
let temporary;
let server;
let browser;
const requests = [];
try {
  let root = output;
  if (platform === 'apk') {
    temporary = await mkdtemp(path.join(tmpdir(), 'manabi-pitch-apk-'));
    const entries = execFileSync('unzip', ['-Z1', output], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    })
      .trim()
      .split('\n');
    assert.equal(new Set(entries).size, entries.length, 'Duplicate APK entry');
    const listing = execFileSync('unzip', ['-Z', '-l', output], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    });
    assert.ok(!/^l[rwxstST-]{9}\s/m.test(listing), 'APK symlinks are not allowed');
    assert.ok(entries.includes('AndroidManifest.xml'));
    for (const entry of entries.filter((name) => name.startsWith(artifactPrefix))) {
      assert.ok(!entry.includes('\\') && !entry.split('/').includes('..'), 'Unsafe APK path');
    }
    execFileSync('unzip', ['-q', output, `${artifactPrefix}*`, '-d', temporary]);
    root = path.resolve(temporary, artifactPrefix);
  }
  const references = qualification.evidence.moduleWorkers.filter((url) =>
    /(?:^|\/)voice-pitch-[a-f0-9]+\.js$/.test(url)
  );
  assert.equal(references.length, 1, 'One actual emitted pitch worker is required');
  const documentURL = `http://reader.invalid${prefix}__pitch-qualification__.html`;
  const workerURL = new URL(references[0], documentURL);
  assert.equal(workerURL.origin, 'http://reader.invalid');
  assert.ok(workerURL.pathname.startsWith(prefix));
  const workerFile = path.resolve(
    root,
    decodeURIComponent(workerURL.pathname.slice(prefix.length))
  );
  assert.ok(workerFile.startsWith(root + path.sep));
  const workerSource = await readFile(workerFile, 'utf8');
  assert.equal(
    workerSource.includes('__ExpoImportMetaRegistry'),
    false,
    'Worker must not rely on an uninjected Expo global'
  );
  const assets = ['swift-f0-0.3.0.onnx', 'ort-wasm-simd-threaded.wasm'].map((name) => {
    const entry = qualification.evidence.bundledAssets.find((asset) => asset.name === name);
    assert.ok(entry?.paths.length, `Missing verified ${name}`);
    return entry.paths.map((file) => {
      assert.ok(file.startsWith(artifactPrefix), 'Verified asset is outside the packaged DOM root');
      return prefix + file.slice(artifactPrefix.length);
    });
  });
  const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${readerContentSecurityPolicy()}"><title>Actual emitted pitch worker qualification</title>`;
  server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://reader.invalid');
    requests.push(url.pathname);
    response.setHeader('Content-Security-Policy', readerContentSecurityPolicy());
    if (!['GET', 'HEAD'].includes(request.method) || !url.pathname.startsWith(prefix)) {
      response.writeHead(404).end();
      return;
    }
    if (url.pathname === new URL(documentURL).pathname) {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(html);
      return;
    }
    let file;
    try {
      file = path.resolve(root, decodeURIComponent(url.pathname.slice(prefix.length)));
      assert.ok(file.startsWith(root + path.sep));
      const bytes = await readFile(file);
      response.setHeader(
        'Content-Type',
        file.endsWith('.js')
          ? 'text/javascript'
          : file.endsWith('.wasm')
            ? 'application/wasm'
            : 'application/octet-stream'
      );
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = await import('@playwright/test');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [],
    network = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => network.push(request.url()));
  await page.goto(origin + new URL(documentURL).pathname);
  assert.equal(await page.evaluate(() => '__ExpoImportMetaRegistry' in globalThis), false);
  await page.evaluate((workerPath) => {
    window.pitchMessages = [];
    window.pitchWorker = new Worker(new URL(workerPath, document.baseURI), { type: 'module' });
    window.pitchWorker.onmessage = ({ data }) => window.pitchMessages.push(data);
    window.pitchWorker.onerror = (event) =>
      window.pitchMessages.push({ type: 'error', error: event.message });
  }, workerURL.pathname);
  await page.waitForTimeout(150);
  assert.ok(
    !assets.some((paths) => paths.some((file) => requests.includes(file))),
    'Pitch assets must wait for init'
  );
  await page.evaluate(() =>
    window.pitchWorker.postMessage({ type: 'init', assetBaseURL: document.baseURI })
  );
  await page.waitForFunction(
    () => window.pitchMessages.some((message) => ['ready', 'error'].includes(message.type)),
    undefined,
    { timeout: 30000 }
  );
  assert.deepEqual(await page.evaluate(() => window.pitchMessages), [
    { type: 'ready', detector: 'swift-f0-0.3.0' }
  ]);
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
  const hz = messages[1].result.hz;
  assert.ok(hz > 210 && hz < 230, JSON.stringify(messages));
  for (const paths of assets)
    assert.ok(
      paths.some((file) => requests.includes(file)),
      `Missing real asset request: ${paths}`
    );
  assert.equal(requests.filter((file) => file.endsWith('.js')).length, 1);
  assert.ok(network.every((url) => url.startsWith(origin + '/')));
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.pitchWorker.terminate());
  const evidence = {
    platform,
    inferenceHz: hz,
    worker: workerURL.pathname,
    requestedAssets: requests,
    injectedExpoGlobals: false,
    androidRuntimeQualified: false
  };
  if (args.includes('--report'))
    await writeFile(value('--report'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
