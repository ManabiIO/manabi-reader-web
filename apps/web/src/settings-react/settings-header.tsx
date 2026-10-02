/** @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors. All rights reserved. */
import React from 'react';
import { useReaderController, readerTick } from '../reader-react/controller';
import { Dom, SurfaceEvents, Head, Icon, AppIcon, Button, Input, Switch, Field, Popover, DialogTemplate, ActionMenu, AppNav, Menu, useLatest, useReaderBindings, slotContent, Slot, type ReaderViewProps } from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import { createSettingsHeader, type SettingsHeaderProps } from './settings-header-controller';
export function SettingsHeader(props: Partial<SettingsHeaderProps> & ReaderViewProps & {
    children?: React.ReactNode;
    onClose?: () => void;
    slot?: string;
}) {
    const latest = useLatest(props);
    const context = useSettingsContext();
    const c = useReaderController(() => createSettingsHeader(props as SettingsHeaderProps, (name, detail) => { latest.current.events?.[name]?.({ detail }); if (name === 'close')
        latest.current.onClose?.(); }, context), props);
    useReaderBindings(c, props);
    if (!c)
        return null;
    return <SettingsContext.Provider value={context}><div className="react-settings-settings-header" style={{ display: 'contents' }}>
    <Dom as="header" className={["app-header settings-header border-b border-border bg-card text-foreground"].filter(Boolean).join(' ')}>
    <Button href={c.leavePageLink} variant={"ghost"} aria-label={"Back"} className={["settings-back"].filter(Boolean).join(' ')}>
    <Icon name="CaretLeftIcon" aria-hidden={"true"} className={["size-5 shrink-0"].filter(Boolean).join(' ')}></Icon>
    <Dom as="span" className={["back-label"].filter(Boolean).join(' ')}>{"Back"}</Dom>
    </Button>
    <Dom as="h1" className={["settings-title font-semibold"].filter(Boolean).join(' ')}>{"Settings"}</Dom>
    <Dom as="div" className={["settings-navigation"].filter(Boolean).join(' ')}><AppNav></AppNav></Dom>
    </Dom>
    </div></SettingsContext.Provider>;
}
