/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import { ReadingGoalFrequency } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
import type { BooksDbReadingGoal, BooksDbStorageSource } from '$lib/data/database/books-db/versions/books-db';
import { dialogManager, type SyncSelection } from '$lib/data/dialog-manager';
import { getCurrentReadingGoal, getDateRangeLabel, type ReadingGoal, type ReadingGoalSaveResult } from '$lib/data/reading-goal';
import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
import { StorageDataType, StorageKey } from '$lib/data/storage/storage-types';
import { cacheStorageData$, database, isOnline$, readingGoal$, readingGoalsMergeMode$, replicationSaveBehavior$, startDayHoursForTracker$, statisticsMergeMode$ } from '$lib/data/store';
import { replicateData } from '$lib/functions/replication/replicator';
import { isOnlineSourceAvailable, pluralize } from '$lib/functions/utils';
import { getDateKey, secondsToMinutes } from '$lib/functions/statistic-util';
import { ReaderController, readerTick, writeStore, type StoreValue } from '../reader-react/controller';
import { type SettingsContextValue } from './context';
import { ConfirmDialog, MessageDialog } from '../ui/dialogs';
import { SettingsReadingGoalsMerge } from './settings-reading-goals-merge';
import { SettingsSyncDialog } from './settings-sync-dialog';
const faCancel = 'faCancel';
const faChevronLeft = 'faChevronLeft';
const faChevronRight = 'faChevronRight';
const faEdit = 'faEdit';
const faRotate = 'faRotate';
const faSave = 'faSave';
const faTrash = 'faTrash';
const Button = 'Button';
const Input = 'Input';
const AppIcon = 'AppIcon';
export interface SettingsReadingGoalsProps {
storageSources?: BooksDbStorageSource[];
}

