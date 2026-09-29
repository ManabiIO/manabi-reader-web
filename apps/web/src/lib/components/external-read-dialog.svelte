<script lang="ts">
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import { Button } from '$lib/components/ui/button';
  import { hideExternalReadHint$ } from '$lib/data/store';
  import { createEventDispatcher, onDestroy } from 'svelte';

  export let resolver: (arg0: string) => void;

  const dispatch = createEventDispatcher<{
    close: void;
  }>();
  let settled = false;

  onDestroy(() => {
    if (settled) return;
    settled = true;
    resolver('cancel');
  });

  function closeDialog(result = '') {
    if (settled) return;
    settled = true;
    resolver(result);
    dispatch('close');
  }
</script>

<DialogTemplate>
  <svelte:fragment slot="header">Read from external storage</svelte:fragment>
  <svelte:fragment slot="content">
    <div class="space-y-3 text-sm sm:text-base">
      <p>
        This book is stored outside the browser. Opening it downloads the complete book again and
        can interact with your configured sync target.
      </p>
      <p class="text-muted-foreground">
        Export a browser copy if you want to avoid downloading the source again on future reads.
      </p>
      <label class="flex min-h-11 min-w-0 items-start gap-3 rounded-xl py-2">
        <input
          type="checkbox"
          class="mt-0.5 size-5 shrink-0 accent-primary"
          bind:checked={$hideExternalReadHint$}
        />
        <span class="min-w-0 break-words">Remember my choice and hide this message</span>
      </label>
    </div>
  </svelte:fragment>
  <div class="flex grow flex-wrap justify-end gap-2" slot="footer">
    <Button variant="ghost" onclick={() => closeDialog('cancel')}>Cancel</Button>
    <Button variant="outline" onclick={() => closeDialog('export')}>Open Export</Button>
    <Button onclick={() => closeDialog()}>Continue</Button>
  </div>
</DialogTemplate>
