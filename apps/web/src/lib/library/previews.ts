/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { openDB, type DBSchema } from 'idb';
import { writable } from 'svelte/store';
import extractEpub from '$lib/functions/file-loaders/epub/extract-epub';
import coverFilename from '$lib/functions/file-loaders/epub/get-epub-cover-image-filename';
import { epubDirection } from '$lib/functions/file-loaders/epub/epub-direction';
import { isOPFType } from '$lib/functions/file-loaders/epub/types';
import { currentUser } from '$lib/manabi/client';
import { librarySource, type SourceDescriptor } from './catalog';
import { sourceBookKey } from './organization';
import type { DirectoryEntry } from './tree';
import type { DirectionEvidence } from './direction';

export interface Preview {
  key: string;
  scannedAt: number;
  title: string;
  imagePath?: Blob;
  pageDirection: DirectionEvidence;
}
interface PreviewDB extends DBSchema {
  previews: { key: string; value: SavedPreview; indexes: { scannedAt: number } };
}
interface SavedPreview extends Omit<Preview, 'imagePath'> {
  imageData?: ArrayBuffer;
  imageType?: string;
}
let database: ReturnType<typeof openDB<PreviewDB>> | undefined;
function previewDB() {
  return (database ??= openDB<PreviewDB>('manabi-library-previews', 1, {
    upgrade(db) {
      db.createObjectStore('previews', { keyPath: 'key' }).createIndex('scannedAt', 'scannedAt');
    }
  }));
}
export const previews = writable<Record<string, Preview>>({});
function publish(value: Preview) {
  previews.update((values) => {
    const next = { ...values, [value.key]: value };
    const keys = Object.keys(next);
    for (const key of keys.slice(0, Math.max(0, keys.length - 500))) delete next[key];
    return next;
  });
}
function restore(saved: SavedPreview | undefined, key: string, scannedAt: number) {
  if (
    !saved ||
    saved.key !== key ||
    saved.scannedAt !== scannedAt ||
    typeof saved.title !== 'string' ||
    !saved.title ||
    saved.title.length > 1000 ||
    !saved.pageDirection ||
    !['ltr', 'rtl', 'unknown'].includes(saved.pageDirection.value) ||
    !['spine', 'content', 'unknown'].includes(saved.pageDirection.source) ||
    'imagePath' in saved ||
    (saved.imageData === undefined
      ? saved.imageType !== undefined
      : !(saved.imageData instanceof ArrayBuffer) ||
        !saved.imageData.byteLength ||
        saved.imageData.byteLength > 1024 * 1024 ||
        !['image/png', 'image/jpeg', 'image/webp'].includes(saved.imageType || ''))
  )
    return undefined;
  return {
    key,
    scannedAt,
    title: saved.title,
    pageDirection: saved.pageDirection,
    ...(saved.imageData
      ? { imagePath: new Blob([saved.imageData], { type: saved.imageType }) }
      : {})
  } satisfies Preview;
}
async function thumbnail(blob: Blob | undefined): Promise<Blob | undefined> {
  if (!blob) return;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 480 / bitmap.width, 720 / bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const image = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.85)
    );
    return image && image.size <= 1024 * 1024 ? image : undefined;
  } catch {
    return undefined;
  } finally {
    bitmap?.close();
  }
}
async function readPreview(
  source: SourceDescriptor,
  file: DirectoryEntry,
  scannedAt: number,
  signal: AbortSignal
): Promise<Preview> {
  const key = sourceBookKey(source, file.id);
  const cached = await (await previewDB()).get('previews', key);
  signal.throwIfAborted();
  const restored = restore(cached, key, scannedAt);
  if (restored) return restored;
  const value: Preview = {
    key,
    scannedAt,
    title: file.name.replace(/\.(epub|txt|htmlz)$/i, ''),
    pageDirection: { value: 'unknown', source: 'unknown' }
  };
  // Text/HTMLZ have no standardized package cover or page-progression metadata.
  if (/\.epub$/i.test(file.name)) {
    const original = await (await librarySource(source)).read(file);
    signal.throwIfAborted();
    const { contents, result } = await extractEpub(original, { signal, preview: true });
    signal.throwIfAborted();
    const metadata = isOPFType(contents)
      ? contents['opf:package']['opf:metadata']
      : contents.package.metadata;
    const titles = Array.isArray(metadata?.['dc:title'])
      ? metadata['dc:title']
      : [metadata?.['dc:title']];
    const title = titles
      .map((v) => (typeof v === 'string' ? v : v?.['#text']))
      .find((v) => typeof v === 'string' && v.trim());
    if (title) value.title = title.trim().slice(0, 1000);
    const blobs = Object.fromEntries(
      Object.entries(result).filter((entry): entry is [string, Blob] => entry[1] instanceof Blob)
    );
    const name = await coverFilename(blobs, contents);
    value.imagePath = await thumbnail(name ? blobs[name] : undefined);
    value.pageDirection = epubDirection(contents, result, document);
  }
  signal.throwIfAborted();
  if (source.owner !== null && source.owner !== currentUser()?.id)
    throw new Error('The account changed.');
  const db = await previewDB(),
    tx = db.transaction('previews', 'readwrite');
  const imagePath = value.imagePath;
  await tx.store.put({
    key: value.key,
    scannedAt: value.scannedAt,
    title: value.title,
    pageDirection: value.pageDirection,
    ...(imagePath ? { imageData: await imagePath.arrayBuffer(), imageType: imagePath.type } : {})
  });
  let count = await tx.store.count();
  let cursor = await tx.store.index('scannedAt').openCursor();
  while (cursor && count > 500) {
    await cursor.delete();
    count--;
    cursor = await cursor.continue();
  }
  await tx.done;
  return value;
}
/** Two visible-cover reads at a time; never import books, change progress or enable sync. */
export class PreviewQueue {
  private controller = new AbortController();
  private waiting: (() => Promise<void>)[] = [];
  private requested = new Set<string>();
  private active = 0;
  constructor(private failed: (error: unknown) => void) {}
  add(source: SourceDescriptor, file: DirectoryEntry, scannedAt: number) {
    const key = sourceBookKey(source, file.id) + ':' + scannedAt;
    if (this.controller.signal.aborted || this.requested.has(key)) return;
    this.requested.add(key);
    this.waiting.push(async () => {
      try {
        const value = await readPreview(source, file, scannedAt, this.controller.signal);
        if (!this.controller.signal.aborted) publish(value);
      } catch (error) {
        if (!this.controller.signal.aborted) this.failed(error);
      }
    });
    this.pump();
  }
  private pump() {
    while (this.active < 2 && this.waiting.length && !this.controller.signal.aborted) {
      const job = this.waiting.shift()!;
      this.active++;
      void job().finally(() => {
        this.active--;
        this.pump();
      });
    }
  }
  stop() {
    this.controller.abort();
    this.waiting = [];
  }
}
