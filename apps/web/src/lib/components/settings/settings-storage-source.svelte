<script lang="ts">
  import { browser } from '$app/environment';
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import type { BooksDbStorageSource } from '$lib/data/database/books-db/versions/books-db';
  import { gDriveRevokeEndpoint } from '$lib/data/env';
  import { resolveTtuRoot } from '$lib/manabi/ttu-folder-contract';
  import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
  import { StorageOAuthManager, storageOAuthTokens } from '$lib/data/storage/storage-oauth-manager';
  import {
    encrypt,
    isAppDefault,
    type FsHandle,
    type StorageSourceSaveResult,
    type StorageUnlockAction
  } from '$lib/data/storage/storage-source-manager';
  import { StorageKey } from '$lib/data/storage/storage-types';
  import { database, isOnline$ } from '$lib/data/store';
  import faTriangleExclamation from '@lucide/svelte/icons/triangle-alert';
  import { createEventDispatcher, onDestroy } from 'svelte';
  import AppIcon from '$lib/components/app-icon.svelte';

  export let configuredName: string;
  export let configuredIsSyncTarget: boolean;
  export let configuredIsStorageSourceDefault: boolean;
  export let configuredType: StorageKey;
  export let configuredRemoteData: StorageUnlockAction;
  export let configuredFSData: FsHandle;
  export let configuredStoredInManager: boolean;
  export let configuredEncryptionDisabled: boolean;
  export let resolver: (arg0: StorageSourceSaveResult | undefined) => void;

  const dispatch = createEventDispatcher<{
    close: void;
  }>();

  const storageSourceRefreshToken = configuredRemoteData?.refreshToken || '';

  let containerElm: HTMLFormElement | null = null;
  let nameElm: HTMLInputElement | null = null;
  let pwConfirmElm: HTMLInputElement | null = null;
  let password = configuredStoredInManager ? configuredRemoteData?.secret || '' : '';
  let confirmedPassword = password;
  let error = '';
  let saving = false;
  let selectingDirectory = false;
  let active = true;
  const passwordManagerAvailable = browser && 'PasswordCredential' in window;
  onDestroy(() => {
    active = false;
  });
  let storageSourceName = configuredName || '';
  let storageSourceIsSyncTarget = configuredIsSyncTarget || false;
  let storageSourceIsSourceDefault = configuredIsStorageSourceDefault || false;
  let storageSourceType = configuredType || StorageKey.GDRIVE;
  let storageSourceClientId = configuredRemoteData?.clientId || '';
  let storageSourceClientSecret = configuredRemoteData?.clientSecret || '';
  let directoryHandle: FileSystemDirectoryHandle | undefined = configuredFSData?.directoryHandle;
  let handleFsPath = configuredFSData?.fsPath || '';
  let storageSourceStoredInManager =
    (passwordManagerAvailable && configuredStoredInManager) || false;
  let storageSourceEncryptionDisabled = configuredEncryptionDisabled || false;
  const storageSourceTypes = [
    { key: StorageKey.GDRIVE, label: 'Google Drive' },
    { key: StorageKey.ONEDRIVE, label: 'OneDrive' },
    ...(browser && 'showDirectoryPicker' in window
      ? [{ key: StorageKey.FS, label: 'Local folder' }]
      : [])
  ];

  async function selectDirectory() {
    if (saving || selectingDirectory || !active) return;
    resetCustomValidity();
    selectingDirectory = true;

    try {
      const dirHandle = await window.showDirectoryPicker({
        id: 'ttu-reader-root',
        mode: 'readwrite'
      });
      const resolved = await resolveTtuRoot(dirHandle, true);
      if (!active) return;
      directoryHandle = resolved;
      handleFsPath =
        directoryHandle.name === dirHandle.name
          ? directoryHandle.name
          : `${dirHandle.name}/${directoryHandle.name}`;
    } catch (err: any) {
      if (!active) return;
      // Cancelling the picker retains the existing directory choice.
      if (err?.name !== 'AbortError') {
        error = err instanceof Error ? err.message : 'Could not select the directory.';
      }
    } finally {
      selectingDirectory = false;
    }
  }

  async function save() {
    if (saving || selectingDirectory || !active || !containerElm) return;
    resetCustomValidity();

    if (
      ![...containerElm.querySelectorAll('input')].every((elm) => {
        let isValid = elm.reportValidity();

        if (!isValid) {
          return false;
        }

        if (elm === nameElm) {
          if (storageSourceType === StorageKey.FS && !directoryHandle) {
            elm.setCustomValidity('You need to select a directory');
            isValid = false;
          } else if (isAppDefault(storageSourceName)) {
            elm.setCustomValidity('Please select a different name');
            isValid = false;
          }
        } else if (elm === pwConfirmElm && password !== confirmedPassword) {
          elm.setCustomValidity('Password does not match');
          isValid = false;
        }

        if (!isValid) {
          elm.reportValidity();
        }

        return isValid;
      })
    ) {
      return;
    }

    saving = true;
    try {
      let storageSourceData;
      let credentialsChanged = false;
      let invalidateToken = false;

      if (storageSourceStoredInManager) {
        await navigator.credentials
          .store(
            // eslint-disable-next-line no-undef
            new PasswordCredential({
              id: storageSourceName,
              name: `${storageSourceName} (${storageSourceType})`,
              password: confirmedPassword
            })
          )
          .catch(({ message }: any) => {
            throw new Error(`Failed to store Password: ${message}`);
          });
      }

      if (storageSourceType === StorageKey.FS) {
        if (!directoryHandle) {
          throw new Error('Directory handle not defined');
        }

        storageSourceData = { directoryHandle, fsPath: handleFsPath };
      } else {
        credentialsChanged =
          storageSourceClientId !== configuredRemoteData?.clientId ||
          storageSourceClientSecret !== configuredRemoteData?.clientSecret;
        invalidateToken = !storageSourceClientSecret || credentialsChanged;

        const willInvalidateToken =
          invalidateToken &&
          configuredType === StorageKey.GDRIVE &&
          configuredRemoteData?.refreshToken;

        if (willInvalidateToken && !$isOnline$) {
          throw new Error('You need to be online in order to make this change to the credentials');
        }

        if (storageSourceEncryptionDisabled) {
          storageSourceData = {
            clientId: storageSourceClientId,
            clientSecret: storageSourceClientSecret,
            refreshToken: invalidateToken ? '' : storageSourceRefreshToken
          };
        } else {
          storageSourceData = await encrypt(
            window,
            JSON.stringify({
              clientId: storageSourceClientId,
              clientSecret: storageSourceClientSecret,
              refreshToken: invalidateToken ? '' : storageSourceRefreshToken
            }),
            confirmedPassword
          );
        }
      }

      const toSave: BooksDbStorageSource = {
        name: storageSourceName,
        type: storageSourceType,
        storedInManager: storageSourceStoredInManager,
        encryptionDisabled: storageSourceEncryptionDisabled,
        data: storageSourceData,
        lastSourceModified: Date.now()
      };

      await database.saveStorageSource(
        toSave,
        configuredName,
        storageSourceIsSyncTarget,
        storageSourceIsSourceDefault
      );

      if (
        invalidateToken &&
        configuredType === StorageKey.GDRIVE &&
        configuredRemoteData?.refreshToken
      ) {
        StorageOAuthManager.revokeToken(gDriveRevokeEndpoint, configuredRemoteData.refreshToken);
      }

      if (credentialsChanged) {
        storageOAuthTokens.delete(configuredName);

        if (storageSourceType !== StorageKey.FS) {
          getStorageHandler(window, storageSourceType).clearData();
        }
      }

      if (
        storageSourceType === StorageKey.FS &&
        directoryHandle &&
        !(await configuredFSData?.directoryHandle.isSameEntry(directoryHandle))
      ) {
        getStorageHandler(window, StorageKey.FS).clearData();
      }

      closeDialog({ new: toSave, old: configuredName });
    } catch (err: unknown) {
      if (active) error = err instanceof Error ? err.message : 'Could not save the storage source.';
    } finally {
      saving = false;
    }
  }

  function resetCustomValidity() {
    error = '';
    nameElm?.setCustomValidity('');
    pwConfirmElm?.setCustomValidity('');
  }

  function closeDialog(data?: StorageSourceSaveResult) {
    if (!active) return;
    resolver(data);
    dispatch('close');
  }
