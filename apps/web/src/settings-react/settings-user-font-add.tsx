/** @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors. All rights reserved. */
import React from 'react';
import { useReaderController, readerTick } from '../reader-react/controller';
import { Dom, SurfaceEvents, Head, Icon, AppIcon, Button, Input, Switch, Field, Popover, DialogTemplate, ActionMenu, AppNav, Menu, useLatest, useReaderBindings, slotContent, Slot, type ReaderViewProps } from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import { createSettingsUserFontAdd, type SettingsUserFontAddProps } from './settings-user-font-add-controller';
import { reservedFontNames } from '$lib/data/fonts';
import { userFonts$ } from '$lib/data/store';
import { fontActionError, saveUserFont } from '../lib/components/settings/user-font-actions';
export function SettingsUserFontAdd(props: Partial<SettingsUserFontAddProps> & ReaderViewProps & {
    children?: React.ReactNode;
    onClose?: () => void;
    slot?: string;
}) {
    const latest = useLatest(props);
    const context = useSettingsContext();
    const c = useReaderController(() => createSettingsUserFontAdd(props as SettingsUserFontAddProps, (name, detail) => { latest.current.events?.[name]?.({ detail }); if (name === 'close')
        latest.current.onClose?.(); }, context), props);
    useReaderBindings(c, props);
    if (!c)
        return null;
    return <SettingsContext.Provider value={context}><div className="react-settings-settings-user-font-add" style={{ display: 'contents' }}>
    <Dom as="form" aria-busy={c.isLoading} className={["min-w-0 space-y-4"].filter(Boolean).join(' ')} events={{ "submit": (event) => { event.preventDefault(); Reflect.apply(c.addFont, undefined, [event]); } }}>
    <Dom as="label" htmlFor={`${c.formId}-name`} className={["block min-w-0 text-sm font-medium"].filter(Boolean).join(' ')}>{" Font name "}<Input id={`${c.formId}-name`} type={"text"} required={true} maxLength={200} disabled={c.isLoading} value={c.fontName} onInput={() => (c.controller.changed(c.currentError = ''))} onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229))
                event.preventDefault();
        }} className={["mt-2"].filter(Boolean).join(' ')} bindings={{ "value": (value) => { c.controller.changed(c.fontName = value); } }}></Input>
    </Dom>
    <Dom as="label" htmlFor={`${c.formId}-file`} className={["block min-w-0 text-sm font-medium"].filter(Boolean).join(' ')}>{" Font file "}<Input id={`${c.formId}-file`} type={"file"} required={true} disabled={c.isLoading} accept={".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf"} ref={c.fileElement} onChange={c.handleFileChange} className={["mt-2"].filter(Boolean).join(' ')} bindings={{ "ref": (value) => { c.controller.changed(c.fileElement = value); } }}></Input>
    </Dom>
    <Dom as="p" className={["text-sm text-muted-foreground"].filter(Boolean).join(' ')}>{" WOFF2, WOFF, TTF, or OTF. The file is saved only in this browser; it is not uploaded to your account. "}</Dom>
        {(c.currentError) ? <><Dom as="p" role={"alert"} className={["break-words text-sm text-destructive"].filter(Boolean).join(' ')}>
        {c.currentError}
        </Dom></> : null}
    <Dom as="div" className={["flex flex-wrap items-center justify-end gap-3"].filter(Boolean).join(' ')}>
        {(c.isLoading) ? <><Dom as="p" role={"status"} className={["text-sm text-muted-foreground"].filter(Boolean).join(' ')}>{"Saving font…"}</Dom></> : null}
    <Button type={"submit"} disabled={c.isLoading} className={["min-h-11"].filter(Boolean).join(' ')}>{"Save font"}</Button>
    </Dom>
    </Dom></div></SettingsContext.Provider>;
}
