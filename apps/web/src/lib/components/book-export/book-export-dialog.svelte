<script lang="ts">
  import { browser } from '$app/environment';
  import BookExportSelection from '$lib/components/book-export/book-export-selection.svelte';
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import { Button } from '$lib/components/ui/button';
  import { StorageKey } from '$lib/data/storage/storage-types';
  import {
    getStorageIconData,
    isStorageSourceAvailable,
    storageSource$
  } from '$lib/data/storage/storage-view';
  import {
    fsStorageSource$,
    gDriveStorageSource$,
    lastExportedTarget$,
    lastExportedTypes$,
    oneDriveStorageSource$
  } from '$lib/data/store';
  import { executeReplicate$ } from '$lib/functions/replication/replication-progress';
  import { createEventDispatcher } from 'svelte';

  const baseIcons = [
    { ...getStorageIconData(StorageKey.BACKUP), source: StorageKey.BACKUP, label: 'Zip File' },
    { ...getStorageIconData(StorageKey.BROWSER), source: StorageKey.BROWSER, label: 'Browser DB' }
  ];
  let icons = baseIcons;

  const dispatch = createEventDispatcher<{
    close: void;
  }>();

  $: if (browser) {
    icons = [
      ...baseIcons,
      ...(isStorageSourceAvailable(StorageKey.GDRIVE, $gDriveStorageSource$, window)
        ? [
            {
              ...getStorageIconData(StorageKey.GDRIVE),
              source: StorageKey.GDRIVE,
              label: 'Google Drive'
            }
          ]
        : []),
      ...(isStorageSourceAvailable(StorageKey.ONEDRIVE, $oneDriveStorageSource$, window)
        ? [
            {
              ...getStorageIconData(StorageKey.ONEDRIVE),
              source: StorageKey.ONEDRIVE,
              label: 'OneDrive'
            }
          ]
        : []),
      ...(isStorageSourceAvailable(StorageKey.FS, $fsStorageSource$, window)
        ? [{ ...getStorageIconData(StorageKey.FS), source: StorageKey.FS, label: 'Filesystem' }]
        : [])
    ].filter((icon) => icon.source !== $storageSource$);
  }

  function replicateData() {
    executeReplicate$.next();
    dispatch('close');
  }
</script>

<DialogTemplate>
  <svelte:fragment slot="header">Export books and reading data</svelte:fragment>
  <svelte:fragment slot="content">
    <BookExportSelection
      {icons}
      bind:target={$lastExportedTarget$}
      bind:dataToReplicate={$lastExportedTypes$}
    />
  </svelte:fragment>
  <div class="flex grow flex-wrap justify-between gap-2" slot="footer">
    <Button variant="ghost" onclick={() => dispatch('close')}>Cancel</Button>
    <Button disabled={!$lastExportedTypes$.length} onclick={replicateData}>Start export</Button>
  </div>
</DialogTemplate>
