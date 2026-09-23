<script lang="ts">
  import faCircleQuestion from '@lucide/svelte/icons/circle-help';
  import faLeftLong from '@lucide/svelte/icons/arrow-left';
  import faRightLong from '@lucide/svelte/icons/arrow-right';
  import { Button } from '$lib/components/ui/button';
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import { optionsForToggle } from '$lib/components/button-toggle-group/toggle-option';
  import Popover from '$lib/components/popover/popover.svelte';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import {
    type StatisticsDateChange,
    statisticsRangeTemplates,
    readingTimeDataSources,
    charactersDataSources,
    readingSpeedDataSources,
    statisticsDataAggregrationModes,
    exportStatisticsData$,
    exportRawStatistics$,
    statisticsActionInProgress$,
    deleteStatisticsData$,
    setStatisticsDatesToAllTime$
  } from '$lib/components/statistics/statistics-types';
  import { daysOfWeek } from '$lib/components/statistics/statistics-heatmap/statistics-heatmap';
  import {
    confirmStatisticsDeletion$,
    lastCharactersDataSource$,
    lastPrimaryReadingDataAggregationMode$,
    lastReadingSpeedDataSource$,
    lastReadingTimeDataSource$,
    lastStartDayOfWeek$,
    lastStatisticsEndDate$,
    lastStatisticsRangeTemplate$,
    lastStatisticsStartDate$
  } from '$lib/data/store';
  import { createEventDispatcher } from 'svelte';
  import AppIcon from '$lib/components/app-icon.svelte';

  const dispatch = createEventDispatcher<{
    close: void;
    statisticsDateChange: StatisticsDateChange;
  }>();

  const weekDays = [...daysOfWeek.slice(1, 7), daysOfWeek[0]].map((day, index) => {
    if (day === 'Sunday') {
      return { day, index: 0 };
    }
    return { day, index: index + 1 };
  });

  $: selectedStatisticsStartDate = $lastStatisticsStartDate$;

  $: selectedStatisticsEndDate = $lastStatisticsEndDate$;

  async function exportStatisticsData(exportAllStatisticsData = true) {
    $statisticsActionInProgress$ = true;

    exportStatisticsData$.next(exportAllStatisticsData);
  }

  async function deleteStatisticsData(deleteAllStatisticsData = true) {
    $statisticsActionInProgress$ = true;

    deleteStatisticsData$.next(deleteAllStatisticsData);
  }
</script>

<div class="flex flex-wrap items-center gap-2 p-4">
  <Button variant="ghost" onclick={() => dispatch('close')}>Close</Button>
  <div class="flex flex-1 flex-wrap justify-end gap-2">
    <button
      class="rounded-lg px-2 py-1 hover:bg-accent"
      on:click={() => {
        $statisticsActionInProgress$ = true;
        exportRawStatistics$.next();
      }}
    >
      Download raw history (JSON)
    </button>
    <button
      class="rounded-lg px-2 py-1 hover:bg-accent"
      on:click={() => exportStatisticsData(false)}
    >
      Export Selection
    </button>
    <button
      class="rounded-lg px-2 py-1 hover:bg-accent"
      on:click={() => deleteStatisticsData(false)}
    >
      Delete Selection
    </button>
    <button class="rounded-lg px-2 py-1 hover:bg-accent" on:click={() => exportStatisticsData()}>
      Export All
    </button>
    <button
      class="rounded-lg px-2 py-1 text-destructive hover:bg-accent"
      on:click={() => deleteStatisticsData()}>Delete All</button
    >
  </div>
</div>
<p class="px-4 text-sm text-muted-foreground">
  Raw history preserves book identities, unresolved legacy days, and migration receipts for
  recovery; it is not a TTU import file. The TTU ZIP exports below use titles and cannot preserve
  book identities.
