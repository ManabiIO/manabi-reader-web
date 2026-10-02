/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
const require = createRequire(import.meta.url);
const root = new URL('../../', import.meta.url);
const text = (file) => readFileSync(new URL(file, root), 'utf8');

test('the real snippets browser matrix starts and checks the Expo static server before either engine', () => {
  const workflow = text('.github/workflows/snippets.yml');
  assert.match(workflow, /PORT=4178 BASE_PATH=\/reader-web node scripts\/serve-expo\.mjs/);
  assert.doesNotMatch(workflow, /vite preview/);
  assert.match(workflow, /if ! kill -0 "\$server"/);
  assert.match(workflow, /if \[ "\$ready" != true \]; then/);
  assert.match(workflow, /trap 'kill "\$server"/);
  assert.match(workflow, /for engine in chromium webkit/);
  assert.match(workflow, /node test\/snippets\/browser\.mjs/);
});

test('isolated media compilation retains strict types and declares the actual Expo environment', () => {
  const source = text('tools/media/test.mjs');
  assert.match(source, /'--types',\s*'node'/);
  assert.match(source, /'--strict'/);
  assert.match(source, /n\.endsWith\('\.ts'\)/);
});

test('Metro preserves the legacy video release flag while preferring explicit Expo values', () => {
  for (const [initial, expected] of [
    [{}, undefined],
    [{ VITE_ENABLE_VIDEO_LEARNING: 'true' }, 'true'],
    [{ VITE_ENABLE_VIDEO_LEARNING: 'false' }, 'false'],
    [{ VITE_ENABLE_VIDEO_LEARNING: 'true', EXPO_PUBLIC_ENABLE_VIDEO_LEARNING: 'false' }, 'false'],
    [{ VITE_ENABLE_VIDEO_LEARNING: 'false', EXPO_PUBLIC_ENABLE_VIDEO_LEARNING: 'true' }, 'true']
  ]) {
    const env = { ...initial };
    vm.runInNewContext(text('apps/web/metro.config.cjs'), {
      process: { env },
      __dirname: '/app/apps/web',
      module: { exports: {} },
      require(name) {
        if (name === 'node:process') return { env };
        if (name === 'expo/metro-config')
          return { getDefaultConfig: () => ({ resolver: { sourceExts: [], assetExts: [] } }) };
        if (name === 'node:path') return path;
        if (name === './metro-source-resolver.cjs') return () => () => {};
        return require(name);
      }
    });
    assert.equal(env.EXPO_PUBLIC_ENABLE_VIDEO_LEARNING, expected);
    assert.equal(env.VITE_ENABLE_VIDEO_LEARNING, initial.VITE_ENABLE_VIDEO_LEARNING);
  }
});

test('production emitted-worker gates use original web and APK bytes without supplying Expo globals', () => {
  const workflow = text('.github/workflows/expo-migration.yml');
  assert.match(workflow, /exported-pitch-browser\.mjs --platform web --output apps\/web\/build/);
  assert.match(
    workflow,
    /exported-pitch-browser\.mjs --platform apk --output apps\/web\/android\/app\/build\/outputs\/apk\/release\/app-release\.apk/
  );
  const script = text('test/expo/exported-pitch-browser.mjs');
  assert.match(script, /readFile\(workerFile/);
  assert.match(
    script,
    /new Worker\(new URL\(workerPath, document.baseURI\), \{ type: 'module' \}\)/
  );
  assert.match(script, /hz > 210 && hz < 230/);
  assert.doesNotMatch(script, /(?:globalThis|window|self)\.__ExpoImportMetaRegistry\s*=/);
  assert.doesNotMatch(
    text('test/expo/onnx-runtime-browser.mjs'),
    /(?:globalThis|window|self)\.__ExpoImportMetaRegistry\s*=/
  );
});
