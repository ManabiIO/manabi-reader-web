<script lang="ts">
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import { Button } from '$lib/components/ui/button';
  import { createEventDispatcher, onDestroy } from 'svelte';

  export let dialogHeader: string;
  export let dialogMessage: string;
  export let contentStyles: string = '';
  export let showCancel = true;
  export let resolver: (arg0: boolean) => void;

  const dispatch = createEventDispatcher<{
    close: void;
  }>();

  let settled = false;
  onDestroy(() => {
    if (!settled) {
      settled = true;
      resolver(true);
    }
  });

  function closeDialog(wasCanceled = false) {
    if (settled) return;
    settled = true;
    resolver(wasCanceled);
    dispatch('close');
  }
</script>

<DialogTemplate>
  <svelte:fragment slot="header">{dialogHeader}</svelte:fragment>
  <svelte:fragment slot="content">
    <p class="[overflow-wrap:anywhere]" style={contentStyles}>{dialogMessage}</p>
  </svelte:fragment>
  <svelte:fragment slot="footer">
    {#if showCancel}
      <Button variant="secondary" class="min-h-11" onclick={() => closeDialog(true)}>Cancel</Button>
    {/if}
    <Button class="min-h-11" onclick={() => closeDialog()}>Confirm</Button>
  </svelte:fragment>
</DialogTemplate>
