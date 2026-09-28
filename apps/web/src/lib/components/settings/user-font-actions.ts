/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { UserFont } from '$lib/data/fonts';

export interface FontCatalog {
  read(): UserFont[];
  write(fonts: UserFont[]): void;
}

const formats: Record<string, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf'
};

function normalizedName(name: string): string {
  return name.trim().normalize('NFC').toLowerCase();
}

function cachePath(fileName: string): string | null {
  // Match the local-font stylesheet's accepted filename/path contract.
  // eslint-disable-next-line no-control-regex
  if (!fileName || fileName.length > 255 || /[\\/\x00-\x1f\x7f]/.test(fileName)) return null;
  try {
    return `/userfonts/${encodeURIComponent(fileName)}`;
  } catch {
    return null;
  }
}

export function sameUserFont(left: UserFont, right: UserFont): boolean {
  return left.name === right.name && left.path === right.path && left.fileName === right.fileName;
}

export function prepareUserFont(
  name: string,
  file: File | undefined,
  fonts: readonly UserFont[],
  reserved: ReadonlySet<string>
): { font: UserFont; mime: string } {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 200) throw new Error('Enter a font name of 1–200 characters.');
  const normalized = normalizedName(trimmed);
  if ([...reserved].some((entry) => normalizedName(entry) === normalized))
    throw new Error('This name is reserved for a built-in font.');
  if (!file) throw new Error('Choose a font file.');
  const path = cachePath(file.name);
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const mime = Object.hasOwn(formats, extension) ? formats[extension] : undefined;
  if (!path || !mime) throw new Error('Choose a WOFF2, WOFF, TTF, or OTF font file.');
  if (!file.size) throw new Error('This font file is empty. Choose another file.');
  if (
    fonts.some(
      (font) =>
        normalizedName(font.name) === normalized ||
        font.path === path ||
        font.fileName === file.name
    )
  )
    throw new Error('A font with this name or filename is already stored.');
  if (fonts.length >= 256) throw new Error('Remove a stored font before adding another.');
  return { font: { name: trimmed, path, fileName: file.name }, mime };
}

// Serialize explicit mutations across managers in this page. This is not a
// cross-tab transaction between CacheStorage and the localStorage catalogue.
let mutationTail: Promise<unknown> = Promise.resolve();
function mutate<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationTail.then(operation);
  mutationTail = result.catch(() => undefined);
  return result;
}

/** Save owns its inputs even if the form is edited or dismissed while it waits. */
export function saveUserFont(
  cache: Pick<Cache, 'put'>,
  catalog: FontCatalog,
  name: string,
  file: File | undefined,
  reserved: ReadonlySet<string>
): Promise<UserFont> {
  const reservedSnapshot = new Set(reserved);
  return mutate(async () => {
    const { font, mime } = prepareUserFont(name, file, catalog.read(), reservedSnapshot);
    await cache.put(font.path, new Response(file, { headers: { 'Content-Type': mime } }));
    const current = catalog.read();
    // Do not overwrite a catalogue edit delivered while CacheStorage was busy.
    const existing = current.find((entry) => sameUserFont(entry, font));
    if (existing) return { ...font };
    prepareUserFont(name, file, current, reservedSnapshot);
    catalog.write([...current, font]);
    return { ...font };
  });
}

/** Only the exact removed face can reset the currently selected family. */
export function removeUserFont(
  cache: Pick<Cache, 'delete'>,
  catalog: FontCatalog,
  target: UserFont,
  selection: { read(): string; write(name: string): void }
): Promise<void> {
  const font = { ...target };
  return mutate(async () => {
    if (!catalog.read().some((entry) => sameUserFont(entry, font))) return;
    // Invalid restored paths must never authorize deletion of another cache key.
    if (cachePath(font.fileName) === font.path) await cache.delete(font.path);
    const current = catalog.read();
    if (!current.some((entry) => sameUserFont(entry, font))) return;
    catalog.write(current.filter((entry) => !sameUserFont(entry, font)));
    if (selection.read() === font.name) selection.write('');
  });
}

/** Inspect, never prune. A stale cache listing is not deletion authority. */
export async function storedFontPaths(cache: Pick<Cache, 'keys'>): Promise<Set<string>> {
  return new Set((await cache.keys()).map((request) => new URL(request.url).pathname));
}

export function fontActionError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Font storage is unavailable. Try again.';
}
