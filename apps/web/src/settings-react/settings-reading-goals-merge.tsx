/** @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors. All rights reserved. */
import React from 'react';
import { useReaderController, readerTick } from '../reader-react/controller';
import { Dom, SurfaceEvents, Head, Icon, AppIcon, Button, Input, Switch, Field, Popover, DialogTemplate, ActionMenu, AppNav, Menu, useLatest, useReaderBindings, slotContent, Slot, type ReaderViewProps } from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import { createSettingsReadingGoalsMerge, type SettingsReadingGoalsMergeProps } from './settings-reading-goals-merge-controller';
import type { BooksDbReadingGoal } from '$lib/data/database/books-db/versions/books-db';
import { getDateRangeLabel, getReadingGoalWindow, type ReadingGoal, type ReadingGoalArchivalOption, type ReadingGoalSaveResult } from '$lib/data/reading-goal';
import { database, readingGoal$, startDayHoursForTracker$ } from '$lib/data/store';
import { advanceDateDays, getDate, getDateKey, getPreviousDayKey, secondsToMinutes } from '$lib/functions/statistic-util';
import { pluralize } from '$lib/functions/utils';
const faSpinner = 'faSpinner';
export function SettingsReadingGoalsMerge(props: Partial<SettingsReadingGoalsMergeProps> & ReaderViewProps & {
    children?: React.ReactNode;
    onClose?: () => void;
    slot?: string;
}) {
    const latest = useLatest(props);
    const context = useSettingsContext();
    const c = useReaderController(() => createSettingsReadingGoalsMerge(props as SettingsReadingGoalsMergeProps, (name, detail) => { latest.current.events?.[name]?.({ detail }); if (name === 'close')
        latest.current.onClose?.(); }, context), props);
    useReaderBindings(c, props);
    if (!c)
        return null;
    return <SettingsContext.Provider value={context}><div className="react-settings-settings-reading-goals-merge" style={{ display: 'contents' }}>
    <Dom as="div" aria-busy={c.showSpinner} className={["relative min-w-0"].filter(Boolean).join(' ')}>
        {(c.showSpinner) ? <><Dom as="div" aria-hidden={"true"} className={["tap-highlight-transparent absolute inset-0 z-10 rounded-3xl bg-black/[.2]"].filter(Boolean).join(' ')}></Dom>
        <Dom as="div" role={"status"} aria-label={"Preparing reading goal"} className={["pointer-events-none absolute inset-0 z-20 flex items-center justify-center text-5xl"].filter(Boolean).join(' ')}>
        <AppIcon icon={faSpinner} spin={true}></AppIcon>
        <Dom as="span" className={["sr-only"].filter(Boolean).join(' ')}>{"Preparing reading goal…"}</Dom>
        </Dom></> : null}
    <DialogTemplate>
    <Slot name="header">{"Save Reading Goal"}</Slot>
    <Slot name="content">
    <Dom as="fieldset" disabled={c.showSpinner} className={["grid min-w-0 gap-4 border-0 p-0"].filter(Boolean).join(' ')}>
        {(c.newReadingGoal.goalStartDate) ? <><Dom as="label" className={["grid min-w-0 gap-2 text-sm font-medium"].filter(Boolean).join(' ')}>
        <Dom as="span">{"New reading goal starts from"}</Dom>
        <Input disabled={true} type={"date"} min={c.newReadingGoal.goalStartDate} value={c.newStartDate} bindings={{ "value": (value: typeof c.newStartDate) => { c.controller.changed(c.newStartDate = value); } }}></Input>
        </Dom></> : null}
        {(c.archivalOptions.length) ? <><Dom as="label" className={["flex min-h-11 items-center gap-2 text-sm font-medium"].filter(Boolean).join(' ')}>
        <Dom as="input" type={"checkbox"} checked={c.archiveReadingGoal} className={["size-5 shrink-0 accent-primary"].filter(Boolean).join(' ')} events={{ "change": c.checkDates }} bindings={{ "checked": (value: typeof c.archiveReadingGoal) => { c.controller.changed(c.archiveReadingGoal = value); } }}/>
        <Dom as="span">{"Archive current reading goal"}</Dom>
        </Dom>
        <Dom as="div" className={["grid gap-3", (!c.archiveReadingGoal) && "opacity-50"].filter(Boolean).join(' ')}>
        <Dom as="div" className={["grid gap-3 sm:grid-cols-2"].filter(Boolean).join(' ')}>
        <Dom as="label" className={["grid min-w-0 gap-2 text-sm font-medium"].filter(Boolean).join(' ')}>
        <Dom as="span">{"Archive from"}</Dom>
        <Input type={"date"} disabled={!c.archiveReadingGoal || !c.archiveDateEditable} value={c.archivalStartDate} onChange={c.checkDates} bindings={{ "value": (value: typeof c.archivalStartDate) => { c.controller.changed(c.archivalStartDate = value); } }}></Input>
        </Dom>
        <Dom as="label" className={["grid min-w-0 gap-2 text-sm font-medium"].filter(Boolean).join(' ')}>
        <Dom as="span">{"Archive through"}</Dom>
        <Input type={"date"} disabled={!c.archiveReadingGoal || !c.archiveDateEditable} value={c.archivalEndDate} onChange={c.checkDates} bindings={{ "value": (value: typeof c.archivalEndDate) => { c.controller.changed(c.archivalEndDate = value); } }}></Input>
        </Dom>
        </Dom>
        <Dom as="fieldset" disabled={!c.archiveReadingGoal} className={["grid gap-2"].filter(Boolean).join(' ')}>
        <Dom as="legend" className={["text-sm font-medium"].filter(Boolean).join(' ')}>{"Archive boundary"}</Dom>
        <Dom as="div" className={["grid gap-1"].filter(Boolean).join(' ')}>
            {(c.archivalOptions ?? []).map((archivalOption, index0) => <React.Fragment key={archivalOption.label}><Dom as="label" className={["flex min-h-11 items-center gap-2 text-sm"].filter(Boolean).join(' ')}>
            <Dom as="input" type={"radio"} name={"action"} value={archivalOption.label} group={c.selectedArchiveOption} className={["size-5 shrink-0 accent-primary"].filter(Boolean).join(' ')} events={{ "change": c.checkDates }} bindings={{ "group": (value: typeof c.selectedArchiveOption) => { c.controller.changed(c.selectedArchiveOption = value); } }}/>
            <Dom as="span">{archivalOption.label}</Dom>
            </Dom></React.Fragment>)}
        </Dom>
        </Dom>
        </Dom></> : null}
        {(c.readingGoalToReplaceMessage) ? <><Dom as="details" className={["max-h-[10rem] cursor-pointer overflow-auto rounded-xl border border-border p-3"].filter(Boolean).join(' ')}>
        <Dom as="summary">{c.readingGoalToReplaceMessage}</Dom>
            {(c.readingGoalsToReplace ?? []).map((goalToReplace, index1) => <React.Fragment key={goalToReplace.goalStartDate}><Dom as="div" className={["my-2 break-words text-sm"].filter(Boolean).join(' ')}>
            {getDateRangeLabel(goalToReplace.goalStartDate, goalToReplace.goalEndDate)}{" / "}{secondsToMinutes(goalToReplace.timeGoal)}{" min / "}{goalToReplace.characterGoal}{" characters / "}{goalToReplace.goalFrequency}
            </Dom></React.Fragment>)}
        </Dom></> : null}
    </Dom>
    </Slot>
    <Dom as="div" slot={"footer"} className={["flex grow flex-wrap justify-between gap-2"].filter(Boolean).join(' ')}>
    <Button variant={"ghost"} disabled={c.showSpinner} onClick={() => c.closeDialog(true)}>{"Cancel"}</Button>
    <Button variant={"default"} disabled={c.showSpinner} onClick={() => c.closeDialog()}>{"Confirm"}</Button>
    </Dom>
    </DialogTemplate>
    </Dom></div></SettingsContext.Provider>;
}
