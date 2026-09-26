<script lang="ts">
  import { pagePath } from '$lib/data/env';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/dropdown-menu';
  import AppNav from '$lib/components/navigation/app-nav.svelte';
  import ActionMenu from '$lib/components/navigation/action-menu.svelte';
  import {
    StatisticsTab,
    copyStatisticsData$,
    statisticsTitleFilterEnabled$,
    statisticsTitleFilterIsOpen$,
    type StatisticsDataSource
  } from './statistics-types';
  import { lastStatisticsTab$ } from '$lib/data/store';
  export let currentBookId: number | undefined;
  export let showStatisticsSettings: boolean;
  const copyItems: StatisticsDataSource[] = [
    { key: 'readingTime', label: 'Reading Time' },
    { key: 'charactersRead', label: 'Characters Read' }
  ];
</script>

<header
  class="app-header sticky top-0 z-10 border-b border-border bg-card text-foreground"
  aria-label="Statistics toolbar"
>
  <div class="mx-auto flex min-h-12 flex-wrap max-w-7xl items-center justify-between gap-2 px-3 py-2 sm:px-6">
    <h1 class="text-lg font-semibold">Statistics</h1>
    <div class="flex flex-wrap items-center gap-1">
      {#if currentBookId}<Button href={`${pagePath}/b?id=${currentBookId}`} variant="ghost"
          >Resume reading</Button
        >{/if}
      <AppNav />
    </div>
  </div>
  <div class="mx-auto flex min-h-14 max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-2 sm:px-6">
    <div role="group" aria-label="Statistics view" class="section-navigation">
      <Button
        variant="ghost"
        shape="rounded"
        data-section-link
        aria-pressed={$lastStatisticsTab$ === StatisticsTab.SUMMARY}
        onclick={() => ($lastStatisticsTab$ = StatisticsTab.SUMMARY)}>Summary</Button
      >
      <Button
        variant="ghost"
        shape="rounded"
        data-section-link
        aria-pressed={$lastStatisticsTab$ === StatisticsTab.OVERVIEW}
        onclick={() => ($lastStatisticsTab$ = StatisticsTab.OVERVIEW)}>Heatmap</Button
      >
    </div>
    <Button
      variant="secondary"
      disabled={!$statisticsTitleFilterEnabled$}
      onclick={() => ($statisticsTitleFilterIsOpen$ = true)}
      title="Open Title Filter Menu">Filter books</Button
    >
    <ActionMenu label="Options" title="Statistics options" variant="secondary">
      <Menu.Item onSelect={() => (showStatisticsSettings = true)}>Statistics Settings</Menu.Item>
      <Menu.Separator /><Menu.Label>Copy TMW log data</Menu.Label>
      {#each copyItems as item (item.key)}<Menu.Item
          onSelect={() => copyStatisticsData$.next(item.key)}>Copy {item.label}</Menu.Item
        >{/each}
    </ActionMenu>
  </div>
</header>
