<script lang="ts">
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { createEventDispatcher, onDestroy } from 'svelte';

  export let dialogHeader: string;
  export let showCancel = true;
  export let minValue = 1;
  export let maxValue = 1;
  export let resolver: (arg0: number | undefined) => void;

  let target: number | undefined = minValue;
  let error = '';
  let settled = false;

  const dispatch = createEventDispatcher<{
    close: void;
  }>();

  onDestroy(() => {
    if (!settled) {
      settled = true;
      resolver(undefined);
    }
  });

  function closeDialog(position?: number) {
    if (settled) return;
    settled = true;
    resolver(position);
    dispatch('close');
  }

  function submit() {
    if (settled) return;
    if (!Number.isSafeInteger(minValue) || !Number.isSafeInteger(maxValue) || minValue > maxValue) {
      error = 'Position range is unavailable.';
      return;
    }
    if (
      target === undefined ||
      !Number.isSafeInteger(target) ||
      target < minValue ||
      target > maxValue
    ) {
      error = `Enter a whole number between ${minValue} and ${maxValue}.`;
      return;
    }
    closeDialog(target);
  }
</script>

<form class="min-w-0 w-full" on:submit|preventDefault={submit} novalidate>
  <DialogTemplate>
    <svelte:fragment slot="header">{dialogHeader}</svelte:fragment>
    <div class="flex flex-col gap-3 text-sm sm:text-base" slot="content">
      <Input
        aria-label={dialogHeader}
        aria-describedby={error ? 'number-dialog-help number-dialog-error' : 'number-dialog-help'}
        aria-invalid={!!error}
        type="number"
        inputmode="numeric"
        min={minValue}
        max={maxValue}
        step={1}
        required
        bind:value={target}
        oninput={() => (error = '')}
        onkeydown={(event) => {
          if (event.key === 'Enter' && event.isComposing) event.preventDefault();
        }}
      />
      <p id="number-dialog-help" class="text-muted-foreground [overflow-wrap:anywhere]">
        Enter a position between {minValue} and {maxValue}.
      </p>
      {#if error}<p
          id="number-dialog-error"
          role="alert"
          class="text-destructive [overflow-wrap:anywhere]"
        >
          {error}
        </p>{/if}
    </div>
    <svelte:fragment slot="footer">
      {#if showCancel}
        <Button variant="secondary" class="min-h-11" onclick={() => closeDialog()}>Cancel</Button>
      {/if}
      <Button type="submit" class="min-h-11">Confirm</Button>
    </svelte:fragment>
  </DialogTemplate>
</form>
