<script lang="ts">
  import { faFont } from '@fortawesome/free-solid-svg-icons';
  import Popover from '$lib/components/popover/popover.svelte';
  import { LocalFont } from '$lib/data/fonts';
  import Fa from 'svelte-fa';

  export let availableFonts: LocalFont[] = [LocalFont.NOTOSANSJP];
  export let fontValue: string;
  export let selectedFont: string | undefined = undefined;
  export let label = 'Show available fonts';

  let element: Popover;
</script>

<Popover bind:this={element} placement="bottom">
  <button
    slot="icon"
    type="button"
    class="mx-2"
    title={label}
    aria-label={label}
    on:click|stopPropagation={() => element.toggleOpen()}
  >
    <Fa icon={faFont} />
  </button>
  <div slot="content" class="min-w-40 py-1">
    {#each availableFonts as font (font)}
      <button
        type="button"
        aria-pressed={(selectedFont ?? fontValue) === font}
        class="block w-full px-4 py-2 text-left hover:bg-surface-hover"
        class:text-accent={(selectedFont ?? fontValue) === font}
        on:click={() => {
          fontValue = font;
          element.toggleOpen();
        }}
      >
        {font}
      </button>
    {/each}
  </div>
</Popover>
