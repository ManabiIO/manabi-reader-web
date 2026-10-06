/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';
import { app } from './onnx-runtime-fixture.mjs';

const pitch = path.join(app, 'src/lib/features/whispersync/pitch');
const urlsSource = stripTypeScriptTypes(readFileSync(path.join(pitch, 'asset-urls.ts'), 'utf8'));
const { resolveSwiftF0AssetURLs } = await import(
  `data:text/javascript;base64,${Buffer.from(urlsSource).toString('base64')}`
);

test('SwiftF0 resolves web and Android DOM assets against the owning document, not its worker chunk', () => {
  for (const base of [
    'https://reader.invalid/reader-web/index.html',
    'https://appassets.androidplatform.net/www.bundle/reader.html',
    'file:///android_asset/www.bundle/reader.html'
  ]) {
    const assets = resolveSwiftF0AssetURLs(
      base,
      'assets/model.hash.onnx',
      'assets/runtime.hash.wasm'
    );
    assert.equal(assets.model, new URL('assets/model.hash.onnx', base).href);
    assert.equal(assets.wasm, new URL('assets/runtime.hash.wasm', base).href);
    assert.ok(!assets.model.includes('/_expo/'));
    assert.ok(!assets.wasm.includes('/_expo/'));
  }
  assert.deepEqual(
    resolveSwiftF0AssetURLs(
      'https://reader.invalid/reader-web/b/42',
      '/reader-web/assets/model.onnx',
      '/reader-web/assets/runtime.wasm'
    ),
    {
      model: 'https://reader.invalid/reader-web/assets/model.onnx',
      wasm: 'https://reader.invalid/reader-web/assets/runtime.wasm'
    }
  );
  assert.deepEqual(
    resolveSwiftF0AssetURLs(
      'file:///android_asset/www.bundle/reader.html',
      'abc123.onnx',
      'def456.wasm'
    ),
    {
      model: 'file:///android_asset/www.bundle/abc123.onnx',
      wasm: 'file:///android_asset/www.bundle/def456.wasm'
    }
  );
  assert.throws(() =>
    resolveSwiftF0AssetURLs('not-an-absolute-base', 'assets/model.onnx', 'assets/runtime.wasm')
  );
});

test('the browser sends its document base to every new pitch worker', async () => {
  const result = await build({
    entryPoints: [path.join(pitch, 'browser.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'PitchBrowser',
    platform: 'browser',
    define: {
      'import.meta.url': JSON.stringify('https://reader.invalid/_expo/static/js/web/browser.js')
    },
    plugins: [
      {
        name: 'capture-pitch-environment',
        setup(bundle) {
          bundle.onResolve({ filter: /^\.\/controller$/ }, () => ({
            path: 'controller',
            namespace: 'test'
          }));
          bundle.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
            contents:
              'export class PitchController { constructor(environment) { this.environment = environment; } }'
          }));
        }
      }
    ]
  });
  for (const baseURI of [
    'https://reader.invalid/reader-web/index.html',
    'file:///android_asset/www.bundle/reader.html'
  ]) {
    const messages = [];
    class Worker {
      postMessage(data) {
        messages.push(data);
      }
    }
    const context = vm.createContext({ Worker, URL, document: { baseURI } });
    vm.runInContext(result.outputFiles[0].text, context);
    const controller = context.PitchBrowser.createPitchController(() => {});
    assert.ok(controller.environment.createWorker() instanceof Worker);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, 'init');
    assert.equal(messages[0].assetBaseURL, baseURI);
  }
});

async function workerFixture({ fail = false } = {}) {
  const result = await build({
    entryPoints: [path.join(pitch, 'voice-pitch.worker.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    plugins: [
      {
        name: 'observe-pitch-initialization',
        setup(bundle) {
          bundle.onResolve({ filter: /^\.\/swift-f0$/ }, () => ({
            path: 'swift-f0',
            namespace: 'test'
          }));
          bundle.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
            contents: `
        export function prepareSwiftF0(base) { globalThis.prepares.push(base); return ${fail ? 'Promise.reject(new Error("model load failed"))' : 'Promise.resolve({})'}; }
        export async function analyseSwiftF0Window() { globalThis.analyses++; return { hz: 220, rms: 1 }; }
      `
          }));
        }
      }
    ]
  });
  const messages = [];
  const context = vm.createContext({
    Float32Array,
    prepares: [],
    analyses: 0,
    postMessage: (message) => messages.push(message)
  });
  vm.runInContext(result.outputFiles[0].text, context);
  return { context, messages, send: (data) => context.onmessage({ data }) };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('pitch worker waits for init, ignores duplicate init and only analyses after readiness', async () => {
  const worker = await workerFixture();
  const analyse = { type: 'analyze', samples: new Float32Array([1]), rate: 16000, epoch: 1, id: 7 };
  worker.send(analyse);
  await flush();
  assert.equal(worker.context.prepares.length, 0);
  assert.equal(worker.context.analyses, 0);
  const base = 'https://appassets.androidplatform.net/www.bundle/reader.html';
  worker.send({ type: 'init', assetBaseURL: base });
  worker.send({ type: 'init', assetBaseURL: 'https://other.invalid/' });
  await flush();
  assert.equal(worker.context.prepares.length, 1);
  assert.equal(worker.context.prepares[0], base);
  assert.equal(worker.messages[0].type, 'ready');
  assert.equal(worker.messages[0].detector, 'swift-f0-0.3.0');
  worker.send(analyse);
  await flush();
  assert.equal(worker.context.analyses, 1);
  assert.equal(worker.messages[1].type, 'result');
  assert.equal(worker.messages[1].id, 7);
});

test('invalid init or model-load failure produces a load error and never readiness', async () => {
  for (const fail of [false, true]) {
    const worker = await workerFixture({ fail });
    worker.send({
      type: 'init',
      ...(fail ? { assetBaseURL: 'https://reader.invalid/reader-web/' } : {})
    });
    await flush();
    assert.equal(worker.messages.length, 1);
    assert.equal(worker.messages[0].type, 'error');
    assert.equal(worker.messages[0].phase, 'load');
  }
});
