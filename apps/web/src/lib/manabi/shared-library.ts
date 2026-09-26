/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { commitTransaction } from '$lib/data/database/books-db/commit-transaction.mjs';

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
import { exclusive, integrationDB } from './persistence';
import { account, currentUser } from './client';
import { visibleLibraryEntries } from '$lib/library/account-visibility';
import { inspectTtuRoot, resolveTtuRoot, ttuRootName } from './ttu-folder-contract';
import { uniqueSharedCopy } from './shared-title-selection';

/** Record the ID the existing serializer actually saved, including a new same-title edition. */
class SharedBrowserStorageHandler extends BrowserStorageHandler {
  readonly savedBooks = new Map<number, string>();

  override async saveBook(...args: Parameters<BrowserStorageHandler['saveBook']>) {
    const id = await super.saveBook(...args);
    if (id) this.savedBooks.set(id, this.currentContext.title);
    return id;
  }
}

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
  const owner = currentUser()?.id ?? null;
  const controller = new AbortController();
  const stopAccount = account.subscribe((state) => {
    if ((state.session?.user?.id ?? null) !== owner)
      controller.abort(new Error('Account changed. Reopen the shared library before sharing.'));
  });
  try {
    return await exclusive(
      `shared-ttu/${source.name}`,
      async () => {
        const root = filesystemData(source).directoryHandle;
        if ((await root.queryPermission({ mode: 'readwrite' })) !== 'granted') {
          throw new Error('Reconnect this folder before syncing.');
        }
        const folderNames = await inspectTtuRoot(root);
        const remoteTitles = new Set(folderNames.map(BaseStorageHandler.desanitizeFilename));
        const links = await (await integrationDB()).getAll('books');
        controller.signal.throwIfAborted();
        const contexts: { title: string; id?: number }[] = [];
        for (const title of new Set(titles)) {
          const local = uniqueSharedCopy(
            title,
            await (await database.db).getAllFromIndex('data', 'title', title, 2)
          );
          controller.signal.throwIfAborted();
          if (local && !visibleLibraryEntries([local], links, owner).cards.length)
            throw new Error(
              'This local book is unavailable for the current account. No transfer was started.'
            );
          if (direction === 'publish') {
            if (!local?.elementHtml)
              throw new Error(`The local book ${title} is not available on this device.`);
            if (remoteTitles.has(title)) {
              throw new Error(
                `${title} already exists in the shared library. Open it there to sync reading data; publishing will not replace its package.`
              );
            }
            // Percent encoding and Ttu Ebook Reader title markers must round-trip before creating a folder.
            if (
              BaseStorageHandler.desanitizeFilename(
                BaseStorageHandler.sanitizeForFilename(title)
              ) !== title
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
          contexts.push({ title, id: local?.id });
        }
        controller.signal.throwIfAborted();
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
        const browser = new SharedBrowserStorageHandler(window, StorageKey.BROWSER);
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
          contexts,
          [StorageDataType.DATA, StorageDataType.PROGRESS, StorageDataType.STATISTICS],
          controller.signal
        );
        controller.signal.throwIfAborted();
        if (error) throw new Error(error);
        const identities =
          direction === 'import'
            ? browser.savedBooks
            : new Map(contexts.map(({ id, title }) => [id!, title]));
        const db = await database.db;
        controller.signal.throwIfAborted();
        const tx = db.transaction('data', 'readwrite');
        const abort = () => {
          try {
            tx.abort();
          } catch {
            /* Already settled. */
          }
        };
        controller.signal.addEventListener('abort', abort, { once: true });
        try {
          await commitTransaction(tx, async () => {
            for (const [id, title] of identities) {
              const book = await tx.store.get(id);
              controller.signal.throwIfAborted();
              if (!book || book.title !== title)
                throw new Error(
                  'A transferred local book changed. Refresh the shared library before retrying.'
                );
              // Only update source metadata on the current stored byte record.
              // Never re-encode an older full-book snapshot or pick by title.
              await tx.store.put({ ...book, storageSource: source.name });
            }
          });
        } finally {
          controller.signal.removeEventListener('abort', abort);
        }
        database.dataListChanged$.next(undefined);
      },
      controller.signal
    );
  } finally {
    stopAccount();
  }
}
