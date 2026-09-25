<script lang="ts">
  import * as Sheet from '$lib/components/ui/sheet';
  import faCalendar from '@lucide/svelte/icons/calendar';
  import faCalendarXmark from '@lucide/svelte/icons/calendar-x';
  import faChevronLeft from '@lucide/svelte/icons/chevron-left';
  import faChevronRight from '@lucide/svelte/icons/chevron-right';
  import faCircleCheck from '@lucide/svelte/icons/circle-check';
  import faEye from '@lucide/svelte/icons/eye';
  import faEyeSlash from '@lucide/svelte/icons/eye-off';
  import faList from '@lucide/svelte/icons/list';
  import faListCheck from '@lucide/svelte/icons/list-check';
  import faTrash from '@lucide/svelte/icons/trash-2';
  import { Button } from '$lib/components/ui/button';
  import CloseButton from '$lib/components/ui/close-button.svelte';
  import { Input } from '$lib/components/ui/input';
  import {
    preFilteredTitlesForStatistics$,
    type StatisticsTitleFilterItem
  } from '$lib/components/statistics/statistics-types';
  import {
    lastStatisticsFilterDateRangeOnly$,
    lastStatisticsFilterShowSelectedTitlesOnly$,
    skipKeyDownListener$
  } from '$lib/data/store';
  import { reduceToEmptyString } from '$lib/functions/rxjs/reduce-to-empty-string';
  import { convertRemToPixels, getFullHeight, limitToRange } from '$lib/functions/utils';
  import { debounceTime, fromEvent, tap } from 'rxjs';
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import AppIcon from '$lib/components/app-icon.svelte';

  export let statisticsTitleFilters: Map<string, boolean>;
  export let titlesInStatisticsDateRange: Set<string>;

  const dispatch = createEventDispatcher<{
    applyFilter: StatisticsTitleFilterItem[];
    clearPrefilter: void;
    close: void;
  }>();

  const resizeHandler$ = fromEvent(window, 'resize').pipe(
    debounceTime(250),
    tap(() => updateStatisticsTitleFilterRowsPerPage),
    reduceToEmptyString()
  );

  const statisticsTitleFilterBaseRowRem = 4;
  const statisticsTitleFilterBaseRowGap = 2;

  let statisticsTitleFilterTableContainerElm: HTMLElement;
  let statisticsTitleFilterButtonContainer: HTMLElement;
  let titleFilter = '';
  let titleFilterTimer: number | undefined;
  let titlesToFilter: StatisticsTitleFilterItem[] = [];
  let filteredTitles: StatisticsTitleFilterItem[] = [];
  let currentTitlesToFilterRows: StatisticsTitleFilterItem[] = [];
  let statisticsTitleFilterMaxPages = 0;
  let currentStatisticsTitleFilterPage = 1;
  let statisticsTitleFilterRowsPerPage = 0;

  $: statisticsTitleFilterPageLabel = `PAGE ${currentStatisticsTitleFilterPage} / ${statisticsTitleFilterMaxPages}`;

  $: setTitlesToFilter(statisticsTitleFilters);

  $: applyTitleFilters(
    $lastStatisticsFilterDateRangeOnly$,
    $lastStatisticsFilterShowSelectedTitlesOnly$
  );

  $: updateStatisticsTitleFilterTableData(currentStatisticsTitleFilterPage);

  onMount(() => {
    $skipKeyDownListener$ = true;

    updateStatisticsTitleFilterRowsPerPage();

    return () => {
      $skipKeyDownListener$ = false;
    };
  });

  function handleTitleFilterChange() {
    clearTimeout(titleFilterTimer);
    titleFilterTimer = window.setTimeout(() => {
      applyTitleFilters();
    }, 500);
  }

  function handleSelectAll(valueToSet: boolean) {
    for (let index = 0, { length } = titlesToFilter; index < length; index += 1) {
      titlesToFilter[index].isSelected = valueToSet;
    }

    if ($lastStatisticsFilterShowSelectedTitlesOnly$) {
      applyTitleFilters();
    } else {
      updateStatisticsTitleFilterTableData(currentStatisticsTitleFilterPage);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function setTitlesToFilter(_: any) {
    const entries = [...statisticsTitleFilters.entries()];

    titlesToFilter = entries.map(([title, isSelected]) => ({ title, isSelected }));

    applyTitleFilters();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function applyTitleFilters(..._: any) {
    tick().then(() => {
      filteredTitles = titlesToFilter.filter(
        (filterItem) =>
          (!titleFilter || filterItem.title.includes(titleFilter)) &&
          (!$lastStatisticsFilterDateRangeOnly$ ||
            titlesInStatisticsDateRange.has(filterItem.title)) &&
          (!$lastStatisticsFilterShowSelectedTitlesOnly$ || filterItem.isSelected)
      );

      updateStatisticsTitleFilterRowsPerPage(currentStatisticsTitleFilterPage);
    });
  }

  function updateStatisticsTitleFilterRowsPerPage(newPage?: number) {
    tick().then(() => {
      if (
        !statisticsTitleFilterTableContainerElm?.isConnected ||
        !statisticsTitleFilterButtonContainer?.isConnected
      )
        return;
      statisticsTitleFilterRowsPerPage = Math.max(
        1,
        Math.ceil(
          (getFullHeight(window, statisticsTitleFilterTableContainerElm) -
            getFullHeight(window, statisticsTitleFilterButtonContainer, true)) /
            convertRemToPixels(
              window,
              statisticsTitleFilterBaseRowRem + statisticsTitleFilterBaseRowGap + 0.4
            )
        )
      );

      updateStatisticsTitleFilterPageData(newPage);
    });
  }

  function updateStatisticsTitleFilterPageData(newPage?: number) {
    statisticsTitleFilterMaxPages = Math.ceil(
      filteredTitles.length / statisticsTitleFilterRowsPerPage
    );

    currentStatisticsTitleFilterPage = newPage
      ? limitToRange(1, statisticsTitleFilterMaxPages, newPage)
      : limitToRange(1, statisticsTitleFilterMaxPages, currentStatisticsTitleFilterPage);

    updateStatisticsTitleFilterTableData(currentStatisticsTitleFilterPage);
  }

  function updateStatisticsTitleFilterTableData(pageNumber: number) {
    if (!pageNumber) {
      return;
    }

    const currenPageStart = (pageNumber - 1) * statisticsTitleFilterRowsPerPage;

    currentTitlesToFilterRows = filteredTitles.slice(
      currenPageStart,
      currenPageStart + statisticsTitleFilterRowsPerPage
    );
  }
</script>

{$resizeHandler$ ?? ''}
<div class="flex min-h-16 items-center justify-between gap-3 px-4 pt-4">
  <Sheet.Title class="min-w-0 text-xl font-semibold">Filter books</Sheet.Title>
  <CloseButton aria-label="Close title filter" onclick={() => dispatch('close')} />
</div>
<div class="flex min-h-0 flex-1 flex-col px-4">
  <Input
    type="search"
    placeholder="Filter Title"
    aria-label="Filter book titles"
    class="min-h-11 text-base"
    bind:value={titleFilter}
    oninput={handleTitleFilterChange}
  />
  <div class="mt-5 flex flex-wrap gap-2 text-sm">
    <Button
      variant="secondary"
      title="Apply Filter"
      onclick={() => {
        dispatch('applyFilter', titlesToFilter);
        dispatch('close');
      }}
    >
      <AppIcon icon={faCircleCheck} /> <span>Apply Filter</span>
    </Button>
    <Button variant="ghost" title="Select All" onclick={() => handleSelectAll(true)}>
      <AppIcon icon={faListCheck} /> <span>Select All</span>
    </Button>
    <Button variant="ghost" title="Remove All" onclick={() => handleSelectAll(false)}>
      <AppIcon icon={faList} /> <span>Remove All</span>
    </Button>
    <Button
      variant="ghost"
      title={$lastStatisticsFilterDateRangeOnly$
        ? 'Display Titles across all Time'
        : 'Display Titles in selected Date Range only'}
      aria-pressed={$lastStatisticsFilterDateRangeOnly$}
      onclick={() => ($lastStatisticsFilterDateRangeOnly$ = !$lastStatisticsFilterDateRangeOnly$)}
    >
      <AppIcon icon={$lastStatisticsFilterDateRangeOnly$ ? faCalendarXmark : faCalendar} />
      <span>{$lastStatisticsFilterDateRangeOnly$ ? 'All dates' : 'Selected dates only'}</span>
    </Button>
    <Button
      variant="ghost"
      title={$lastStatisticsFilterShowSelectedTitlesOnly$
        ? 'Display all Titles'
        : 'Display selected Titles only'}
      aria-pressed={$lastStatisticsFilterShowSelectedTitlesOnly$}
      onclick={() =>
        ($lastStatisticsFilterShowSelectedTitlesOnly$ =
          !$lastStatisticsFilterShowSelectedTitlesOnly$)}
    >
      <AppIcon icon={$lastStatisticsFilterShowSelectedTitlesOnly$ ? faEyeSlash : faEye} />
      <span
        >{$lastStatisticsFilterShowSelectedTitlesOnly$
          ? 'All titles'
          : 'Selected titles only'}</span
      >
    </Button>
    {#if $preFilteredTitlesForStatistics$.size}
      <Button
        variant="destructive"
        title="Remove Prefilter"
        onclick={() => dispatch('clearPrefilter')}
      >
        <AppIcon icon={faTrash} /> <span>Remove Prefilter</span>
      </Button>
    {/if}
  </div>
  <div class="grow mt-8 pl-1 overflow-auto" bind:this={statisticsTitleFilterTableContainerElm}>
    {#if filteredTitles.length}
      <div
        class="grid grid-cols-[max-content_auto] gap-x-8 items-center"
        style:grid-auto-rows={`${statisticsTitleFilterBaseRowRem}rem`}
        style:row-gap={`${statisticsTitleFilterBaseRowGap}rem`}
      >
        {#each currentTitlesToFilterRows as currentTitlesToFilterRow (currentTitlesToFilterRow.title)}
          <input
            aria-label={currentTitlesToFilterRow.title}
            type="checkbox"
            class="size-5 accent-primary"
            bind:checked={currentTitlesToFilterRow.isSelected}
            on:change={() => {
              if ($lastStatisticsFilterShowSelectedTitlesOnly$) {
                applyTitleFilters();
              }
            }}
          />
          <div
            class="line-clamp-3"
            class:opacity-50={!titlesInStatisticsDateRange.has(currentTitlesToFilterRow.title)}
            title={currentTitlesToFilterRow.title}
          >
            {currentTitlesToFilterRow.title}
          </div>
        {/each}
      </div>
    {:else}
      <div class="mt-6 text-2xl text-center">No Titles to filter</div>
    {/if}
  </div>
  <div
    class="my-6 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)_minmax(0,auto)] items-center gap-2"
    class:invisible={statisticsTitleFilterMaxPages < 2}
    bind:this={statisticsTitleFilterButtonContainer}
  >
    <Button
      variant="ghost"
      disabled={currentStatisticsTitleFilterPage === 1}
      onclick={() => (currentStatisticsTitleFilterPage -= 1)}
    >
      <AppIcon icon={faChevronLeft} />Previous
    </Button>
    <div class="min-w-0 text-center text-sm">{statisticsTitleFilterPageLabel}</div>
    <Button
      variant="ghost"
      disabled={currentStatisticsTitleFilterPage === statisticsTitleFilterMaxPages}
      onclick={() => (currentStatisticsTitleFilterPage += 1)}
    >
      Next<AppIcon icon={faChevronRight} />
    </Button>
  </div>
</div>
