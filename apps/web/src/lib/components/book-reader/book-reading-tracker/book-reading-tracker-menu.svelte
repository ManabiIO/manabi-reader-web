<script lang="ts">
  import * as Sheet from '$lib/components/ui/sheet';
  import { Button } from '$lib/components/ui/button';
  import CloseButton from '$lib/components/ui/close-button.svelte';
  import faChevronLeft from '@lucide/svelte/icons/chevron-left';
  import faChevronRight from '@lucide/svelte/icons/chevron-right';
  import faClockRotateLeft from '@lucide/svelte/icons/history';
  import faFloppyDisk from '@lucide/svelte/icons/save';
  import faPlay from '@lucide/svelte/icons/play';
  import faRepeat from '@lucide/svelte/icons/repeat';
  import faSpinner from '@lucide/svelte/icons/loader-circle';
  import faTrash from '@lucide/svelte/icons/trash-2';
  import type { TrackingHistory } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
  import {
    getChapterData,
    type SectionWithProgress
  } from '$lib/components/book-reader/book-toc/book-toc';
  import { chapterCharacters } from '$lib/components/book-reader/book-toc/chapter-model';
  import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
  import type { ReadingGoal } from '$lib/data/reading-goal';
  import { lastBlurredTrackerItems$, skipKeyDownListener$ } from '$lib/data/store';
  import { secondsToMinutes, toTimeString } from '$lib/functions/statistic-util';
  import { caluclatePercentage } from '$lib/functions/utils';
  import { createEventDispatcher, onMount, tick } from 'svelte';
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
    { icon: faPlay, event: 'resumeAfterClose', title: 'Resume tracking after closing' },
    { icon: faRepeat, event: 'updateCurrentLocation', title: 'Update position' },
    {
      icon: faClockRotateLeft,
      event: 'freezeCurrentLocation',
      title: 'Keep reading position fixed'
    },
    { icon: faFloppyDisk, event: 'saveStatistics', title: 'Save statistics' }
  ] as const;

  const trackingItemsPerPage = 15;

  let trackingHistoryIndex = 0;
  let previousHistoryPage: HTMLButtonElement | null = null;
  let nextHistoryPage: HTMLButtonElement | null = null;
  let timeToFinishChapter = 'N/A';

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

  $: historyPageCount = Math.max(1, Math.ceil(trackingHistory.length / trackingItemsPerPage));
  $: if (trackingHistoryIndex >= historyPageCount) trackingHistoryIndex = historyPageCount - 1;
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
      const characters = chapterCharacters(currentChapter, exploredCharCount);
      const speed = sessionStatistics.lastReadingSpeed;
      if (characters && Number.isFinite(speed) && speed > 0) {
        const seconds = Math.floor((characters.total - characters.read) / (speed / 3600));
        if (Number.isFinite(seconds)) timeToFinishChapter = toTimeString(seconds);
      }
    }

    return () => {
      $skipKeyDownListener$ = false;
    };
  });

  function executeAction(event: string) {
    switch (event) {
      case 'resumeAfterClose':
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

  async function pageHistory(delta: -1 | 1) {
    trackingHistoryIndex = Math.min(
      historyPageCount - 1,
      Math.max(0, trackingHistoryIndex + delta)
    );
    await tick();

    // Keep keyboard ownership on an enabled pager when the activated control
    // becomes disabled at a boundary. On intermediate pages the same button
    // remains focused so repeated paging is still one-key operation.
    if (delta > 0 && nextHistoryPage?.disabled) {
      previousHistoryPage?.focus();
    } else if (delta < 0 && previousHistoryPage?.disabled) {
      nextHistoryPage?.focus();
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

  function privacyMetricLabel(dataKey: string, label: string, value: string | number) {
    return $lastBlurredTrackerItems$.has(dataKey)
      ? `${label}: value hidden. Activate to show.`
      : `${label}: ${value}. Activate to hide.`;
  }
</script>

<div class="flex min-h-16 items-center justify-between gap-3 px-4 pt-4">
  <div class="min-w-0">
    <Sheet.Title class="min-w-0 text-xl font-semibold">Reading tracker</Sheet.Title>
    {#if hadError}<p role="status" class="mt-1 text-sm text-destructive">Last update failed</p>{/if}
  </div>
  <CloseButton
    aria-label="Close reading tracker"
    disabled={actionInProgress}
    onclick={() => dispatch('trackerMenuClosed')}
  />
</div>
<div class="relative flex min-h-0 flex-1" aria-busy={actionInProgress}>
  <div class="flex min-h-0 flex-1 flex-col overflow-auto p-4" inert={actionInProgress}>
    <p class="mb-4 text-sm text-muted-foreground" role="status" aria-live="polite">
      Tracking is paused while this panel is open.
      {wasTrackerPaused ? 'It will remain paused after closing.' : 'It will resume after closing.'}
    </p>
    {#if currentReadingGoal}
      <div class="mb-6">
        {#if currentReadingGoal.timeGoal}
          {@const timeGoalPercentage = caluclatePercentage(
            currentTimeGoal,
            currentReadingGoal.timeGoal
          )}
          <div>
            {secondsToMinutes(currentTimeGoal)} / {secondsToMinutes(currentReadingGoal.timeGoal)} Min
            ({timeGoalPercentage}%)
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
        <div class="mt-4 grid min-w-0 gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
          <div class="font-medium">Current Reading Goal</div>
          <div class="min-w-0 break-words">
            <span>{currentReadingGoalStart}</span>
            {#if currentReadingGoalEnd && currentReadingGoalStart !== currentReadingGoalEnd}
              <span> – </span>
              <span>{currentReadingGoalEnd}</span>
            {/if}
          </div>
          <div class="font-medium">Remaining time</div>
          <div class="min-w-0 break-words">
            {remainingTimeInReadingGoalWindow}
          </div>
        </div>
      </div>
    {/if}
    {#each allStatistics as statistic (statistic.id)}
      <div class="mb-7 last:mb-4">
        <div class="flex flex-wrap items-center gap-2">
          <div>
            {statistic.id}
          </div>
          {#if statistic.id === 'Current Session'}
            {#each actions as action (action.event)}
              <Button
                variant="ghost"
                size="sm"
                title={action.title}
                aria-pressed={action.event === 'resumeAfterClose'
                  ? !wasTrackerPaused
                  : action.event === 'freezeCurrentLocation'
                    ? frozenPosition > -1
                    : undefined}
                disabled={actionInProgress ||
                  (action.event === 'saveStatistics' && !canSaveStatistics)}
                onclick={() => executeAction(action.event)}
              >
                <AppIcon icon={action.icon} />
                {action.title}
              </Button>
            {/each}
          {/if}
        </div>
        <hr />
        <div class="grid min-w-0 gap-1">
          {#if statistic.id === 'All Time'}
            <div class="grid min-w-0 gap-1 px-2 py-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
              <span class="font-medium">Book started on</span>
              <span class="min-w-0 break-words">{bookStartDate}</span>
            </div>
          {/if}
          {#if statistic.id === 'Book Completion' && bookCompletionStatistics}
            <div class="grid min-w-0 gap-1 px-2 py-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
              <span class="font-medium">Completed on</span>
              <span class="min-w-0 break-words">{bookCompletionStatistics.dateKey}</span>
            </div>
          {/if}
          <button
            data-tracker-metric
            type="button"
            class="grid min-h-11 min-w-0 gap-1 rounded-xl px-2 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]"
            aria-pressed={$lastBlurredTrackerItems$.has('charactersRead')}
            aria-label={privacyMetricLabel(
              'charactersRead',
              'Characters Read',
              statistic.charactersRead
            )}
            on:click={() => handleBlurredKey('charactersRead')}
          >
            <span class="font-medium">Characters Read</span>
            <span
              data-tracker-value
              class="min-w-0 break-words"
              class:blur={$lastBlurredTrackerItems$.has('charactersRead')}
              aria-hidden={$lastBlurredTrackerItems$.has('charactersRead')}
              >{statistic.charactersRead}</span
            >
          </button>
          <button
            data-tracker-metric
            type="button"
            class="grid min-h-11 min-w-0 gap-1 rounded-xl px-2 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]"
            aria-pressed={$lastBlurredTrackerItems$.has('lastReadingSpeed')}
            aria-label={privacyMetricLabel(
              'lastReadingSpeed',
              'Reading Speed',
              `${statistic.lastReadingSpeed} per hour`
            )}
            on:click={() => handleBlurredKey('lastReadingSpeed')}
          >
            <span class="font-medium">Reading Speed</span>
            <span
              data-tracker-value
              class="min-w-0 break-words"
              class:blur={$lastBlurredTrackerItems$.has('lastReadingSpeed')}
              aria-hidden={$lastBlurredTrackerItems$.has('lastReadingSpeed')}
              >{statistic.lastReadingSpeed} / h</span
            >
          </button>
          <button
            data-tracker-metric
            type="button"
            class="grid min-h-11 min-w-0 gap-1 rounded-xl px-2 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]"
            aria-pressed={$lastBlurredTrackerItems$.has('readingTime')}
            aria-label={privacyMetricLabel(
              'readingTime',
              'Reading Time',
              toTimeString(statistic.readingTime)
            )}
            on:click={() => handleBlurredKey('readingTime')}
          >
            <span class="font-medium">Reading Time</span>
            <span
              data-tracker-value
              class="min-w-0 break-words"
              class:blur={$lastBlurredTrackerItems$.has('readingTime')}
              aria-hidden={$lastBlurredTrackerItems$.has('readingTime')}
              >{toTimeString(statistic.readingTime)}</span
            >
          </button>
          {#if statistic.id === 'Current Session'}
            <button
              data-tracker-metric
              type="button"
              class="grid min-h-11 min-w-0 gap-1 rounded-xl px-2 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]"
              aria-pressed={$lastBlurredTrackerItems$.has('finishETA')}
              aria-label={privacyMetricLabel('finishETA', 'Time to Finish Book', timeToFinishBook)}
              on:click={() => handleBlurredKey('finishETA')}
            >
              <span class="font-medium">Time to Finish Book</span>
              <span
                data-tracker-value
                class="min-w-0 break-words"
                class:blur={$lastBlurredTrackerItems$.has('finishETA')}
                aria-hidden={$lastBlurredTrackerItems$.has('finishETA')}>{timeToFinishBook}</span
              >
            </button>
            {#if timeToFinishChapter}
              <button
                data-tracker-metric
                type="button"
                class="grid min-h-11 min-w-0 gap-1 rounded-xl px-2 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]"
                aria-pressed={$lastBlurredTrackerItems$.has('finishChapterETA')}
                aria-label={privacyMetricLabel(
                  'finishChapterETA',
                  'Time to Finish Chapter',
                  timeToFinishChapter
                )}
                on:click={() => handleBlurredKey('finishChapterETA')}
              >
                <span class="font-medium">Time to Finish Chapter</span>
                <span
                  data-tracker-value
                  class="min-w-0 break-words"
                  class:blur={$lastBlurredTrackerItems$.has('finishChapterETA')}
                  aria-hidden={$lastBlurredTrackerItems$.has('finishChapterETA')}
                  >{timeToFinishChapter}</span
                >
              </button>
            {/if}
            <div class="grid min-w-0 gap-1 px-2 py-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
              <span class="font-medium">Current Position</span>
              <span>{lastExploredCharCount}</span>
            </div>
            <div class="grid min-w-0 gap-1 px-2 py-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
              <span class="font-medium">Previous Position</span>
              <span>{previousLastExploredCharCount}</span>
            </div>
            {#if frozenPosition > -1}
              <div
                class="grid min-w-0 gap-1 px-2 py-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]"
              >
                <span class="font-medium">Frozen Position</span>
                <span>{frozenPosition}</span>
              </div>
            {/if}
          {/if}
        </div>
        {#if statistic.id === 'Current Session' && trackingHistoryItems.length}
          <details class="mt-3 min-w-0">
            <summary class="flex min-h-11 cursor-pointer items-center">Recent History</summary>
            <div class="grid min-w-0 gap-2">
              {#each trackingHistoryItems as trackingHistoryItem (trackingHistoryItem.id)}
                <div
                  data-tracker-history-item
                  class="grid min-w-0 gap-2 rounded-xl border border-border p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center"
                >
                  <div class="min-w-0 break-words">{trackingHistoryItem.dateTimeKey}</div>
                  <div>
                    <span class="font-medium sm:sr-only">Time change: </span>
                    <span
                      class:text-green-500={trackingHistoryItem.timeDiff > 0}
                      class:text-red-500={trackingHistoryItem.timeDiff < 0}
                      >{trackingHistoryItem.timeDiff}</span
                    >
                  </div>
                  <div>
                    <span class="font-medium sm:sr-only">Character change: </span>
                    <span
                      class:text-green-500={trackingHistoryItem.characterDiff > 0}
                      class:text-red-500={trackingHistoryItem.characterDiff < 0}
                      >{trackingHistoryItem.characterDiff}</span
                    >
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      class="min-h-11 whitespace-nowrap"
                      aria-label="Revert history item"
                      title="Revert Item"
                      onclick={() => dispatch('revertStatistic', trackingHistoryItem)}
                    >
                      <AppIcon icon={faTrash} class="size-[18px]" /> <span>Revert</span>
                    </Button>
                    <span
                      data-tracker-save-state
                      title={trackingHistoryItem.saved
                        ? 'Item saved to database'
                        : 'Item not saved yet'}
                      class="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground"
                      class:text-green-500={trackingHistoryItem.saved}
                    >
                      <AppIcon icon={faFloppyDisk} class="size-[18px]" />
                      <span class="sm:sr-only"
                        >{trackingHistoryItem.saved ? 'Saved' : 'Not saved yet'}</span
                      >
                      <span class="sr-only"
                        >{trackingHistoryItem.saved ? ' to database' : ''}</span
                      >
                    </span>
                  </div>
                </div>
              {/each}
            </div>
            <div class="mt-3 flex items-center justify-between gap-2">
              <Button
                bind:ref={previousHistoryPage}
                variant="ghost"
                size="icon"
                shape="circle"
                class="shrink-0"
                style="inline-size:44px;block-size:44px;min-inline-size:44px;min-block-size:44px"
                aria-label="Previous history page"
                title="Previous Page"
                disabled={currentTrackingHistoryIndex === 0}
                onclick={() => void pageHistory(-1)}
              >
                <AppIcon icon={faChevronLeft} />
              </Button>
              <span
                class="min-w-0 flex-1 whitespace-nowrap text-center text-sm text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                Page {trackingHistoryIndex + 1} of {historyPageCount}
              </span>
              <Button
                bind:ref={nextHistoryPage}
                variant="ghost"
                size="icon"
                shape="circle"
                class="shrink-0"
                style="inline-size:44px;block-size:44px;min-inline-size:44px;min-block-size:44px"
                aria-label="Next history page"
                title="Next Page"
                disabled={!hasNextPage}
                onclick={() => void pageHistory(1)}
              >
                <AppIcon icon={faChevronRight} />
              </Button>
            </div>
          </details>
        {/if}
      </div>
    {/each}
  </div>
  {#if actionInProgress}
    <div aria-hidden="true" class="tap-highlight-transparent absolute inset-0 bg-black/[.2]"></div>
    <div
      role="status"
      aria-label="Updating reading tracker"
      class="pointer-events-none absolute inset-0 flex h-full w-full items-center justify-center text-7xl"
    >
      <AppIcon icon={faSpinner} spin />
      <span class="sr-only">Updating reading tracker…</span>
    </div>
  {/if}
</div>

