/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { writable } from 'svelte/store';
import type { BackgroundMode, BackgroundTarget } from './state';
import {
  backgroundMimeTypes,
  imageDimensions,
  maxBackgroundBytes,
  maxBackgroundPixels
} from './image-format';

interface SavedImage {
  revision?: string;
  blob?: Blob;
  dataUrl?: string;
  name: string;
}
interface SavedBackgrounds {
  light?: SavedImage;
  dark?: SavedImage;
}
interface BackgroundDatabase extends DBSchema {
  // First-release schema: two independent mode slots per surface.
  backgrounds: { key: BackgroundTarget; value: SavedBackgrounds };
}
export interface BackgroundImageState {
  revision?: string;
  url?: string;
  name?: string;
  busy: boolean;
  error?: string;
}
export type BackgroundState = Record<BackgroundMode, BackgroundImageState>;

const modes: BackgroundMode[] = ['light', 'dark'];
const emptyTarget = (): BackgroundState => ({
  light: { busy: false },
  dark: { busy: false }
});
const empty = (): Record<BackgroundTarget, BackgroundState> => ({
  library: emptyTarget(),
  reader: emptyTarget()
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

function update(
  target: BackgroundTarget,
  mode: BackgroundMode,
  patch: Partial<BackgroundImageState>
) {
  backgrounds.update((value) => ({
    ...value,
    [target]: {
      ...value[target],
      [mode]: { ...value[target][mode], ...patch }
    }
  }));
}

function publish(
  target: BackgroundTarget,
  mode: BackgroundMode,
  saved: SavedImage | undefined,
  url?: string
) {
  update(target, mode, {
    url,
    name: saved?.name,
    revision: saved?.revision,
    error: undefined
  });
}

function validateSaved(saved: SavedImage) {
  const hasLegacyBlob = saved.blob instanceof Blob;
  const hasDataUrl =
    typeof saved.dataUrl === 'string' &&
    saved.dataUrl.length <= Math.ceil((maxBackgroundBytes * 4) / 3) + 100 &&
    /^data:image\/(?:png|jpeg|webp);base64,/i.test(saved.dataUrl);
  if ((!hasLegacyBlob && !hasDataUrl) || typeof saved.name !== 'string' || saved.name.length > 200)
    throw new Error('The saved background cannot be read. Remove it and choose another image.');
}

async function refreshMode(
  target: BackgroundTarget,
  mode: BackgroundMode,
  saved: SavedImage | undefined,
  generation: number,
  life: number
) {
  try {
    if (!saved) {
      if (mounted && lifetime === life && generation === versions[target])
        publish(target, mode, undefined);
      return;
    }
    validateSaved(saved);
    // Focus/tab switches need not decode or replace an unchanged, already
    // validated image. Older records without a revision are still supported.
    if (
      saved.revision &&
      saved.revision === current[target][mode].revision &&
      current[target][mode].url
    ) {
      update(target, mode, { error: undefined });
      return;
    }
    const { url } = saved.dataUrl
      ? await decodeDataUrl(saved.dataUrl)
      : await decodeImage(saved.blob as Blob);
    if (!mounted || lifetime !== life || generation !== versions[target]) return;
    publish(target, mode, saved, url);
  } catch (error) {
    if (mounted && life === lifetime && generation === versions[target])
      update(target, mode, { error: errorMessage(error) });
  }
}

async function refresh(target: BackgroundTarget) {
  const generation = ++versions[target],
    life = lifetime;
  try {
    const stored = await (await db()).get('backgrounds', target);
    if (!mounted || lifetime !== life || generation !== versions[target]) return;
    const saved = stored ?? {};
    await Promise.all(
      modes.map((mode) => refreshMode(target, mode, saved[mode], generation, life))
    );
  } catch (error) {
    if (mounted && life === lifetime && generation === versions[target])
      for (const mode of modes) update(target, mode, { error: errorMessage(error) });
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.includes('Error preparing Blob/File data'))
    return 'This browser session cannot store images. Try a regular window instead of private browsing. The previous background has been kept.';
  if (error instanceof DOMException && error.name === 'QuotaExceededError')
    return 'There is not enough browser storage. The previous background has been kept.';
  return error instanceof Error
    ? error.message
    : 'The background could not be saved. The previous image has been kept.';
}

function bytesToDataUrl(bytes: Uint8Array, mime: string) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return `data:${mime};base64,${btoa(binary)}`;
}

async function decodeUrl(url: string): Promise<{ image: HTMLImageElement; url: string }> {
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
    throw error;
  } finally {
    clearTimeout(timer);
    image.onload = null;
    image.onerror = null;
  }
}

