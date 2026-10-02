/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import type { BooksDbReadingGoal } from '$lib/data/database/books-db/versions/books-db';
import { getDateRangeLabel, getReadingGoalWindow, type ReadingGoal, type ReadingGoalArchivalOption, type ReadingGoalSaveResult } from '$lib/data/reading-goal';
import { database, readingGoal$, startDayHoursForTracker$ } from '$lib/data/store';
import { advanceDateDays, getDate, getDateKey, getPreviousDayKey, secondsToMinutes } from '$lib/functions/statistic-util';
import { pluralize } from '$lib/functions/utils';
import { ReaderController, readerTick, writeStore, type StoreValue } from '../reader-react/controller';
import { type SettingsContextValue } from './context';


const faSpinner = 'faSpinner';
const DialogTemplate = 'DialogTemplate';
const Button = 'Button';
const Input = 'Input';
const AppIcon = 'AppIcon';
export interface SettingsReadingGoalsMergeProps {
newReadingGoal: ReadingGoal;
resolver: (arg0: ReadingGoalSaveResult) => void;
}

export function createSettingsReadingGoalsMerge(props: SettingsReadingGoalsMergeProps, emit: (name: string, detail?: unknown) => void = () => {}, componentContext: SettingsContextValue) {
const __readerController = new ReaderController();
let selectedArchiveOptionObject: any;
let readingGoalToReplaceMessage: any;
let $readingGoal$: StoreValue<typeof readingGoal$> = __readerController.read(readingGoal$);
let $startDayHoursForTracker$: StoreValue<typeof startDayHoursForTracker$> = __readerController.read(startDayHoursForTracker$);
let newReadingGoal: ReadingGoal = props.newReadingGoal;
let resolver: (arg0: ReadingGoalSaveResult) => void = props.resolver;
const dispatch = (name: string, detail?: unknown) => emit(name, detail);
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
__readerController.onDestroy(() => {
    __readerController.changed(active = false);
    if (settled)
        return;
    __readerController.changed(settled = true);
    resolver(cancelledResult());
});
__readerController.effect(() => [archivalOptions, selectedArchiveOption], () => { __readerController.changed(selectedArchiveOptionObject = archivalOptions.find((opt) => opt.label === selectedArchiveOption)); });
__readerController.effect(() => [existingReadingGoals, $readingGoal$], () => { __readerController.changed(readingGoalsToReplace = existingReadingGoals.filter((readingGoal) => readingGoal.goalStartDate !== $readingGoal$.goalStartDate)); });
__readerController.effect(() => [readingGoalsToReplace], () => { __readerController.changed(readingGoalToReplaceMessage = readingGoalsToReplace.length
    ? `${pluralize(readingGoalsToReplace.length, 'Item')} will be replaced`
    : ''); });
__readerController.effect(() => [selectedArchiveOptionObject], () => { if (selectedArchiveOptionObject) {
    ({ archivalStartDate, archivalEndDate } = selectedArchiveOptionObject);
    __readerController.changed(archiveDateEditable = selectedArchiveOptionObject.editable);
    updateNextReadingGoalStartDate();
} });
__readerController.effect(() => [newReadingGoal, archiveReadingGoal, $readingGoal$], () => { if (newReadingGoal.goalStartDate) {
    if (!archiveReadingGoal) {
        __readerController.changed(newStartDate = newReadingGoal.goalStartDate);
        __readerController.changed(archivalStartDate = $readingGoal$.goalStartDate);
    }
    else {
        updateNextReadingGoalStartDate();
    }
} });
__readerController.onMount(init);
async function checkDates() {
    try {
        __readerController.changed(showSpinner = true);
        if (!archivalStartDate || !archivalEndDate) {
            __readerController.changed(archivalStartDate = $readingGoal$.goalStartDate);
            __readerController.changed(archivalEndDate = archivalMaxDate);
        }
        else if (archivalEndDate < archivalStartDate) {
            const oldStartDate = archivalStartDate;
            const oldEndStartDate = archivalEndDate;
            __readerController.changed(archivalStartDate = oldEndStartDate);
            __readerController.changed(archivalEndDate = oldStartDate);
        }
        await updateExistingReadingGoals();
        if (!active)
            return;
        __readerController.changed(showSpinner = false);
    }
    catch ({ message }: any) {
        if (!active)
            return;
        __readerController.changed(error = `Failed to refresh Reading Goals (${message})`);
        void closeDialog();
    }
}
async function closeDialog(wasCanceled = false) {
    if (settled || !active)
        return;
    const exitEarly = wasCanceled || error;
    const resultObject: ReadingGoalSaveResult = {
        ...cancelledResult(),
        error
    };
    if (!exitEarly)
        await readerTick();
    if (settled || !active)
        return;
    if (exitEarly) {
        __readerController.changed(settled = true);
        resolver(resultObject);
        dispatch('close');
        return;
    }
    const goalsToDelete: string[] = [];
    const addGoalToDelete = (date: string) => {
        if (!goalsToDelete.includes(date))
            goalsToDelete.push(date);
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
    __readerController.changed(settled = true);
    resolver(resultObject);
    dispatch('close');
}
function updateNextReadingGoalStartDate() {
    if (!newReadingGoal.goalStartDate) {
        return;
    }
    if (!archiveReadingGoal || newReadingGoal.goalStartDate > archivalEndDate) {
        __readerController.changed(newStartDate = newReadingGoal.goalStartDate);
    }
    else {
        ({ dateString: newStartDate } = advanceDateDays(getDate(archivalEndDate, $startDayHoursForTracker$)));
    }
}
async function init() {
    try {
        const todayKey = getDateKey($startDayHoursForTracker$);
        if ($readingGoal$.goalStartDate && todayKey >= $readingGoal$.goalStartDate) {
            const yesterDayKey = getPreviousDayKey($startDayHoursForTracker$);
            const [readingGoalStart, readingGoalEnd] = getReadingGoalWindow(todayKey, $startDayHoursForTracker$, $readingGoal$);
            const previousReadingGoalEnd = getPreviousDayKey($startDayHoursForTracker$, getDate(readingGoalStart, $startDayHoursForTracker$));
            __readerController.changed(archivalMaxDate = readingGoalEnd);
            archivalOptions.push({
                label: 'Custom',
                archivalStartDate: $readingGoal$.goalStartDate,
                archivalEndDate: readingGoalEnd,
                editable: true
            });
            if (previousReadingGoalEnd > $readingGoal$.goalStartDate &&
                yesterDayKey !== previousReadingGoalEnd &&
                todayKey !== previousReadingGoalEnd) {
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
            __readerController.changed(archiveReadingGoal = true);
            __readerController.changed(selectedArchiveOption = archivalOptions[0].label);
            __readerController.changed(archivalOptions = [...archivalOptions]);
            __readerController.changed(archivalOriginalEndDate = readingGoalEnd);
        }
        await updateExistingReadingGoals();
        if (!active)
            return;
        __readerController.changed(showSpinner = false);
    }
    catch ({ message }: any) {
        if (!active)
            return;
        __readerController.changed(error = `Failed to set Context (${message})`);
        void closeDialog();
    }
}
async function updateExistingReadingGoals() {
    updateNextReadingGoalStartDate();
    await readerTick();
    if (!active)
        return;
    let nextGoals: BooksDbReadingGoal[] = [];
    if (archiveReadingGoal) {
        nextGoals = await database.getReadingGoalsForDateWindow(archivalStartDate, newStartDate, archivalEndDate);
    }
    else if (newReadingGoal.goalStartDate) {
        nextGoals = await database.getReadingGoalsForDateWindow(newReadingGoal.goalStartDate, newStartDate);
    }
    if (active)
        __readerController.changed(existingReadingGoals = nextGoals);
}
__readerController.observeSource(() => readingGoal$, (value) => { $readingGoal$ = value; });
__readerController.observeSource(() => startDayHoursForTracker$, (value) => { $startDayHoursForTracker$ = value; });
const api = { controller: __readerController, checkDates, closeDialog, updateNextReadingGoalStartDate, init, updateExistingReadingGoals,
get newReadingGoal() { return newReadingGoal; }, set newReadingGoal(nextValue: typeof newReadingGoal) { if (Object.is(newReadingGoal, nextValue)) return; newReadingGoal = nextValue; __readerController.invalidate(); },
get resolver() { return resolver; }, set resolver(nextValue: typeof resolver) { if (Object.is(resolver, nextValue)) return; resolver = nextValue; __readerController.invalidate(); },
get dispatch() { return dispatch; },
get showSpinner() { return showSpinner; }, set showSpinner(nextValue: typeof showSpinner) { if (Object.is(showSpinner, nextValue)) return; showSpinner = nextValue; __readerController.invalidate(); },
get newStartDate() { return newStartDate; }, set newStartDate(nextValue: typeof newStartDate) { if (Object.is(newStartDate, nextValue)) return; newStartDate = nextValue; __readerController.invalidate(); },
get archiveReadingGoal() { return archiveReadingGoal; }, set archiveReadingGoal(nextValue: typeof archiveReadingGoal) { if (Object.is(archiveReadingGoal, nextValue)) return; archiveReadingGoal = nextValue; __readerController.invalidate(); },
get archiveDateEditable() { return archiveDateEditable; }, set archiveDateEditable(nextValue: typeof archiveDateEditable) { if (Object.is(archiveDateEditable, nextValue)) return; archiveDateEditable = nextValue; __readerController.invalidate(); },
get archivalOptions() { return archivalOptions; }, set archivalOptions(nextValue: typeof archivalOptions) { if (Object.is(archivalOptions, nextValue)) return; archivalOptions = nextValue; __readerController.invalidate(); },
get selectedArchiveOption() { return selectedArchiveOption; }, set selectedArchiveOption(nextValue: typeof selectedArchiveOption) { if (Object.is(selectedArchiveOption, nextValue)) return; selectedArchiveOption = nextValue; __readerController.invalidate(); },
get archivalMaxDate() { return archivalMaxDate; }, set archivalMaxDate(nextValue: typeof archivalMaxDate) { if (Object.is(archivalMaxDate, nextValue)) return; archivalMaxDate = nextValue; __readerController.invalidate(); },
get archivalStartDate() { return archivalStartDate; }, set archivalStartDate(nextValue: typeof archivalStartDate) { if (Object.is(archivalStartDate, nextValue)) return; archivalStartDate = nextValue; __readerController.invalidate(); },
get archivalEndDate() { return archivalEndDate; }, set archivalEndDate(nextValue: typeof archivalEndDate) { if (Object.is(archivalEndDate, nextValue)) return; archivalEndDate = nextValue; __readerController.invalidate(); },
get archivalOriginalEndDate() { return archivalOriginalEndDate; }, set archivalOriginalEndDate(nextValue: typeof archivalOriginalEndDate) { if (Object.is(archivalOriginalEndDate, nextValue)) return; archivalOriginalEndDate = nextValue; __readerController.invalidate(); },
get error() { return error; }, set error(nextValue: typeof error) { if (Object.is(error, nextValue)) return; error = nextValue; __readerController.invalidate(); },
get existingReadingGoals() { return existingReadingGoals; }, set existingReadingGoals(nextValue: typeof existingReadingGoals) { if (Object.is(existingReadingGoals, nextValue)) return; existingReadingGoals = nextValue; __readerController.invalidate(); },
get readingGoalsToReplace() { return readingGoalsToReplace; }, set readingGoalsToReplace(nextValue: typeof readingGoalsToReplace) { if (Object.is(readingGoalsToReplace, nextValue)) return; readingGoalsToReplace = nextValue; __readerController.invalidate(); },
get settled() { return settled; }, set settled(nextValue: typeof settled) { if (Object.is(settled, nextValue)) return; settled = nextValue; __readerController.invalidate(); },
get active() { return active; }, set active(nextValue: typeof active) { if (Object.is(active, nextValue)) return; active = nextValue; __readerController.invalidate(); },
get cancelledResult() { return cancelledResult; },
get selectedArchiveOptionObject() { return selectedArchiveOptionObject; }, set selectedArchiveOptionObject(nextValue: typeof selectedArchiveOptionObject) { if (Object.is(selectedArchiveOptionObject, nextValue)) return; selectedArchiveOptionObject = nextValue; __readerController.invalidate(); },
get readingGoalToReplaceMessage() { return readingGoalToReplaceMessage; }, set readingGoalToReplaceMessage(nextValue: typeof readingGoalToReplaceMessage) { if (Object.is(readingGoalToReplaceMessage, nextValue)) return; readingGoalToReplaceMessage = nextValue; __readerController.invalidate(); },
get $readingGoal$() { return $readingGoal$; }, set $readingGoal$(nextValue: typeof $readingGoal$) { writeStore(readingGoal$, nextValue); },
get $startDayHoursForTracker$() { return $startDayHoursForTracker$; }, set $startDayHoursForTracker$(nextValue: typeof $startDayHoursForTracker$) { writeStore(startDayHoursForTracker$, nextValue); },
updateProps(next: Record<string, unknown>) {
if ('newReadingGoal' in next) api.newReadingGoal = next.newReadingGoal as typeof newReadingGoal;
if ('resolver' in next) api.resolver = next.resolver as typeof resolver;
}
};
return api;
}
