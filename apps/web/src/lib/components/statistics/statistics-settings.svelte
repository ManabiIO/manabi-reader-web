<script lang="ts">
  import faLeftLong from '@lucide/svelte/icons/arrow-left';
  import faRightLong from '@lucide/svelte/icons/arrow-right';
  import { Button } from '$lib/components/ui/button';
  import CloseButton from '$lib/components/ui/close-button.svelte';
  import * as Sheet from '$lib/components/ui/sheet';
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import { optionsForToggle } from '$lib/components/button-toggle-group/toggle-option';
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

<div class="statistics-options">
  <div class="flex items-start justify-between gap-3">
    <Sheet.Title class="min-w-0 text-xl font-semibold">Statistics options</Sheet.Title>
    <CloseButton
      aria-label="Close statistics options"
      disabled={$statisticsActionInProgress$}
      onclick={() => dispatch('close')}
    />
  </div>
  <Sheet.Description>Choose your date range, measurements, and export format.</Sheet.Description>
  <fieldset disabled={$statisticsActionInProgress$} class="options-group">
    <legend>Date range</legend>
    <div class="fields">
      <label for="datesTemplate">Template
        <select id="datesTemplate" bind:value={$lastStatisticsRangeTemplate$}>
          {#each statisticsRangeTemplates as template (template)}
            <option value={template}>{template}</option>
          {/each}
        </select>
      </label>
      <label for="weekDay">Start of Week
        <select id="weekDay" bind:value={$lastStartDayOfWeek$}>
          {#each weekDays as weekDay (weekDay.day)}
            <option value={weekDay.index}>{weekDay.day}</option>
          {/each}
        </select>
      </label>
      <label for="fromDate">From
        <input
          id="fromDate"
          type="date"
          value={selectedStatisticsStartDate}
          on:change={(event) =>
            dispatch('statisticsDateChange', {
              isStartDate: true,
              dateString: event.currentTarget.value
            })}
        />
      </label>
      <label for="toDate">To
        <input
          id="toDate"
          type="date"
          value={selectedStatisticsEndDate}
          on:change={(event) =>
            dispatch('statisticsDateChange', {
              isStartDate: false,
              dateString: event.currentTarget.value
            })}
        />
      </label>
    </div>
    <div class="actions">
      <Button
        variant="ghost"
        aria-label="Set end date to start date"
        onclick={() => dispatch('statisticsDateChange', {
          isStartDate: false, dateString: selectedStatisticsStartDate
        })}
      ><AppIcon icon={faRightLong} />Use start date for both</Button>
      <Button
        variant="ghost"
        aria-label="Set start date to end date"
        onclick={() => dispatch('statisticsDateChange', {
          isStartDate: true, dateString: selectedStatisticsEndDate
        })}
      ><AppIcon icon={faLeftLong} />Use end date for both</Button>
      <Button variant="link" onclick={() => setStatisticsDatesToAllTime$.next()}
        >Set to All Time for selected Book Titles</Button>
    </div>
  </fieldset>
  <fieldset disabled={$statisticsActionInProgress$} class="options-group">
    <legend>Measurements</legend>
    <p id="statistics-measurement-help" class="text-sm text-muted-foreground">
      Choose which values appear in the summary and how the reading data is grouped.
    </p>
    <div class="fields">
      <label for="timeDataSource">Time Data Source
        <select id="timeDataSource" aria-describedby="statistics-measurement-help" bind:value={$lastReadingTimeDataSource$}>
          {#each readingTimeDataSources as source (source.key)}<option value={source.key}>{source.label}</option>{/each}
        </select>
      </label>
      <label for="charactersSource">Characters Data Source
        <select id="charactersSource" aria-describedby="statistics-measurement-help" bind:value={$lastCharactersDataSource$}>
          {#each charactersDataSources as source (source.key)}<option value={source.key}>{source.label}</option>{/each}
        </select>
      </label>
      <label for="speedSource">Speed Data Source
        <select id="speedSource" aria-describedby="statistics-measurement-help" bind:value={$lastReadingSpeedDataSource$}>
          {#each readingSpeedDataSources as source (source.key)}<option value={source.key}>{source.label}</option>{/each}
        </select>
      </label>
      <label for="primaryAggregration">Primary Aggregation
        <select id="primaryAggregration" aria-describedby="statistics-measurement-help" bind:value={$lastPrimaryReadingDataAggregationMode$}>
          {#each statisticsDataAggregrationModes as mode (mode)}<option value={mode}>{mode}</option>{/each}
        </select>
      </label>
    </div>
  </fieldset>
  <fieldset disabled={$statisticsActionInProgress$} class="options-group">
    <legend>Export history</legend>
    <p class="text-sm text-muted-foreground">
      Raw history preserves book identities, unresolved legacy days, and migration receipts for
      recovery; it is not a TTU import file. The TTU ZIP exports use titles and cannot preserve
      book identities.
    </p>
    <div class="actions">
      <Button variant="secondary" onclick={() => {
        $statisticsActionInProgress$ = true;
        exportRawStatistics$.next();
      }}>Download raw history (JSON)</Button>
      <Button variant="outline" onclick={() => exportStatisticsData(false)}>Export Selection</Button>
      <Button variant="outline" onclick={() => exportStatisticsData()}>Export All</Button>
    </div>
  </fieldset>
  <fieldset disabled={$statisticsActionInProgress$} class="options-group">
    <legend>Manage history</legend>
    <SettingsItemGroup title="Confirm Statistics Deletion" applyHeaderClasses={false}>
      <ButtonToggleGroup
        invertColors
        options={optionsForToggle}
        bind:selectedOptionId={$confirmStatisticsDeletion$}
      />
    </SettingsItemGroup>
    <div class="actions">
      <Button variant="destructive" onclick={() => deleteStatisticsData(false)}>Delete Selection</Button>
      <Button variant="destructive" onclick={() => deleteStatisticsData()}>Delete All</Button>
    </div>
  </fieldset>
</div>

<style>
  .statistics-options {
    display: grid;
    flex-shrink: 0;
    min-width: 0;
    gap: 16px;
    padding: 20px;
    padding-bottom: max(20px, env(safe-area-inset-bottom));
  }
  .options-group {
    display: grid;
    min-width: 0;
    gap: 16px;
    margin-top: 8px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }
  legend {
    padding-inline-end: 12px;
    font-weight: 600;
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
    gap: 16px;
  }
  label {
    display: grid;
    min-width: 0;
    gap: 6px;
    font-size: 0.875rem;
  }
  input,
  select {
    width: 100%;
    min-width: 0;
    min-height: 44px;
    padding: 8px 10px;
    border: 1px solid var(--input);
    border-radius: 10px;
    background: var(--background);
    color: var(--foreground);
    font-size: 1rem;
  }
  input:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
