/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * React/controller port of lib/components/book-card/book-manager-header.svelte; transactions retain their original guards.
 */

import { browser } from '$app/environment';

import type { SortOption } from '$lib/data/sort-types';
import { SortDirection } from '$lib/data/sort-types';
import { FilesystemStorageHandler } from '$lib/data/storage/handler/filesystem-handler';
import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
import { StorageKey } from '$lib/data/storage/storage-types';
import { isStorageSourceAvailable, storageSource$ } from '$lib/data/storage/storage-view';
import {
  booklistSortOptions$,
  cacheStorageData$,
  fileCountData$,
  fsStorageSource$,
  gDriveStorageSource$,
  oneDriveStorageSource$
} from '$lib/data/store';

import { isOnOldUrl } from '$lib/functions/utils';
import type { LibraryMenuModel } from '$lib/library/library-menu';
import { ObservableController, readStore, writeStore, tick } from './observable-controller';
export class HeaderController extends ObservableController {
  dispatch: (event: string, payload?: FileList | File) => void = () => {};
  modernLibrary = false;
  get compactMenus() {
    return {
      current: typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches
    };
  }
  compactLibrary = browser && window.matchMedia('(max-width: 767px)').matches;
  searchExpanded = false;
  hydrated = false;
  searchInput!: HTMLInputElement | undefined;
  searchButton: HTMLButtonElement | null = null;
  libraryActionsButton: HTMLButtonElement | null = null;
  searchDraft = '';
  searchComposing = false;
  searchCompositionCancelled = false;
  searchCompositionBaseQuery = '';
  lastExternalSearchQuery = '';
  title = 'Library';
  collectionsExpanded = false;
  libraryMenu: LibraryMenuModel | undefined = undefined;
  hasBookOpened = false;
  selectMode = false;
  selectedCount = 0;
  hasBooks = false;
  cancelTooltip = '';
  replicationProgress = 0;
  replicationToProgress = 0;
  replicationProgressRemaining = '';
  fileImportElm: HTMLInputElement | null = null;
  folderImportElm: HTMLInputElement | null = null;
  backupImportElm: HTMLInputElement | null = null;
  countImportElm: HTMLInputElement | null = null;
  get externalSearchQuery() {
    return this.libraryMenu?.search.query ?? '';
  }
  openFilePicker() {
    this.fileImportElm?.click();
  }
  openFolderPicker() {
    this.folderImportElm?.click();
  }
  openBackupPicker() {
    this.backupImportElm?.click();
  }
  enterSelectionMode() {
    this.selectMode = true;
    // The menu trigger disappears when the selection toolbar replaces it.
    // Focus a surviving book after the menu finishes restoring trigger focus.
    void tick().then(() =>
      requestAnimationFrame(() => {
        if (this.selectMode)
          document
            .querySelector<HTMLButtonElement>('.library-workspace [data-selection-key]')
            ?.focus();
      })
    );
  }
  async exitSelectionMode() {
    this.selectMode = false;
    // Selection chrome unmounts its focused control. Restore a stable trigger
    // for both the modern browser library and legacy provider libraries.
    await tick();
    (
      this.libraryActionsButton ??
      document.querySelector<HTMLButtonElement>('.app-header button[aria-label="Add books"]')
    )?.focus({ preventScroll: true });
  }
  selectionKeydown(event: {
    defaultPrevented: boolean;
    key: string;
    isComposing?: boolean;
    nativeEvent?: {
      isComposing?: boolean;
      type?: string;
    };
    altKey: boolean;
    preventDefault(): void;
  }) {
    if (
      event.defaultPrevented ||
      event.key !== 'Escape' ||
      event.isComposing ||
      event.nativeEvent?.isComposing ||
      event.altKey
    )
      return;
    event.preventDefault();
    void this.exitSelectionMode();
  }
  get isOldUrl() {
    return browser && isOnOldUrl(window);
  }
  get showLoadCount() {
    return browser && new URLSearchParams(window.location.search).has('count');
  }
  get sources() {
    return [
      { label: 'Browser', key: StorageKey.BROWSER, online: false },
      ...(browser &&
      isStorageSourceAvailable(StorageKey.GDRIVE, readStore(gDriveStorageSource$), window)
        ? [{ label: 'Google Drive', key: StorageKey.GDRIVE, online: true }]
        : []),
      ...(browser &&
      isStorageSourceAvailable(StorageKey.ONEDRIVE, readStore(oneDriveStorageSource$), window)
        ? [{ label: 'OneDrive', key: StorageKey.ONEDRIVE, online: true }]
        : []),
      ...(browser && isStorageSourceAvailable(StorageKey.FS, readStore(fsStorageSource$), window)
        ? [{ label: 'Filesystem', key: StorageKey.FS, online: false }]
        : [])
    ];
  }
  get sortItems() {
    return [
      ...(readStore(storageSource$) === StorageKey.BROWSER
        ? [{ property: 'id', label: 'Added' }]
        : []),
      { property: 'title', label: 'Title' },
      { property: 'author', label: 'Author' },
      { property: 'characters', label: 'Characters' },
      { property: 'lastBookModified', label: 'Last Update' },
      { property: 'lastBookOpen', label: 'Last Read' },
      { property: 'progress', label: 'Progress' },
      { property: 'lastBookmarkModified', label: 'Bookmarked' }
    ];
  }
  filesChanged(files: FileList) {
    this.dispatch('filesChange', files);
  }
  backupChanged(files: FileList) {
    if (files[0]) this.dispatch('importBackup', files[0]);
  }
  async setCountData(files: FileList) {
    try {
      if (files[0])
        writeStore(
          fileCountData$,
          JSON.parse(await FilesystemStorageHandler.readFileObject(files[0]))
        );
    } catch (error) {
      console.error('Failed to read character counts', error);
    }
  }
  setSort(property: string, direction: SortDirection) {
    booklistSortOptions$.next({
      ...readStore(booklistSortOptions$),
      [readStore(storageSource$)]: {
        property: property as SortOption['property'],
        direction
      }
    });
  }
  sourceChanged(key: StorageKey) {
    if (key === readStore(storageSource$)) return;
    if (!readStore(cacheStorageData$)) getStorageHandler(window, key).clearData();
    storageSource$.next(key);
  }
  searchInputChanged(event: {
    currentTarget: HTMLInputElement;
    isComposing?: boolean;
    nativeEvent?: {
      isComposing?: boolean;
      type?: string;
    };
  }) {
    this.searchDraft = event.currentTarget.value;
    const composing = event.isComposing === true || event.nativeEvent?.isComposing === true;
    if (!this.searchComposing && !composing) this.libraryMenu?.search.setQuery(this.searchDraft);
  }
  searchCompositionStarted(event: {
    currentTarget: HTMLInputElement;
    isComposing?: boolean;
    nativeEvent?: {
      isComposing?: boolean;
      type?: string;
    };
  }) {
    this.searchComposing = true;
    this.searchCompositionCancelled = false;
    this.searchCompositionBaseQuery = this.externalSearchQuery;
    this.searchDraft = event.currentTarget.value;
  }
  searchCompositionEnded(event: {
    currentTarget: HTMLInputElement;
    isComposing?: boolean;
    nativeEvent?: {
      isComposing?: boolean;
      type?: string;
    };
  }) {
    const value = event.currentTarget.value;
    this.searchComposing = false;
    if (
      this.searchCompositionCancelled ||
      this.externalSearchQuery !== this.searchCompositionBaseQuery
    ) {
      this.searchCompositionCancelled = false;
      this.searchDraft = this.externalSearchQuery;
      return;
    }
    this.searchDraft = value;
    this.libraryMenu?.search.setQuery(this.searchDraft);
  }
  searchInputBlurred() {
    if (!this.searchComposing) return;
    this.searchCompositionCancelled = true;
    this.searchComposing = false;
    this.searchDraft = this.externalSearchQuery;
  }
  async openSearch() {
    this.searchExpanded = true;
    await tick();
    this.searchInput?.focus();
  }
  async closeSearch() {
    this.searchCompositionCancelled = this.searchComposing;
    this.searchComposing = false;
    this.searchDraft = '';
    this.libraryMenu?.search.setQuery('');
    this.searchExpanded = false;
    await tick();
    this.searchButton?.focus();
  }
  reconcile() {
    if (this.externalSearchQuery !== this.lastExternalSearchQuery) {
      this.lastExternalSearchQuery = this.externalSearchQuery;
      if (this.searchComposing && this.externalSearchQuery !== this.searchCompositionBaseQuery)
        this.searchCompositionCancelled = true;
      else if (!this.searchComposing) this.searchDraft = this.externalSearchQuery;
    }
  }
  start() {
    this.watch(
      gDriveStorageSource$,
      oneDriveStorageSource$,
      fsStorageSource$,
      storageSource$,
      fileCountData$,
      booklistSortOptions$,
      cacheStorageData$
    );
    return (() => {
      this.hydrated = true;
      const media = window.matchMedia('(max-width: 767px)');
      const update = () => (this.compactLibrary = media.matches);
      update();
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    })();
  }
}
