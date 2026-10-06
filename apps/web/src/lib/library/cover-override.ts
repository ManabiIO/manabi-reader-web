/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

const maximumEncodedLength = 512 * 1024;
interface CoverAuthority {
  signal: AbortSignal;
  assertCurrent(): void;
}
/** The web picker and native byte transfer share this inert, bounded raster pipeline. */
export async function coverOverride(file: File, authority?: CoverAuthority): Promise<string> {
  const check = () => {
    authority?.signal.throwIfAborted();
    authority?.assertCurrent();
  };
  check();
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    throw new Error('Choose a PNG, JPEG, or WebP image.');
  if (!file.size || file.size > 32 * 1024 * 1024)
    throw new Error('Choose a cover image smaller than 32 MB.');
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  check();
  const matches =
    file.type === 'image/png'
      ? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte)
      : file.type === 'image/jpeg'
        ? header[0] === 255 && header[1] === 216 && header[2] === 255
        : [82, 73, 70, 70].every((byte, index) => header[index] === byte) &&
          [87, 69, 66, 80].every((byte, index) => header[index + 8] === byte);
  if (!matches) throw new Error('The selected file is not the declared PNG, JPEG, or WebP image.');
  let bitmap: ImageBitmap | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    bitmap = await new Promise<ImageBitmap>((resolve, reject) => {
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      abort = () => fail(new Error('Cover image preparation was cancelled.'));
      authority?.signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => fail(new Error('The cover image took too long to decode.')), 6000);
      try {
        check();
        void createImageBitmap(file).then(
          (image) => {
            if (settled) image.close();
            else {
              settled = true;
              resolve(image);
            }
          },
          (error) =>
            fail(error instanceof Error ? error : new Error('The cover image could not be read.'))
        );
      } catch (error) {
        fail(error instanceof Error ? error : new Error('The cover image could not be read.'));
      }
    });
    check();
    const { width, height } = bitmap;
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > 8192 ||
      height > 8192 ||
      width * height > 16 * 1024 * 1024
    )
      throw new Error('Choose a cover image up to 8192 pixels per side and 16 megapixels.');
    const scale = Math.min(1, 400 / width, 600 / height);
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot prepare the cover image.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    check();
    const value = canvas.toDataURL('image/webp', 0.78);
    if (value.length > maximumEncodedLength) throw new Error('Choose a smaller cover image.');
    if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))
      throw new Error('The cover image could not be encoded.');
    check();
    return value;
  } finally {
    clearTimeout(timer);
    if (abort) authority?.signal.removeEventListener('abort', abort);
    bitmap?.close();
    if (canvas) canvas.width = canvas.height = 0;
  }
}
