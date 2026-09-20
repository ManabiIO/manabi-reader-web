<script lang="ts">
  import faArrowDown19 from '@lucide/svelte/icons/arrow-down-0-1';
  import AppIcon from '$lib/components/app-icon.svelte';
  import Popover from '../popover/popover.svelte';
  import SettingsDimensionContent from './settings-dimension-content.svelte';

  export let isFirstDimension = false;
  export let isVertical = false;
  export let dimensionValue = 0;
</script>

<Popover>
  <AppIcon icon={faArrowDown19} slot="icon" class="mx-2" />
  <SettingsDimensionContent slot="content" {isFirstDimension} {isVertical} bind:dimensionValue />
</Popover>
