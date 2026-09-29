<script lang="ts">
  import faSpinner from '@lucide/svelte/icons/loader-circle';
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import type { BooksDbReadingGoal } from '$lib/data/database/books-db/versions/books-db';
  import {
    getDateRangeLabel,
    getReadingGoalWindow,
    type ReadingGoal,
    type ReadingGoalArchivalOption,
    type ReadingGoalSaveResult
  } from '$lib/data/reading-goal';
  import { database, readingGoal$, startDayHoursForTracker$ } from '$lib/data/store';
  import {
    advanceDateDays,
    getDate,
    getDateKey,
    getPreviousDayKey,
    secondsToMinutes
  } from '$lib/functions/statistic-util';
  import { pluralize } from '$lib/functions/utils';
  import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
  import AppIcon from '$lib/components/app-icon.svelte';

  export let newReadingGoal: ReadingGoal;
  export let resolver: (arg0: ReadingGoalSaveResult) => void;

  const dispatch = createEventDispatcher<{
    close: void;
  }>();

  let showSpinner = true;
  let newStartDate = newReadingGoal.goalStartDate;
  let archiveReadingGoal = false;
  let archiveDateEditable = false;
  let archivalOptions: ReadingGoalArchivalOption[] = [];
  let selectedArchiveOption = '';
  let archivalMaxDate: string;
  let archivalStartDate = '';
  let archivalEndDate = '';
  let archivalOriginalEndDate = '';
  let error = '';
  let existingReadingGoals: BooksDbReadingGoal[] = [];
  let readingGoalsToReplace: BooksDbReadingGoal[] = [];
  let settled = false;
  let active = true;

  const cancelledResult = (): ReadingGoalSaveResult => ({
    readingGoalsToDelete: [],
    readingGoalsToInsert: [],
    error: ''
  });

  onDestroy(() => {
    active = false;
    if (settled) return;
    settled = true;
    resolver(cancelledResult());
  });

  $: selectedArchiveOptionObject = archivalOptions.find(
    (opt) => opt.label === selectedArchiveOption
  );

  $: readingGoalsToReplace = existingReadingGoals.filter(
    (readingGoal) => readingGoal.goalStartDate !== $readingGoal$.goalStartDate
  );

  $: readingGoalToReplaceMessage = readingGoalsToReplace.length
    ? `${pluralize(readingGoalsToReplace.length, 'Item')} will be replaced`
    : '';

  $: if (selectedArchiveOptionObject) {
    ({ archivalStartDate, archivalEndDate } = selectedArchiveOptionObject);
    archiveDateEditable = selectedArchiveOptionObject.editable;
    updateNextReadingGoalStartDate();
  }

  $: if (newReadingGoal.goalStartDate) {
    if (!archiveReadingGoal) {
      newStartDate = newReadingGoal.goalStartDate;
      archivalStartDate = $readingGoal$.goalStartDate;
    } else {
      updateNextReadingGoalStartDate();
    }
  }

  onMount(init);

  async function checkDates() {
    try {
      showSpinner = true;

      if (!archivalStartDate || !archivalEndDate) {
        archivalStartDate = $readingGoal$.goalStartDate;
        archivalEndDate = archivalMaxDate;
      } else if (archivalEndDate < archivalStartDate) {
        const oldStartDate = archivalStartDate;
        const oldEndStartDate = archivalEndDate;

        archivalStartDate = oldEndStartDate;
        archivalEndDate = oldStartDate;
      }

      await updateExistingReadingGoals();
      if (!active) return;
      showSpinner = false;
    } catch ({ message }: any) {
      if (!active) return;
      error = `Failed to refresh Reading Goals (${message})`;
      void closeDialog();
    }
  }

  async function closeDialog(wasCanceled = false) {
    if (settled || !active) return;
    const exitEarly = wasCanceled || error;

    const resultObject: ReadingGoalSaveResult = {
      ...cancelledResult(),
      error
    };

    if (!exitEarly) await tick();
    if (settled || !active) return;

    if (exitEarly) {
      settled = true;
      resolver(resultObject);
      dispatch('close');
      return;
    }

    const goalsToDelete: string[] = [];
    const addGoalToDelete = (date: string) => {
      if (!goalsToDelete.includes(date)) goalsToDelete.push(date);
    };

    readingGoalsToReplace.forEach((goal) => addGoalToDelete(goal.goalStartDate));

    if ($readingGoal$.goalStartDate) {
      addGoalToDelete($readingGoal$.goalStartDate);
    }

    if (archiveReadingGoal) {
      resultObject.readingGoalsToInsert.push({
        ...$readingGoal$,
        ...{
          goalStartDate: archivalStartDate,
          goalEndDate: archivalEndDate,
          goalOriginalEndDate: archivalOriginalEndDate
        }
      });
    }

    resultObject.readingGoalsToDelete = goalsToDelete;
    resultObject.readingGoalsToInsert = [
      ...resultObject.readingGoalsToInsert,
      ...(newReadingGoal.goalStartDate
        ? [
            {
              ...newReadingGoal,
              ...{ goalStartDate: newStartDate, goalEndDate: '', goalOriginalEndDate: '' }
            }
          ]
        : [])
    ];

    settled = true;
    resolver(resultObject);
    dispatch('close');
  }

  function updateNextReadingGoalStartDate() {
    if (!newReadingGoal.goalStartDate) {
      return;
    }

    if (!archiveReadingGoal || newReadingGoal.goalStartDate > archivalEndDate) {
      newStartDate = newReadingGoal.goalStartDate;
    } else {
      ({ dateString: newStartDate } = advanceDateDays(
        getDate(archivalEndDate, $startDayHoursForTracker$)
      ));
    }
  }

  async function init() {
    try {
      const todayKey = getDateKey($startDayHoursForTracker$);

      if ($readingGoal$.goalStartDate && todayKey >= $readingGoal$.goalStartDate) {
        const yesterDayKey = getPreviousDayKey($startDayHoursForTracker$);
        const [readingGoalStart, readingGoalEnd] = getReadingGoalWindow(
          todayKey,
          $startDayHoursForTracker$,
          $readingGoal$
        );
        const previousReadingGoalEnd = getPreviousDayKey(
          $startDayHoursForTracker$,
          getDate(readingGoalStart, $startDayHoursForTracker$)
        );

        archivalMaxDate = readingGoalEnd;

        archivalOptions.push({
          label: 'Custom',
          archivalStartDate: $readingGoal$.goalStartDate,
          archivalEndDate: readingGoalEnd,
          editable: true
        });

        if (
          previousReadingGoalEnd > $readingGoal$.goalStartDate &&
          yesterDayKey !== previousReadingGoalEnd &&
          todayKey !== previousReadingGoalEnd
        ) {
          archivalOptions.push({
            label: 'Close previous nearest End',
            archivalStartDate: $readingGoal$.goalStartDate,
            archivalEndDate: previousReadingGoalEnd,
            editable: false
          });
        }

        if (yesterDayKey >= $readingGoal$.goalStartDate) {
          archivalOptions.push({
            label: 'Close Yesterday',
            archivalStartDate: $readingGoal$.goalStartDate,
            archivalEndDate: yesterDayKey,
            editable: false
          });
        }

        if (todayKey >= $readingGoal$.goalStartDate) {
          archivalOptions.push({
            label: 'Close Today',
            archivalStartDate: $readingGoal$.goalStartDate,
            archivalEndDate: todayKey,
            editable: false
          });
        }

        if (readingGoalEnd !== todayKey) {
          archivalOptions.push({
            label: 'Close nearest End',
            archivalStartDate: $readingGoal$.goalStartDate,
            archivalEndDate: readingGoalEnd,
            editable: false
          });
        }

        archiveReadingGoal = true;
        selectedArchiveOption = archivalOptions[0].label;
        archivalOptions = [...archivalOptions];
        archivalOriginalEndDate = readingGoalEnd;
      }

      await updateExistingReadingGoals();
      if (!active) return;
      showSpinner = false;
    } catch ({ message }: any) {
      if (!active) return;
      error = `Failed to set Context (${message})`;
      void closeDialog();
    }
  }

  async function updateExistingReadingGoals() {
    updateNextReadingGoalStartDate();

    await tick();
    if (!active) return;

    let nextGoals: BooksDbReadingGoal[] = [];
    if (archiveReadingGoal) {
      nextGoals = await database.getReadingGoalsForDateWindow(
        archivalStartDate,
        newStartDate,
        archivalEndDate
      );
    } else if (newReadingGoal.goalStartDate) {
      nextGoals = await database.getReadingGoalsForDateWindow(
        newReadingGoal.goalStartDate,
        newStartDate
      );
    }
    if (active) existingReadingGoals = nextGoals;
  }
