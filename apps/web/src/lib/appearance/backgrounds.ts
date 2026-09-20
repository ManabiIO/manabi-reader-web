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
  blob: Blob;
  name: string;
}
interface SavedBackgrounds {
  light?: SavedImage;
  dark?: SavedImage;
}
type StoredBackground = SavedImage | SavedBackgrounds;
interface BackgroundDatabase extends DBSchema {
  // Keep one record per surface. Released single-image records are read as both
  // modes; the first edit writes the new {light,dark} shape in place.
  backgrounds: { key: BackgroundTarget; value: StoredBackground };
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

function storedBackgrounds(value: StoredBackground | undefined): SavedBackgrounds {
  if (!value) return {};
  if (typeof value === 'object' && value !== null && ('light' in value || 'dark' in value)) {
    const saved = value as SavedBackgrounds;
    return { light: saved.light, dark: saved.dark };
  }
  // Released schema: one image was shared by both appearances.
  const legacy = value as SavedImage;
  return { light: legacy, dark: legacy };
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
  const old = current[target][mode].url;
  update(target, mode, {
    url,
    name: saved?.name,
    revision: saved?.revision,
    error: undefined
  });
  if (old && old !== url) URL.revokeObjectURL(old);
}

function validateSaved(saved: SavedImage) {
  if (!(saved.blob instanceof Blob) || typeof saved.name !== 'string' || saved.name.length > 200)
    throw new Error('The saved background cannot be read. Remove it and choose another image.');
}

async function refreshMode(
  target: BackgroundTarget,
  mode: BackgroundMode,
  saved: SavedImage | undefined,
  generation: number,
  life: number
) {
  let url: string | undefined;
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
    const decoded = await decodeImage(saved.blob);
    url = decoded.url;
    decoded.image.src = '';
    if (!mounted || lifetime !== life || generation !== versions[target]) return;
    publish(target, mode, saved, url);
    url = undefined; // Ownership transferred to the visible state.
  } catch (error) {
    if (mounted && life === lifetime && generation === versions[target])
      update(target, mode, { error: errorMessage(error) });
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

async function refresh(target: BackgroundTarget) {
  const generation = ++versions[target],
    life = lifetime;
  try {
    const stored = await (await db()).get('backgrounds', target);
    if (!mounted || lifetime !== life || generation !== versions[target]) return;
    const saved = storedBackgrounds(stored);
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
    const saved = storedBackgrounds(await database.get('backgrounds', target));
    saved[mode] = await prepare(file);
    await database.put('backgrounds', saved, target);
  });
}

export function removeBackground(target: BackgroundTarget, mode: BackgroundMode): Promise<void> {
  return mutate(target, [mode], async (database) => {
    const saved = storedBackgrounds(await database.get('backgrounds', target));
    delete saved[mode];
    if (saved.light || saved.dark) await database.put('backgrounds', saved, target);
    else await database.delete('backgrounds', target);
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
    for (const target of Object.values(current))
      for (const value of Object.values(target)) if (value.url) URL.revokeObjectURL(value.url);
    backgrounds.set(empty());
  };
}
