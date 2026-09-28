<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import DialogTemplate from '$lib/components/dialog-template.svelte';

  export let title: string;

  export let message: string;

  const dispatch = createEventDispatcher<{
    close: void;
  }>();
</script>

<DialogTemplate>
  <svelte:fragment slot="header">{title}</svelte:fragment>
  <svelte:fragment slot="content">
    <p class="[overflow-wrap:anywhere]">{message}</p>
  </svelte:fragment>
  <svelte:fragment slot="footer">
    <Button variant="secondary" class="min-h-11" onclick={() => dispatch('close')}>Close</Button>
  </svelte:fragment>
</DialogTemplate>
