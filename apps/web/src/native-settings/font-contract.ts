/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export type FontFamily = 'primary' | 'secondary';
export interface FontImportTarget {
  name: string;
}
export interface NativeFontState {
  token: string;
  fonts: { key: string; name: string; fileName: string; available: boolean }[];
  selected: Record<FontFamily, string>;
}
export function parseFontImportTarget(value: unknown): FontImportTarget {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !('name' in value) ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.trim().length > 200
  )
    throw new Error('Enter a font name of 1–200 characters.');
  return { name: value.name.trim() };
}
export function isNativeFontState(value: unknown): value is NativeFontState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<NativeFontState>;
  return (
    typeof state.token === 'string' &&
    state.token.length > 0 &&
    Array.isArray(state.fonts) &&
    state.fonts.length <= 256 &&
    state.fonts.every(
      (item) =>
        !!item &&
        typeof item === 'object' &&
        typeof item.key === 'string' &&
        item.key.length > 0 &&
        item.key.length <= 100 &&
        typeof item.name === 'string' &&
        item.name.length <= 1024 &&
        typeof item.fileName === 'string' &&
        item.fileName.length <= 512 &&
        typeof item.available === 'boolean'
    ) &&
    new Set(state.fonts.map((item) => item.key)).size === state.fonts.length &&
    !!state.selected &&
    typeof state.selected.primary === 'string' &&
    typeof state.selected.secondary === 'string'
  );
}
