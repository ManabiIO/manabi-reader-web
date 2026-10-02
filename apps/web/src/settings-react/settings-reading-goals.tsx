/** @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors. All rights reserved. */
import React from 'react';
import { useReaderController, readerTick } from '../reader-react/controller';
import { Dom, SurfaceEvents, Head, Icon, AppIcon, Button, Input, Switch, Field, Popover, DialogTemplate, ActionMenu, AppNav, Menu, useLatest, useReaderBindings, slotContent, Slot, type ReaderViewProps } from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import { createSettingsReadingGoals, type SettingsReadingGoalsProps } from './settings-reading-goals-controller';
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
import { ConfirmDialog } from '../ui/dialogs';
import { MessageDialog } from '../ui/dialogs';
import { SettingsReadingGoalsMerge } from './settings-reading-goals-merge';
import { SettingsSyncDialog } from './settings-sync-dialog';
const faCancel = 'faCancel';
const faChevronLeft = 'faChevronLeft';
const faChevronRight = 'faChevronRight';
const faEdit = 'faEdit';
const faRotate = 'faRotate';
const faSave = 'faSave';
const faTrash = 'faTrash';
export function SettingsReadingGoals(props: Partial<SettingsReadingGoalsProps> & ReaderViewProps & {
    children?: React.ReactNode;
    onClose?: () => void;
    slot?: string;
}) {
    const latest = useLatest(props);
    const context = useSettingsContext();
    const c = useReaderController(() => createSettingsReadingGoals(props as SettingsReadingGoalsProps, (name, detail) => { latest.current.events?.[name]?.({ detail }); if (name === 'close')
        latest.current.onClose?.(); }, context), props);
    useReaderBindings(c, props);
    if (!c)
        return null;
    return <SettingsContext.Provider value={context}><div className="react-settings-settings-reading-goals" style={{ display: 'contents' }}>
    <Dom as="div" className={["mb-8 min-w-0 sm:col-span-2 lg:col-span-3"].filter(Boolean).join(' ')}>
    <Dom as="div" className={["flex flex-wrap items-center justify-end gap-2"].filter(Boolean).join(' ')}>
        {(c.isInEditMode) ? <><Button variant={"default"} disabled={c.saveDisabled} onClick={c.saveReadingGoal}>
        <Dom as="span">{"Save"}</Dom>
        <AppIcon icon={faSave}></AppIcon>
        </Button>
        <Button variant={"ghost"} onClick={() => {
                ({
                    timeGoal: c.currentTimeGoal,
                    characterGoal: c.currentCharacterGoal,
                    goalFrequency: c.currentReadingGoalFrequency,
                    goalStartDate: c.currentReadingGoalStartDate
                } = c.$readingGoal$);
                c.controller.changed(c.isInEditMode = false);
            }}>
        <Dom as="span">{"Cancel"}</Dom>
        <AppIcon icon={faCancel}></AppIcon>
        </Button></> : <> <Button variant={"outline"} onClick={c.syncReadingGoals}>
        <Dom as="span">{"Sync"}</Dom>
        <AppIcon icon={faRotate}></AppIcon>
        </Button>
        <Button variant={"secondary"} onClick={() => (c.controller.changed(c.isInEditMode = true))}>
        <Dom as="span">{"Edit"}</Dom>
        <AppIcon icon={faEdit}></AppIcon>
        </Button>
        <Button variant={"destructive"} disabled={!c.readingGoals.length} title={"Delete all Reading Goals"} onClick={() => c.deleteReadingGoals()}>
        <Dom as="span">{"Reset"}</Dom>
        <AppIcon icon={faTrash}></AppIcon>
        </Button></>}
    </Dom>
    <Dom as="div" className={["mt-4 grid grid-cols-1 items-end justify-between gap-4 md:grid-cols-4"].filter(Boolean).join(' ')}>
    <Dom as="label" className={["grid min-w-0 gap-2 text-sm font-medium"].filter(Boolean).join(' ')}>
    <Dom as="span">{"Time goal (minutes)"}</Dom>
    <Input type={"number"} min={"0"} disabled={!c.isInEditMode} value={c.currentTimeGoalInMin} onBlur={(event: React.FocusEvent<HTMLInputElement>) => c.handleReadingGoalChange(event, true)} bindings={{ "value": (value: typeof c.currentTimeGoalInMin) => { c.controller.changed(c.currentTimeGoalInMin = value); } }}></Input>
    </Dom>
    <Dom as="label" className={["grid min-w-0 gap-2 text-sm font-medium"].filter(Boolean).join(' ')}>
    <Dom as="span">{"Character goal"}</Dom>
    <Input type={"number"} min={"0"} disabled={!c.isInEditMode} value={c.currentCharacterGoal} onBlur={(event: React.FocusEvent<HTMLInputElement>) => c.handleReadingGoalChange(event, false)} bindings={{ "value": (value: typeof c.currentCharacterGoal) => { c.controller.changed(c.currentCharacterGoal = value); } }}></Input>
    </Dom>
    <Dom as="label" className={["grid min-w-0 gap-2 text-sm font-medium"].filter(Boolean).join(' ')}>
    <Dom as="span">{"Frequency"}</Dom>
    <Dom as="select" disabled={!c.isInEditMode} value={c.currentReadingGoalFrequency} className={["min-h-11 min-w-0 rounded-[10px] border border-input bg-background px-3 py-2 text-base text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"].filter(Boolean).join(' ')} bindings={{ "value": (value: typeof c.currentReadingGoalFrequency) => { c.controller.changed(c.currentReadingGoalFrequency = value); } }}>
        {(c.readingGoalFrequencies ?? []).map((readingGoalFrequency, index0) => <React.Fragment key={readingGoalFrequency.id}><Dom as="option" value={readingGoalFrequency.id}>
        {readingGoalFrequency.label}
        </Dom></React.Fragment>)}
    </Dom>
    </Dom>
    <Dom as="label" className={["grid min-w-0 gap-2 text-sm font-medium"].filter(Boolean).join(' ')}>
    <Dom as="span">{"Start date"}</Dom>
    <Input type={"date"} disabled={!c.isInEditMode} value={c.currentReadingGoalStartDate} bindings={{ "value": (value: typeof c.currentReadingGoalStartDate) => { c.controller.changed(c.currentReadingGoalStartDate = value); } }}></Input>
    </Dom>
    </Dom>
    <Dom as="details" className={["mt-6 cursor-pointer"].filter(Boolean).join(' ')}>
    <Dom as="summary">{"Reading Goal History ("}{pluralize(c.readingGoals.length, 'Item')}{")"}</Dom>
        {(c.readingGoals.length) ? <><Dom as="div" className={["grid-cols-[repeat(4,minmax(0,1fr))_auto] hidden items-center gap-2 sm:grid"].filter(Boolean).join(' ')}>
            {(c.historyReadingGoals ?? []).map((historyGoal, index1) => <React.Fragment key={historyGoal.goalStartDate}>{(() => {
                    const dateRangeLabel = getDateRangeLabel(historyGoal.goalStartDate, historyGoal.goalEndDate);
                    return <>
                    <Dom as="div" className={["min-w-0 break-words"].filter(Boolean).join(' ')}>{dateRangeLabel}</Dom>
                    <Dom as="div">{secondsToMinutes(historyGoal.timeGoal)}{" min"}</Dom>
                    <Dom as="div">{historyGoal.characterGoal}{" characters"}</Dom>
                    <Dom as="div">{historyGoal.goalFrequency}</Dom>
                    <Button variant={"destructive"} size={"sm"} title={"Delete Reading Goal"} onClick={() => c.deleteReadingGoals(historyGoal, dateRangeLabel)}>
                    <AppIcon icon={faTrash}></AppIcon>
                    <Dom as="span">{"Delete Reading Goal"}</Dom>
                    </Button></>;
                })()}</React.Fragment>)}
        </Dom>
        <Dom as="div" className={["sm:hidden"].filter(Boolean).join(' ')}>
            {(c.historyReadingGoals ?? []).map((historyGoal, index2) => <React.Fragment key={historyGoal.goalStartDate}>{(() => {
                    const dateRangeLabel = getDateRangeLabel(historyGoal.goalStartDate, historyGoal.goalEndDate);
                    return <>
                    <Dom as="div" className={["my-3 grid gap-2 rounded-xl border border-border p-3"].filter(Boolean).join(' ')}>
                    <Dom as="div">
                    {dateRangeLabel}{" / "}{secondsToMinutes(historyGoal.timeGoal)}{" min / "}{historyGoal.characterGoal}{" characters / "}{historyGoal.goalFrequency}
                    </Dom>
                    <Button variant={"destructive"} size={"sm"} title={"Delete Reading Goal"} onClick={() => c.deleteReadingGoals(historyGoal, dateRangeLabel)} className={["justify-self-start"].filter(Boolean).join(' ')}>
                    <AppIcon icon={faTrash}></AppIcon>
                    <Dom as="span">{"Delete Reading Goal"}</Dom>
                    </Button>
                    </Dom></>;
                })()}</React.Fragment>)}
        </Dom>
        <Dom as="div" className={["mt-3 flex justify-between gap-2"].filter(Boolean).join(' ')}>
        <Button variant={"ghost"} size={"icon-sm"} shape={"circle"} aria-label={"Previous reading goal"} title={"Previous Page"} disabled={c.currentHistoryIndex === 0} onClick={() => (c.controller.changed(c.historyIndex -= 1))}>
        <AppIcon icon={faChevronLeft}></AppIcon>
        </Button>
        <Button variant={"ghost"} size={"icon-sm"} shape={"circle"} aria-label={"Next reading goal"} title={"Next Page"} disabled={!c.hasNextHistoryPage} onClick={() => (c.controller.changed(c.historyIndex += 1))}>
        <AppIcon icon={faChevronRight}></AppIcon>
        </Button>
        </Dom></> : <> <Dom as="div" className={["mt-3 text-sm text-muted-foreground"].filter(Boolean).join(' ')}>{"You have no archived Reading Goals yet"}</Dom></>}
    </Dom>
    </Dom></div></SettingsContext.Provider>;
}
