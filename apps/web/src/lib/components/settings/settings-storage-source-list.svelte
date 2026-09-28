<script lang="ts">
  import { browser } from '$app/environment';
  import faCircleQuestion from '@lucide/svelte/icons/circle-help';
  import faCloudArrowUp from '@lucide/svelte/icons/cloud-upload';
  import faPenToSquare from '@lucide/svelte/icons/square-pen';
  import faPlus from '@lucide/svelte/icons/plus';
  import faSpinner from '@lucide/svelte/icons/loader-circle';
  import faTableList from '@lucide/svelte/icons/table';
  import faTrash from '@lucide/svelte/icons/trash-2';
  import faTriangleExclamation from '@lucide/svelte/icons/triangle-alert';
  import MessageDialog from '$lib/components/message-dialog.svelte';
  import Popover from '$lib/components/popover/popover.svelte';
  import SettingsStorageSource from '$lib/components/settings/settings-storage-source.svelte';
  import { Button } from '$lib/components/ui/button';
  import type { BooksDbStorageSource } from '$lib/data/database/books-db/versions/books-db';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { gDriveRevokeEndpoint } from '$lib/data/env';
  import { StorageOAuthManager, storageOAuthTokens } from '$lib/data/storage/storage-oauth-manager';
  import {
    isAppDefault,
    setStorageSourceDefault,
    type FsHandle,
    type StorageSourceSaveResult,
    type StorageUnlockAction,
    type RemoteContext,
    unlockStorageData
  } from '$lib/data/storage/storage-source-manager';
  import { StorageKey } from '$lib/data/storage/storage-types';
  import { getStorageIconData } from '$lib/data/storage/storage-view';
  import {
    autoReplication$,
    database,
    fsStorageSource$,
    gDriveStorageSource$,
    isOnline$,
    oneDriveStorageSource$,
    syncTarget$
  } from '$lib/data/store';
  import { AutoReplicationType } from '$lib/functions/replication/replication-options';
  import AppIcon from '$lib/components/app-icon.svelte';

  export let storageSources: BooksDbStorageSource[];

  let listLoading = true;
  let listTooltip = 'Allows you to add a custom set of credentials';

  $: if (storageSources) {
    listLoading = false;
  }

  $: fileSystemAvailable = browser && 'showDirectoryPicker' in window;

  $: if (fileSystemAvailable) {
    listTooltip += ' or filesystem access';
  }

  function isSyncTarget(name: string, referenceName: string) {
    return name === referenceName;
  }

  function isStorageSourceDefault(name: string, type: StorageKey, _sources: string[] = []) {
    let configuredIsSourceDefault = false;

    switch (type) {
      case StorageKey.GDRIVE:
        configuredIsSourceDefault = name === $gDriveStorageSource$;
        break;
      case StorageKey.ONEDRIVE:
        configuredIsSourceDefault = name === $oneDriveStorageSource$;
        break;
      case StorageKey.FS:
        configuredIsSourceDefault = name === $fsStorageSource$;
        break;
      default:
        break;
    }

    return configuredIsSourceDefault;
  }

  async function modifyStorageSource(storageSource?: BooksDbStorageSource) {
    let configuredRemoteData: StorageUnlockAction | undefined;
    let configuredFSData: FsHandle | undefined;

    if (storageSource && storageSource.type !== StorageKey.FS) {
      const unlockResult = await unlockStorageData(
        storageSource,
        'You are trying to access protected data',
        {
          action: `Enter the correct password for ${storageSource.name} to proceed`,
          encryptedData: storageSource.data
        }
      );

      if (!unlockResult) {
        return;
      }

      configuredRemoteData = unlockResult;
    } else if (storageSource && isFSHandle(storageSource.type, storageSource.data)) {
      configuredFSData = {
        directoryHandle: storageSource.data.directoryHandle,
        fsPath: storageSource.data.fsPath
      };
    }

    const saveResult = await new Promise<StorageSourceSaveResult>((resolver) => {
      dialogManager.dialogs$.next([
        {
          component: SettingsStorageSource,
          props: {
            configuredName: storageSource?.name,
            configuredType: storageSource?.type,
            configuredIsSyncTarget: storageSource ? $syncTarget$ === storageSource.name : false,
            configuredIsStorageSourceDefault: storageSource
              ? isStorageSourceDefault(storageSource.name, storageSource.type)
              : false,
            configuredFSData,
            configuredRemoteData,
            configuredStoredInManager: storageSource?.storedInManager,
            configuredEncryptionDisabled: storageSource?.encryptionDisabled,
            resolver
          },
          disableCloseOnClick: true
        }
      ]);
    });

    if (!saveResult) {
      return;
    }

    if (saveResult.old) {
      const oldToken = storageOAuthTokens.get(saveResult.old);

      storageOAuthTokens.delete(saveResult.old);

      if (oldToken && saveResult.new.type === storageSource?.type) {
        storageOAuthTokens.set(saveResult.new.name, oldToken);
      }

      database.storageSourcesChanged$.next(
        storageSources.map((entry) => (entry.name === saveResult.old ? saveResult.new : entry))
      );
    } else {
      database.storageSourcesChanged$.next([...storageSources, saveResult.new]);
    }
  }

  function isFSHandle(
    type: StorageKey,
    data: FsHandle | ArrayBuffer | RemoteContext
  ): data is FsHandle {
    return data && type === StorageKey.FS;
  }

  async function deleteStorageSource(
    storageSource: BooksDbStorageSource,
    wasSyncTarget: boolean,
    wasSourceDefault: boolean
  ) {
    const unlockResult = await unlockStorageData(
      storageSource,
      storageSource.type === StorageKey.FS
        ? 'You are trying to delete data'
        : 'You are trying to delete protected data',
      {
        action:
          storageSource.type === StorageKey.FS
            ? `Please confirm to proceed with deleting ${storageSource.name}`
            : `Enter the correct password for ${storageSource.name} to proceed`,
        requiresSecret: storageSource.type !== StorageKey.FS,
        showCancel: true,
        encryptedData: storageSource.type !== StorageKey.FS ? storageSource.data : undefined
      }
    );

    if (!unlockResult) {
      return;
    }

    const invalidateToken = storageSource.type === StorageKey.GDRIVE && unlockResult.refreshToken;

    if (invalidateToken && !$isOnline$) {
      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: {
            title: 'Error',
            message: 'You need to be online to delete this storage source'
          },
          disableCloseOnClick: true
        }
      ]);
      return;
    }

    await database.deleteStorageSource(storageSource, wasSyncTarget, wasSourceDefault);

    storageOAuthTokens.delete(storageSource.name);

    if (invalidateToken && unlockResult.refreshToken) {
      StorageOAuthManager.revokeToken(gDriveRevokeEndpoint, unlockResult.refreshToken);
    }

    database.storageSourcesChanged$.next(
      storageSources.filter((source) => source.name !== storageSource.name)
    );
  }
