/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { currentUser, localProfileUser, request } from '$lib/manabi/client';
import { integrationDB, metadata, setMetadata } from '$lib/manabi/persistence';
import {
  CloudLibrary,
  LocalLibrarySource,
  supportedBook,
  type CloudConnection,
  type LibrarySource
} from '$lib/manabi/sources';
import { davSources, davSource } from '$lib/webdav/source';
import { sourceKey } from './organization';
import { isSeriesMetadataFilename, seriesMetadataFilename } from './series-metadata';
import type { LibraryEntry } from '$lib/manabi/sources';
import type { DirectoryEntry } from './tree';

export interface SourceDescriptor {
  id: string;
  owner: string | null;
  root: string;
  name: string;
  provider: string;
}
export interface Catalog {
  source: SourceDescriptor;
  entries: DirectoryEntry[];
  names: Record<string, string>;
  warnings: string[];
  scannedAt: number;
}
export async function sourceDescriptors(): Promise<SourceDescriptor[]> {
  const db = await integrationDB();
  const local = (await db.getAll('localLibraries')).map((l) => ({
    id: l.id,
    owner: null,
    root: '',
    name: l.name,
    provider: 'local'
  }));
  local.push(
    ...(await davSources()).map((source) => ({
      id: source.id,
      owner: null,
      root: source.url,
      name: source.name,
      provider: 'webdav'
    }))
  );
  const owner = localProfileUser()?.id;
  if (!owner) return local;
  const cloudKey = `library-sources:${owner}`;
  let cloud = (await metadata<SourceDescriptor[]>(cloudKey)) ?? [];
  if (currentUser()?.id !== owner) return [...local, ...cloud];
  try {
    const result = await request<{ items: CloudConnection[] }>('connections/', { userId: owner });
    cloud = result.items.flatMap((c) =>
      c.roots.map((root) => ({ id: c.id, owner, root, name: root, provider: c.provider }))
    );
    if (currentUser()?.id !== owner) return local;
    await setMetadata(cloudKey, cloud);
  } catch {
    /* Keep an offline catalog; the explicit Refresh action surfaces access errors. */
  }
  return [...local, ...cloud];
}
export async function librarySource(source: SourceDescriptor): Promise<LibrarySource> {
  if (source.owner !== null) {
    if (source.owner !== currentUser()?.id)
      throw new Error('Reconnect this library with its original account.');
    return new CloudLibrary(source.id, source.owner, source.root);
  }
  if (source.provider === 'webdav') return davSource(source.id);
  const local = await (await integrationDB()).get('localLibraries', source.id);
  if (!local) throw new Error('This folder is no longer connected.');
  return new LocalLibrarySource(local);
}
export async function cachedCatalog(source: SourceDescriptor) {
  return metadata<Catalog>(`library-catalog:${sourceKey(source)}`);
}
/** Entire traversal succeeds before replacing the last usable snapshot. No partial empty library on error. */
export async function scanCatalog(
  source: LibrarySource,
  descriptor: SourceDescriptor,
  signal?: AbortSignal
): Promise<Catalog> {
  const entries: DirectoryEntry[] = [],
    names: Record<string, string> = Object.create(null),
    warnings: string[] = [];
  const pending = [{ id: source.root, depth: 0 }],
    visited = new Set<string>(),
    seen = new Set<string>();
  while (pending.length) {
    signal?.throwIfAborted();
    const folder = pending.pop()!;
    if (visited.has(folder.id) || folder.depth > 64)
      throw new Error('Cyclic or excessively deep library.');
    visited.add(folder.id);
    if (folder.id !== source.root && source instanceof LocalLibrarySource) {
      try {
        const name = await source.seriesName(folder.id);
        if (name) names[folder.id] = name;
      } catch (error) {
        warnings.push(
          `${folder.id}: ${error instanceof Error ? error.message : 'Cannot read series name.'}`
        );
      }
    }
    const sidecars: LibraryEntry[] = [];
    let cursor = '';
    const cursors = new Set<string>();
    do {
      signal?.throwIfAborted();
      if (cursors.has(cursor)) throw new Error('The provider repeated a pagination cursor.');
      cursors.add(cursor);
      if (cursors.size > 1000) throw new Error('The folder requires too many listing pages.');
      const page = await source.list(folder.id, cursor);
      for (const entry of page.items) {
        if (
          entry.kind === 'file' &&
          isSeriesMetadataFilename(entry.name) &&
          folder.id !== source.root
        ) {
          if (sidecars.length < 2) sidecars.push(entry);
          continue;
        }
        if (entry.name === '.manabi-reader') continue;
        if (entry.kind === 'file' && !supportedBook(entry.name)) continue;
        if (entry.id === source.root || seen.has(entry.id))
          throw new Error('The provider returned a duplicate or cyclic file.');
        seen.add(entry.id);
        entries.push({ ...entry, parent: folder.id });
        if (entries.length > 50000)
          throw new Error('A library can contain at most 50,000 entries.');
        if (entry.kind === 'folder') pending.push({ id: entry.id, depth: folder.depth + 1 });
      }
      cursor = page.cursor;
    } while (cursor);
    if (source instanceof CloudLibrary && sidecars.length) {
      try {
        const canonical = sidecars.find((item) => item.name === seriesMetadataFilename);
        if (sidecars.length > 1 && !canonical)
          throw new Error('More than one series metadata file exists.');
        if (sidecars.length > 1)
          warnings.push(
            `${folder.id}: Both series metadata spellings exist; using .manabi-reader.yaml.`
          );
        names[folder.id] = await source.readSeriesName(canonical ?? sidecars[0]);
      } catch (error) {
        warnings.push(
          `${folder.id}: ${error instanceof Error ? error.message : 'Cannot read series name.'}`
        );
      }
    }
  }
  if (source.owner !== null && source.owner !== currentUser()?.id)
    throw new Error('The account changed during the scan.');
  signal?.throwIfAborted();
  const catalog = { source: descriptor, entries, names, warnings, scannedAt: Date.now() };
  await setMetadata(`library-catalog:${sourceKey(descriptor)}`, catalog);
  return catalog;
}
