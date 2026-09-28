<script lang="ts">
  import faArrowsUpDown from '@lucide/svelte/icons/move-vertical';
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import { Button } from '$lib/components/ui/button';
  import { InternalStorageSources, StorageKey } from '$lib/data/storage/storage-types';
  import type { BooksDbStorageSource } from '$lib/data/database/books-db/versions/books-db';
  import type { SyncSelection } from '$lib/data/dialog-manager';
  import { lastSyncedSettingsSource$, lastSyncedSettingsTarget$ } from '$lib/data/store';
  import { createEventDispatcher } from 'svelte';
  import AppIcon from '$lib/components/app-icon.svelte';

  export let settingsSyncHeader = '';
  export let storageSources: BooksDbStorageSource[] = [];
  export let resolver: (arg0: SyncSelection[]) => void;

  const dispatch = createEventDispatcher<{
    close: void;
  }>();

  const syncSources: SyncSelection[] = [
    { id: InternalStorageSources.INTERNAL_BROWSER, label: 'Browser DB', type: StorageKey.BROWSER },
    { id: InternalStorageSources.INTERNAL_ZIP, label: 'ZIP File', type: StorageKey.BACKUP },
    ...storageSources.map((storageSource) => ({
      id: storageSource.name,
      label: `${storageSource.name} (${storageSource.type})`,
      type: storageSource.type
    }))
  ];

  let selectedSource =
    syncSources.find((entry) => entry.id === $lastSyncedSettingsSource$)?.id || syncSources[0].id;
  let selectedTarget =
    syncSources.find((entry) => entry.id === $lastSyncedSettingsTarget$)?.id || syncSources[1].id;

  $: sources = syncSources.filter(
    (entry) => entry.id !== selectedTarget && entry.id !== InternalStorageSources.INTERNAL_ZIP
  );
  $: targets = syncSources.filter((entry) => entry.id !== selectedSource);

  function closeDialog(wasCanceled = false) {
    if (!wasCanceled) {
      $lastSyncedSettingsSource$ = selectedSource;
      $lastSyncedSettingsTarget$ = selectedTarget;
    }

    resolver(
      wasCanceled
        ? []
        : [
            syncSources.find((entry) => entry.id === selectedSource)!,
            syncSources.find((entry) => entry.id === selectedTarget)!
          ]
    );
    dispatch('close');
  }
</script>

<DialogTemplate>
  <svelte:fragment slot="header">{settingsSyncHeader}</svelte:fragment>
  <svelte:fragment slot="content">
    <div class="grid gap-4">
      <label class="grid gap-2 text-sm font-medium">
        <span>Source</span>
        <select
          class="min-h-11 min-w-0 rounded-[10px] border border-input bg-background px-3 py-2 text-base text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 md:text-sm"
          bind:value={selectedSource}
        >
          {#each sources as source (source.id)}
            <option value={source.id}>
              {source.label}
            </option>
          {/each}
        </select>
      </label>
      <Button
        variant="ghost"
        size="icon"
        shape="circle"
        class="justify-self-center"
        aria-label="Swap sync source and target"
        title={selectedTarget === InternalStorageSources.INTERNAL_ZIP
          ? 'Choose a different target before swapping'
          : 'Swap source and target'}
        disabled={selectedTarget === InternalStorageSources.INTERNAL_ZIP}
        onclick={() => {
          const oldSource = selectedSource;
          const oldTarget = selectedTarget;

          selectedSource = oldTarget;
          selectedTarget = oldSource;
        }}
      >
        <AppIcon icon={faArrowsUpDown} />
      </Button>
      <label class="grid gap-2 text-sm font-medium">
        <span>Target</span>
        <select
          class="min-h-11 min-w-0 rounded-[10px] border border-input bg-background px-3 py-2 text-base text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 md:text-sm"
          bind:value={selectedTarget}
        >
          {#each targets as target (target.id)}
            <option value={target.id}>
              {target.label}
            </option>
          {/each}
        </select>
      </label>
    </div>
  </svelte:fragment>
  <div class="flex grow flex-wrap justify-between gap-2" slot="footer">
    <Button variant="ghost" onclick={() => closeDialog(true)}>Cancel</Button>
    <Button variant="default" onclick={() => closeDialog()}>Confirm</Button>
  </div>
</DialogTemplate>
