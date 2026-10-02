/** @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors. All rights reserved. */
import React from 'react';
import { useReaderController, readerTick } from '../reader-react/controller';
import { Dom, SurfaceEvents, Head, Icon, AppIcon, Button, Input, Switch, Field, Popover, DialogTemplate, ActionMenu, AppNav, Menu, useLatest, useReaderBindings, slotContent, Slot, type ReaderViewProps } from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import { createSettingsItemGroup, type SettingsItemGroupProps } from './settings-item-group-controller';
import { SETTINGS_FILTER, SETTINGS_FIELD, matchesSetting, type SettingsFilterStore } from '../lib/components/settings/settings-context';
export function SettingsItemGroup(props: Partial<SettingsItemGroupProps> & ReaderViewProps & {
    children?: React.ReactNode;
    onClose?: () => void;
    slot?: string;
}) {
    const latest = useLatest(props);
    const context = useSettingsContext();
    const c = useReaderController(() => createSettingsItemGroup(props as SettingsItemGroupProps, (name, detail) => { latest.current.events?.[name]?.({ detail }); if (name === 'close')
        latest.current.onClose?.(); }, context), props);
    useReaderBindings(c, props);
    if (!c)
        return null;
    return <SettingsContext.Provider value={context}><div className="react-settings-settings-item-group" style={{ display: 'contents' }}>
    <Dom as="section" data-setting={c.settingId || c.title} data-category={c.category} hidden={!c.visible} aria-labelledby={c.showHeading ? c.headingId : undefined} className={[([
                'appearance',
                'selected-theme',
                'storage-sources',
                'reading-goals',
                'font-defaults'
            ].includes(c.settingId)) && "wide", "settings-field rounded-2xl bg-card p-[16px] text-card-foreground ring-1 ring-border/60 sm:p-[20px]"].filter(Boolean).join(' ')}>
    <Field.Field>
        {(c.showHeading) ? <><Dom as="div" className={["flex flex-wrap items-center justify-between gap-2"].filter(Boolean).join(' ')}>
        <Dom as="h2" id={c.headingId} className={["text-sm", (c.applyHeaderClasses) && "font-semibold"].filter(Boolean).join(' ')}>{c.title}</Dom>
        {slotContent(props.children, "header")}
        </Dom></> : null}
    {(c.tooltip) ? <><Field.Description className={["whitespace-pre-line"].filter(Boolean).join(' ')}>{c.tooltip}</Field.Description></> : null}
    <Dom as="div" className={["min-w-0"].filter(Boolean).join(' ')}>{slotContent(props.children, undefined)}</Dom>
    </Field.Field>
    </Dom>
    </div></SettingsContext.Provider>;
}
