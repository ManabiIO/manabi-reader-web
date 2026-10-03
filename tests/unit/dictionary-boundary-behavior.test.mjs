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
import {
  isPackagedFont,
  isShellAsset
} from '../../apps/web/src/lib/service-worker/reader-service-worker.mjs';

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

test('generated dictionary runtime never becomes mandatory shell or packaged-font cache state', () => {
  const root = 'https://reader.example/reader-web/';
  for (const path of [
    'dictionary-runtime/revision/web/client.js',
    'dictionary-runtime/revision/css/structured-content.css',
    'dictionary-runtime/revision/data/font.ttf',
    'dictionary-archives/default.zip'
  ]) {
    assert.equal(isShellAsset(new URL(path, root)), false, path);
  }
  assert.equal(isPackagedFont(new URL('dictionary-runtime/revision/data/font.ttf', root)), false);
});
