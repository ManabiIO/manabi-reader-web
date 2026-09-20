<script lang="ts">
  import { browser } from '$app/environment';
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { createEventDispatcher } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/dropdown-menu';
  import AppNav from '$lib/components/navigation/app-nav.svelte';
  import ActionMenu from '$lib/components/navigation/action-menu.svelte';
  import type { BookCardProps } from './book-card-props';
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
    isOnline$,
    oneDriveStorageSource$
  } from '$lib/data/store';
  import { inputAllowDirectory } from '$lib/functions/file-dom/input-allow-directory';
  import { inputFile } from '$lib/functions/file-dom/input-file';
  import { isMobile$, isOnOldUrl } from '$lib/functions/utils';

  export let hasBookOpened: boolean;
  export let selectMode: boolean;
  export let selectedCount: number;
  export let hasBooks: boolean;
  export let cancelTooltip: string;
  export let replicationProgress: number;
  export let replicationToProgress: number;
  export let replicationProgressRemaining: string;
  const dispatch = createEventDispatcher<{
    selectAllClick: void;
    removeClick: void;
    domainHintClick: void;
    bugReportClick: void;
    backToBookClick: void;
    filesChange: FileList;
    importBackup: File;
    selectionToStatistics: void;
    deleteStatistics: void;
    replicateData: void;
    cancelReplication: void;
  }>();
  let fileImportElm: HTMLInputElement;
  let folderImportElm: HTMLInputElement;
  let backupImportElm: HTMLInputElement;
  let countImportElm: HTMLInputElement;
  $: isOldUrl = browser && isOnOldUrl(window);
  $: showLoadCount = browser && new URLSearchParams(window.location.search).has('count');
  $: sources = [
    { label: 'Browser', key: StorageKey.BROWSER, online: false },
    ...(browser && isStorageSourceAvailable(StorageKey.GDRIVE, $gDriveStorageSource$, window)
      ? [{ label: 'Google Drive', key: StorageKey.GDRIVE, online: true }]
      : []),
    ...(browser && isStorageSourceAvailable(StorageKey.ONEDRIVE, $oneDriveStorageSource$, window)
      ? [{ label: 'OneDrive', key: StorageKey.ONEDRIVE, online: true }]
      : []),
    ...(browser && isStorageSourceAvailable(StorageKey.FS, $fsStorageSource$, window)
      ? [{ label: 'Filesystem', key: StorageKey.FS, online: false }]
      : [])
  ];
  $: sortItems = [
    ...($storageSource$ === StorageKey.BROWSER ? [{ property: 'id', label: 'Added' }] : []),
    { property: 'title', label: 'Title' },
    { property: 'characters', label: 'Characters' },
    { property: 'lastBookModified', label: 'Last Update' },
    { property: 'lastBookOpen', label: 'Last Read' },
    { property: 'progress', label: 'Progress' },
    { property: 'lastBookmarkModified', label: 'Bookmarked' }
  ];
  function filesChanged(files: FileList) {
    dispatch('filesChange', files);
  }
  function backupChanged(files: FileList) {
    if (files[0]) dispatch('importBackup', files[0]);
  }
  async function setCountData(files: FileList) {
    try {
      if (files[0])
        $fileCountData$ = JSON.parse(await FilesystemStorageHandler.readFileObject(files[0]));
    } catch (error) {
      console.error('Failed to read character counts', error);
    }
  }
  function setSort(property: string, direction: SortDirection) {
    booklistSortOptions$.next({
      ...$booklistSortOptions$,
      [$storageSource$]: {
        property: property as Exclude<keyof BookCardProps, 'imagePath' | 'isPlaceholder'>,
        direction
      }
    });
  }
  function sourceChanged(key: StorageKey) {
    if (key === $storageSource$) return;
    if (!$cacheStorageData$) getStorageHandler(window, key).clearData();
    storageSource$.next(key);
  }
</script>

<input
  hidden
  multiple
  type="file"
  accept="application/epub+zip,.epub,.htmlz,plain/text,.txt"
  use:inputFile={filesChanged}
  bind:this={fileImportElm}
/>
<input
  hidden
  multiple
  type="file"
  use:inputAllowDirectory
  use:inputFile={filesChanged}
  bind:this={folderImportElm}
/>
<input
  hidden
  type="file"
  accept=".zip,application/zip"
  use:inputFile={backupChanged}
  bind:this={backupImportElm}
/>
<input
  hidden
  type="file"
  accept=".json,application/json"
  use:inputFile={setCountData}
  bind:this={countImportElm}
/>

<header
  class="app-header border-b border-border bg-card text-foreground"
  aria-label="Library toolbar"
