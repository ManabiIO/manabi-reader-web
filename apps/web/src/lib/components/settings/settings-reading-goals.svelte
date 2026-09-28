<script lang="ts">
  import faCancel from '@lucide/svelte/icons/x';
  import faChevronLeft from '@lucide/svelte/icons/chevron-left';
  import faChevronRight from '@lucide/svelte/icons/chevron-right';
  import faEdit from '@lucide/svelte/icons/pencil';
  import faRotate from '@lucide/svelte/icons/refresh-cw';
  import faSave from '@lucide/svelte/icons/save';
  import faTrash from '@lucide/svelte/icons/trash-2';
  import { ReadingGoalFrequency } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
  import ConfirmDialog from '$lib/components/confirm-dialog.svelte';
  import MessageDialog from '$lib/components/message-dialog.svelte';
  import SettingsReadingGoalsMerge from '$lib/components/settings/settings-reading-goals-merge.svelte';
  import SettingsSyncDialog from '$lib/components/settings/settings-sync-dialog.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import type {
    BooksDbReadingGoal,
    BooksDbStorageSource
  } from '$lib/data/database/books-db/versions/books-db';
  import { dialogManager, type SyncSelection } from '$lib/data/dialog-manager';
  import {
    getCurrentReadingGoal,
    getDateRangeLabel,
    type ReadingGoal,
    type ReadingGoalSaveResult
  } from '$lib/data/reading-goal';
  import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
  import { StorageDataType, StorageKey } from '$lib/data/storage/storage-types';
  import {
    cacheStorageData$,
    database,
    isOnline$,
    readingGoal$,
    readingGoalsMergeMode$,
    replicationSaveBehavior$,
    startDayHoursForTracker$,
    statisticsMergeMode$
  } from '$lib/data/store';
  import { replicateData } from '$lib/functions/replication/replicator';
  import { isOnlineSourceAvailable, pluralize } from '$lib/functions/utils';
  import { getDateKey, secondsToMinutes } from '$lib/functions/statistic-util';
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import AppIcon from '$lib/components/app-icon.svelte';

  export let storageSources: BooksDbStorageSource[] = [];

  const dispatch = createEventDispatcher<{
    spinner: boolean;
  }>();

  const readingGoalFrequencies = [
    {
      id: ReadingGoalFrequency.DAILY,
      label: 'Daily (1 Day)'
    },
    {
      id: ReadingGoalFrequency.WEEKLY,
      label: 'Weekly (7 Days)'
    },
    { id: ReadingGoalFrequency.MONTHLY, label: 'Monthly (30 Days)' }
  ];

  let currentTimeGoal = 0;
  let currentCharacterGoal = 0;
  let currentReadingGoalFrequency = ReadingGoalFrequency.DAILY;
  let currentReadingGoalStartDate = '';
  let isInEditMode = false;
  let readingGoals: BooksDbReadingGoal[] = [];
  let sortedReadingGoals: BooksDbReadingGoal[] = [];
  let historyIndex = 0;
  const itemsPerPage = 1;

  $: availableSources = storageSources.filter((source) =>
    isOnlineSourceAvailable($isOnline$, source.type)
  );

  $: saveDisabled = !!((currentTimeGoal || currentCharacterGoal) && !currentReadingGoalStartDate);

  $: currentTimeGoalInMin = secondsToMinutes(currentTimeGoal);

  $: currentHistoryIndex = Math.max(0, historyIndex * itemsPerPage);

  $: historyReadingGoals = sortedReadingGoals.slice(
    currentHistoryIndex,
    currentHistoryIndex + itemsPerPage
  );

  $: hasNextHistoryPage = sortedReadingGoals.length > currentHistoryIndex + itemsPerPage;

  $: if ($readingGoal$) {
    ({
      timeGoal: currentTimeGoal,
      characterGoal: currentCharacterGoal,
      goalFrequency: currentReadingGoalFrequency,
      goalStartDate: currentReadingGoalStartDate
    } = $readingGoal$);
  }

  onMount(init);

  function handleReadingGoalChange(event: Event, isTimeGoal: boolean) {
    const { value } = event.target as HTMLInputElement;

    const mod = isTimeGoal ? 60 : 1;
    const val = Math.floor((Number.parseFloat(value) || 0) * mod);

    if (isTimeGoal) {
      currentTimeGoal = val < 0 ? 0 : val;
    } else {
      currentCharacterGoal = val < 0 ? 0 : val;
    }
  }

  async function saveReadingGoal() {
    if (!currentTimeGoal && !currentCharacterGoal) {
      currentReadingGoalStartDate = '';
      currentReadingGoalFrequency = ReadingGoalFrequency.DAILY;
    }

    if (
      currentTimeGoal === $readingGoal$.timeGoal &&
      currentCharacterGoal === $readingGoal$.characterGoal &&
      currentReadingGoalFrequency === $readingGoal$.goalFrequency &&
      currentReadingGoalStartDate === $readingGoal$.goalStartDate
    ) {
      isInEditMode = false;
      return;
    }

    try {
      const todayKey = getDateKey($startDayHoursForTracker$);
      const initialExistingReadingGoals = await database.getReadingGoalsForDateWindow(
        currentReadingGoalStartDate < $readingGoal$.goalStartDate
          ? currentReadingGoalStartDate || $readingGoal$.goalStartDate
          : $readingGoal$.goalStartDate || currentReadingGoalStartDate
      );
      const existingReadingGoals = currentReadingGoalStartDate
        ? initialExistingReadingGoals.filter(
            (item) => item.goalStartDate !== $readingGoal$.goalStartDate
          )
        : [];
      const isFutureWithoutReadingGoalConflicts =
        $readingGoal$.goalStartDate &&
        todayKey < $readingGoal$.goalStartDate &&
        !existingReadingGoals.length;

      const newReadingGoal = {
        timeGoal: currentTimeGoal,
        characterGoal: currentCharacterGoal,
        goalFrequency: currentReadingGoalFrequency,
        goalStartDate: currentReadingGoalStartDate,
        lastGoalModified: Date.now()
      };
      let readingGoalsToDelete: string[] = [];
      let readingGoalsToInsert: BooksDbReadingGoal[] = [];
      let error = '';

      if (isFutureWithoutReadingGoalConflicts && currentReadingGoalStartDate) {
        readingGoalsToDelete.push($readingGoal$.goalStartDate);
        readingGoalsToInsert.push({ ...newReadingGoal, goalEndDate: '', goalOriginalEndDate: '' });
      } else if (isFutureWithoutReadingGoalConflicts) {
        readingGoalsToDelete.push($readingGoal$.goalStartDate);
      } else if (initialExistingReadingGoals.length) {
        ({ readingGoalsToDelete, readingGoalsToInsert, error } =
          await new Promise<ReadingGoalSaveResult>((resolver) => {
            dialogManager.dialogs$.next([
              {
                component: SettingsReadingGoalsMerge,
                props: { newReadingGoal, resolver },
                disableCloseOnClick: true
              }
            ]);
          }));
      } else {
        readingGoalsToInsert.push({ ...newReadingGoal, goalEndDate: '', goalOriginalEndDate: '' });
      }

      if (error) {
        throw new Error(error);
      }

      dispatch('spinner', true);

      await database.updateReadingGoals(readingGoalsToDelete, readingGoalsToInsert);
    } catch (error: any) {
      tick().then(() =>
        dialogManager.dialogs$.next([
          {
            component: MessageDialog,
            props: {
              title: 'Error',
              message: `Error updating Reading Goal(s): ${error.message}`
            }
          }
        ])
      );
    } finally {
      dispatch('spinner', false);
      isInEditMode = false;
      await updateReadingGoalsData().catch(() => {
        // no-op
      });
    }
  }

  async function syncReadingGoals() {
    const [source, target] = await new Promise<SyncSelection[]>((resolver) => {
      dialogManager.dialogs$.next([
        {
          component: SettingsSyncDialog,
          props: {
            settingsSyncHeader: 'Sync Reading Goals',
            storageSources: availableSources,
            resolver
          },
          disableCloseOnClick: true
        }
      ]);
    });

    if (!source || !target) {
      return;
    }

    dispatch('spinner', true);

    try {
      const error = await replicateData(
        getStorageHandler(
          window,
          source.type,
          source.id,
          target.type === StorageKey.BROWSER,
          $cacheStorageData$,
          $replicationSaveBehavior$,
          $statisticsMergeMode$,
          $readingGoalsMergeMode$
        ),
        getStorageHandler(
          window,
          target.type,
          target.id,
          target.type === StorageKey.BROWSER,
          $cacheStorageData$,
          $replicationSaveBehavior$,
          $statisticsMergeMode$,
          $readingGoalsMergeMode$
        ),
        false,
        [],
        [StorageDataType.READING_GOALS]
      );

      if (error) {
        throw new Error(error);
      }

      await updateReadingGoalsData();
    } catch ({ message }: any) {
      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: {
            title: 'Error',
            message: `Error syncing Reading Goals: ${message}`
          }
        }
      ]);
    } finally {
      dispatch('spinner', false);
    }
  }

  async function deleteReadingGoals(readingGoalToDelete?: ReadingGoal, dateRangeLabel?: string) {
    let dialogMessage = '';

    if (readingGoalToDelete) {
      const isCurrentReadingGoal =
        $readingGoal$.goalStartDate &&
        $readingGoal$.goalStartDate === readingGoalToDelete.goalStartDate;
      const term =
        getDateKey($startDayHoursForTracker$) >= readingGoalToDelete.goalStartDate
          ? 'started'
          : 'starting';
      dialogMessage = `The${
        isCurrentReadingGoal ? ` current Reading Goal ${term} on` : ' archived Reading Goal for '
      } ${dateRangeLabel} will be deleted${isCurrentReadingGoal ? ' without archiving' : ''}`;
    } else if (readingGoals.length > 1) {
      dialogMessage = `All archived Reading Goals will be deleted${
        $readingGoal$.goalStartDate ? ' (including the current One)' : ''
      }`;
    } else {
      dialogMessage = $readingGoal$.goalStartDate
        ? 'Your current Reading Goal will be deleted without archiving'
        : 'Your archived Reading Goal will be deleted';
    }

    dialogMessage +=
      '\n\nExecute an one time Sync with an export behavior of "overwrite" and/or reading goals merge mode of "replace" to apply deletions to other devices';

    const wasCanceled = await new Promise((resolver) => {
      dialogManager.dialogs$.next([
        {
          component: ConfirmDialog,
          props: {
            dialogHeader: 'Data Deletion',
            dialogMessage,
            contentStyles: 'white-space: pre-line;',
            resolver
          },
          disableCloseOnClick: true
        }
      ]);
    });

    if (wasCanceled) {
      return;
    }

    dispatch('spinner', true);

    try {
      await database.deleteReadingGoal(readingGoalToDelete?.goalStartDate);
      await updateReadingGoalsData();
    } catch ({ message }: any) {
      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: {
            title: 'Error',
            message: `An Error occurred: ${message}`
          }
        }
      ]);
    } finally {
      dispatch('spinner', false);
    }
  }

  async function init() {
    try {
      dispatch('spinner', true);
      await updateReadingGoalsData();
    } catch (error: any) {
      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: {
            title: 'Error',
            message: `Error loading Reading Goals: ${error.message}`
          }
        }
      ]);
    } finally {
      dispatch('spinner', false);
    }
  }

  async function updateReadingGoalsData() {
    readingGoals = await database.getReadingGoals();

    sortedReadingGoals = [...readingGoals];
    sortedReadingGoals.sort((a, b) => (a.goalStartDate > b.goalStartDate ? -1 : 1));
    historyIndex = 0;

    $readingGoal$ = await getCurrentReadingGoal(readingGoals);
  }
