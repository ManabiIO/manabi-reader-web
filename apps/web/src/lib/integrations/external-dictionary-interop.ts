/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 *
 * Public black-box interoperability identifiers for external dictionary extensions.
 * No extension implementation code belongs in Reader.
 */

export type DictionarySetupChoice = 'preferred' | 'done' | 'other' | 'skip';

export const PREFERRED_DICTIONARY_EXTENSION_NAME = 'Manabitan';
export const PREFERRED_DICTIONARY_EXTENSION_SETUP_URL =
  'https://manabitan.manabi.io/getting-started/#installation';
export const PREFERRED_DICTIONARY_EXTENSION_DESCRIPTION =
  'Look up words with Manabitan and the Jitendex Japanese dictionary.';

export const DICTIONARY_EXTENSION_MUTATION_ATTRIBUTES = [
  'data-manabitan-content-script-loaded',
  'data-manabitan-content-script-prepared',
  'data-manabitan-reader-jitendex-bridge'
] as const;

export const EXTERNAL_DICTIONARY_POPUP_SELECTOR =
  '.yomichan-popup,.yomichan-float,.yomitan-popup,.yomitan-float';

export const EXTERNAL_DICTIONARY_POPUP_DETECTION_TOOLTIP =
  "If enabled, auto pause is skipped while a supported external dictionary popup is open. Yomitan detection may require its 'Secure Container' setting to be disabled.";

export function preferredDictionaryExtensionPresent(document: Document): boolean {
  const { dataset } = document.documentElement;
  return (
    dataset.manabitanContentScriptLoaded === 'true' ||
    dataset.manabitanContentScriptPrepared === 'true'
  );
}

export function preferredDictionaryReaderBridgeReady(document: Document): boolean {
  return document.documentElement.dataset.manabitanReaderJitendexBridge === 'true';
}

export function normalizeDictionarySetupChoice(value: string | null): DictionarySetupChoice | null {
  // Preserve the pre-boundary preference value without making generic Reader code
  // depend on the provider's historical identifier.
  if (value === 'manabitan') return 'preferred';
  return value === 'preferred' || value === 'done' || value === 'other' || value === 'skip'
    ? value
    : null;
}

export function markPreferredDefaultDictionaryInstall(node: HTMLElement) {
  node.dataset.manabitanInstallJitendex = 'true';
}
