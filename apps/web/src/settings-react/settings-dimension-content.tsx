/** @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors. All rights reserved. */
import React from 'react';
import { useReaderController, readerTick } from '../reader-react/controller';
import { Dom, SurfaceEvents, Head, Icon, AppIcon, Button, Input, Switch, Field, Popover, DialogTemplate, ActionMenu, AppNav, Menu, useLatest, useReaderBindings, slotContent, Slot, type ReaderViewProps } from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import { createSettingsDimensionContent, type SettingsDimensionContentProps } from './settings-dimension-content-controller';
import { dimensionExtent, dimensionLabel, dimensionLimits, dimensionPercentage, dimensionPixels } from '../lib/components/settings/dimension-presets';
export function SettingsDimensionContent(props: Partial<SettingsDimensionContentProps> & ReaderViewProps & {
    children?: React.ReactNode;
    onClose?: () => void;
    slot?: string;
}) {
    const latest = useLatest(props);
    const context = useSettingsContext();
    const c = useReaderController(() => createSettingsDimensionContent(props as SettingsDimensionContentProps, (name, detail) => { latest.current.events?.[name]?.({ detail }); if (name === 'close')
        latest.current.onClose?.(); }, context), props);
    useReaderBindings(c, props);
    if (!c)
        return null;
    return <SettingsContext.Provider value={context}><div className="react-settings-settings-dimension-content" style={{ display: 'contents' }}>
    <SurfaceEvents target="window" bindings={{ "innerWidth": (value: typeof c.width) => { c.controller.changed(c.width = value); }, "innerHeight": (value: typeof c.height) => { c.controller.changed(c.height = value); } }}></SurfaceEvents>
    <Dom as="fieldset" className={["dimension-presets min-w-0 space-y-3 p-3"].filter(Boolean).join(' ')}>
    <Dom as="legend" className={["max-w-full px-1 text-sm font-semibold"].filter(Boolean).join(' ')}>{c.label}</Dom>
    <Dom as="p" className={["text-sm text-muted-foreground"].filter(Boolean).join(' ')}>{" Current: "}<Dom as="strong" className={["text-foreground"].filter(Boolean).join(' ')}>{c.currentValue}</Dom>
    </Dom>
    <Dom as="label" className={["block text-sm"].filter(Boolean).join(' ')}>
    <Dom as="span" className={["font-medium"].filter(Boolean).join(' ')}>{"Quick size"}</Dom>
    <Dom as="span" className={["block text-xs text-muted-foreground"].filter(Boolean).join(' ')}>
    {c.shownPercentage}{"% of the window"}{c.isFirstDimension ? ', split between both sides' : ''}
    {(c.pixels !== null) ? <>{"· "}{c.pixels}{" px"}{c.isFirstDimension ? ' per side' : ''}</> : null}
    </Dom>
    <Dom as="input" type={"range"} min={c.limits.min} max={c.limits.max} step={c.limits.step} value={c.shownPercentage} disabled={!c.extent} aria-label={`Quick size for ${c.label.toLowerCase()}`} aria-valuetext={`${c.shownPercentage}%${c.pixels === null ? '' : `, ${c.pixels} pixels${c.isFirstDimension ? ' per side' : ''}`}`} className={["mt-2 block min-h-11 w-full accent-primary"].filter(Boolean).join(' ')} events={{ "input": (event: Event & { currentTarget: HTMLInputElement }) => (c.controller.changed(c.preview = { context: c.context, percentage: event.currentTarget.valueAsNumber })), "blur": () => (c.controller.changed(c.preview = undefined)), "pointercancel": () => (c.controller.changed(c.preview = undefined)), "change": (event: Event & { currentTarget: HTMLInputElement }) => c.setToValue(event.currentTarget.valueAsNumber) }}/>
    </Dom>
    <Dom as="div" className={["flex flex-wrap gap-2"].filter(Boolean).join(' ')}>
    <Button variant={"outline"} disabled={!c.extent} onClick={() => c.setToValue(c.isFirstDimension ? 25 : 75)} className={["min-h-11"].filter(Boolean).join(' ')}>
    {c.isFirstDimension ? 25 : 75}{"% "}</Button>
    <Button variant={"outline"} disabled={!c.extent} onClick={() => c.setToValue(50)} className={["min-h-11"].filter(Boolean).join(' ')}>{"50%"}</Button>
        {(!c.isFirstDimension) ? <><Button variant={"ghost"} onClick={() => (c.controller.changed(c.dimensionValue = 0))} className={["min-h-11"].filter(Boolean).join(' ')}>{"Automatic"}</Button></> : null}
    </Dom>
    <Dom as="p" className={["text-xs text-muted-foreground"].filter(Boolean).join(' ')}>{" Choose a size to save it in pixels. Opening this panel or resizing the window does not change your setting. "}</Dom>
    </Dom>
    </div></SettingsContext.Provider>;
}
