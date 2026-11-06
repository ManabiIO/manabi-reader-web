import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DICTIONARY_EXTENSION_MUTATION_ATTRIBUTES,
  EXTERNAL_DICTIONARY_POPUP_SELECTOR,
  PREFERRED_DEFAULT_INSTALL_BUTTON_ATTRIBUTES,
  normalizeDictionarySetupChoice,
  preferredDictionaryExtensionPresent,
  preferredDictionaryReaderBridgeReady
} from '../../apps/web/src/lib/integrations/external-dictionary-interop.ts';
import { isShellAsset } from '../../apps/web/src/lib/service-worker/reader-service-worker.mjs';
import { externalRuntimeAssets } from '../../apps/web/src/lib/service-worker/optional-static-assets.mjs';

test('legacy external-dictionary choice migrates behind the neutral setup contract', () => {
  assert.equal(normalizeDictionarySetupChoice('manabitan'), 'preferred');
  for (const choice of ['preferred', 'done', 'other', 'skip'])
    assert.equal(normalizeDictionarySetupChoice(choice), choice);
  assert.equal(normalizeDictionarySetupChoice('unknown'), null);
  assert.equal(normalizeDictionarySetupChoice(null), null);
});

test('external dictionary bridge detection is isolated to documented DOM markers', () => {
  const document = { documentElement: { dataset: {} } };
  assert.equal(preferredDictionaryExtensionPresent(document), false);
  assert.equal(preferredDictionaryReaderBridgeReady(document), false);

  document.documentElement.dataset.manabitanContentScriptPrepared = 'true';
  assert.equal(preferredDictionaryExtensionPresent(document), true);
  document.documentElement.dataset.manabitanReaderJitendexBridge = 'true';
  assert.equal(preferredDictionaryReaderBridgeReady(document), true);

  assert.deepEqual(
    [...DICTIONARY_EXTENSION_MUTATION_ATTRIBUTES],
    [
      'data-manabitan-content-script-loaded',
      'data-manabitan-content-script-prepared',
      'data-manabitan-reader-jitendex-bridge'
    ]
  );
  assert.match(EXTERNAL_DICTIONARY_POPUP_SELECTOR, /yomitan-popup/);
});

test('default-install interop marker is isolated to provider-specific forwarded props', () => {
  assert.deepEqual(PREFERRED_DEFAULT_INSTALL_BUTTON_ATTRIBUTES, {
    'data-manabitan-install-jitendex': 'true'
  });
});

test('external runtime discovery is provider-name agnostic and complete', () => {
  const runtime = [
    'arbitrary-provider/revision/manifest.json',
    'arbitrary-provider/revision/reader-runtime.json',
    'arbitrary-provider/revision/web/client.js',
    'arbitrary-provider/revision/css/structured-content.css',
    'arbitrary-provider/revision/data/font.ttf'
  ];
  assert.deepEqual(externalRuntimeAssets([...runtime, 'unrelated/app.js']), runtime);
  assert.deepEqual(
    externalRuntimeAssets(['incomplete/revision/manifest.json', 'unrelated/app.js']),
    []
  );
});

test('dictionary archives remain outside the mandatory shell independently of provider name', () => {
  const root = 'https://reader.example/reader-web/';
  assert.equal(isShellAsset(new URL('dictionary-archives/default.zip', root)), false);
});
