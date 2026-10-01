<script lang="ts">
  import faArrowDownWideShort from '@lucide/svelte/icons/arrow-down-wide-narrow';
  import faArrowUpShortWide from '@lucide/svelte/icons/arrow-up-narrow-wide';
  import Popover from '$lib/components/popover/popover.svelte';
  import { Button } from '$lib/components/ui/button';
  import type {
    StatisticsDataSourceChange,
    StatisticsSummaryKey
  } from '$lib/components/statistics/statistics-summary/statistics-summary';
  import type {
    BookStatistic,
    StatisticsDataSource
  } from '$lib/components/statistics/statistics-types';
  import { SortDirection } from '$lib/data/sort-types';
  import {
    lastStatisticsSummarySortDirection$,
    lastStatisticsSummarySortProperty$
  } from '$lib/data/store';
  import { createEventDispatcher } from 'svelte';
  import AppIcon from '$lib/components/app-icon.svelte';

  export let statisticsSummaryKey: StatisticsSummaryKey;
  export let options: StatisticsDataSource[];
  export let selectionKey: keyof BookStatistic;
  export let gridRow: number | undefined;
  export let hasRowInEdit: boolean;
  export let isHidden = false;
  export let title = '';

  const dispatch = createEventDispatcher<{
    propertyChange: StatisticsDataSourceChange;
  }>();

  const tableHeaderClasses =
    'flex items-center py-0 px-0 text-sm w-full bg-transparent border-0 md:border-b-2 border-border appearance-none focus:outline-none focus:ring-0 focus:border-border peer lg:text-base';

  let summaryHeaderPopover: Popover;

  $: optionKeys = new Set<keyof BookStatistic>((options || []).map((option) => option.key));

  $: selectedOption = options.find((option) => option.key === selectionKey)!;
</script>

<div
  class={tableHeaderClasses}
  class:hidden={isHidden}
  style:grid-row={gridRow ? `${gridRow}/${gridRow}` : null}
>
  {#if options.length > 1 && !hasRowInEdit}
    <Popover
      placement={'bottom-start'}
      fallbackPlacements={['top']}
      innerContainerStyles={'width:100%;min-height:44px;padding:0 8px;'}
      containerStyles={'flex: 1;'}
      bind:this={summaryHeaderPopover}
    >
      <div {title}>{selectedOption.label}</div>
      <div slot="content" class="flex flex-col overflow-auto w-46 p-2">
        {#each options as option (option.key)}
          <button
            type="button"
            class="my-1 flex min-h-11 w-full items-center rounded-lg px-3 py-2 text-left hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            on:click|stopPropagation={() => {
              selectedOption = option;
              dispatch('propertyChange', { property: option.key, statisticsSummaryKey });
              summaryHeaderPopover.toggleOpen();
            }}
          >
            {option.label}
          </button>
        {/each}
      </div>
    </Popover>
  {:else}
    <button
      type="button"
      class="flex min-h-11 flex-1 items-center rounded-lg px-2 text-left focus-visible:outline-2 focus-visible:outline-ring"
      class:cursor-not-allowed={hasRowInEdit}
      disabled={hasRowInEdit}
      {title}
      on:click={() => {
        dispatch('propertyChange', { property: selectedOption.key, statisticsSummaryKey });
      }}
    >
      {selectedOption.label}
    </button>
  {/if}
  <Button
    variant="ghost"
    size="icon"
    shape="circle"
    class={`ml-2 size-11 ${
      !optionKeys.has($lastStatisticsSummarySortProperty$) ? 'opacity-20' : ''
    }`}
    aria-label={`Sort by ${selectedOption.label}`}
    title="Sort by this attribute"
    disabled={hasRowInEdit}
    onclick={() =>
      dispatch('propertyChange', { property: selectedOption.key, statisticsSummaryKey })}
  >
    {#if $lastStatisticsSummarySortDirection$ === SortDirection.ASC}
      <AppIcon icon={faArrowUpShortWide} />
    {:else}
      <AppIcon icon={faArrowDownWideShort} />
    {/if}
  </Button>
</div>
