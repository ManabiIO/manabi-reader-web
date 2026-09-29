<script lang="ts">
  import BookExportIcon from '$lib/components/book-export/book-export-icon.svelte';
  import { StorageDataType, StorageKey } from '$lib/data/storage/storage-types';
  import type { StorageIconElement } from '$lib/data/storage/storage-view';
  import { isOnline$ } from '$lib/data/store';
  import { isOnlineSourceAvailable } from '$lib/functions/utils';

  export let icons: StorageIconElement[];
  export let target: StorageKey;
  export let dataToReplicate: StorageDataType[];

  $: if (icons.length && !icons.some((icon) => icon.source === target)) {
    target = icons[0].source;
  }

  $: if (!isOnlineSourceAvailable($isOnline$, target) && icons.length) {
    target =
      icons.find((icon) => icon.source === StorageKey.BACKUP)?.source ??
      icons.find((icon) => icon.source === StorageKey.BROWSER)?.source ??
      icons[0].source;
  }
</script>

<fieldset class="min-w-0">
  <legend class="mb-3 text-lg font-semibold">Export target</legend>
  <div class="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
    {#each icons as icon (icon.source)}
      {@const disabled = !isOnlineSourceAvailable($isOnline$, icon.source)}
      <BookExportIcon
        {...icon}
        {disabled}
        selected={icon.source === target}
        on:click={() => {
          if (!disabled) target = icon.source;
        }}
      />
    {/each}
  </div>
</fieldset>

<fieldset class="mt-6 min-w-0">
  <legend class="mb-3 text-lg font-semibold">Export content</legend>
  <div class="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
    <label class="flex min-h-11 min-w-0 items-center gap-3 rounded-xl px-2 hover:bg-muted">
      <input
        type="checkbox"
        class="size-5 shrink-0 accent-primary"
        name="data"
        value="data"
        bind:group={dataToReplicate}
      />
      <span class="min-w-0 break-words">Book data</span>
    </label>
    <label class="flex min-h-11 min-w-0 items-center gap-3 rounded-xl px-2 hover:bg-muted">
      <input
        type="checkbox"
        class="size-5 shrink-0 accent-primary"
        name="bookmark"
        value="bookmark"
        bind:group={dataToReplicate}
      />
      <span class="min-w-0 break-words">Reading position</span>
    </label>
    <label class="flex min-h-11 min-w-0 items-center gap-3 rounded-xl px-2 hover:bg-muted">
      <input
        type="checkbox"
        class="size-5 shrink-0 accent-primary"
        name="statistic"
        value="statistic"
        bind:group={dataToReplicate}
      />
      <span class="min-w-0 break-words">Statistics</span>
    </label>
    <label class="flex min-h-11 min-w-0 items-center gap-3 rounded-xl px-2 hover:bg-muted">
      <input
        type="checkbox"
        class="size-5 shrink-0 accent-primary"
        name="audioBook"
        value="audioBook"
        bind:group={dataToReplicate}
      />
      <span class="min-w-0 break-words">Audiobook</span>
    </label>
    <label class="flex min-h-11 min-w-0 items-center gap-3 rounded-xl px-2 hover:bg-muted">
      <input
        type="checkbox"
        class="size-5 shrink-0 accent-primary"
        name="subtitle"
        value="subtitle"
        bind:group={dataToReplicate}
      />
      <span class="min-w-0 break-words">Subtitles</span>
    </label>
  </div>
</fieldset>