</script>

<div class="mb-8 min-w-0 sm:col-span-2 lg:col-span-3">
  <div class="flex flex-wrap items-center justify-end gap-2">
    {#if isInEditMode}
      <Button variant="default" disabled={saveDisabled} onclick={saveReadingGoal}>
        <span>Save</span>
        <AppIcon icon={faSave} />
      </Button>
      <Button
        variant="ghost"
        onclick={() => {
          ({
            timeGoal: currentTimeGoal,
            characterGoal: currentCharacterGoal,
            goalFrequency: currentReadingGoalFrequency,
            goalStartDate: currentReadingGoalStartDate
          } = $readingGoal$);

          isInEditMode = false;
        }}
      >
        <span>Cancel</span>
        <AppIcon icon={faCancel} />
      </Button>
    {:else}
      <Button variant="outline" onclick={syncReadingGoals}>
        <span>Sync</span>
        <AppIcon icon={faRotate} />
      </Button>
      <Button variant="secondary" onclick={() => (isInEditMode = true)}>
        <span>Edit</span>
        <AppIcon icon={faEdit} />
      </Button>
      <Button
        variant="destructive"
        disabled={!readingGoals.length}
        title="Delete all Reading Goals"
        onclick={() => deleteReadingGoals()}
      >
        <span>Reset</span>
        <AppIcon icon={faTrash} />
      </Button>
    {/if}
  </div>
  <div class="mt-4 grid grid-cols-1 items-end justify-between gap-4 md:grid-cols-4">
    <label class="grid min-w-0 gap-2 text-sm font-medium">
      <span>Time goal (minutes)</span>
      <Input
        type="number"
        min="0"
        disabled={!isInEditMode}
        bind:value={currentTimeGoalInMin}
        onblur={(event) => handleReadingGoalChange(event, true)}
      />
    </label>
    <label class="grid min-w-0 gap-2 text-sm font-medium">
      <span>Character goal</span>
      <Input
        type="number"
        min="0"
        disabled={!isInEditMode}
        bind:value={currentCharacterGoal}
        onblur={(event) => handleReadingGoalChange(event, false)}
      />
    </label>
    <label class="grid min-w-0 gap-2 text-sm font-medium">
      <span>Frequency</span>
      <select
        class="min-h-11 min-w-0 rounded-[10px] border border-input bg-background px-3 py-2 text-base text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
        disabled={!isInEditMode}
        bind:value={currentReadingGoalFrequency}
      >
        {#each readingGoalFrequencies as readingGoalFrequency (readingGoalFrequency.id)}
          <option value={readingGoalFrequency.id}>
            {readingGoalFrequency.label}
          </option>
        {/each}
      </select>
    </label>
    <label class="grid min-w-0 gap-2 text-sm font-medium">
      <span>Start date</span>
      <Input
        type="date"
        disabled={!isInEditMode}
        bind:value={currentReadingGoalStartDate}
      />
    </label>
  </div>
  <details class="mt-6 cursor-pointer">
    <summary>Reading Goal History ({pluralize(readingGoals.length, 'Item')})</summary>
    {#if readingGoals.length}
      <div class="grid-cols-[repeat(4,minmax(0,1fr))_auto] hidden items-center gap-2 sm:grid">
        {#each historyReadingGoals as historyGoal (historyGoal.goalStartDate)}
          {@const dateRangeLabel = getDateRangeLabel(
            historyGoal.goalStartDate,
            historyGoal.goalEndDate
          )}
          <div class="min-w-0 break-words">{dateRangeLabel}</div>
          <div>{secondsToMinutes(historyGoal.timeGoal)} min</div>
          <div>{historyGoal.characterGoal} characters</div>
          <div>{historyGoal.goalFrequency}</div>
          <Button
            variant="destructive"
            size="sm"
            title="Delete Reading Goal"
            onclick={() => deleteReadingGoals(historyGoal, dateRangeLabel)}
          >
            <AppIcon icon={faTrash} />
            <span>Delete Reading Goal</span>
          </Button>
        {/each}
      </div>
      <div class="sm:hidden">
        {#each historyReadingGoals as historyGoal (historyGoal.goalStartDate)}
          {@const dateRangeLabel = getDateRangeLabel(
            historyGoal.goalStartDate,
            historyGoal.goalEndDate
          )}
          <div class="my-3 grid gap-2 rounded-xl border border-border p-3">
            <div>
              {dateRangeLabel} / {secondsToMinutes(historyGoal.timeGoal)} min / {historyGoal.characterGoal}
              characters / {historyGoal.goalFrequency}
            </div>
            <Button
              variant="destructive"
              size="sm"
              class="justify-self-start"
              title="Delete Reading Goal"
              onclick={() => deleteReadingGoals(historyGoal, dateRangeLabel)}
            >
              <AppIcon icon={faTrash} />
              <span>Delete Reading Goal</span>
            </Button>
          </div>
        {/each}
      </div>
      <div class="mt-3 flex justify-between gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          shape="circle"
          aria-label="Previous reading goal"
          title="Previous Page"
          disabled={currentHistoryIndex === 0}
          onclick={() => (historyIndex -= 1)}
        >
          <AppIcon icon={faChevronLeft} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          shape="circle"
          aria-label="Next reading goal"
          title="Next Page"
          disabled={!hasNextHistoryPage}
          onclick={() => (historyIndex += 1)}
        >
          <AppIcon icon={faChevronRight} />
        </Button>
      </div>
    {:else}
      <div class="mt-3 text-sm text-muted-foreground">You have no archived Reading Goals yet</div>
    {/if}
  </details>
</div>
