<script lang="ts">
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { decrypt, type StorageUnlockAction } from '$lib/data/storage/storage-source-manager';
  import { skipKeyDownListener$ } from '$lib/data/store';
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';

  export let description: string;
  export let action: string;
  export let requiresSecret = true;
  export let showCancel = false;
  export let forwardSecret = false;
  export let encryptedData: ArrayBuffer | undefined;
  export let resolver: (arg0: StorageUnlockAction | undefined) => void;

  let passwordElm: HTMLInputElement | null = null;
  let secret = '';
  let error = '';
  let pending = false;
  let settled = false;
  let active = true;

  const dispatch = createEventDispatcher<{
    close: void;
  }>();

  onDestroy(() => {
    active = false;
    if (settled) return;
    settled = true;
    resolver(undefined);
  });

  onMount(() => {
    skipKeyDownListener$.next(true);
    passwordElm?.focus({ preventScroll: true });
    return () => skipKeyDownListener$.next(false);
  });

  async function unlock() {
    if (pending || settled || !active) return;
    error = '';
    pending = true;

    try {
      let result: StorageUnlockAction;
      if (encryptedData) {
        const decoded = JSON.parse(
          new TextDecoder().decode(await decrypt(window, encryptedData, secret))
        ) as StorageUnlockAction;
        result = { ...decoded, ...(forwardSecret ? { secret } : {}) };
      } else if (requiresSecret) {
        throw new Error('No encrypted data is available.');
      } else {
        result = { clientId: '', clientSecret: '' };
      }

      closeDialog(result);
    } catch (cause) {
      if (active && !settled)
        error =
          cause instanceof Error && cause.message
            ? `Could not unlock data: ${cause.message}`
            : 'Could not unlock data.';
    } finally {
      if (active) pending = false;
    }
  }

  function closeDialog(data?: StorageUnlockAction) {
    if (settled) return;
    settled = true;
    resolver(data);
    dispatch('close');
  }
</script>

<form
  class="min-w-0 w-full"
  aria-busy={pending}
  on:submit|preventDefault={unlock}
  on:keydown={(event) => {
    if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229))
      event.preventDefault();
  }}
>
  <DialogTemplate>
    <svelte:fragment slot="header"
      >{requiresSecret ? 'Unlock storage source' : 'Continue to sign in'}</svelte:fragment
    >
    <div class="min-w-0 space-y-4 text-sm sm:text-base" slot="content">
      <p class="break-words">{description}</p>
      <p class="break-words text-muted-foreground">{action}</p>
      {#if requiresSecret}
        <label class="grid min-w-0 gap-2 text-sm font-medium">
          <span>Password</span>
          <Input
            type="password"
            autocomplete="current-password"
            required
            disabled={pending}
            bind:value={secret}
            bind:ref={passwordElm}
            oninput={() => (error = '')}
          />
        </label>
      {/if}
      {#if error}<p role="alert" class="break-words text-sm text-destructive">{error}</p>{/if}
    </div>
    <div class="flex grow flex-wrap justify-end gap-2" slot="footer">
      {#if requiresSecret || showCancel}
        <Button type="button" variant="ghost" disabled={pending} onclick={() => closeDialog()}
          >Cancel</Button
        >
      {/if}
      <Button type="submit" disabled={pending}
        >{pending ? (requiresSecret ? 'Unlocking…' : 'Continuing…') : requiresSecret ? 'Unlock' : 'Continue'}</Button
      >
    </div>
  </DialogTemplate>
</form>
