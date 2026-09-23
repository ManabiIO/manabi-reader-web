<script lang="ts">
  import { browser } from '$app/environment';
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/dropdown-menu';
  import AppNav from '$lib/components/navigation/app-nav.svelte';
  import ActionMenu from '$lib/components/navigation/action-menu.svelte';
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
    isOnline$,
    oneDriveStorageSource$
  } from '$lib/data/store';
  import { inputAllowDirectory } from '$lib/functions/file-dom/input-allow-directory';
  import { inputFile } from '$lib/functions/file-dom/input-file';
  import { isMobile$, isOnOldUrl } from '$lib/functions/utils';
  import type { LibraryMenuModel } from '$lib/library/library-menu';
  import {
    ArrowLeftIcon as ArrowLeft,
    BookmarkSimpleIcon as BookmarkSimple,
    BooksIcon as Books,
    BugIcon as Bug,
    CalendarBlankIcon as CalendarBlank,
    ChartBarIcon as ChartBar,
    CloudIcon as Cloud,
    DotsThreeIcon as MoreHorizontal,
    FileArrowUpIcon as FileArrowUp,
    FolderOpenIcon as FolderOpen,
    FolderPlusIcon as FolderPlus,
    GearIcon as Gear,
    ListIcon as List,
    MagnifyingGlassIcon as Search,
    TextAlignLeftIcon as CollectionsList,
    SelectionAllIcon as SelectionAll,
    SquaresFourIcon as SquaresFour,
    UserCircleIcon as UserCircle
  } from 'phosphor-svelte';

  export let modernLibrary = false;
  const compactMenus = new MediaQuery('(max-width: 639px)');
  let compactLibrary = browser && window.matchMedia('(max-width: 1023px)').matches;
  let searchExpanded = false;
  let searchInput: HTMLInputElement | undefined;
  let searchButton: HTMLButtonElement | null = null;
  onMount(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const update = () => (compactLibrary = media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  });
  export let title = 'Library';
  export let collectionsExpanded = false;
  export let libraryMenu: LibraryMenuModel | undefined = undefined;
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
    collectionsClick: void;
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
    { property: 'author', label: 'Author' },
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
        property: property as SortOption['property'],
        direction
      }
    });
  }
  function sourceChanged(key: StorageKey) {
    if (key === $storageSource$) return;
    if (!$cacheStorageData$) getStorageHandler(window, key).clearData();
    storageSource$.next(key);
  }
  async function openSearch() {
    searchExpanded = true;
    await tick();
    searchInput?.focus();
  }
  async function closeSearch() {
    libraryMenu?.search.setQuery('');
    searchExpanded = false;
    await tick();
    searchButton?.focus();
  }
</script>

<input
  hidden
  multiple
  type="file"
  accept="application/epub+zip,.epub,.epub.zip,.htmlz,plain/text,.txt"
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

