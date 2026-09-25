<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import type { DictionaryAsset, DictionaryInstallationCoordinator } from './installation.mjs';

  // Mount from the existing startup/setup surface, regardless of plugin presence.
  // The deployment supplies only selectable definition dictionaries here.
  export let dictionaries: DictionaryAsset[] = [];
  export let installer: DictionaryInstallationCoordinator;
  export let onComplete: () => void;
  export let onSkip: () => void;
  let selected: string[] = [];
  let controller: AbortController | null = null;
  let error = '';
  let disposed = false;
  onDestroy(() => {
    disposed = true;
    controller?.abort();
  });
  async function install() {
    if (controller || selected.length === 0) return;
    const current = new AbortController();
    controller = current;
    error = '';
    try {
      await installer.install(
        dictionaries.filter((entry) => selected.includes(entry.id)),
        { signal: current.signal }
      );
      if (!disposed && !current.signal.aborted) onComplete();
    } catch (cause) {
      if (!disposed && !current.signal.aborted)
        error = cause instanceof Error ? cause.message : 'Dictionary installation failed.';
    } finally {
      if (controller === current) controller = null;
    }
  }
</script>

<section
  aria-labelledby="dictionary-setup-title"
  class="mx-auto flex w-full max-w-lg flex-col gap-5 p-6"
  aria-busy={!!controller}
>
  <h1 id="dictionary-setup-title" class="text-2xl font-semibold">Set up dictionaries</h1>
  <p class="text-muted-foreground">
    Choose dictionaries for definitions while you read. You can also install your own dictionaries
    later.
  </p>
  <fieldset disabled={!!controller} class="flex flex-col gap-3">
    <legend class="mb-3 font-medium">Definition dictionaries</legend>
    {#each dictionaries as entry (entry.id)}
      <label class="flex min-h-11 items-center gap-3"
        ><input type="checkbox" value={entry.id} bind:group={selected} />{entry.label}</label
      >
    {/each}
  </fieldset>
  {#if installer.processingResourceCount > 0}
    <p class="text-sm text-muted-foreground">
      Installing any dictionary also installs the text-processing index. It helps identify words;
      your chosen dictionaries supply the definitions.
    </p>
  {/if}
  {#if controller}<p role="status">Installing dictionaries…</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
  <div class="flex flex-wrap gap-3">
    <Button disabled={!!controller || selected.length === 0} onclick={install}
      >{error ? 'Retry installation' : 'Install selected dictionaries'}</Button
    >
    {#if controller}
      <Button variant="outline" onclick={() => controller?.abort()}>Cancel installation</Button>
    {:else}
      <Button variant="ghost" onclick={onSkip}>Not now</Button>
    {/if}
  </div>
</section>
