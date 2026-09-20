<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { mergeEntries } from './merged-entries';
  import { pagePath } from '$lib/data/env';
  import * as Menu from '$lib/components/ui/dropdown-menu';
  import { Button } from '$lib/components/ui/button';
  import ActionMenu from '$lib/components/navigation/action-menu.svelte';
  export let leavePageLink = '';
  export let items = [mergeEntries.MANAGE, mergeEntries.SETTINGS, mergeEntries.BUG_REPORT];
  export let mergeTo = mergeEntries.MANAGE;
  export let disableRouteNavigation = false;
  const dispatch = createEventDispatcher<{ action: string }>();
  $: actions = items.filter((item) => item.routeId !== $page.route.id);
  function select(item: (typeof items)[number]) {
    dispatch('action', item.label);
    if (!disableRouteNavigation && item.routeId) goto(`${pagePath}${item.routeId}`);
  }
</script>

{#if leavePageLink}<Button href={leavePageLink} variant="ghost">Back</Button>
{:else}<ActionMenu label={mergeTo === mergeEntries.FILE_IMPORT ? 'Add books' : 'Navigate'}>
    {#each actions as item (item.label)}<Menu.Item onSelect={() => select(item)}
        >{item.label}</Menu.Item
      >{/each}
  </ActionMenu>{/if}
