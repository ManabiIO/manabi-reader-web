/** @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors. All rights reserved. */
import React from 'react';
import { useReaderController, readerTick } from '../reader-react/controller';
import { Dom, SurfaceEvents, Head, Icon, AppIcon, Button, Input, Switch, Field, Popover, DialogTemplate, ActionMenu, AppNav, Menu, useLatest, useReaderBindings, slotContent, Slot, type ReaderViewProps } from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import { createBackgroundSettings, type BackgroundSettingsProps } from './background-settings-controller';
import { backgrounds, chooseBackground, removeBackground, removeBackgrounds } from '../lib/appearance/backgrounds';
import { libraryBackgroundOptions$, readerBackgroundOptions$, type BackgroundMode, type BackgroundTarget } from '../lib/appearance/state';
export function BackgroundSettings(props: Partial<BackgroundSettingsProps> & ReaderViewProps & {
    children?: React.ReactNode;
    onClose?: () => void;
    slot?: string;
}) {
    const latest = useLatest(props);
    const context = useSettingsContext();
    const c = useReaderController(() => createBackgroundSettings(props as BackgroundSettingsProps, (name, detail) => { latest.current.events?.[name]?.({ detail }); if (name === 'close')
        latest.current.onClose?.(); }, context), props);
    useReaderBindings(c, props);
    if (!c)
        return null;
    return <SettingsContext.Provider value={context}><div className="react-settings-background-settings" style={{ display: 'contents' }}>
    <Dom as="fieldset" aria-busy={c.busy} className={["background-setting"].filter(Boolean).join(' ')}>
    <Dom as="legend">{c.label}</Dom>
    <Dom as="div" className={["mode-grid"].filter(Boolean).join(' ')}>
        {(c.modes ?? []).map((mode, index0) => <React.Fragment key={mode.value}>{(() => {
                const image = c.state[mode.value];
                return <>
                <Dom as="section" aria-labelledby={String((c.target) ?? '') + "-" + String((mode.value) ?? '') + "-heading"} className={["mode-image rounded-2xl bg-muted/40 p-3"].filter(Boolean).join(' ')}>
                <Dom as="h3" id={String((c.target) ?? '') + "-" + String((mode.value) ?? '') + "-heading"}>{mode.label}</Dom>
                <Dom as="div" aria-hidden={"true"} className={["background-preview", (mode.value === 'dark') && "dark-preview"].filter(Boolean).join(' ')} style={{ "backgroundImage": image.url ? `url("${image.url}")` : undefined, "--image-fade-color": mode.fadeColor, "--background-fade": c.opacity }}>
                {(image.url) ? <><Dom as="span" className={[(c.target === 'reader') && "reader-preview"].filter(Boolean).join(' ')}>{"本を読む"}<Dom as="br"/><Dom as="small">{"Read comfortably"}</Dom></Dom></> : <> <Dom as="span">{"No image"}</Dom></>}
                </Dom>
                <Button variant={"outline"} onClick={() => document.getElementById(`background-${c.target}-${mode.value}`)?.click()} disabled={image.busy} className={["w-full"].filter(Boolean).join(' ')}>{"Choose "}{mode.label.toLowerCase()}{" image"}</Button>
                <Dom as="input" id={"background-" + String((c.target) ?? '') + "-" + String((mode.value) ?? '')} type={"file"} aria-label={`Choose ${mode.label.toLowerCase()} ${c.label.toLowerCase()}`} accept={"image/png,image/jpeg,image/webp"} disabled={image.busy} className={["sr-only"].filter(Boolean).join(' ')} events={{ "change": (event) => c.select(mode.value, event) }}/>
                    {(image.url || image.error) ? <><Button variant={"ghost"} disabled={image.busy} onClick={() => removeBackground(c.target, mode.value).catch(() => undefined)} aria-label={"Remove " + String((mode.label.toLowerCase()) ?? '') + " " + String((c.label.toLowerCase()) ?? '')}>{"Remove"}</Button></> : null}
                {(image.name) ? <><Dom as="p" className={["filename"].filter(Boolean).join(' ')}>{image.name}</Dom></> : null}
                {(image.busy) ? <><Dom as="p" role={"status"}>{"Preparing image…"}</Dom></> : null}
                    {(image.error) ? <><Dom as="p" role={"alert"} className={["error"].filter(Boolean).join(' ')}>{image.error}</Dom></> : null}
                </Dom></>;
            })()}</React.Fragment>)}
    </Dom>
        {(c.hasAnything) ? <><Button variant={"outline"} disabled={c.busy} onClick={() => removeBackgrounds(c.target).catch(() => undefined)} aria-label={"Remove both " + String((c.label.toLowerCase()) ?? '') + " images"} className={["mt-3"].filter(Boolean).join(' ')}>{"Remove both"}</Button></> : null}
    <Dom as="div" className={["fade-toggle"].filter(Boolean).join(' ')}>
    <Switch id={`fade-enabled-${c.target}`} checked={c.$options.fade} onCheckedChange={(fade) => c.options.next({ ...c.$options, fade })} aria-label={`Fade ${c.label.toLowerCase()}`}></Switch>
    <Dom as="label" htmlFor={`fade-enabled-${c.target}`}>{"Fade background"}</Dom>
    </Dom>
    <Dom as="label" htmlFor={"fade-" + String((c.target) ?? '')} className={["fade-label"].filter(Boolean).join(' ')}>{"Fade amount "}<Dom as="output" htmlFor={"fade-" + String((c.target) ?? '')}>{c.$options.amount}{"%"}</Dom></Dom>
    <Dom as="input" id={"fade-" + String((c.target) ?? '')} type={"range"} min={"0"} max={"100"} step={"1"} value={c.$options.amount} disabled={!c.$options.fade} events={{ "input": (event) => c.options.next({ ...c.$options, amount: event.currentTarget.valueAsNumber }) }}/>
    <Dom as="p" className={["fade-note"].filter(Boolean).join(' ')}>{"Light fades toward white; dark fades toward black."}</Dom>
    </Dom>
    </div></SettingsContext.Provider>;
}
