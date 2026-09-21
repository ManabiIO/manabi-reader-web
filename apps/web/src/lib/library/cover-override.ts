/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

const maximumEncodedLength = 512 * 1024;

export async function coverOverride(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    throw new Error('Choose a PNG, JPEG, or WebP image.');
  if (!file.size || file.size > 32 * 1024 * 1024)
    throw new Error('Choose a cover image smaller than 32 MB.');
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 400 / bitmap.width, 600 / bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot prepare the cover image.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const value = canvas.toDataURL('image/webp', 0.78);
    if (value.length > maximumEncodedLength) throw new Error('Choose a smaller cover image.');
    return value;
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error('The cover image could not be read.');
  } finally {
    bitmap?.close();
  }
}
