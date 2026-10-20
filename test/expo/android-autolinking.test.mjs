/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyReaderDomAutolinking,
  verifyExpoUiAutolinking,
  resolveReaderDomAutolinking
} from '../../scripts/verify-reader-dom-autolinking.mjs';

test('the real installed SDK resolves the patched Android DOM host as source-built', () => {
  assert.equal(verifyReaderDomAutolinking(resolveReaderDomAutolinking()).name, 'expo-dom-webview');
});
test('the installed Expo UI accessibility backport must be source-built', () => {
  const resolved = resolveReaderDomAutolinking();
  assert.equal(verifyExpoUiAutolinking(resolved).name, 'expo-ui');
  for (const patterns of [[], ['@expo/ui'], ['expo-u'], ['expo-ui-next']]) {
    const candidate = structuredClone(resolved);
    candidate.configuration = { buildFromSource: patterns };
    assert.throws(() => verifyExpoUiAutolinking(candidate), /must build from source/);
  }
  const other = structuredClone(resolved);
  other.modules.find((module) => module.packageName === '@expo/ui').packageVersion = '57.0.21';
  assert.throws(() => verifyExpoUiAutolinking(other), /Re-review/);
});
test('missing, npm-scoped, prefix-only, or stale source-build configurations fail closed', () => {
  const resolved = resolveReaderDomAutolinking();
  for (const patterns of [[], ['@expo/dom-webview'], ['expo-dom'], ['expo-dom-webview-next']]) {
    const candidate = structuredClone(resolved);
    candidate.configuration = { buildFromSource: patterns };
    assert.throws(() => verifyReaderDomAutolinking(candidate), /must build from source/);
  }
  const other = structuredClone(resolved);
  other.modules.find((module) => module.packageName === '@expo/dom-webview').packageVersion =
    '58.0.0';
  assert.throws(() => verifyReaderDomAutolinking(other), /Re-review/);
});
