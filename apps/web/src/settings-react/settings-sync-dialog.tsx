/** @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors. All rights reserved. */
import React from 'react';
import { useReaderController, readerTick } from '../reader-react/controller';
import { Dom, SurfaceEvents, Head, Icon, AppIcon, Button, Input, Switch, Field, Popover, DialogTemplate, ActionMenu, AppNav, Menu, useLatest, useReaderBindings, slotContent, Slot, type ReaderViewProps } from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import { createSettingsSyncDialog, type SettingsSyncDialogProps } from './settings-sync-dialog-controller';
import { InternalStorageSources, StorageKey } from '$lib/data/storage/storage-types';
import type { BooksDbStorageSource } from '$lib/data/database/books-db/versions/books-db';
import type { SyncSelection } from '$lib/data/dialog-manager';
import { lastSyncedSettingsSource$, lastSyncedSettingsTarget$ } from '$lib/data/store';
const faArrowsUpDown = 'faArrowsUpDown';
export function SettingsSyncDialog(props: Partial<SettingsSyncDialogProps> & ReaderViewProps & {
    children?: React.ReactNode;
    onClose?: () => void;
    slot?: string;
}) {
    const latest = useLatest(props);
    const context = useSettingsContext();
    const c = useReaderController(() => createSettingsSyncDialog(props as SettingsSyncDialogProps, (name, detail) => { latest.current.events?.[name]?.({ detail }); if (name === 'close')
        latest.current.onClose?.(); }, context), props);
    useReaderBindings(c, props);
    if (!c)
        return null;
    return <SettingsContext.Provider value={context}><div className="react-settings-settings-sync-dialog" style={{ display: 'contents' }}>
    <DialogTemplate>
    <Slot name="header">{c.settingsSyncHeader}</Slot>
    <Slot name="content">
    <Dom as="div" className={["grid gap-4"].filter(Boolean).join(' ')}>
    <Dom as="label" className={["grid gap-2 text-sm font-medium"].filter(Boolean).join(' ')}>
    <Dom as="span">{"Source"}</Dom>
    <Dom as="select" value={c.selectedSource} className={["min-h-11 min-w-0 rounded-[10px] border border-input bg-background px-3 py-2 text-base text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 md:text-sm"].filter(Boolean).join(' ')} bindings={{ "value": (value: typeof c.selectedSource) => { c.controller.changed(c.selectedSource = value); } }}>
        {(c.sources ?? []).map((source, index0) => <React.Fragment key={source.id}><Dom as="option" value={source.id}>
        {source.label}
        </Dom></React.Fragment>)}
    </Dom>
    </Dom>
    <Button variant={"ghost"} size={"icon"} shape={"circle"} aria-label={"Swap sync source and target"} title={c.selectedTarget === InternalStorageSources.INTERNAL_ZIP
            ? 'Choose a different target before swapping'
            : 'Swap source and target'} disabled={c.selectedTarget === InternalStorageSources.INTERNAL_ZIP} onClick={() => {
            const oldSource = c.selectedSource;
            const oldTarget = c.selectedTarget;
            c.controller.changed(c.selectedSource = oldTarget);
            c.controller.changed(c.selectedTarget = oldSource);
        }} className={["justify-self-center"].filter(Boolean).join(' ')}>
    <AppIcon icon={faArrowsUpDown}></AppIcon>
    </Button>
    <Dom as="label" className={["grid gap-2 text-sm font-medium"].filter(Boolean).join(' ')}>
    <Dom as="span">{"Target"}</Dom>
    <Dom as="select" value={c.selectedTarget} className={["min-h-11 min-w-0 rounded-[10px] border border-input bg-background px-3 py-2 text-base text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 md:text-sm"].filter(Boolean).join(' ')} bindings={{ "value": (value: typeof c.selectedTarget) => { c.controller.changed(c.selectedTarget = value); } }}>
        {(c.targets ?? []).map((target, index1) => <React.Fragment key={target.id}><Dom as="option" value={target.id}>
        {target.label}
        </Dom></React.Fragment>)}
    </Dom>
    </Dom>
    </Dom>
    </Slot>
    <Dom as="div" slot={"footer"} className={["flex grow flex-wrap justify-between gap-2"].filter(Boolean).join(' ')}>
    <Button variant={"ghost"} onClick={() => c.closeDialog(true)}>{"Cancel"}</Button>
    <Button variant={"default"} onClick={() => c.closeDialog()}>{"Confirm"}</Button>
    </Dom>
    </DialogTemplate></div></SettingsContext.Provider>;
}