export function createSettingsReadingGoals(props: SettingsReadingGoalsProps, emit: (name: string, detail?: unknown) => void = () => {}, componentContext: SettingsContextValue) {
const __readerController = new ReaderController();
let availableSources: any;
let saveDisabled: any;
let currentTimeGoalInMin: any;
let currentHistoryIndex: any;
let historyReadingGoals: any;
let hasNextHistoryPage: any;
let $isOnline$: StoreValue<typeof isOnline$> = __readerController.read(isOnline$);
let $readingGoal$: StoreValue<typeof readingGoal$> = __readerController.read(readingGoal$);
let $startDayHoursForTracker$: StoreValue<typeof startDayHoursForTracker$> = __readerController.read(startDayHoursForTracker$);
let $cacheStorageData$: StoreValue<typeof cacheStorageData$> = __readerController.read(cacheStorageData$);
let $replicationSaveBehavior$: StoreValue<typeof replicationSaveBehavior$> = __readerController.read(replicationSaveBehavior$);
let $statisticsMergeMode$: StoreValue<typeof statisticsMergeMode$> = __readerController.read(statisticsMergeMode$);
let $readingGoalsMergeMode$: StoreValue<typeof readingGoalsMergeMode$> = __readerController.read(readingGoalsMergeMode$);
let storageSources: BooksDbStorageSource[] = props.storageSources !== undefined ? props.storageSources : [];
const dispatch = (name: string, detail?: unknown) => emit(name, detail);
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
__readerController.effect(() => [storageSources, $isOnline$], () => { __readerController.changed(availableSources = storageSources.filter((source) => isOnlineSourceAvailable($isOnline$, source.type))); });
__readerController.effect(() => [currentTimeGoal, currentCharacterGoal, currentReadingGoalStartDate], () => { __readerController.changed(saveDisabled = !!((currentTimeGoal || currentCharacterGoal) && !currentReadingGoalStartDate)); });
__readerController.effect(() => [currentTimeGoal], () => { __readerController.changed(currentTimeGoalInMin = secondsToMinutes(currentTimeGoal)); });
__readerController.effect(() => [historyIndex, itemsPerPage], () => { __readerController.changed(currentHistoryIndex = Math.max(0, historyIndex * itemsPerPage)); });
__readerController.effect(() => [sortedReadingGoals, currentHistoryIndex, itemsPerPage], () => { __readerController.changed(historyReadingGoals = sortedReadingGoals.slice(currentHistoryIndex, currentHistoryIndex + itemsPerPage)); });
__readerController.effect(() => [sortedReadingGoals, currentHistoryIndex, itemsPerPage], () => { __readerController.changed(hasNextHistoryPage = sortedReadingGoals.length > currentHistoryIndex + itemsPerPage); });
__readerController.effect(() => [$readingGoal$], () => { if ($readingGoal$) {
    ({
        timeGoal: currentTimeGoal,
        characterGoal: currentCharacterGoal,
        goalFrequency: currentReadingGoalFrequency,
        goalStartDate: currentReadingGoalStartDate
    } = $readingGoal$);
} });
__readerController.onMount(init);
function handleReadingGoalChange(event: Event, isTimeGoal: boolean) {
    const { value } = event.target as HTMLInputElement;
    const mod = isTimeGoal ? 60 : 1;
    const val = Math.floor((Number.parseFloat(value) || 0) * mod);
    if (isTimeGoal) {
        __readerController.changed(currentTimeGoal = val < 0 ? 0 : val);
    }
    else {
        __readerController.changed(currentCharacterGoal = val < 0 ? 0 : val);
    }
}
async function saveReadingGoal() {
    if (!currentTimeGoal && !currentCharacterGoal) {
        __readerController.changed(currentReadingGoalStartDate = '');
        __readerController.changed(currentReadingGoalFrequency = ReadingGoalFrequency.DAILY);
    }
    if (currentTimeGoal === $readingGoal$.timeGoal &&
        currentCharacterGoal === $readingGoal$.characterGoal &&
        currentReadingGoalFrequency === $readingGoal$.goalFrequency &&
        currentReadingGoalStartDate === $readingGoal$.goalStartDate) {
        __readerController.changed(isInEditMode = false);
        return;
    }
    try {
        const todayKey = getDateKey($startDayHoursForTracker$);
        const initialExistingReadingGoals = await database.getReadingGoalsForDateWindow(currentReadingGoalStartDate < $readingGoal$.goalStartDate
            ? currentReadingGoalStartDate || $readingGoal$.goalStartDate
            : $readingGoal$.goalStartDate || currentReadingGoalStartDate);
        const existingReadingGoals = currentReadingGoalStartDate
            ? initialExistingReadingGoals.filter((item) => item.goalStartDate !== $readingGoal$.goalStartDate)
            : [];
        const isFutureWithoutReadingGoalConflicts = $readingGoal$.goalStartDate &&
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
        }
        else if (isFutureWithoutReadingGoalConflicts) {
            readingGoalsToDelete.push($readingGoal$.goalStartDate);
        }
        else if (initialExistingReadingGoals.length) {
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
        }
        else {
            readingGoalsToInsert.push({ ...newReadingGoal, goalEndDate: '', goalOriginalEndDate: '' });
        }
        if (error) {
            throw new Error(error);
        }
        dispatch('spinner', true);
        await database.updateReadingGoals(readingGoalsToDelete, readingGoalsToInsert);
    }
    catch (error: any) {
        readerTick().then(() => dialogManager.dialogs$.next([
            {
                component: MessageDialog,
                props: {
                    title: 'Error',
                    message: `Error updating Reading Goal(s): ${error.message}`
                }
            }
        ]));
    }
    finally {
        dispatch('spinner', false);
        __readerController.changed(isInEditMode = false);
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
        const error = await replicateData(getStorageHandler(window, source.type, source.id, target.type === StorageKey.BROWSER, $cacheStorageData$, $replicationSaveBehavior$, $statisticsMergeMode$, $readingGoalsMergeMode$), getStorageHandler(window, target.type, target.id, target.type === StorageKey.BROWSER, $cacheStorageData$, $replicationSaveBehavior$, $statisticsMergeMode$, $readingGoalsMergeMode$), false, [], [StorageDataType.READING_GOALS]);
        if (error) {
            throw new Error(error);
        }
        await updateReadingGoalsData();
    }
    catch ({ message }: any) {
        dialogManager.dialogs$.next([
            {
                component: MessageDialog,
                props: {
                    title: 'Error',
                    message: `Error syncing Reading Goals: ${message}`
                }
            }
        ]);
    }
    finally {
        dispatch('spinner', false);
    }
}
async function deleteReadingGoals(readingGoalToDelete?: ReadingGoal, dateRangeLabel?: string) {
    let dialogMessage = '';
    if (readingGoalToDelete) {
        const isCurrentReadingGoal = $readingGoal$.goalStartDate &&
            $readingGoal$.goalStartDate === readingGoalToDelete.goalStartDate;
        const term = getDateKey($startDayHoursForTracker$) >= readingGoalToDelete.goalStartDate
            ? 'started'
            : 'starting';
        dialogMessage = `The${isCurrentReadingGoal ? ` current Reading Goal ${term} on` : ' archived Reading Goal for '} ${dateRangeLabel} will be deleted${isCurrentReadingGoal ? ' without archiving' : ''}`;
    }
    else if (readingGoals.length > 1) {
        dialogMessage = `All archived Reading Goals will be deleted${$readingGoal$.goalStartDate ? ' (including the current One)' : ''}`;
    }
    else {
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
    }
    catch ({ message }: any) {
        dialogManager.dialogs$.next([
            {
                component: MessageDialog,
                props: {
                    title: 'Error',
                    message: `An Error occurred: ${message}`
                }
            }
        ]);
    }
    finally {
        dispatch('spinner', false);
    }
}
async function init() {
    try {
        dispatch('spinner', true);
        await updateReadingGoalsData();
    }
    catch (error: any) {
        dialogManager.dialogs$.next([
            {
                component: MessageDialog,
                props: {
                    title: 'Error',
                    message: `Error loading Reading Goals: ${error.message}`
                }
            }
        ]);
    }
    finally {
        dispatch('spinner', false);
    }
}
async function updateReadingGoalsData() {
    __readerController.changed(readingGoals = await database.getReadingGoals());
    __readerController.changed(sortedReadingGoals = [...readingGoals]);
    sortedReadingGoals.sort((a, b) => (a.goalStartDate > b.goalStartDate ? -1 : 1));
    __readerController.changed(historyIndex = 0);
    writeStore(readingGoal$, await getCurrentReadingGoal(readingGoals));
}
__readerController.observeSource(() => isOnline$, (value) => { $isOnline$ = value; });
__readerController.observeSource(() => readingGoal$, (value) => { $readingGoal$ = value; });
__readerController.observeSource(() => startDayHoursForTracker$, (value) => { $startDayHoursForTracker$ = value; });
__readerController.observeSource(() => cacheStorageData$, (value) => { $cacheStorageData$ = value; });
__readerController.observeSource(() => replicationSaveBehavior$, (value) => { $replicationSaveBehavior$ = value; });
__readerController.observeSource(() => statisticsMergeMode$, (value) => { $statisticsMergeMode$ = value; });
__readerController.observeSource(() => readingGoalsMergeMode$, (value) => { $readingGoalsMergeMode$ = value; });
const api = { controller: __readerController, handleReadingGoalChange, saveReadingGoal, syncReadingGoals, deleteReadingGoals, init, updateReadingGoalsData,
get storageSources() { return storageSources; }, set storageSources(nextValue: typeof storageSources) { if (Object.is(storageSources, nextValue)) return; storageSources = nextValue; __readerController.invalidate(); },
get dispatch() { return dispatch; },
get readingGoalFrequencies() { return readingGoalFrequencies; },
get currentTimeGoal() { return currentTimeGoal; }, set currentTimeGoal(nextValue: typeof currentTimeGoal) { if (Object.is(currentTimeGoal, nextValue)) return; currentTimeGoal = nextValue; __readerController.invalidate(); },
get currentCharacterGoal() { return currentCharacterGoal; }, set currentCharacterGoal(nextValue: typeof currentCharacterGoal) { if (Object.is(currentCharacterGoal, nextValue)) return; currentCharacterGoal = nextValue; __readerController.invalidate(); },
get currentReadingGoalFrequency() { return currentReadingGoalFrequency; }, set currentReadingGoalFrequency(nextValue: typeof currentReadingGoalFrequency) { if (Object.is(currentReadingGoalFrequency, nextValue)) return; currentReadingGoalFrequency = nextValue; __readerController.invalidate(); },
get currentReadingGoalStartDate() { return currentReadingGoalStartDate; }, set currentReadingGoalStartDate(nextValue: typeof currentReadingGoalStartDate) { if (Object.is(currentReadingGoalStartDate, nextValue)) return; currentReadingGoalStartDate = nextValue; __readerController.invalidate(); },
get isInEditMode() { return isInEditMode; }, set isInEditMode(nextValue: typeof isInEditMode) { if (Object.is(isInEditMode, nextValue)) return; isInEditMode = nextValue; __readerController.invalidate(); },
get readingGoals() { return readingGoals; }, set readingGoals(nextValue: typeof readingGoals) { if (Object.is(readingGoals, nextValue)) return; readingGoals = nextValue; __readerController.invalidate(); },
get sortedReadingGoals() { return sortedReadingGoals; }, set sortedReadingGoals(nextValue: typeof sortedReadingGoals) { if (Object.is(sortedReadingGoals, nextValue)) return; sortedReadingGoals = nextValue; __readerController.invalidate(); },
get historyIndex() { return historyIndex; }, set historyIndex(nextValue: typeof historyIndex) { if (Object.is(historyIndex, nextValue)) return; historyIndex = nextValue; __readerController.invalidate(); },
get itemsPerPage() { return itemsPerPage; },
get availableSources() { return availableSources; }, set availableSources(nextValue: typeof availableSources) { if (Object.is(availableSources, nextValue)) return; availableSources = nextValue; __readerController.invalidate(); },
get saveDisabled() { return saveDisabled; }, set saveDisabled(nextValue: typeof saveDisabled) { if (Object.is(saveDisabled, nextValue)) return; saveDisabled = nextValue; __readerController.invalidate(); },
get currentTimeGoalInMin() { return currentTimeGoalInMin; }, set currentTimeGoalInMin(nextValue: typeof currentTimeGoalInMin) { if (Object.is(currentTimeGoalInMin, nextValue)) return; currentTimeGoalInMin = nextValue; __readerController.invalidate(); },
get currentHistoryIndex() { return currentHistoryIndex; }, set currentHistoryIndex(nextValue: typeof currentHistoryIndex) { if (Object.is(currentHistoryIndex, nextValue)) return; currentHistoryIndex = nextValue; __readerController.invalidate(); },
get historyReadingGoals() { return historyReadingGoals; }, set historyReadingGoals(nextValue: typeof historyReadingGoals) { if (Object.is(historyReadingGoals, nextValue)) return; historyReadingGoals = nextValue; __readerController.invalidate(); },
get hasNextHistoryPage() { return hasNextHistoryPage; }, set hasNextHistoryPage(nextValue: typeof hasNextHistoryPage) { if (Object.is(hasNextHistoryPage, nextValue)) return; hasNextHistoryPage = nextValue; __readerController.invalidate(); },
get $isOnline$() { return $isOnline$; }, set $isOnline$(nextValue: typeof $isOnline$) { writeStore(isOnline$, nextValue); },
get $readingGoal$() { return $readingGoal$; }, set $readingGoal$(nextValue: typeof $readingGoal$) { writeStore(readingGoal$, nextValue); },
get $startDayHoursForTracker$() { return $startDayHoursForTracker$; }, set $startDayHoursForTracker$(nextValue: typeof $startDayHoursForTracker$) { writeStore(startDayHoursForTracker$, nextValue); },
get $cacheStorageData$() { return $cacheStorageData$; }, set $cacheStorageData$(nextValue: typeof $cacheStorageData$) { writeStore(cacheStorageData$, nextValue); },
get $replicationSaveBehavior$() { return $replicationSaveBehavior$; }, set $replicationSaveBehavior$(nextValue: typeof $replicationSaveBehavior$) { writeStore(replicationSaveBehavior$, nextValue); },
get $statisticsMergeMode$() { return $statisticsMergeMode$; }, set $statisticsMergeMode$(nextValue: typeof $statisticsMergeMode$) { writeStore(statisticsMergeMode$, nextValue); },
get $readingGoalsMergeMode$() { return $readingGoalsMergeMode$; }, set $readingGoalsMergeMode$(nextValue: typeof $readingGoalsMergeMode$) { writeStore(readingGoalsMergeMode$, nextValue); },
updateProps(next: Record<string, unknown>) {
if ('storageSources' in next && next.storageSources !== undefined) api.storageSources = next.storageSources as typeof storageSources;
}
};
return api;
}