</script>

<div class="relative min-w-0" aria-busy={showSpinner}>
  {#if showSpinner}
    <div
      aria-hidden="true"
      class="tap-highlight-transparent absolute inset-0 z-10 rounded-3xl bg-black/[.2]"
    ></div>
    <div
      role="status"
      aria-label="Preparing reading goal"
      class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center text-5xl"
    >
      <AppIcon icon={faSpinner} spin />
      <span class="sr-only">Preparing reading goal…</span>
    </div>
  {/if}
  <DialogTemplate>
    <svelte:fragment slot="header">Save Reading Goal</svelte:fragment>
    <svelte:fragment slot="content">
      <fieldset class="grid min-w-0 gap-4 border-0 p-0" disabled={showSpinner}>
        {#if newReadingGoal.goalStartDate}
          <label class="grid min-w-0 gap-2 text-sm font-medium">
            <span>New reading goal starts from</span>
            <Input
              disabled
              type="date"
              min={newReadingGoal.goalStartDate}
              bind:value={newStartDate}
            />
          </label>
        {/if}

        {#if archivalOptions.length}
          <label class="flex min-h-11 items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              class="size-5 shrink-0 accent-primary"
              bind:checked={archiveReadingGoal}
              on:change={checkDates}
            />
            <span>Archive current reading goal</span>
          </label>

          <div class="grid gap-3" class:opacity-50={!archiveReadingGoal}>
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="grid min-w-0 gap-2 text-sm font-medium">
                <span>Archive from</span>
                <Input
                  type="date"
                  disabled={!archiveReadingGoal || !archiveDateEditable}
                  bind:value={archivalStartDate}
                  onchange={checkDates}
                />
              </label>
              <label class="grid min-w-0 gap-2 text-sm font-medium">
                <span>Archive through</span>
                <Input
                  type="date"
                  disabled={!archiveReadingGoal || !archiveDateEditable}
                  bind:value={archivalEndDate}
                  onchange={checkDates}
                />
              </label>
            </div>

            <fieldset class="grid gap-2" disabled={!archiveReadingGoal}>
              <legend class="text-sm font-medium">Archive boundary</legend>
              <div class="grid gap-1">
                {#each archivalOptions as archivalOption (archivalOption.label)}
                  <label class="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="action"
                      class="size-5 shrink-0 accent-primary"
                      value={archivalOption.label}
                      bind:group={selectedArchiveOption}
                      on:change={checkDates}
                    />
                    <span>{archivalOption.label}</span>
                  </label>
                {/each}
              </div>
            </fieldset>
          </div>
        {/if}

        {#if readingGoalToReplaceMessage}
          <details
            class="max-h-[10rem] cursor-pointer overflow-auto rounded-xl border border-border p-3"
          >
            <summary>{readingGoalToReplaceMessage}</summary>
            {#each readingGoalsToReplace as goalToReplace (goalToReplace.goalStartDate)}
              <div class="my-2 break-words text-sm">
                {getDateRangeLabel(goalToReplace.goalStartDate, goalToReplace.goalEndDate)} / {secondsToMinutes(
                  goalToReplace.timeGoal
                )} min / {goalToReplace.characterGoal}
                characters / {goalToReplace.goalFrequency}
              </div>
            {/each}
          </details>
        {/if}
      </fieldset>
    </svelte:fragment>
    <div class="flex grow flex-wrap justify-between gap-2" slot="footer">
      <Button variant="ghost" disabled={showSpinner} onclick={() => closeDialog(true)}
        >Cancel</Button
      >
      <Button variant="default" disabled={showSpinner} onclick={() => closeDialog()}>Confirm</Button
      >
    </div>
  </DialogTemplate>
</div>