</script>

<div class="mb-8 min-w-0 sm:col-span-2 lg:col-span-3">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex min-w-0 items-center gap-1">
      <Popover contentText={listTooltip} contentStyles="padding: 0.5rem;">
        <AppIcon icon={faCircleQuestion} slot="icon" class="mx-1" />
      </Popover>
      {#if $autoReplication$ !== AutoReplicationType.Off && !$syncTarget$}
        <Popover
          contentText="Auto import/export enabled but no source as sync target from list selected"
          contentStyles="padding: 0.25rem;"
        >
          <AppIcon icon={faTriangleExclamation} slot="icon" class="mx-1" />
        </Popover>
      {/if}
    </div>
    <Button
      variant="outline"
      disabled={!storageSources}
      onclick={() => {
        modifyStorageSource();
      }}
    >
      <AppIcon icon={faPlus} />
      <span>Add source</span>
    </Button>
  </div>

  <div class="mt-6">
    {#if !listLoading && storageSources}
      <div class="grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {#each storageSources as storageSource (storageSource.name)}
          {@const icon = getStorageIconData(storageSource.type)}
          {@const isDefault = isAppDefault(storageSource.name)}
          {@const storageSourceIsSyncTarget = isSyncTarget(storageSource.name, $syncTarget$)}
          {@const storageSourceIsSourceDefault = isStorageSourceDefault(
            storageSource.name,
            storageSource.type,
            [$gDriveStorageSource$, $oneDriveStorageSource$, $fsStorageSource$]
          )}
          <article class="grid min-w-0 gap-3 rounded-xl border border-border p-3">
            <div class="flex min-w-0 items-center gap-3">
              <svg
                class="inline-block size-6 shrink-0 self-center"
                xmlns="http://www.w3.org/2000/svg"
                viewBox={icon.viewBox}
                aria-hidden="true"
              >
                <path class="fill-current" d={icon.d}></path>
              </svg>
              <div class="min-w-0 break-words font-medium">{storageSource.name}</div>
            </div>
            <div class="flex flex-wrap gap-2">
              {#if !isDefault}
                <Button
                  variant="ghost"
                  size="sm"
                  onclick={() => modifyStorageSource(storageSource)}
                >
                  <AppIcon icon={faPenToSquare} />
                  <span>Edit</span>
                </Button>
              {/if}
              <Button
                variant={storageSourceIsSyncTarget ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={storageSourceIsSyncTarget}
                onclick={() =>
                  syncTarget$.next($syncTarget$ === storageSource.name ? '' : storageSource.name)}
              >
                <AppIcon icon={faCloudArrowUp} />
                <span>Sync target</span>
              </Button>
              <Button
                variant={storageSourceIsSourceDefault ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={storageSourceIsSourceDefault}
                onclick={() =>
                  setStorageSourceDefault(
                    storageSourceIsSourceDefault ? '' : storageSource.name,
                    storageSource.type
                  )}
              >
                <AppIcon icon={faTableList} />
                <span>Use by default</span>
              </Button>
              {#if !isDefault}
                <Button
                  variant="destructive"
                  size="sm"
                  onclick={() =>
                    deleteStorageSource(
                      storageSource,
                      storageSourceIsSyncTarget,
                      storageSourceIsSourceDefault
                    )}
                >
                  <AppIcon icon={faTrash} />
                  <span>Remove</span>
                </Button>
              {/if}
            </div>
          </article>
        {/each}
      </div>
    {:else}
      <div role="status" aria-label="Loading storage sources" class="text-xl">
        <AppIcon icon={faSpinner} spin />
      </div>
    {/if}
  </div>
</div>
