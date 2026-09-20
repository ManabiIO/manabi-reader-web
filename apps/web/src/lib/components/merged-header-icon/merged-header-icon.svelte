<script lang="ts">
  import Fa from 'svelte-fa';
  import { createEventDispatcher } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
  import Popover from '$lib/components/popover/popover.svelte';
  import { baseIconClasses } from '$lib/css-classes';
  import { pagePath } from '$lib/data/env';

  export let leavePageLink = '';
  export let items = [mergeEntries.MANAGE, mergeEntries.SETTINGS, mergeEntries.BUG_REPORT];
  export let mergeTo = mergeEntries.MANAGE;
  export let disableRouteNavigation = false;
  const dispatch = createEventDispatcher<{ action: string }>();
  const sharedLibrary = {
    routeId: '/shared-library',
    label: 'Shared Ttu Ebook Reader libraries',
    title: 'Local folders shared with Ttu Ebook Reader',
    icon: mergeEntries.FOLDER_IMPORT.icon
  };
  const navigationItems = [...items];
  if (
    !disableRouteNavigation &&
    items.some((item) => ['/manage', '/settings'].includes(item.routeId))
  ) {
    for (const destination of [mergeEntries.CONNECTIONS, sharedLibrary]) {
      if (!navigationItems.some((item) => item.routeId === destination.routeId))
        navigationItems.push(destination);
    }
  }
  const actionItems = navigationItems.filter((item) => item.routeId !== $page.route.id);
  let menuElm: Popover;
  function handleActionMenuItem(target: string) {
    dispatch('action', target);
    if (!(target === mergeEntries.FILE_IMPORT.label || target === mergeEntries.FOLDER_IMPORT.label))
      menuElm?.toggleOpen();
    if (!disableRouteNavigation) {
      const action = actionItems.find((item) => item.label === target);
      if (action?.routeId) goto(`${pagePath}${action.routeId}`);
    }
  }
  if (actionItems.length === 1 && actionItems[0].routeId)
    leavePageLink = `${pagePath}${actionItems[0].routeId}`;
</script>

{#if leavePageLink}
  <a href={leavePageLink}><div class={baseIconClasses}><Fa icon={mergeTo.icon} /></div></a>
{:else}
  <div class="hidden sm:flex">
    {#each actionItems as actionItem (actionItem.label)}
      <button
        type="button"
        title={actionItem.title}
        aria-label={actionItem.label}
        class={baseIconClasses}
        on:click={() => handleActionMenuItem(actionItem.label)}
        ><Fa icon={actionItem.icon} /></button
      >
    {/each}
  </div>
  <div class="flex sm:hidden">
    <Popover
      placement="bottom"
      fallbackPlacements={['bottom-end', 'bottom-start']}
      yOffset={0}
      bind:this={menuElm}
    >
      <div slot="icon" class={baseIconClasses}><Fa icon={mergeTo.icon} /></div>
      <div class="w-64 max-w-[80vw] bg-card" slot="content">
        {#each actionItems as actionItem (actionItem.label)}
          <button
            type="button"
            class="block w-full px-4 py-2 text-left text-sm hover:bg-muted hover:text-foreground"
            title={actionItem.title}
            on:click={() => handleActionMenuItem(actionItem.label)}>{actionItem.label}</button
          >
        {/each}
      </div>
    </Popover>
  </div>
{/if}
