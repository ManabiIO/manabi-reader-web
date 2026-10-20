/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  readBackgroundMetadata,
  readBackgroundImage,
  chooseBackground,
  removeBackground,
  removeBackgrounds,
  type BackgroundMutationAuthority
} from '../lib/appearance/backgrounds';
import { libraryBackgroundOptions$, readerBackgroundOptions$ } from '../lib/appearance/state';
import {
  isNativeBackgroundImage,
  parseBackgroundSlot,
  parseBackgroundImportTarget,
  type NativeBackgroundResource,
  type NativeBackgroundState
} from './background-contract';

export async function readNativeBackgroundState(
  payload: unknown,
  authority: BackgroundMutationAuthority
): Promise<NativeBackgroundState> {
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    Object.keys(payload).length
  )
    throw new Error('Invalid background request.');
  return { slots: await readBackgroundMetadata(authority) };
}
/** Keep alpha and aspect ratio. Original bytes, URLs and native paths never cross this reply. */
export async function readNativeBackgroundResource(
  payload: unknown,
  authority: BackgroundMutationAuthority
): Promise<NativeBackgroundResource> {
  const slot = parseBackgroundSlot(payload);
  const source = await readBackgroundImage(slot.target, slot.mode, authority);
  const options = () =>
    (slot.target === 'library' ? libraryBackgroundOptions$ : readerBackgroundOptions$).getValue();
  const reply = (image: NativeBackgroundResource['image']) => {
    authority.signal.throwIfAborted();
    authority.assertCurrent();
    const fade = options();
    return { ...slot, image, fade: fade.fade ? fade.amount / 100 : 0 };
  };
  if (!source) return reply(null);
  try {
    for (const [side, quality] of [
      [2048, 0.82],
      [1536, 0.72],
      [1024, 0.65],
      [640, 0.6],
      [256, 0.6]
    ]) {
      source.check();
      const scale = Math.min(
        1,
        side / Math.max(source.image.naturalWidth, source.image.naturalHeight)
      );
      const canvas = document.createElement('canvas');
      try {
        canvas.width = Math.max(1, Math.round(source.image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(source.image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Background preview is unavailable.');
        context.drawImage(source.image, 0, 0, canvas.width, canvas.height);
        const image = {
          uri: canvas.toDataURL('image/webp', quality),
          width: canvas.width,
          height: canvas.height
        };
        source.check();
        if (isNativeBackgroundImage(image)) return reply(image);
      } finally {
        canvas.width = canvas.height = 0;
      }
    }
    throw new Error('This image is saved, but a smaller preview could not be prepared.');
  } finally {
    source.release();
  }
}
export async function changeNativeBackground(
  payload: unknown,
  authority: BackgroundMutationAuthority
) {
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    Object.keys(payload).length !== 3 ||
    !('type' in payload) ||
    payload.type !== 'remove' ||
    !('target' in payload) ||
    !('mode' in payload)
  )
    throw new Error('Invalid background action.');
  if (payload.mode === 'both') {
    const { target } = parseBackgroundSlot({ target: payload.target, mode: 'light' });
    await removeBackgrounds(target, authority);
  } else {
    const { target, mode } = parseBackgroundSlot({ target: payload.target, mode: payload.mode });
    await removeBackground(target, mode, authority);
  }
  return readNativeBackgroundState({}, authority);
}
export async function importNativeBackground(
  target: unknown,
  file: File,
  authority: BackgroundMutationAuthority
) {
  const slot = parseBackgroundImportTarget(target);
  if (file.type !== slot.type) throw new Error('The image type changed during transfer.');
  await chooseBackground(slot.target, slot.mode, file, authority);
  return readNativeBackgroundState({}, authority);
}
