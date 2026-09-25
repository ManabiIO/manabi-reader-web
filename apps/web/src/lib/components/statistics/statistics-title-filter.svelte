<script lang="ts">
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import * as Sheet from '$lib/components/ui/sheet';
  import { Button } from '$lib/components/ui/button';
  import CloseButton from '$lib/components/ui/close-button.svelte';
  import { Input } from '$lib/components/ui/input';
  import {
    preFilteredTitlesForStatistics$,
    type StatisticsTitleFilterItem
  } from './statistics-types';
  import {
    lastStatisticsFilterDateRangeOnly$,
    lastStatisticsFilterShowSelectedTitlesOnly$,
    skipKeyDownListener$
  } from '$lib/data/store';
  import { filterStatisticsTitles, statisticsTitlePage } from './title-filter-model';

  export let statisticsTitleFilters: Map<string, boolean>;
  export let titlesInStatisticsDateRange: Set<string>;

  const dispatch = createEventDispatcher<{
    applyFilter: StatisticsTitleFilterItem[];
    clearPrefilter: void;
    close: void;
  }>();
  let titleFilter = '';
  let page = 1;
  let titleList: HTMLDivElement | undefined;
  let titlesToFilter: StatisticsTitleFilterItem[] = [];
  // Draft selection is private to this opening. Close/Escape never applies it.
  $: titlesToFilter = [...statisticsTitleFilters].map(([title, isSelected]) => ({
    title,
    isSelected
  }));
  $: filteredTitles = filterStatisticsTitles(
    titlesToFilter,
    titleFilter,
    titlesInStatisticsDateRange,
    $lastStatisticsFilterDateRangeOnly$,
    $lastStatisticsFilterShowSelectedTitlesOnly$
  );
  $: current = statisticsTitlePage(filteredTitles, page);

  onMount(() => {
    $skipKeyDownListener$ = true;
    return () => {
      $skipKeyDownListener$ = false;
    };
  });

  async function changePage(nextPage: number) {
    const query = titleFilter;
    page = nextPage;
    await tick();
    if (page !== nextPage || titleFilter !== query) return;
    const first = titleList?.querySelector<HTMLInputElement>('input[type=checkbox]');
    if (!first?.isConnected) return;
    // A page can be taller than the sheet. Do not leave the user at its
    // last row after Next; move keyboard focus into the new page too.
    first.focus({ preventScroll: true });
    first.scrollIntoView({ block: 'nearest' });
  }

  function selectTitle(title: string, isSelected: boolean) {
    titlesToFilter = titlesToFilter.map((item) =>
      item.title === title ? { ...item, isSelected } : item
    );
    page = current.page;
  }

  function selectAll(isSelected: boolean) {
    titlesToFilter = titlesToFilter.map((item) => ({ ...item, isSelected }));
    page = 1;
  }
</script>

<div class="filter-panel">
  <div class="flex items-start justify-between gap-3">
    <Sheet.Title class="min-w-0 text-xl font-semibold">Filter books</Sheet.Title>
    <CloseButton aria-label="Close title filter" onclick={() => dispatch('close')} />
  </div>
  <Input
    type="search"
    placeholder="Filter titles"
    aria-label="Filter book titles"
    value={titleFilter}
    oninput={(event) => {
      titleFilter = event.currentTarget.value;
      page = 1;
    }}
  />
  <div class="flex flex-wrap gap-2" role="group" aria-label="Title visibility">
    <Button
      variant={$lastStatisticsFilterDateRangeOnly$ ? 'secondary' : 'ghost'}
      shape="rounded"
      aria-pressed={$lastStatisticsFilterDateRangeOnly$}
      onclick={() => {
        $lastStatisticsFilterDateRangeOnly$ = !$lastStatisticsFilterDateRangeOnly$;
        page = 1;
      }}>Selected dates only</Button
    >
    <Button
      variant={$lastStatisticsFilterShowSelectedTitlesOnly$ ? 'secondary' : 'ghost'}
      shape="rounded"
      aria-pressed={$lastStatisticsFilterShowSelectedTitlesOnly$}
      onclick={() => {
        $lastStatisticsFilterShowSelectedTitlesOnly$ =
          !$lastStatisticsFilterShowSelectedTitlesOnly$;
        page = 1;
      }}>Selected titles only</Button
    >
  </div>
  <div class="flex flex-wrap items-center gap-2">
    <Button variant="ghost" onclick={() => selectAll(true)}>Select All</Button>
    <Button variant="ghost" onclick={() => selectAll(false)}>Remove All</Button>
    {#if $preFilteredTitlesForStatistics$.size}
      <Button variant="outline" onclick={() => dispatch('clearPrefilter')}>Remove Prefilter</Button>
    {/if}
  </div>
  <p role="status" class="text-sm text-muted-foreground">
    {filteredTitles.length} matching titles · {titlesToFilter.filter((item) => item.isSelected).length} selected
  </p>
  {#if current.rows.length}
    <div bind:this={titleList} class="title-list" role="group" aria-label="Book title selection">
      {#each current.rows as item (item.title)}
        <label class="title-row">
          <input
            type="checkbox"
            aria-label={item.title}
            checked={item.isSelected}
            onchange={(event) => selectTitle(item.title, event.currentTarget.checked)}
          />
          <span class:text-muted-foreground={!titlesInStatisticsDateRange.has(item.title)}
            >{item.title}</span
          >
        </label>
      {/each}
    </div>
  {:else}
    <p class="rounded-xl bg-muted p-5 text-center">No Titles to filter</p>
  {/if}
  {#if current.pages > 1}
    <div class="flex flex-wrap items-center justify-between gap-2" aria-label="Title pages">
      <Button
        variant="ghost"
        disabled={current.page === 1}
        onclick={() => changePage(current.page - 1)}>Previous</Button
      >
      <span class="text-sm text-muted-foreground">Page {current.page} / {current.pages}</span>
      <Button
        variant="ghost"
        disabled={current.page === current.pages}
        onclick={() => changePage(current.page + 1)}>Next</Button
      >
    </div>
  {/if}
  <div class="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
    <Button variant="ghost" onclick={() => dispatch('close')}>Cancel</Button>
    <Button
      variant="secondary"
      onclick={() => {
        dispatch('applyFilter', titlesToFilter);
        dispatch('close');
      }}>Apply Filter</Button
    >
  </div>
</div>

<style>
  .filter-panel {
    display: grid;
    flex-shrink: 0;
    min-width: 0;
    gap: 16px;
    padding: 20px;
    padding-bottom: max(20px, env(safe-area-inset-bottom));
  }
  .title-list {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  .title-row {
    display: flex;
    min-height: 52px;
    align-items: center;
    gap: 12px;
    padding: 12px;
    cursor: pointer;
  }
  .title-row + .title-row {
    border-top: 1px solid var(--border);
  }
  .title-row:hover,
  .title-row:focus-within {
    background: var(--muted);
  }
  .title-row input {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    accent-color: var(--primary);
  }
  .title-row span {
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