>
  <div class="mx-auto flex h-12 max-w-7xl items-center justify-between gap-2 px-3 sm:px-6">
    <div class="flex min-w-0 items-center gap-3">
      <h1 class="truncate text-lg font-semibold">Library</h1>
      <span class="hidden text-sm text-muted-foreground sm:inline">Manabi Reader</span>
    </div>
    <div class="flex items-center gap-1">
      {#if hasBookOpened && !replicationToProgress}<Button
          variant="ghost"
          onclick={() => dispatch('backToBookClick')}
          title="Back to Book">Resume reading</Button
        >{/if}
      {#if !replicationToProgress}<AppNav />{/if}
    </div>
  </div>
  <div class="mx-auto flex min-h-14 max-w-7xl items-center gap-2 overflow-x-auto px-3 pb-2 sm:px-6">
    {#if replicationToProgress}
      <Button variant="outline" onclick={() => dispatch('cancelReplication')} title={cancelTooltip}
        >Cancel operation</Button
      >
      <progress
        class="h-2 min-w-20 flex-1"
        aria-label="Export progress"
        value={replicationProgress}
        max={replicationToProgress}
      ></progress>
      <span role="status" class="whitespace-nowrap text-sm">{replicationProgressRemaining}</span>
    {:else if selectMode}
      <Button variant="ghost" onclick={() => (selectMode = false)}>Cancel selection</Button>
      <span class="whitespace-nowrap text-sm" aria-live="polite">{selectedCount} selected</span>
      <Button variant="outline" onclick={() => dispatch('selectAllClick')}>Select all</Button>
      {#if selectedCount > 0}
        <Button
          variant="secondary"
          onclick={() => dispatch('replicateData')}
          title="Open Export Menu">Export</Button
        >
        <ActionMenu label="Actions" title="Selected book actions">
          {#if $storageSource$ === StorageKey.BROWSER}
            <Menu.Item onSelect={() => dispatch('selectionToStatistics')}
              >Statistics for selected books</Menu.Item
            >
            <Menu.Item variant="destructive" onSelect={() => dispatch('deleteStatistics')}
              >Delete selected statistics</Menu.Item
            >
            <Menu.Separator />
          {/if}
          <Menu.Item variant="destructive" onSelect={() => dispatch('removeClick')}
            >Delete selected books</Menu.Item
          >
        </ActionMenu>
      {/if}
    {:else}
      <ActionMenu label="Add books">
        <Menu.Item onSelect={() => fileImportElm.click()}>Import File(s)</Menu.Item>
        {#if !$isMobile$}<Menu.Item onSelect={() => folderImportElm.click()}
            >Import Folder(s)</Menu.Item
          >{/if}
        <Menu.Item onSelect={() => backupImportElm.click()}>Import Backup</Menu.Item>
        <Menu.Separator />
        <Menu.Item onSelect={() => goto(resolve('/import-ttu'))}
          >Import from Ttu Ebook Reader</Menu.Item
        >
      </ActionMenu>
      <ActionMenu
        label={sources.find((source) => source.key === $storageSource$)?.label ?? 'Storage'}
        title="Select Storage Source"
      >
        <Menu.Label>Storage source</Menu.Label>
        <Menu.RadioGroup
          value={$storageSource$}
          onValueChange={(value) => sourceChanged(value as StorageKey)}
        >
          {#each sources as source (source.key)}<Menu.RadioItem
              value={source.key}
              disabled={source.online && !$isOnline$}>{source.label}</Menu.RadioItem
            >{/each}
        </Menu.RadioGroup>
      </ActionMenu>
      <ActionMenu label="Sort" title="Select Sort Options">
        <Menu.Label>Sort books</Menu.Label>
        <Menu.RadioGroup
          value={$booklistSortOptions$[$storageSource$].property}
          onValueChange={(property) =>
            setSort(property, $booklistSortOptions$[$storageSource$].direction)}
        >
          {#each sortItems as item (item.property)}<Menu.RadioItem value={item.property}
              >{item.label}</Menu.RadioItem
            >{/each}
        </Menu.RadioGroup>
        <Menu.Separator />
        <Menu.RadioGroup
          value={String($booklistSortOptions$[$storageSource$].direction)}
          onValueChange={(direction) =>
            setSort($booklistSortOptions$[$storageSource$].property, direction as SortDirection)}
        >
          <Menu.RadioItem value={String(SortDirection.ASC)}>Ascending</Menu.RadioItem>
          <Menu.RadioItem value={String(SortDirection.DESC)}>Descending</Menu.RadioItem>
        </Menu.RadioGroup>
      </ActionMenu>
      <Button variant="ghost" disabled={!hasBooks} onclick={() => (selectMode = true)}
        >Select books</Button
      >
      <ActionMenu label="Help">
        <Menu.Item onSelect={() => dispatch('bugReportClick')}>Report an Issue</Menu.Item>
        {#if isOldUrl}<Menu.Item onSelect={() => dispatch('domainHintClick')}
            >Old domain information</Menu.Item
          >{/if}
        {#if showLoadCount}<Menu.Item onSelect={() => countImportElm.click()}
            >Import character counts{$fileCountData$ ? ' (loaded)' : ''}</Menu.Item
          >{/if}
      </ActionMenu>
    {/if}
  </div>
</header>
