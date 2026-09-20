<script lang="ts">
  import faChevronLeft from '@lucide/svelte/icons/chevron-left';
  import faChevronRight from '@lucide/svelte/icons/chevron-right';
  import faClockRotateLeft from '@lucide/svelte/icons/history';
  import faFloppyDisk from '@lucide/svelte/icons/save';
  import faPause from '@lucide/svelte/icons/pause';
  import faPlay from '@lucide/svelte/icons/play';
  import faRepeat from '@lucide/svelte/icons/repeat';
  import faSpinner from '@lucide/svelte/icons/loader-circle';
  import faTrash from '@lucide/svelte/icons/trash-2';
  import faXmark from '@lucide/svelte/icons/x';
  import type { IconDefinition } from '$lib/components/icon-types';
  import type { TrackingHistory } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
  import {
    getChapterData,
    type SectionWithProgress
  } from '$lib/components/book-reader/book-toc/book-toc';
  import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
  import type { ReadingGoal } from '$lib/data/reading-goal';
  import { lastBlurredTrackerItems$, skipKeyDownListener$ } from '$lib/data/store';
  import { secondsToMinutes, toTimeString } from '$lib/functions/statistic-util';
  import { caluclatePercentage } from '$lib/functions/utils';
  import { createEventDispatcher, onMount } from 'svelte';
  import AppIcon from '$lib/components/app-icon.svelte';

  export let fontColor: string;
  export let backgroundColor: string;
  export let actionInProgress: boolean;
  export let hadError: boolean;
  export let currentReadingGoal: ReadingGoal | undefined;
  export let currentTimeGoal: number;
  export let currentCharacterGoal: number;
  export let currentReadingGoalStart: string;
  export let currentReadingGoalEnd: string;
  export let remainingTimeInReadingGoalWindow: string;
  export let wasTrackerPaused: boolean;
  export let canSaveStatistics: boolean;
  export let timeToFinishBook: string;
  export let sectionData: SectionWithProgress[];
  export let exploredCharCount: number;
  export let lastExploredCharCount: number;
  export let previousLastExploredCharCount: number;
  export let frozenPosition: number;
  export let trackingHistory: TrackingHistory[];
  export let sessionStatistics: BooksDbStatistic;
  export let todaysStatistics: BooksDbStatistic;
  export let allTimeStatistics: BooksDbStatistic;
  export let bookCompletionStatistics:
    | Omit<BooksDbStatistic, 'title' | 'lastStatisticModified'>
    | undefined;
  export let autoScrollerStatistics: BooksDbStatistic | undefined;
  export let bookStartDate: string;

  const dispatch = createEventDispatcher<{
    trackerMenuClosed: void;
    updateCurrentLocation: void;
    freezeCurrentLocation: void;
    saveStatistics: void;
    revertStatistic: TrackingHistory;
  }>();

  const actions = [
    { icon: faPlay, event: 'toggleTracker', title: 'Toggle Tracker' },
    { icon: faRepeat, event: 'updateCurrentLocation', title: 'Update Position' },
    { icon: faClockRotateLeft, event: 'freezeCurrentLocation', title: 'Toggle Freeze Position' },
    { icon: faFloppyDisk, event: 'saveStatistics', title: 'Save' }
  ];

  const trackingItemsPerPage = 15;

  let trackingHistoryIndex = 0;
  let timeToFinishChapter = '';

  $: allStatistics = autoScrollerStatistics
    ? [
        { id: 'Current Session', ...sessionStatistics },
        { id: 'Today', ...todaysStatistics },
        { id: 'All Time', ...allTimeStatistics },
        ...(bookCompletionStatistics
          ? [{ id: 'Book Completion', ...bookCompletionStatistics }]
          : []),
        { id: 'Autoscroller', ...autoScrollerStatistics }
      ]
    : [
        { id: 'Current Session', ...sessionStatistics },
        { id: 'Today', ...todaysStatistics },
        { id: 'All Time', ...allTimeStatistics },
        ...(bookCompletionStatistics
          ? [{ id: 'Book Completion', ...bookCompletionStatistics }]
          : [])
      ];

  $: currentTrackingHistoryIndex = Math.max(0, trackingHistoryIndex * trackingItemsPerPage);

  $: trackingHistoryItems = trackingHistory.slice(
    currentTrackingHistoryIndex,
    currentTrackingHistoryIndex + trackingItemsPerPage
  );

  $: hasNextPage = trackingHistory.length > currentTrackingHistoryIndex + trackingItemsPerPage;

  onMount(() => {
    $skipKeyDownListener$ = true;

    if (sectionData) {
      const [mainChapters, chapterIndex] = getChapterData(sectionData);
      const currentChapter = mainChapters[chapterIndex];
      const remainingCharacters =
        (currentChapter.startCharacter ?? 0) +
        (currentChapter.characters ?? 0) -
        (exploredCharCount ?? 0);

      timeToFinishChapter = sessionStatistics.lastReadingSpeed
        ? toTimeString(
            Math.max(
              0,
              Math.floor(remainingCharacters / (sessionStatistics.lastReadingSpeed / 3600))
            )
          )
        : 'N/A';
    }

    return () => {
      $skipKeyDownListener$ = false;
    };
  });

  function executeAction(event: string) {
    switch (event) {
      case 'toggleTracker':
        wasTrackerPaused = !wasTrackerPaused;
        break;
      case 'updateCurrentLocation':
      case 'freezeCurrentLocation':
      case 'saveStatistics':
        dispatch(event);
        break;

      default:
        break;
    }
  }

  function handleBlurredKey(dataKey: string) {
    if (window.getSelection()?.toString().trim()) {
      return;
    }

    if ($lastBlurredTrackerItems$.has(dataKey)) {
      $lastBlurredTrackerItems$.delete(dataKey);
    } else {
      $lastBlurredTrackerItems$.add(dataKey);
    }

    $lastBlurredTrackerItems$ = new Set([...$lastBlurredTrackerItems$]);
  }

  function getActionIcon(
    action: { icon: IconDefinition; event: string; title: string },
    trackerPaused: boolean
  ) {
    if (action.event === 'toggleTracker') {
      return trackerPaused ? faPlay : faPause;
    }

    return action.icon;
  }
