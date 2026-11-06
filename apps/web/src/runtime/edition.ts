/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// Keep this leaf usable in portable DOM-only TypeScript test/build targets.
// Expo replaces these exact property accesses with public build constants.
declare const process: {
  env: {
    EXPO_PUBLIC_READER_EDITION?: string;
    EXPO_PUBLIC_READER_NAME?: string;
    EXPO_PUBLIC_READER_STORAGE_NAMESPACE?: string;
  };
};

/** Build-selected identity. Never derive storage ownership from location or user input. */
// Metro substitutes these literal public env accesses. Standalone browser/VM
// consumers can omit Node's process global and retain the public identity.
function buildValue(read: () => string | undefined): string | undefined {
  try {
    return read();
  } catch (error) {
    if (error instanceof ReferenceError) return undefined;
    throw error;
  }
}
export const readerEdition =
  buildValue(() => process.env.EXPO_PUBLIC_READER_EDITION) ?? 'manabitan';
if (readerEdition !== 'manabitan' && readerEdition !== 'manabi')
  throw new Error('Unknown Reader edition.');
export const readerName =
  buildValue(() => process.env.EXPO_PUBLIC_READER_NAME) ??
  (readerEdition === 'manabitan' ? 'Manabitan Reader' : 'Manabi Reader for Web');
export const storageNamespace =
  buildValue(() => process.env.EXPO_PUBLIC_READER_STORAGE_NAMESPACE) ??
  (readerEdition === 'manabitan' ? 'manabitan-reader-v1' : 'manabi-reader-v1');
if (!/^[a-z][a-z0-9-]*$/.test(storageNamespace))
  throw new Error('Invalid Reader storage namespace.');

/** Logical names remain stable in backup/export formats; physical names belong to one edition. */
export function storageName(name: string, namespace = storageNamespace): string {
  return `${namespace}:${name}`;
}
export function logicalStorageKey(key: string, namespace = storageNamespace): string | null {
  const prefix = `${namespace}:`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}
