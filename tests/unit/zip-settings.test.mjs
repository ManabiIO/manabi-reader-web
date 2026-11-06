/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(
  new URL(
    '../../apps/web/src/lib/functions/file-loaders/utils/init-zip-settings.ts',
    import.meta.url
  ),
  'utf8'
);
const output = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

function settings(userAgent) {
  const calls = [];
  const module = { exports: {} };
  runInNewContext(output, {
    module,
    exports: module.exports,
    ...(userAgent === undefined ? {} : { window: { navigator: { userAgent } } }),
    require(name) {
      assert.equal(
        name,
        '@zip.js/zip.js',
        'The ZIP workaround needs no browser-detection dependency'
      );
      return { configure: (value) => calls.push(value) };
    }
  });
  module.exports.default();
  assert.equal(calls.length, 1);
  return calls[0].useWebWorkers;
}

test('Android Chromium keeps the inherited ZIP worker workaround without a UA database', () => {
  for (const userAgent of [
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  ])
    assert.equal(settings(userAgent), false);
});

test('desktop, iOS, Firefox, unknown browsers and non-browser contexts retain ZIP workers', () => {
  for (const userAgent of [
    undefined,
    '',
    'Unknown browser',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 Version/17.6 Safari/605.1.15',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0',
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Version/4.0 Mobile Safari/537.36'
  ])
    assert.equal(settings(userAgent), true, String(userAgent));
});
