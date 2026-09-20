/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BooksDbStorageSource } from '$lib/data/database/books-db/versions/books-db';
import { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';
import { BrowserStorageHandler } from '$lib/data/storage/handler/browser-handler';
import { FilesystemStorageHandler } from '$lib/data/storage/handler/filesystem-handler';
import { StorageDataType, StorageKey } from '$lib/data/storage/storage-types';
import { isRemoteContext, type FsHandle } from '$lib/data/storage/storage-source-manager';
import { storageSource$ } from '$lib/data/storage/storage-view';
import { database, fsStorageSource$ } from '$lib/data/store';
import { MergeMode } from '$lib/data/merge-mode';
import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';
import { replicateData } from '$lib/functions/replication/replicator';
import { exclusive } from './persistence';
import { inspectTtuRoot, resolveTtuRoot, ttuRootName } from './ttu-folder-contract';

export function filesystemData(source: BooksDbStorageSource): FsHandle {
  const data = source.data;
  if (
    source.type !== StorageKey.FS ||
    data instanceof ArrayBuffer ||
    isRemoteContext(data) ||
    !data.directoryHandle
  ) {
    throw new Error('This source is not a local shared-library folder.');
  }
  return data;
}

export async function sharedFolderSources() {
  return (await database.getStorageSources()).filter((source) => source.type === StorageKey.FS);
}

export async function addSharedFolder(create = false): Promise<BooksDbStorageSource | null> {
  if (!window.isSecureContext || !('showDirectoryPicker' in window)) {
    throw new Error(
      'This browser does not support local folder selection. Individual book import remains available.'
    );
  }
  // This call occurs directly in the button handler, before an IndexedDB await.
  let selected: FileSystemDirectoryHandle;
  try {
    selected = await window.showDirectoryPicker({ id: 'manabi-shared-ttu', mode: 'readwrite' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
  return registerSharedFolder(await resolveTtuRoot(selected, create));
}

export async function registerSharedFolder(
  root: FileSystemDirectoryHandle
): Promise<BooksDbStorageSource> {
  if (BaseStorageHandler.rootName !== ttuRootName) {
    throw new Error(
      'This deployment overrides the Ttu Ebook Reader root name and cannot promise native-library compatibility.'
    );
  }
  if ((await root.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    throw new Error(
      'Read/write permission is required for a shared sync library. Use local book import for read-only access.'
    );
  }
  await inspectTtuRoot(root);
  const sources = await database.getStorageSources();
  for (const source of sources) {
    if (source.type !== StorageKey.FS) continue;
    const existing = filesystemData(source);
    if (await existing.directoryHandle.isSameEntry(root)) return source;
  }
  let name = 'Shared Ttu Ebook Reader library';
  let suffix = 1;
  while (sources.some((source) => source.name === name))
    name = `Shared Ttu Ebook Reader library ${++suffix}`;
  const source: BooksDbStorageSource = {
    name,
    type: StorageKey.FS,
    storedInManager: false,
    encryptionDisabled: false,
    data: { directoryHandle: root, fsPath: root.name },
    lastSourceModified: Date.now()
  };
  // Connecting is not permission to publish all books or replace the sync target.
  await database.saveStorageSource(source, '', false, false);
  database.storageSourcesChanged$.next(await database.getStorageSources());
  return source;
}

export async function reconnectSharedFolder(source: BooksDbStorageSource) {
  const handle = filesystemData(source).directoryHandle;
  if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') {
    throw new Error(
      'Folder access was not granted. Books already on this device remain available.'
    );
  }
  await inspectTtuRoot(handle);
}

export async function openSharedFolder(source: BooksDbStorageSource) {
  const root = filesystemData(source).directoryHandle;
  if ((await root.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    throw new Error('Reconnect this folder using the button before opening it.');
  }
  await inspectTtuRoot(root);
  fsStorageSource$.next(source.name);
  storageSource$.next(StorageKey.FS);
}

/** Use the real Ttu Ebook Reader serializers/replication path, never a second reading-state schema. */
export async function transferSharedBooks(
  source: BooksDbStorageSource,
  direction: 'import' | 'publish',
  titles: string[]
) {
  if (!titles.length) throw new Error('Select at least one book.');
  return exclusive(`shared-ttu/${source.name}`, async () => {
    const root = filesystemData(source).directoryHandle;
    if ((await root.queryPermission({ mode: 'readwrite' })) !== 'granted') {
      throw new Error('Reconnect this folder before syncing.');
    }
    const folderNames = await inspectTtuRoot(root);
    const remoteTitles = new Set(folderNames.map(BaseStorageHandler.desanitizeFilename));
    for (const title of titles) {
      const local = await database.getDataByTitle(title);
      if (direction === 'publish') {
        if (!local) throw new Error(`The local book ${title} no longer exists.`);
        if (remoteTitles.has(title)) {
          throw new Error(
            `${title} already exists in the shared library. Open it there to sync reading data; publishing will not replace its package.`
          );
        }
        // Percent encoding and Ttu Ebook Reader title markers must round-trip before creating a folder.
        if (
          BaseStorageHandler.desanitizeFilename(BaseStorageHandler.sanitizeForFilename(title)) !==
          title
        ) {
          throw new Error(
            `${title} cannot be represented unambiguously in the Ttu Ebook Reader folder format. Rename it before publishing.`
          );
        }
      } else {
        if (!remoteTitles.has(title))
          throw new Error(`The shared book ${title} is no longer available.`);
        if (local && local.storageSource !== source.name) {
          throw new Error(
            `${title} already exists from another source. Rename or move that local copy before importing; no book was overwritten.`
          );
        }
      }
    }
    const filesystem = new FilesystemStorageHandler(window, StorageKey.FS);
    filesystem.updateSettings(
      window,
      true,
      ReplicationSaveBehavior.NewOnly,
      MergeMode.MERGE,
      MergeMode.MERGE,
      false,
      false,
      source.name
    );
    const browser = new BrowserStorageHandler(window, StorageKey.BROWSER);
    browser.updateSettings(
      window,
      true,
      ReplicationSaveBehavior.NewOnly,
      MergeMode.MERGE,
      MergeMode.MERGE
    );
    const from = direction === 'import' ? filesystem : browser;
    const to = direction === 'import' ? browser : filesystem;
    const error = await replicateData(
      from,
      to,
      true,
      titles.map((title) => ({ title })),
      [StorageDataType.DATA, StorageDataType.PROGRESS, StorageDataType.STATISTICS]
    );
    if (error) throw new Error(error);
    {
      const db = await database.db;
      for (const title of titles) {
        const book = await database.getDataByTitle(title);
        if (book) await db.put('data', { ...book, storageSource: source.name });
      }
    }
    database.dataListChanged$.next(undefined);
  });
}