</script>

<div class="flex items-center justify-between min-h-[60px] px-4">
  <div class="mr-4">
    {#if hadError}
      Last Update failed
    {/if}
  </div>
  <button
    type="button"
    title="Close Tracker Menu"
    class="flex items-center hover:text-red-500 md:items-center gap-2 rounded-xl px-2 py-1.5 text-sm"
    on:click={() => dispatch('trackerMenuClosed')}
  >
    <AppIcon icon={faXmark} />
    <span>Close Tracker Menu</span></button
  >
</div>
<div class="flex flex-1 flex-col overflow-auto p-4">
  {#if currentReadingGoal}
    <div class="mb-6">
      {#if currentReadingGoal.timeGoal}
        {@const timeGoalPercentage = caluclatePercentage(
          currentTimeGoal,
          currentReadingGoal.timeGoal
        )}
        <div>
          {secondsToMinutes(currentTimeGoal)} / {secondsToMinutes(currentReadingGoal.timeGoal)} Min ({timeGoalPercentage}%)
        </div>
        <!-- eslint-disable-next-line svelte/no-unknown-style-directive-property -->
        <div class="w-full rounded-full h-2.5" style:background-Color={fontColor}>
          <div
            class="h-2.5 rounded-full opacity-70"
            style:width={`${Math.min(100, timeGoalPercentage)}%`}
            style:background-color={backgroundColor}
          ></div>
        </div>
      {/if}
      {#if currentReadingGoal.characterGoal}
        {@const characterGoalPercentage = caluclatePercentage(
          currentCharacterGoal,
          currentReadingGoal.characterGoal
        )}
        <div class="mt-4">
          {currentCharacterGoal} / {currentReadingGoal.characterGoal} Characters ({characterGoalPercentage}%)
        </div>
        <!-- eslint-disable-next-line svelte/no-unknown-style-directive-property -->
        <div class="w-full rounded-full h-2.5" style:background-Color={fontColor}>
          <!-- eslint-disable svelte/no-unknown-style-directive-property -->
          <div
            class="h-2.5 rounded-full opacity-70"
            style:width={`${Math.min(100, characterGoalPercentage)}%`}
            style:background-Color={backgroundColor}
          ></div>
          <!-- eslint-enable svelte/no-unknown-style-directive-property -->
        </div>
      {/if}
      <div class="grid grid-cols-[max-content_auto] gap-x-4 gap-y-2 mt-4">
        <div>Current Reading Goal:</div>
        <div class="flex flex-col sm:block">
          <span>{currentReadingGoalStart}</span>
          {#if currentReadingGoalEnd && currentReadingGoalStart !== currentReadingGoalEnd}
            <span>-</span>
            <span>{currentReadingGoalEnd}</span>
          {/if}
        </div>
        <div>Remaining Time left:</div>
        <div>
          {remainingTimeInReadingGoalWindow}
        </div>
      </div>
    </div>
  {/if}
  {#each allStatistics as statistic (statistic.id)}
    <div class="mb-7 last:mb-4">
      <div class="flex items-center">
        <div>
          {statistic.id}
        </div>
        {#if statistic.id === 'Current Session'}
          {#each actions as action (action.event)}
            {#if action.event !== 'saveStatistics' || (action.event === 'saveStatistics' && canSaveStatistics)}
              <button
                type="button"
                class="ml-4 hover:text-red-500 gap-2 rounded-xl px-2 py-1.5 text-sm"
                title={action.title}
                on:click={() => executeAction(action.event)}
              >
                <AppIcon icon={getActionIcon(action, wasTrackerPaused)} />
                <span>{action.title}</span></button
              >
            {/if}
          {/each}
        {/if}
      </div>
      <hr />
      <div class="grid grid-cols-[max-content_auto] gap-x-4 gap-y-2">
        {#if statistic.id === 'All Time'}
          <div class="mt-3">Book started on:</div>
          <div class="mt-3">{bookStartDate}</div>
        {/if}
        {#if statistic.id === 'Book Completion' && bookCompletionStatistics}
          <div class="mt-3">Completed on:</div>
          <div class="mt-3">{bookCompletionStatistics.dateKey}</div>
        {/if}
        <button
          class="text-left"
          class:mt-3={statistic.id !== 'All Time' && statistic.id !== 'Book Completion'}
          on:click={() => handleBlurredKey('charactersRead')}
        >
          Characters Read:
        </button>
        <button
          type="button"
          class:blur={$lastBlurredTrackerItems$.has('charactersRead')}
          class:mt-3={statistic.id !== 'All Time' && statistic.id !== 'Book Completion'}
          on:click={() => handleBlurredKey('charactersRead')}
        >
          {statistic.charactersRead}
        </button>
        <button class="text-left" on:click={() => handleBlurredKey('lastReadingSpeed')}>
          Reading Speed:
        </button>
        <button
          type="button"
          class:blur={$lastBlurredTrackerItems$.has('lastReadingSpeed')}
          on:click={() => handleBlurredKey('lastReadingSpeed')}
        >
          {statistic.lastReadingSpeed} / h
        </button>
        <button class="text-left" on:click={() => handleBlurredKey('readingTime')}>
          Reading Time:
        </button>
        <button
          type="button"
          class:blur={$lastBlurredTrackerItems$.has('readingTime')}
          on:click={() => handleBlurredKey('readingTime')}
        >
          {toTimeString(statistic.readingTime)}
        </button>
        {#if statistic.id === 'Current Session'}
          <button class="text-left" on:click={() => handleBlurredKey('finishETA')}>
            Time to Finish Book:
          </button>
          <button
            type="button"
            class:blur={$lastBlurredTrackerItems$.has('finishETA')}
            on:click={() => handleBlurredKey('finishETA')}
          >
            {timeToFinishBook}
          </button>
          {#if timeToFinishChapter}
            <button class="text-left" on:click={() => handleBlurredKey('finishChapterETA')}>
              Time to Finish Chapter:
            </button>
            <button
              type="button"
              class:blur={$lastBlurredTrackerItems$.has('finishChapterETA')}
              on:click={() => handleBlurredKey('finishChapterETA')}
            >
              {timeToFinishChapter}
            </button>
          {/if}

          <div class="mt-3">Current Position:</div>
          <div class="mt-3">{lastExploredCharCount}</div>
          <div>Previous Position</div>
          <div>{previousLastExploredCharCount}</div>
          {#if frozenPosition > -1}
            <div>Frozen Position</div>
            <div>{frozenPosition}</div>
          {/if}
        {/if}
      </div>
      {#if statistic.id === 'Current Session' && trackingHistoryItems.length}
        <details class="mt-3 mr-4">
          <summary class="cursor-pointer">Recent History</summary>
          <div class="grid grid-cols-[repeat(4,max-content)] gap-x-8 items-center">
            {#each trackingHistoryItems as trackingHistoryItem (trackingHistoryItem.id)}
              <div>{trackingHistoryItem.dateTimeKey}</div>
              <div
                class:text-green-500={trackingHistoryItem.timeDiff > 0}
                class:text-red-500={trackingHistoryItem.timeDiff < 0}
              >
                {trackingHistoryItem.timeDiff}
              </div>
              <div
                class:text-green-500={trackingHistoryItem.characterDiff > 0}
                class:text-red-500={trackingHistoryItem.characterDiff < 0}
              >
                {trackingHistoryItem.characterDiff}
              </div>
              <div class="flex">
                <button
                  title="Revert Item"
                  class="hover:text-red-500"
                  on:click={() => dispatch('revertStatistic', trackingHistoryItem)}
                >
                  <AppIcon icon={faTrash} /> <span>Revert Item</span>
                </button>
                <div
                  title="Item saved to Database"
                  class="ml-4 cursor-not-allowed"
                  class:text-green-500={trackingHistoryItem.saved}
                >
                  <AppIcon icon={faFloppyDisk} />
                </div>
              </div>
            {/each}
          </div>
          <div class="flex justify-between mt-3">
            <button
              title={currentTrackingHistoryIndex === 0 ? '' : 'Previous Page'}
              disabled={currentTrackingHistoryIndex === 0}
              class:opacity-50={currentTrackingHistoryIndex === 0}
              class:cursor-not-allowed={currentTrackingHistoryIndex === 0}
              on:click={() => (trackingHistoryIndex -= 1)}
            >
              <AppIcon icon={faChevronLeft} />
            </button>
            <button
              title={hasNextPage ? 'Next Page' : ''}
              disabled={!hasNextPage}
              class:opacity-50={!hasNextPage}
              class:cursor-not-allowed={!hasNextPage}
              on:click={() => (trackingHistoryIndex += 1)}
            >
              <AppIcon icon={faChevronRight} />
            </button>
          </div>
        </details>
      {/if}
    </div>
  {/each}
  {#if actionInProgress}
    <div class="tap-highlight-transparent absolute inset-0 bg-black/[.2]"></div>
    <div class="absolute inset-0 flex h-full w-full items-center justify-center text-7xl">
      <AppIcon icon={faSpinner} spin />
    </div>
  {/if}
</div>
