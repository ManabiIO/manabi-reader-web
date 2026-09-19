/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { writable } from 'svelte/store';
import type { BackgroundTarget } from './state';
import {
  backgroundMimeTypes,
  imageDimensions,
  maxBackgroundBytes,
  maxBackgroundPixels
} from './image-format';

interface SavedImage {
  revision?: string;
  blob: Blob;
  name: string;
}
interface BackgroundDatabase extends DBSchema {
  backgrounds: { key: BackgroundTarget; value: SavedImage };
}
interface BackgroundState {
  revision?: string;
  url?: string;
  name?: string;
  busy: boolean;
  error?: string;
}
const empty = (): Record<BackgroundTarget, BackgroundState> => ({
  library: { busy: false },
  reader: { busy: false }
});
export const backgrounds = writable(empty());
let current = empty();
backgrounds.subscribe((value) => {
  current = value;
});
let database: Promise<IDBPDatabase<BackgroundDatabase>> | undefined;
let channel: BroadcastChannel | undefined;
let mounted = false;
let lifetime = 0;
const versions = { library: 0, reader: 0 };
const queues: Record<BackgroundTarget, Promise<void>> = {
  library: Promise.resolve(),
  reader: Promise.resolve()
};
function db() {
  if (!database)
    database = openDB<BackgroundDatabase>('manabi-reader-appearance', 1, {
      upgrade(value) {
        value.createObjectStore('backgrounds');
      },
      blocking() {
        void database?.then((value) => value.close());
        database = undefined;
      }
    }).catch((error) => {
      database = undefined;
      throw error;
    });
  return database;
}
function update(target: BackgroundTarget, patch: Partial<BackgroundState>) {
  backgrounds.update((value) => ({ ...value, [target]: { ...value[target], ...patch } }));
}
function publish(target: BackgroundTarget, saved: SavedImage | undefined, url?: string) {
  const old = current[target].url;
  update(target, { url, name: saved?.name, revision: saved?.revision, error: undefined });
  if (old) URL.revokeObjectURL(old);
}
async function refresh(target: BackgroundTarget) {
  const generation = ++versions[target],
    life = lifetime;
  let url: string | undefined;
  try {
    const saved = await (await db()).get('backgrounds', target);
    if (!mounted || lifetime !== life || generation !== versions[target]) return;
    if (saved) {
      if (
        !(saved.blob instanceof Blob) ||
        typeof saved.name !== 'string' ||
        saved.name.length > 200
      )
        throw new Error('The saved background cannot be read. Remove it and choose another image.');
      // Focus/tab switches need not decode or replace an unchanged, already
      // validated image. Older records without a revision are still supported.
      if (saved.revision && saved.revision === current[target].revision && current[target].url)
        return;
      const decoded = await decodeImage(saved.blob);
      url = decoded.url;
      decoded.image.src = '';
    }
    if (!mounted || lifetime !== life || generation !== versions[target]) return;
    publish(target, saved, url);
    url = undefined; // Ownership transferred to the visible state.
  } catch (error) {
    if (mounted && life === lifetime && generation === versions[target])
      update(target, { error: errorMessage(error) });
  } finally {
    // A newer read, unmount, or failed decode must not leak an object URL.
    if (url) URL.revokeObjectURL(url);
  }
}
function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError')
    return 'There is not enough browser storage. The previous background has been kept.';
  return error instanceof Error
    ? error.message
    : 'The background could not be saved. The previous image has been kept.';
}
async function decodeImage(blob: Blob): Promise<{ image: HTMLImageElement; url: string }> {
  if (!backgroundMimeTypes.includes(blob.type))
    throw new Error('Choose a PNG, JPEG, or WebP image. SVG and GIF are not supported.');
  if (!blob.size || blob.size > maxBackgroundBytes)
    throw new Error('Choose an image no larger than 8 MB.');
  imageDimensions(new Uint8Array(await blob.arrayBuffer()), blob.type);
  const url = URL.createObjectURL(blob);
  const image = new Image();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The browser could not decode this image.'));
      timer = setTimeout(
        () => reject(new Error('The image took too long to decode. Try a smaller image.')),
        15000
      );
      image.src = url;
    });
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth > 8192 ||
      image.naturalHeight > 8192 ||
      image.naturalWidth * image.naturalHeight > maxBackgroundPixels
    )
      throw new Error('The decoded image is too large. Choose an image up to 24 megapixels.');
    return { image, url };
  } catch (error) {
    image.src = '';
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    clearTimeout(timer);
    image.onload = null;
    image.onerror = null;
  }
}
async function prepare(file: File): Promise<SavedImage> {
  const { image, url } = await decodeImage(file);
  const canvas = document.createElement('canvas');
  try {
    const scale = Math.min(1, 2560 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not prepare the background image.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // Re-encode once: remove metadata, freeze motion, and bound stored/decode size.
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('The image could not be prepared.'))),
        'image/webp',
        0.88
      )
    );
    if (blob.size > maxBackgroundBytes) throw new Error('The prepared image is too large to save.');
    return { blob, name: file.name.slice(0, 200), revision: crypto.randomUUID() };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    image.src = '';
    URL.revokeObjectURL(url);
  }
}
function mutate(target: BackgroundTarget, work: () => Promise<void>): Promise<void> {
  const operation = queues[target].then(async () => {
    update(target, { busy: true, error: undefined });
    ++versions[target];
    try {
      await work();
      // idb's convenience writes resolve after transaction commit, not just request success.
      ++versions[target];
      await refresh(target);
      channel?.postMessage(target);
    } catch (error) {
      update(target, { error: errorMessage(error) });
      throw error;
    } finally {
      update(target, { busy: false });
    }
  });
  queues[target] = operation.catch(() => undefined);
  return operation;
}
export function chooseBackground(target: BackgroundTarget, file: File): Promise<void> {
  return mutate(target, async () => {
    const saved = await prepare(file);
    await (await db()).put('backgrounds', saved, target);
  });
}
export function removeBackground(target: BackgroundTarget): Promise<void> {
  return mutate(target, async () => {
    await (await db()).delete('backgrounds', target);
  });
}
export function startBackgrounds(): () => void {
  mounted = true;
  lifetime++;
  const reload = () => {
    void refresh('library');
    void refresh('reader');
  };
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel('manabi-reader-backgrounds');
      channel.onmessage = ({ data }) => {
        if (data === 'library' || data === 'reader') void refresh(data);
      };
    } catch {
      /* Focus refresh still works when cross-tab messaging is unavailable. */
    }
  }
  window.addEventListener('focus', reload);
  reload();
  return () => {
    mounted = false;
    lifetime++;
    window.removeEventListener('focus', reload);
    channel?.close();
    channel = undefined;
    for (const value of Object.values(current)) if (value.url) URL.revokeObjectURL(value.url);
    backgrounds.set(empty());
  };
}