</p>
<div class="flex-1 p-4 overflow-auto">
  <div class="flex flex-col mb-6">
    <label for="datesTemplate">Template</label>
    <select id="datesTemplate" class="text-foreground" bind:value={$lastStatisticsRangeTemplate$}>
      {#each statisticsRangeTemplates as statisticsRangeTemplate (statisticsRangeTemplate)}
        <option value={statisticsRangeTemplate}>
          {statisticsRangeTemplate}
        </option>
      {/each}
    </select>
  </div>
  <div class="flex flex-col mb-4 sm:hidden">
    <label for="weekDay">Start of Week</label>
    <select id="weekDay" class="text-foreground" bind:value={$lastStartDayOfWeek$}>
      {#each weekDays as weekDay (weekDay.day)}
        <option value={weekDay.index}>
          {weekDay.day}
        </option>
      {/each}
    </select>
  </div>
  <div class="flex justify-between sm:flex-row">
    <div class="flex flex-col">
      <label for="fromDate">From</label>
      <input
        id="fromDate"
        type="date"
        class="text-foreground"
        bind:value={selectedStatisticsStartDate}
        on:change={() =>
          dispatch('statisticsDateChange', {
            isStartDate: true,
            dateString: selectedStatisticsStartDate
          })}
      />
    </div>
    <div class="flex flex-col justify-between pt-4 mx-2 text-xl sm:mx-0">
      <button
        aria-label="Set end date to start date"
        title="Set end date to start date"
        on:click={() =>
          dispatch('statisticsDateChange', {
            isStartDate: false,
            dateString: selectedStatisticsStartDate
          })}
      >
        <AppIcon icon={faRightLong} />
      </button>
      <button
        aria-label="Set start date to end date"
        title="Set start date to end date"
        on:click={() =>
          dispatch('statisticsDateChange', {
            isStartDate: true,
            dateString: selectedStatisticsEndDate
          })}
      >
        <AppIcon icon={faLeftLong} />
      </button>
    </div>
    <div class="flex flex-col">
      <label for="toDate">To</label>
      <input
        id="toDate"
        type="date"
        class="text-foreground"
        bind:value={selectedStatisticsEndDate}
        on:change={() =>
          dispatch('statisticsDateChange', {
            isStartDate: false,
            dateString: selectedStatisticsEndDate
          })}
      />
    </div>
    <div class="flex-col hidden sm:flex">
      <label for="weekDay">Start of Week</label>
      <select id="weekDay" class="text-foreground" bind:value={$lastStartDayOfWeek$}>
        {#each weekDays as weekDay (weekDay.day)}
          <option value={weekDay.index}>
            {weekDay.day}
          </option>
        {/each}
      </select>
    </div>
  </div>
  <button
    class="text-left mt-3 hover:text-red-500"
    on:click={() => setStatisticsDatesToAllTime$.next()}
  >
    Set to All Time for selected Book Titles
  </button>
  <div class="flex flex-wrap justify-between mt-4">
    <div class="flex flex-col my-2 w-full sm:w-[initial]">
      <Popover
        contentText={'Reading Time Attribute which should be used for the Summary Tab'}
        contentStyles="padding: 0.5rem;"
      >
        <AppIcon icon={faCircleQuestion} slot="icon" class="mx-2" />
        <label for="timeDataSource">Time Data Source</label>
      </Popover>
      <select id="timeDataSource" class="text-foreground" bind:value={$lastReadingTimeDataSource$}>
        {#each readingTimeDataSources as readingTimeDataSource (readingTimeDataSource.key)}
          <option value={readingTimeDataSource.key}>
            {readingTimeDataSource.label}
          </option>
        {/each}
      </select>
    </div>
    <div class="flex flex-col my-2 w-full sm:w-[initial]">
      <Popover
        contentText={'Characters Read Attribute which should be used for the Summary Tab'}
        contentStyles="padding: 0.5rem; max-width: 20rem;"
      >
        <AppIcon icon={faCircleQuestion} slot="icon" class="mx-2" />
        <label for="charactersSource">Characters Data Source</label>
      </Popover>
      <select id="charactersSource" class="text-foreground" bind:value={$lastCharactersDataSource$}>
        {#each charactersDataSources as charactersDataSource (charactersDataSource.key)}
          <option value={charactersDataSource.key}>
            {charactersDataSource.label}
          </option>
        {/each}
      </select>
    </div>
    <div class="flex flex-col my-2 w-full sm:w-[initial]">
      <Popover
        contentText={'Reading Speed Attribute which should be used for the Summary Tab'}
        contentStyles="padding: 0.5rem;"
      >
        <AppIcon icon={faCircleQuestion} slot="icon" class="mx-2" />
        <label for="speedSource">Speed Data Source</label>
      </Popover>
      <select id="speedSource" class="text-foreground" bind:value={$lastReadingSpeedDataSource$}>
        {#each readingSpeedDataSources as readingSpeedDataSource (readingSpeedDataSource.key)}
          <option value={readingSpeedDataSource.key}>
            {readingSpeedDataSource.label}
          </option>
        {/each}
      </select>
    </div>
  </div>
  <div class="flex flex-col mt-4">
    <Popover
      contentText={'Determines on which primary Attribute the Data will be grouped for the Summary Tab'}
      contentStyles="padding: 0.5rem;"
    >
      <AppIcon icon={faCircleQuestion} slot="icon" class="mx-2" />
      <label for="primaryAggregration">Primary Aggregration</label>
    </Popover>
    <select
      id="primaryAggregration"
      class="text-foreground"
      bind:value={$lastPrimaryReadingDataAggregationMode$}
    >
      {#each statisticsDataAggregrationModes as statisticsDataAggregrationMode (statisticsDataAggregrationMode)}
        <option value={statisticsDataAggregrationMode}>
          {statisticsDataAggregrationMode}
        </option>
      {/each}
    </select>
  </div>
  <div class="mt-4">
    <SettingsItemGroup title="Confirm Statistics Deletion" applyHeaderClasses={false}>
      <ButtonToggleGroup
        invertColors
        options={optionsForToggle}
        bind:selectedOptionId={$confirmStatisticsDeletion$}
      />
    </SettingsItemGroup>
  </div>
</div>
