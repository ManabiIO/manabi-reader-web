/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';
const app = new URL('../../apps/web/', import.meta.url);
test('Expo document retains manifest, icon, pre-paint appearance and root contracts for every deployment prefix', () => {
  const source = readFileSync(new URL('expo-index.html', app), 'utf8');
  for (const base of ['', '/reader-web', '/nested/reader']) {
    const html = source
      .replaceAll('{{BASE_PATH}}', base)
      .replace('%LANG_ISO_CODE%', 'ja')
      .replace('%WEB_TITLE%', 'Manabi Reader');
    const document = new JSDOM(html, { url: `https://reader.invalid${base}/manage` }).window
      .document;
    assert.equal(document.documentElement.lang, 'ja');
    assert.equal(document.querySelectorAll('body #root').length, 1);
    assert.equal(
      document.querySelector('link[rel=manifest]').getAttribute('href'),
      `${base}/manifest.webmanifest`
    );
    assert.equal(
      document.querySelector('script').getAttribute('src'),
      `${base}/appearance-init.js`
    );
    assert(document.querySelector('meta[name="color-scheme"]'));
    assert(document.body.classList.contains('font-sans'));
    for (const element of document.querySelectorAll('[href],[src]')) {
      const url = new URL(
        element.getAttribute('href') ?? element.getAttribute('src'),
        document.URL
      );
      assert.equal(url.origin, 'https://reader.invalid');
      assert(
        existsSync(new URL(`static/${url.pathname.slice(base.length + 1)}`, app)),
        url.pathname
      );
    }
  }
});

test('Expo only targets Android/web and does not request microphone or unused background media services', () => {
  const source = readFileSync(new URL('app.config.ts', app), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
  }).outputText;
  const output = {};
  runInNewContext(code, { exports: output, process: { env: {} } });
  const config = output.default;
  assert.deepEqual(Array.from(config.platforms), ['android', 'web']);
  assert.equal(config.ios, undefined);
  assert.equal(config.macos, undefined);
  assert.equal(config.updates.enabled, false);
  const audio = config.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-audio'
  )[1];
  assert.equal(audio.recordAudioAndroid, false);
  assert.equal(audio.enableBackgroundRecording, false);
  assert.equal(audio.enableBackgroundPlayback, false);
});