</script>

<DialogTemplate>
  <svelte:fragment slot="header"
    >{configuredName ? 'Edit storage source' : 'Add storage source'}</svelte:fragment
  >
  <form
    id="storage-source-form"
    class="min-w-0"
    slot="content"
    bind:this={containerElm}
    aria-busy={saving || selectingDirectory}
    on:submit|preventDefault={save}
    on:input={resetCustomValidity}
    on:keydown={(event) => {
      if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229))
        event.preventDefault();
    }}
  >
    <fieldset class="grid min-w-0 gap-4 border-0 p-0" disabled={saving || selectingDirectory}>
      <p class="text-sm">
        Advanced Ttu Ebook Reader storage. These sources use <code>ttu-reader-data</code> and its
        book, bookmark and statistics format. For ordinary Manabi folders, use
        <strong>Accounts and libraries</strong>.
      </p>

      <label class="grid gap-2 text-sm font-medium">
        <span>Name</span>
        <Input
          required
          type="text"
          placeholder="Name"
          bind:value={storageSourceName}
          bind:ref={nameElm}
        />
      </label>

      <div class="flex flex-wrap gap-x-5 gap-y-3">
        <label class="flex min-h-11 items-center gap-2 text-sm">
          <input
            id="cbx-source"
            type="checkbox"
            class="size-5 shrink-0 accent-primary"
            bind:checked={storageSourceIsSyncTarget}
          />
          <span>Is Sync Target</span>
        </label>
        <label class="flex min-h-11 items-center gap-2 text-sm">
          <input
            id="cbx-manager"
            type="checkbox"
            class="size-5 shrink-0 accent-primary"
            bind:checked={storageSourceIsSourceDefault}
          />
          <span>Is Source Default</span>
        </label>
      </div>

      <label class="grid gap-2 text-sm font-medium">
        <span>Storage type</span>
        <select
          class="min-h-11 min-w-0 rounded-[10px] border border-input bg-background px-3 py-2 text-base text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 md:text-sm"
          bind:value={storageSourceType}
          on:change={() => {
            if (storageSourceType === StorageKey.FS) {
              storageSourceClientId = '';
              storageSourceClientSecret = '';
              storageSourceStoredInManager = false;
              storageSourceEncryptionDisabled = false;
            } else {
              directoryHandle = undefined;
              handleFsPath = '';
            }
          }}
        >
          {#each storageSourceTypes as sourceType (sourceType.key)}
            <option value={sourceType.key}>
              {sourceType.label}
            </option>
          {/each}
        </select>
      </label>

      {#if storageSourceType === StorageKey.FS}
        <Button variant="outline" onclick={selectDirectory}>Select Directory</Button>
        <div class="text-center text-sm text-muted-foreground">
          {handleFsPath || 'Nothing selected'}
        </div>
      {:else}
        <label class="grid gap-2 text-sm font-medium">
          <span>Client ID</span>
          <Input required type="text" bind:value={storageSourceClientId} />
        </label>
        <label class="grid gap-2 text-sm font-medium">
          <span>Client Secret</span>
          <Input type="text" bind:value={storageSourceClientSecret} />
        </label>
        <label class="grid gap-2 text-sm font-medium">
          <span>Password</span>
          <Input
            type="password"
            required={!storageSourceEncryptionDisabled}
            disabled={storageSourceEncryptionDisabled}
            bind:value={password}
          />
        </label>
        <label class="grid gap-2 text-sm font-medium">
          <span>Confirm Password</span>
          <Input
            type="password"
            required={!storageSourceEncryptionDisabled}
            disabled={storageSourceEncryptionDisabled}
            bind:value={confirmedPassword}
            bind:ref={pwConfirmElm}
          />
        </label>
        {#if passwordManagerAvailable}
          <label class="flex min-h-11 items-center gap-2 text-sm">
            <input
              id="cbx-store-in-manager"
              type="checkbox"
              class="size-5 shrink-0 accent-primary"
              bind:checked={storageSourceStoredInManager}
              on:change={() => {
                if (storageSourceStoredInManager && storageSourceEncryptionDisabled) {
                  storageSourceEncryptionDisabled = false;
                }
              }}
            />
            <span>Store in Password Manager</span>
          </label>
        {/if}
        <label class="flex min-h-11 items-center gap-2 text-sm">
          <input
            id="cbx-disable-encryption"
            type="checkbox"
            class="size-5 shrink-0 accent-primary"
            bind:checked={storageSourceEncryptionDisabled}
            on:change={() => {
              if (storageSourceEncryptionDisabled) {
                storageSourceStoredInManager = false;
                password = '';
                confirmedPassword = '';
              }
            }}
          />
          <span>Disable Password Encryption</span>
        </label>
      {/if}

      {#if storageSourceStoredInManager || storageSourceEncryptionDisabled}
        <div class="flex max-w-sm items-start gap-2 rounded-xl bg-muted p-3 text-sm">
          <AppIcon icon={faTriangleExclamation} class="mt-0.5 shrink-0" />
          <span>
            Make sure to understand the
            <a
              class="text-primary underline underline-offset-2"
              href="https://github.com/ManabiIO/Manabi-Reader-Web?tab=readme-ov-file#security-considerations"
              target="_blank"
              rel="noopener noreferrer"
            >
              implications
            </a>
            of these settings.
          </span>
        </div>
      {/if}
    </fieldset>
    {#if error}
      <div role="alert" class="mt-4 text-sm text-destructive">Error: {error}</div>
    {/if}
  </form>
  <div class="mt-4 flex grow flex-wrap justify-between gap-2" slot="footer">
    <Button variant="ghost" disabled={saving || selectingDirectory} onclick={() => closeDialog()}
      >Cancel</Button
    >
    <Button
      variant="default"
      type="submit"
      form="storage-source-form"
      disabled={saving || selectingDirectory}>{saving ? 'Saving…' : 'Save'}</Button
    >
  </div>
</DialogTemplate>
