<script lang="ts">
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import AppIcon from '$lib/components/app-icon.svelte';
  import Popover from '../popover/popover.svelte';
  import SettingsDimensionContent from './settings-dimension-content.svelte';
  import { dimensionLabel } from './dimension-presets';

  export let isFirstDimension = false;
  export let isVertical = false;
  export let dimensionValue = 0;
</script>

<Popover
  label={`Size presets for ${dimensionLabel(isVertical, isFirstDimension).toLowerCase()}`}
  dialog
>
  <span slot="icon" class="flex min-h-11 min-w-9 items-center justify-center">
    <AppIcon icon={SlidersHorizontal} class="size-5" />
  </span>
  <SettingsDimensionContent slot="content" {isFirstDimension} {isVertical} bind:dimensionValue />
</Popover>
