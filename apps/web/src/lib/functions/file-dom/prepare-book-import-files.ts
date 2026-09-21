/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { BlobReader, BlobWriter, ZipWriter } from '@zip.js/zip.js';
import {
  ArchiveLimitError,
  BOOK_ARCHIVE_LIMITS,
  LimitedArchive,
  validateArchivePath
} from '../file-loaders/utils/limited-archive';

const EPUB_MIME_TYPE = 'application/epub+zip';
const EPUB_CONTAINER_PATH = 'META-INF/container.xml';
const EPUB_MIMETYPE_PATH = 'mimetype';

interface PackageLocation {
  root: string;
  relativePath: string;
}

interface PackageEntry {
  path: string;
  blob: Blob;
  lastModified: number;
}

interface PackageGroup {
  root: string;
  entries: PackageEntry[];
  sourceFiles: File[];
}

export async function prepareBookImportFiles(
  fileList: FileList | File[],
  signal?: AbortSignal
): Promise<File[]> {
  abortIfNeeded(signal);

  const files = Array.from(fileList);
  const consumed = new Set<File>();
  const prepared: File[] = [];

  const folderGroups = groupPackageFiles(files);
  for (const group of folderGroups.values()) {
    const visibleEntries = group.entries.filter((entry) => !isHiddenPath(entry.path));
    if (!(await isEpubPackage(visibleEntries, signal))) continue;

    prepared.push(await packageEpub(group.root, visibleEntries, undefined, signal));
    group.sourceFiles.forEach((file) => consumed.add(file));
  }

  for (const file of files) {
    abortIfNeeded(signal);
    if (consumed.has(file)) continue;

    if (file.name.toLowerCase().endsWith('.epub.zip')) {
      const unpacked = await prepareWrappedEpub(file, signal);
      if (unpacked.length) {
        prepared.push(...unpacked);
        consumed.add(file);
      }
    }
  }

  for (const file of files) {
    if (consumed.has(file)) continue;
    if (/\.(?:htmlz|epub|txt)$/i.test(file.name)) prepared.push(file);
  }

  return prepared;
}

function groupPackageFiles(files: File[]): Map<string, PackageGroup> {
  const groups = new Map<string, PackageGroup>();

  for (const file of files) {
    const relativePath = file.webkitRelativePath;
    if (!relativePath) continue;

    const location = findPackageLocation(relativePath);
    if (!location || isHiddenPath(location.root)) continue;

    const group = groups.get(location.root) ?? {
      root: location.root,
      entries: [],
      sourceFiles: []
    };

    group.entries.push({
      path: location.relativePath,
      blob: file,
      lastModified: file.lastModified
    });
    group.sourceFiles.push(file);
    groups.set(location.root, group);
  }

  return groups;
}

async function prepareWrappedEpub(file: File, signal?: AbortSignal): Promise<File[]> {
  const archive = await LimitedArchive.open(file, { signal });

  try {
    const groups = new Map<string, Array<{ fullPath: string; relativePath: string }>>();
    const rootEntries: Array<{ fullPath: string; relativePath: string }> = [];

    for (const [name, entry] of archive.entries) {
      abortIfNeeded(signal);
      if (entry.directory || isHiddenPath(name)) continue;

      rootEntries.push({ fullPath: name, relativePath: name });

      const location = findPackageLocation(name);
      if (!location || isHiddenPath(location.root) || isHiddenPath(location.relativePath)) continue;

      const group = groups.get(location.root) ?? [];
      group.push({ fullPath: name, relativePath: location.relativePath });
      groups.set(location.root, group);
    }

    const validGroups: Array<{
      root: string;
      entries: Array<{ fullPath: string; relativePath: string }>;
    }> = [];

    const rootPaths = new Set(rootEntries.map((entry) => entry.relativePath));
    if (rootPaths.has(EPUB_MIMETYPE_PATH) && rootPaths.has(EPUB_CONTAINER_PATH)) {
      validGroups.push({
        root: file.name.slice(0, -'.zip'.length),
        entries: rootEntries
      });
    }

    for (const [root, entries] of groups) {
      const paths = new Set(entries.map((entry) => entry.relativePath));
      if (paths.has(EPUB_MIMETYPE_PATH) && paths.has(EPUB_CONTAINER_PATH)) {
        validGroups.push({ root, entries });
      }
    }

    if (!validGroups.length) return [];

    const results: File[] = [];
    for (const group of validGroups) {
      const entries: PackageEntry[] = [];
      for (const entry of group.entries) {
        abortIfNeeded(signal);
        entries.push({
          path: entry.relativePath,
          blob: await archive.readBlob(entry.fullPath),
          lastModified: file.lastModified
        });
      }

      if (!(await isEpubPackage(entries, signal))) continue;

      const singleWrapperName =
        validGroups.length === 1 ? file.name.slice(0, -'.zip'.length) : undefined;
      results.push(await packageEpub(group.root, entries, singleWrapperName, signal));
    }

    return results;
  } finally {
    await archive.close();
  }
}