async function decodeDataUrl(url: string): Promise<{ image: HTMLImageElement; url: string }> {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/]*={0,2})$/i.exec(url);
  if (!match)
    throw new Error('The saved background cannot be read. Remove it and choose another image.');
  const binary = atob(match[2]);
  if (!binary.length || binary.length > maxBackgroundBytes)
    throw new Error('The saved background cannot be read. Remove it and choose another image.');
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  imageDimensions(bytes, match[1].toLowerCase());
  return decodeUrl(url);
}

async function decodeImage(blob: Blob): Promise<{ image: HTMLImageElement; url: string }> {
  if (!backgroundMimeTypes.includes(blob.type))
    throw new Error('Choose a PNG, JPEG, or WebP image. SVG and GIF are not supported.');
  if (!blob.size || blob.size > maxBackgroundBytes)
    throw new Error('Choose an image no larger than 8 MB.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  imageDimensions(bytes, blob.type);
  // Data URLs are independent of a document's Blob registry. WebKit can
  // invalidate IndexedDB Blob wrappers during navigation while CSS is still
  // resolving them, producing access-control failures and lost backgrounds.
  return decodeUrl(bytesToDataUrl(bytes, blob.type));
}

async function prepare(file: File): Promise<SavedImage> {
  const { image } = await decodeImage(file);
  const canvas = document.createElement('canvas');
  try {
    const scale = Math.min(1, 2560 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not prepare the background image.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('The image could not be prepared.'))),
        'image/webp',
        0.88
      )
    );
    if (blob.size > maxBackgroundBytes) throw new Error('The prepared image is too large to save.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    imageDimensions(bytes, blob.type);
    return {
      dataUrl: bytesToDataUrl(bytes, blob.type),
      name: file.name.slice(0, 200),
      revision: crypto.randomUUID()
    };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    image.src = '';
  }
}

function mutate(
  target: BackgroundTarget,
  affectedModes: BackgroundMode[],
  work: (database: IDBPDatabase<BackgroundDatabase>) => Promise<void>
): Promise<void> {
  const operation = queues[target].then(async () => {
    for (const mode of affectedModes) update(target, mode, { busy: true, error: undefined });
    ++versions[target];
    try {
      await work(await db());
      ++versions[target];
      await refresh(target);
      channel?.postMessage(target);
    } catch (error) {
      for (const mode of affectedModes) update(target, mode, { error: errorMessage(error) });
      throw error;
    } finally {
      for (const mode of affectedModes) update(target, mode, { busy: false });
    }
  });
  queues[target] = operation.catch(() => undefined);
  return operation;
}

export function chooseBackground(
  target: BackgroundTarget,
  mode: BackgroundMode,
  file: File
): Promise<void> {
  return mutate(target, [mode], async (database) => {
    // Decode outside the transaction; keep read-modify-write atomic across tabs.
    const image = await prepare(file);
    const tx = database.transaction('backgrounds', 'readwrite');
    const saved = (await tx.store.get(target)) ?? {};
    saved[mode] = image;
    await tx.store.put(saved, target);
    await tx.done;
  });
}

export function removeBackground(target: BackgroundTarget, mode: BackgroundMode): Promise<void> {
  return mutate(target, [mode], async (database) => {
    const tx = database.transaction('backgrounds', 'readwrite');
    const saved = (await tx.store.get(target)) ?? {};
    delete saved[mode];
    if (saved.light || saved.dark) await tx.store.put(saved, target);
    else await tx.store.delete(target);
    await tx.done;
  });
}

export function removeBackgrounds(target: BackgroundTarget): Promise<void> {
  return mutate(target, modes, async (database) => {
    await database.delete('backgrounds', target);
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
    backgrounds.set(empty());
  };
}
