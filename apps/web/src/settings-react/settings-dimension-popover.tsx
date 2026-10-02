/** @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors. All rights reserved. */
import React from 'react';
import { useReaderController, readerTick } from '../reader-react/controller';
import { Dom, SurfaceEvents, Head, Icon, AppIcon, Button, Input, Switch, Field, Popover, DialogTemplate, ActionMenu, AppNav, Menu, useLatest, useReaderBindings, slotContent, Slot, type ReaderViewProps } from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import { createSettingsDimensionPopover, type SettingsDimensionPopoverProps } from './settings-dimension-popover-controller';
import { dimensionLabel } from '../lib/components/settings/dimension-presets';
import { SettingsDimensionContent } from './settings-dimension-content';
const SlidersHorizontal = 'SlidersHorizontal';
export function SettingsDimensionPopover(props: Partial<SettingsDimensionPopoverProps> & ReaderViewProps & {
    children?: React.ReactNode;
    onClose?: () => void;
    slot?: string;
}) {
    const latest = useLatest(props);
    const context = useSettingsContext();
    const c = useReaderController(() => createSettingsDimensionPopover(props as SettingsDimensionPopoverProps, (name, detail) => { latest.current.events?.[name]?.({ detail }); if (name === 'close')
        latest.current.onClose?.(); }, context), props);
    useReaderBindings(c, props);
    if (!c)
        return null;
    return <SettingsContext.Provider value={context}><div className="react-settings-settings-dimension-popover" style={{ display: 'contents' }}>
    <Popover label={`Size presets for ${dimensionLabel(c.isVertical, c.isFirstDimension).toLowerCase()}`} dialog={true}>
    <Dom as="span" slot={"icon"} className={["flex min-h-11 min-w-9 items-center justify-center"].filter(Boolean).join(' ')}>
    <AppIcon icon={SlidersHorizontal} className={["size-5"].filter(Boolean).join(' ')}></AppIcon>
    </Dom>
    <SettingsDimensionContent slot={"content"} isFirstDimension={c.isFirstDimension} isVertical={c.isVertical} dimensionValue={c.dimensionValue} bindings={{ "dimensionValue": (value) => { c.controller.changed(c.dimensionValue = value); } }}></SettingsDimensionContent>
    </Popover></div></SettingsContext.Provider>;
}
