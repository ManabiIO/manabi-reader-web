/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BackgroundMode, BackgroundTarget } from '../lib/appearance/state';
export type { BackgroundMode, BackgroundTarget } from '../lib/appearance/state';
export const NATIVE_BACKGROUND_MAX_BYTES = 384 * 1024;
export const NATIVE_BACKGROUND_MAX_SIDE = 2048;
export const BACKGROUND_IMPORT_MAX_BYTES = 8 * 1024 * 1024;
export interface BackgroundSlot {
  target: BackgroundTarget;
  mode: BackgroundMode;
}
export interface BackgroundImportTarget extends BackgroundSlot {
  type: 'image/png' | 'image/jpeg' | 'image/webp';
}
export interface NativeBackgroundImage {
  uri: string;
  width: number;
  height: number;
}
export interface NativeBackgroundSlot extends BackgroundSlot {
  present: boolean;
  name: string;
}
export interface NativeBackgroundState {
  slots: NativeBackgroundSlot[];
}
export interface NativeBackgroundResource extends BackgroundSlot {
  image: NativeBackgroundImage | null;
  fade: number;
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
export function parseBackgroundSlot(v: unknown): BackgroundSlot {
  if (
    !record(v) ||
    Object.keys(v).length !== 2 ||
    (v.target !== 'library' && v.target !== 'reader') ||
    (v.mode !== 'light' && v.mode !== 'dark')
  )
    throw new Error('Choose a light or dark image for the Library or reader.');
  return { target: v.target as BackgroundTarget, mode: v.mode as BackgroundMode };
}
export function parseBackgroundImportTarget(v: unknown): BackgroundImportTarget {
  if (
    !record(v) ||
    Object.keys(v).length !== 3 ||
    (v.type !== 'image/png' && v.type !== 'image/jpeg' && v.type !== 'image/webp')
  )
    throw new Error('Choose a PNG, JPEG, or WebP background image.');
  return {
    ...parseBackgroundSlot({ target: v.target, mode: v.mode }),
    type: v.type as BackgroundImportTarget['type']
  };
}
export function isNativeBackgroundImage(v: unknown): v is NativeBackgroundImage {
  if (
    !record(v) ||
    Object.keys(v).length !== 3 ||
    typeof v.uri !== 'string' ||
    v.uri.length > Math.ceil(NATIVE_BACKGROUND_MAX_BYTES / 3) * 4 + 32 ||
    !/^data:image\/(?:webp|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(v.uri)
  )
    return false;
  const encoded = v.uri.slice(v.uri.indexOf(',') + 1);
  const bytes =
    (encoded.length / 4) * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
  return (
    encoded.length % 4 === 0 &&
    bytes > 0 &&
    bytes <= NATIVE_BACKGROUND_MAX_BYTES &&
    [v.width, v.height].every(
      (side) =>
        Number.isInteger(side) && Number(side) > 0 && Number(side) <= NATIVE_BACKGROUND_MAX_SIDE
    )
  );
}
export function isNativeBackgroundResource(v: unknown): v is NativeBackgroundResource {
  if (!record(v) || Object.keys(v).length !== 4) return false;
  try {
    parseBackgroundSlot({ target: v.target, mode: v.mode });
  } catch {
    return false;
  }
  return (
    (v.image === null || isNativeBackgroundImage(v.image)) &&
    typeof v.fade === 'number' &&
    Number.isFinite(v.fade) &&
    v.fade >= 0 &&
    v.fade <= 1
  );
}
export function isNativeBackgroundState(v: unknown): v is NativeBackgroundState {
  if (!record(v) || Object.keys(v).length !== 1 || !Array.isArray(v.slots) || v.slots.length !== 4)
    return false;
  const seen = new Set<string>();
  for (const slot of v.slots) {
    if (
      !record(slot) ||
      Object.keys(slot).length !== 4 ||
      typeof slot.present !== 'boolean' ||
      typeof slot.name !== 'string' ||
      slot.name.length > 200
    )
      return false;
    try {
      parseBackgroundSlot({ target: slot.target, mode: slot.mode });
    } catch {
      return false;
    }
    seen.add(`${slot.target}:${slot.mode}`);
  }
  return seen.size === 4;
}
