/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** The public on-disk contract used by Ttu Ebook Reader and native Manabi, not app-private state. */
export const ttuRootName = 'ttu-reader-data';
export const ttuPrefixes = ['bookdata_', 'progress_', 'statistics_', 'cover_'] as const;

export function selectTtuFile<T extends { name: string }>(
  files: T[],
  prefix: string
): T | undefined {
  const matches = files.filter((file) => file.name.startsWith(prefix));
  if (matches.length > 1) {
    throw new Error(
      `Conflicting ${prefix} files. Keep both copies for recovery; resolve the conflict before syncing.`
    );
  }
  const file = matches[0];
  if (!file || prefix === 'cover_') return file;
  if (!['bookdata_', 'progress_', 'statistics_'].includes(prefix)) return file;
  const extension = prefix === 'bookdata_' ? '.zip' : '.json';
  const parts = file.name.slice(0, -extension.length).split('_');
  if (!file.name.endsWith(extension) || parts[1] !== '1' || parts[2] !== '6') {
    throw new Error(
      `Unsupported Ttu Ebook Reader file format: ${file.name}. This integration supports exporter 1 / database 6.`
    );
  }
  const expected = prefix === 'bookdata_' ? [6] : prefix === 'progress_' ? [5] : [16, 17];
  if (!expected.includes(parts.length))
    throw new Error(`Malformed Ttu Ebook Reader filename: ${file.name}`);
  const numeric =
    prefix === 'progress_' ? parts.slice(3, 4) : parts.slice(3, prefix === 'bookdata_' ? 6 : 16);
  if (numeric.some((part) => !/^\d+$/.test(part) || !Number.isSafeInteger(Number(part)))) {
    throw new Error(`Invalid numeric Ttu Ebook Reader metadata: ${file.name}`);
  }
  return file;
}

/** Selecting the root itself must not create ttu-reader-data/ttu-reader-data. */
export async function resolveTtuRoot(
  selected: FileSystemDirectoryHandle,
  create = false
): Promise<FileSystemDirectoryHandle> {
  if (selected.name === ttuRootName) return selected;
  // A title folder is not a library parent. Check before any create operation;
  // validating the newly created empty child afterwards would be too late.
  let entries = 0;
  for await (const [name, handle] of selected.entries()) {
    if (++entries > 10000)
      throw new Error('The selected folder contains too many entries to inspect safely.');
    if (handle.kind === 'file' && ttuPrefixes.some((prefix) => name.startsWith(prefix))) {
      throw new Error(
        'This is a book folder, not the library root. Select its parent ttu-reader-data folder.'
      );
    }
  }
  try {
    return await selected.getDirectoryHandle(ttuRootName, { create });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') {
      throw new Error(
        'Select the existing ttu-reader-data folder or its parent. Use Create shared library only for a new library.'
      );
    }
    throw error;
  }
}

export async function inspectTtuRoot(root: FileSystemDirectoryHandle): Promise<string[]> {
  const titles: string[] = [];
  let entries = 0;
  for await (const [name, handle] of root.entries()) {
    if (++entries > 10000)
      throw new Error('The shared library contains too many entries to inspect safely.');
    if (handle.kind !== 'directory') {
      if (ttuPrefixes.some((prefix) => name.startsWith(prefix))) {
        throw new Error(
          'This is a book folder, not the library root. Select its parent ttu-reader-data folder.'
        );
      }
      continue;
    }
    if (name.startsWith('.')) continue;
    const files: FileSystemFileHandle[] = [];
    for await (const child of handle.values()) {
      if (++entries > 10000)
        throw new Error('The shared library contains too many entries to inspect safely.');
      if (child.kind === 'file') files.push(child);
    }
    if (!files.some((file) => ttuPrefixes.some((prefix) => file.name.startsWith(prefix)))) continue;
    for (const prefix of ttuPrefixes) selectTtuFile(files, prefix);
    if (!selectTtuFile(files, 'bookdata_')) {
      throw new Error(
        `${name} has reading data but no Ttu Ebook Reader book package. No files were changed.`
      );
    }
    titles.push(name);
  }
  return titles;
}
