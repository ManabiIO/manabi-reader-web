/** @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors. All rights reserved. */
import React from 'react';
import { useReaderController, readerTick } from '../reader-react/controller';
import { Dom, SurfaceEvents, Head, Icon, AppIcon, Button, Input, Switch, Field, Popover, DialogTemplate, ActionMenu, AppNav, Menu, useLatest, useReaderBindings, slotContent, Slot, type ReaderViewProps } from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import { createSettingsOfflineStatus, type SettingsOfflineStatusProps } from './settings-offline-status-controller';
import { base } from '$app/paths';
import { getOfflineStatus, type OfflineStatus } from '$lib/service-worker/offline-status.mjs';
import { SettingsItemGroup } from './settings-item-group';
export function SettingsOfflineStatus(props: Partial<SettingsOfflineStatusProps> & ReaderViewProps & {
    children?: React.ReactNode;
    onClose?: () => void;
    slot?: string;
}) {
    const latest = useLatest(props);
    const context = useSettingsContext();
    const c = useReaderController(() => createSettingsOfflineStatus(props as SettingsOfflineStatusProps, (name, detail) => { latest.current.events?.[name]?.({ detail }); if (name === 'close')
        latest.current.onClose?.(); }, context), props);
    useReaderBindings(c, props);
    if (!c)
        return null;
    return <SettingsContext.Provider value={context}><div className="react-settings-settings-offline-status" style={{ display: 'contents' }}>
    <SettingsItemGroup title={"Offline reading"} category={"library"} settingId={"offline-reading"} keywords={"offline internet download cache storage PWA installation"}>
    <Dom as="p" role={"status"} className={["text-sm font-medium"].filter(Boolean).join(' ')}>
    {c.checking ? 'Checking offline app files…' : c.labels[c.status.state]}
    </Dom>
    <Dom as="p" className={["mt-2 text-sm text-muted-foreground"].filter(Boolean).join(' ')}>{" Offline support is automatic; installing a Home Screen app is optional. Books saved in this browser can be read offline when their local content is available. Remote-only books still need a connection to download. Browser restrictions can also prevent a book from being saved. "}</Dom>
    {(c.status.updateWaiting) ? <><Dom as="p" className={["mt-2 text-sm text-muted-foreground"].filter(Boolean).join(' ')}>{" An update is ready. It will be used after all Reader tabs and windows are closed; your current reading session will not be reloaded. "}</Dom></> : null}
    {(!c.checking && ['preparing', 'incomplete', 'unknown'].includes(c.status.state)) ? <><Dom as="p" className={["mt-2 text-sm text-muted-foreground"].filter(Boolean).join(' ')}>{" Offline reopening is not yet confirmed. Use Reader online before relying on offline access. This status does not mean your saved books or reading progress were deleted. "}</Dom></> : null}
    <Dom as="p" className={["mt-2 text-xs text-muted-foreground"].filter(Boolean).join(' ')}>{" This checks app files, not every book, font, dictionary, or audio file. Browser storage can be cleared or unavailable in private browsing; keep backups of important local data. "}</Dom>
    </SettingsItemGroup></div></SettingsContext.Provider>;
}