{#if modernLibrary}
  <header
    class="floating-library-header text-foreground lg:ml-[16rem]"
    aria-label="Library toolbar"
  >
    <div class="flex min-h-16 items-center justify-between gap-2 px-3 py-2 sm:px-6">
      {#if compactLibrary && (searchExpanded || !!libraryMenu?.search.query)}
        <form
          class="flex min-w-0 flex-1 items-center gap-2"
          role="search"
          onsubmit={(event) => event.preventDefault()}
        >
          <label
            class="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-muted px-3 focus-within:ring-2 focus-within:ring-ring"
          >
            <Search class="size-6 shrink-0" weight="bold" aria-hidden="true" />
            <span class="sr-only">Search library</span>
            <input
              bind:this={searchInput}
              type="search"
              class="min-w-0 w-full border-0 bg-transparent p-0 shadow-none outline-none focus:border-transparent focus:shadow-none focus:ring-0"
              placeholder="Search library"
              value={libraryMenu?.search.query || ''}
              oninput={(event) => libraryMenu?.search.setQuery(event.currentTarget.value)}
              onkeydown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  void closeSearch();
                }
              }}
            />
          </label>
          <Button variant="ghost" class="min-h-11" onclick={closeSearch}>Cancel</Button>
        </form>
      {:else}
        <div class="flex min-w-0 items-center gap-2">
          {#if libraryMenu?.canGoBack}
            <Button
              variant="ghost"
              size="icon"
              class="size-11 shrink-0 rounded-full"
              aria-label="Back"
              title="Back"
              onclick={() => libraryMenu?.back()}
            >
              <ArrowLeft class="size-6" weight="bold" aria-hidden="true" />
            </Button>
            <h1 class="truncate text-base font-semibold tracking-tight sm:text-2xl">{title}</h1>
          {:else}
            <h1
              class="flex min-w-0 flex-wrap gap-x-1 text-sm leading-tight font-semibold tracking-tight min-[390px]:text-base sm:text-xl"
            >
              <span class="whitespace-nowrap">Manabi Reader</span>
              <span class="whitespace-nowrap font-normal text-muted-foreground">for Web</span>
            </h1>
          {/if}
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <Button
            variant="outline"
            size="icon"
            class="size-11 rounded-full lg:hidden"
            aria-label="Collections"
            title="Collections"
            aria-expanded={collectionsExpanded}
            aria-haspopup="dialog"
            aria-controls="library-collections-sheet"
            onclick={() => dispatch('collectionsClick')}
            disabled={!!replicationToProgress}
          >
            <CollectionsList class="size-6" weight="bold" aria-hidden="true" />
          </Button>
          <Menu.Root>
            <Menu.Trigger>
              {#snippet child({ props })}
                <Button
                  {...props}
                  variant="outline"
                  size="icon"
                  class="size-11 rounded-full"
                  aria-label="Library actions"
                  title="Library actions"
                  disabled={!!replicationToProgress}
                >
                  <MoreHorizontal class="size-7" weight="bold" aria-hidden="true" />
                </Button>
              {/snippet}
            </Menu.Trigger>
            <Menu.Content
              align="end"
              class="library-menu max-h-[min(80dvh,40rem)] w-72 max-w-[calc(100vw-1rem)] overflow-y-auto"
            >
              {#if hasBookOpened}
                <Menu.Item onSelect={() => dispatch('backToBookClick')}
                  ><Books aria-hidden="true" />Resume Reading</Menu.Item
                >
                <Menu.Separator />
              {/if}
              <Menu.Item disabled={!hasBooks} onSelect={() => (selectMode = true)}
                ><SelectionAll aria-hidden="true" />Select Books</Menu.Item
              >
              <Menu.Sub>
                <Menu.SubTrigger><FolderPlus aria-hidden="true" />Add Books</Menu.SubTrigger>
                <Menu.SubContent
                  side={compactMenus.current ? 'bottom' : 'right'}
                  align="end"
                  collisionPadding={8}
                  class="library-menu w-64"
                >
                  <Menu.Item onSelect={() => fileImportElm.click()}
                    ><FileArrowUp aria-hidden="true" />Import File(s)</Menu.Item
                  >
                  {#if !$isMobile$}
                    <Menu.Item onSelect={() => folderImportElm.click()}
                      ><FolderPlus aria-hidden="true" />Import Folder(s)</Menu.Item
                    >
                  {/if}
                  <Menu.Item onSelect={() => backupImportElm.click()}>Import Backup</Menu.Item>
                  <Menu.Separator />
                  <Menu.Item onSelect={() => goto(resolve('/import-ttu'))}
                    >Import from Ttu Ebook Reader</Menu.Item
                  >
                </Menu.SubContent>
              </Menu.Sub>
              {#if libraryMenu}
                <Menu.Sub>
                  <Menu.SubTrigger><SquaresFour aria-hidden="true" />View Options</Menu.SubTrigger>
                  <Menu.SubContent
                    side={compactMenus.current ? 'bottom' : 'right'}
                    align="end"
                    collisionPadding={8}
                    class="library-menu w-64"
                  >
                    <Menu.RadioGroup
                      value={libraryMenu.currentLayout}
                      onValueChange={libraryMenu.setLayout}
                    >
                      {#each libraryMenu.layouts as choice (choice.value)}
                        <Menu.RadioItem value={choice.value}>
                          {#if choice.icon === 'grid'}<SquaresFour
                              aria-hidden="true"
                            />{:else if choice.icon === 'list'}<List
                              aria-hidden="true"
                            />{:else}<CalendarBlank aria-hidden="true" />{/if}{choice.label}
                        </Menu.RadioItem>
                      {/each}
                    </Menu.RadioGroup>
                    <Menu.Separator /><Menu.Label>Show</Menu.Label>
                    <Menu.RadioGroup
                      value={libraryMenu.showValue}
                      onValueChange={libraryMenu.setShow}
                    >
                      {#each libraryMenu.showChoices as choice (choice.value)}
                        <Menu.RadioItem
                          value={choice.value}
                          disabled={libraryMenu.showChoices.length === 1}
                          >{choice.label}</Menu.RadioItem
                        >
                      {/each}
                    </Menu.RadioGroup>
                    <Menu.Separator />
                    <Menu.Sub>
                      <Menu.SubTrigger>Sort by…</Menu.SubTrigger>
                      <Menu.SubContent
                        side={compactMenus.current ? 'bottom' : 'right'}
                        align="end"
                        collisionPadding={8}
                        class="library-menu w-56"
                      >
                        {#if libraryMenu.finishedOrder}
                          <Menu.Label>Finished date</Menu.Label>
                          <Menu.RadioGroup
                            value={libraryMenu.finishedOrder}
                            onValueChange={libraryMenu.setFinishedOrder}
                          >
                            <Menu.RadioItem value="desc">Newest first</Menu.RadioItem>
                            <Menu.RadioItem value="asc">Oldest first</Menu.RadioItem>
                          </Menu.RadioGroup>
                        {:else}
                          <Menu.RadioGroup
                            value={libraryMenu.sortProperty}
                            onValueChange={(value) => libraryMenu?.setSort(value)}
                          >
                            {#each libraryMenu.sortChoices as choice (choice.property)}
                              <Menu.RadioItem value={choice.property}>{choice.label}</Menu.RadioItem
                              >
                            {/each}
                          </Menu.RadioGroup>
                          <Menu.Sub>
                            <Menu.SubTrigger>More Sort Options</Menu.SubTrigger>
                            <Menu.SubContent
                              side={compactMenus.current ? 'bottom' : 'right'}
                              align="end"
                              collisionPadding={8}
                              class="library-menu w-52"
                            >
                              <Menu.RadioGroup
                                value={libraryMenu.sortProperty}
                                onValueChange={(value) => libraryMenu?.setSort(value)}
                              >
                                {#each libraryMenu.moreSortChoices as choice (choice.property)}
                                  <Menu.RadioItem value={choice.property}
                                    >{choice.label}</Menu.RadioItem
                                  >
                                {/each}
                              </Menu.RadioGroup>
                            </Menu.SubContent>
                          </Menu.Sub>
                          <Menu.Separator />
                          <Menu.RadioGroup
                            value={libraryMenu.sortDirection}
                            onValueChange={(value) =>
                              libraryMenu?.setSort(
                                libraryMenu.sortProperty,
                                value === 'asc' ? 'asc' : 'desc'
                              )}
                          >
                            <Menu.RadioItem value="asc">Ascending</Menu.RadioItem>
                            <Menu.RadioItem value="desc">Descending</Menu.RadioItem>
                          </Menu.RadioGroup>
                        {/if}
                      </Menu.SubContent>
                    </Menu.Sub>
                  </Menu.SubContent>
                </Menu.Sub>
                <Menu.Sub>
                  <Menu.SubTrigger
                    ><FolderOpen aria-hidden="true" />Organize Library</Menu.SubTrigger
                  >
                  <Menu.SubContent
                    side={compactMenus.current ? 'bottom' : 'right'}
                    align="end"
                    collisionPadding={8}
                    class="library-menu w-64"
                  >
                    <Menu.Item onSelect={libraryMenu.createSeries}
                      ><FolderPlus aria-hidden="true" />Create Series from Books…</Menu.Item
                    >
                    <Menu.Item onSelect={libraryMenu.refreshFolders}
                      ><Cloud aria-hidden="true" />Refresh Connected Folders</Menu.Item
                    >
                  </Menu.SubContent>
                </Menu.Sub>
              {/if}
              <Menu.Separator />
              <Menu.Item onSelect={() => goto(resolve('/connections'))}
                ><UserCircle aria-hidden="true" />Accounts and Libraries</Menu.Item
              >
              <Menu.Item onSelect={() => goto(resolve('/statistics'))}
                ><ChartBar aria-hidden="true" />Statistics</Menu.Item
              >
              <Menu.Item onSelect={() => goto(resolve('/settings'))}
                ><Gear aria-hidden="true" />Settings</Menu.Item
              >
              <Menu.Item onSelect={() => goto(resolve('/shared-library'))}
                >Shared Libraries</Menu.Item
              >
              {#if sources.length > 1}
                <Menu.Separator />
                <Menu.Sub>
                  <Menu.SubTrigger>Storage View</Menu.SubTrigger>
                  <Menu.SubContent
                    side={compactMenus.current ? 'bottom' : 'right'}
                    align="end"
                    collisionPadding={8}
                    class="library-menu w-64"
                  >
                    <Menu.Label>Legacy storage views</Menu.Label>
                    <Menu.RadioGroup
                      value={$storageSource$}
                      onValueChange={(value) => sourceChanged(value as StorageKey)}
                    >
                      {#each sources as source (source.key)}
                        <Menu.RadioItem value={source.key} disabled={source.online && !$isOnline$}
                          >{source.label}</Menu.RadioItem
                        >
                      {/each}
                    </Menu.RadioGroup>
                  </Menu.SubContent>
                </Menu.Sub>
              {/if}
              <Menu.Separator />
              <Menu.Item onSelect={() => dispatch('bugReportClick')}
                ><Bug aria-hidden="true" />Report an Issue</Menu.Item
              >
              {#if isOldUrl}
                <Menu.Item onSelect={() => dispatch('domainHintClick')}
                  >Old Domain Information</Menu.Item
                >
              {/if}
              {#if showLoadCount}
                <Menu.Item onSelect={() => countImportElm.click()}
                  >Import Character Counts{$fileCountData$ ? ' (Loaded)' : ''}</Menu.Item
                >
              {/if}
            </Menu.Content>
          </Menu.Root>
          {#if compactLibrary}
            <Button
              bind:ref={searchButton}
              variant="outline"
              size="icon"
              class="size-11 rounded-full lg:hidden"
              aria-label="Search library"
              title="Search library"
              onclick={openSearch}
              disabled={!!replicationToProgress}
              ><Search class="size-6" weight="bold" aria-hidden="true" /></Button
            >
          {:else}
            <label
              class="hidden min-h-11 w-[clamp(12rem,20vw,18rem)] min-w-0 items-center gap-2 rounded-full bg-muted px-3 text-sm focus-within:ring-2 focus-within:ring-ring lg:flex"
              ><Search class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" /><span
                class="sr-only">Search library</span
              ><input
                class="min-w-0 w-full border-0 bg-transparent p-0 shadow-none outline-none focus:border-transparent focus:shadow-none focus:ring-0"
                type="search"
                placeholder="Search library"
                value={libraryMenu?.search.query || ''}
                oninput={(event) => libraryMenu?.search.setQuery(event.currentTarget.value)}
              /></label
            >
          {/if}
        </div>
      {/if}
    </div>
    {#if replicationToProgress}
      <div class="mx-auto flex min-h-14 max-w-6xl items-center gap-2 px-4 pb-3 sm:px-6">
        <Button
          variant="outline"
          onclick={() => dispatch('cancelReplication')}
          title={cancelTooltip}>Cancel Operation</Button
        >
        <progress
          class="h-2 min-w-20 flex-1"
          aria-label="Export progress"
          value={replicationProgress}
          max={replicationToProgress}
        ></progress>
        <span role="status" class="whitespace-nowrap text-sm">{replicationProgressRemaining}</span>
      </div>
    {:else if selectMode}
      <div
        class="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center gap-2 border-t border-border/60 px-4 py-2 sm:px-6"
        aria-label="Book selection"
      >
        <Button variant="ghost" onclick={() => (selectMode = false)}>Cancel selection</Button>
        <span class="whitespace-nowrap text-sm" aria-live="polite">{selectedCount} selected</span>
        <Button variant="outline" onclick={() => dispatch('selectAllClick')}>Select all</Button>
        {#if selectedCount > 0}
          <Button variant="secondary" onclick={() => dispatch('replicateData')}>Export</Button>
          <ActionMenu label="Actions" title="Selected book actions">
            {#if libraryMenu?.selectedWantToRead.canAdd}
              <Menu.Item onSelect={() => libraryMenu?.selectedWantToRead.set(true)}
                ><BookmarkSimple aria-hidden="true" />Add to Want to Read</Menu.Item
              >
            {/if}
            {#if libraryMenu?.selectedWantToRead.canRemove}
              <Menu.Item onSelect={() => libraryMenu?.selectedWantToRead.set(false)}
                ><BookmarkSimple weight="fill" aria-hidden="true" />Remove from Want to Read</Menu.Item
              >
            {/if}
            <Menu.Separator />
            <Menu.Item onSelect={() => dispatch('selectionToStatistics')}
              >Statistics for Selected Books</Menu.Item
            >
            <Menu.Item variant="destructive" onSelect={() => dispatch('deleteStatistics')}
              >Delete Selected Statistics</Menu.Item
            >
            <Menu.Separator />
            <Menu.Item variant="destructive" onSelect={() => dispatch('removeClick')}
              >Delete Selected Books</Menu.Item
            >
          </ActionMenu>
        {/if}
      </div>
    {/if}
  </header>
{:else}
  <header
    class="app-header border-b border-border bg-card text-foreground"
    aria-label="Library toolbar"
  >
    <div class="mx-auto flex h-12 max-w-7xl items-center justify-between gap-2 px-3 sm:px-6">
      <div class="flex min-w-0 items-center gap-3">
        <h1 class="truncate font-serif text-3xl font-bold tracking-tight">Library</h1>
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
    <div
      class="mx-auto flex min-h-14 max-w-7xl items-center gap-2 overflow-x-auto px-3 pb-2 sm:px-6"
    >
      {#if replicationToProgress}
        <Button
          variant="outline"
          onclick={() => dispatch('cancelReplication')}
          title={cancelTooltip}>Cancel operation</Button
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
        {#if !modernLibrary}
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
                setSort(
                  $booklistSortOptions$[$storageSource$].property,
                  direction as SortDirection
                )}
            >
              <Menu.RadioItem value={String(SortDirection.ASC)}>Ascending</Menu.RadioItem>
              <Menu.RadioItem value={String(SortDirection.DESC)}>Descending</Menu.RadioItem>
            </Menu.RadioGroup>
          </ActionMenu>
        {/if}
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
{/if}

<style>
  .floating-library-header {
    border: 0;
    background: transparent;
  }
</style>