async function packageEpub(
  root: string,
  entries: PackageEntry[],
  preferredName?: string,
  signal?: AbortSignal
): Promise<File> {
  validatePackageEntries(entries);
  abortIfNeeded(signal);

  const entryMap = new Map(entries.map((entry) => [entry.path, entry]));
  const mimetype = entryMap.get(EPUB_MIMETYPE_PATH)!;
  const writer = new ZipWriter(new BlobWriter(EPUB_MIME_TYPE));
  let writerClosed = false;

  try {
    await writer.add(EPUB_MIMETYPE_PATH, new BlobReader(mimetype.blob), { level: 0 });

    for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
      abortIfNeeded(signal);
      if (entry.path === EPUB_MIMETYPE_PATH || isHiddenPath(entry.path)) continue;
      await writer.add(entry.path, new BlobReader(entry.blob));
    }

    abortIfNeeded(signal);
    writerClosed = true;
    const blob = await writer.close();
    const rootName = root.split('/').at(-1) ?? 'book.epub';
    const name =
      preferredName && preferredName.toLowerCase().endsWith('.epub') ? preferredName : rootName;
    const lastModified = Math.max(0, ...entries.map((entry) => entry.lastModified));

    return new File([blob], name, {
      type: EPUB_MIME_TYPE,
      lastModified
    });
  } catch (error) {
    if (!writerClosed) await writer.close().catch(() => {});
    throw error;
  }
}

async function isEpubPackage(entries: PackageEntry[], signal?: AbortSignal): Promise<boolean> {
  const byPath = new Map<string, PackageEntry>();

  for (const entry of entries) {
    abortIfNeeded(signal);
    validateArchivePath(entry.path);
    if (byPath.has(entry.path)) throw new Error(`Duplicate EPUB package path: ${entry.path}`);
    byPath.set(entry.path, entry);
  }

  const mimetype = byPath.get(EPUB_MIMETYPE_PATH);
  if (!mimetype || !byPath.has(EPUB_CONTAINER_PATH)) return false;
  if (mimetype.blob.size > 1024) throw new Error('Invalid EPUB package mimetype');

  abortIfNeeded(signal);
  const value = (await mimetype.blob.text()).trim();
  abortIfNeeded(signal);
  if (value !== EPUB_MIME_TYPE) throw new Error('Invalid EPUB package mimetype');

  validatePackageEntries(entries);
  return true;
}

function validatePackageEntries(entries: PackageEntry[]): void {
  if (entries.length > BOOK_ARCHIVE_LIMITS.entryCount) {
    throw new ArchiveLimitError('EPUB package has too many entries');
  }

  let totalBytes = 0;
  const paths = new Set<string>();

  for (const entry of entries) {
    const path = validateArchivePath(entry.path);
    if (paths.has(path)) throw new Error(`Duplicate EPUB package path: ${path}`);
    paths.add(path);

    if (!Number.isSafeInteger(entry.blob.size) || entry.blob.size < 0) {
      throw new Error(`Invalid EPUB package entry size: ${path}`);
    }
    if (entry.blob.size > BOOK_ARCHIVE_LIMITS.entryBytes) {
      throw new ArchiveLimitError(`EPUB package entry is too large: ${path}`);
    }

    totalBytes += entry.blob.size;
    if (totalBytes > BOOK_ARCHIVE_LIMITS.totalBytes) {
      throw new ArchiveLimitError('EPUB package decompressed size exceeds the limit');
    }
  }

  if (!paths.has(EPUB_MIMETYPE_PATH) || !paths.has(EPUB_CONTAINER_PATH)) {
    throw new Error('Invalid EPUB package');
  }
}

function findPackageLocation(rawPath: string): PackageLocation | undefined {
  if (!rawPath || rawPath.includes('\\')) return undefined;

  const parts = rawPath.replace(/^\/+/, '').split('/');
  for (let index = parts.length - 2; index >= 0; index--) {
    if (!parts[index].toLowerCase().endsWith('.epub')) continue;

    const root = parts.slice(0, index + 1).join('/');
    const relativePath = parts.slice(index + 1).join('/');
    if (!root || !relativePath) return undefined;

    validateArchivePath(relativePath);
    return { root, relativePath };
  }

  return undefined;
}

function isHiddenPath(value: string): boolean {
  return value.split('/').some((part) => part === '__MACOSX' || part.startsWith('.'));
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException('Book import cancelled', 'AbortError');
}
