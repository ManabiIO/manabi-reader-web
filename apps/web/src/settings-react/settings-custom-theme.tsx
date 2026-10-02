/** @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors. All rights reserved. */
import React from 'react';
import { useReaderController, readerTick } from '../reader-react/controller';
import { Dom, SurfaceEvents, Head, Icon, AppIcon, Button, Input, Switch, Field, Popover, DialogTemplate, ActionMenu, AppNav, Menu, useLatest, useReaderBindings, slotContent, Slot, type ReaderViewProps } from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import { createSettingsCustomTheme, type SettingsCustomThemeProps } from './settings-custom-theme-controller';
import type { ToggleOption } from '$lib/components/button-toggle-group/toggle-option';
import { customThemes$, theme$ } from '$lib/data/store';
import { availableThemes, themeForMode, customThemeValues, type CustomThemeValue, type ThemeOption } from '$lib/data/theme-option';
import { resolvedMode$ } from '$lib/appearance/state';
import { SettingsCustomThemeInput } from './settings-custom-theme-input';
export function SettingsCustomTheme(props: Partial<SettingsCustomThemeProps> & ReaderViewProps & {
    children?: React.ReactNode;
    onClose?: () => void;
    slot?: string;
}) {
    const latest = useLatest(props);
    const context = useSettingsContext();
    const c = useReaderController(() => createSettingsCustomTheme(props as SettingsCustomThemeProps, (name, detail) => { latest.current.events?.[name]?.({ detail }); if (name === 'close')
        latest.current.onClose?.(); }, context), props);
    useReaderBindings(c, props);
    if (!c)
        return null;
    return <SettingsContext.Provider value={context}><div className="react-settings-settings-custom-theme" style={{ display: 'contents' }}>
    <DialogTemplate>
    <Dom as="div" slot={"content"}>
    <Dom as="div" className={["grid grid-cols-1 gap-2 items-center overflow-auto max-h-[60vh] sm:grid-cols-[auto_auto_5rem] sm:gap-4"].filter(Boolean).join(' ')}>
    <Dom as="select" aria-label={"Copy colors from theme"} value={c.themeToCopy} className={["min-h-11 rounded-xl border border-input bg-background px-3 sm:col-span-2"].filter(Boolean).join(' ')} bindings={{ "value": (value) => { c.controller.changed(c.themeToCopy = value); } }}>
        {(c.existingThemes ?? []).map((theme, index0) => <React.Fragment key={theme.id}><Dom as="option" value={theme.id}>
        {theme.id}
        </Dom></React.Fragment>)}
    </Dom>
    <Button variant={"outline"} onClick={c.handleCopyTheme} className={["min-h-11"].filter(Boolean).join(' ')}>{"Copy"}</Button>
    <Dom as="span" className={["hidden sm:block"].filter(Boolean).join(' ')}>{"Attribute"}</Dom>
    <Dom as="span" className={["hidden sm:block"].filter(Boolean).join(' ')}>{"Color"}</Dom>
    <Dom as="span" className={["hidden sm:block"].filter(Boolean).join(' ')}>{"Alpha"}</Dom>
    <SettingsCustomThemeInput label={"Font"} attribute={"fontColor"} values={c.customTheme.fontColor} events={{ "color": c.handleColorValueChange, "alpha": c.handleAlphaValueChange }}></SettingsCustomThemeInput>
    <SettingsCustomThemeInput label={"Background"} attribute={"backgroundColor"} values={c.customTheme.backgroundColor} events={{ "color": c.handleColorValueChange, "alpha": c.handleAlphaValueChange }}></SettingsCustomThemeInput>
    <SettingsCustomThemeInput label={"Selected text"} attribute={"selectionFontColor"} values={c.customTheme.selectionFontColor} events={{ "color": c.handleColorValueChange, "alpha": c.handleAlphaValueChange }}></SettingsCustomThemeInput>
    <SettingsCustomThemeInput label={"Selection background"} attribute={"selectionBackgroundColor"} values={c.customTheme.selectionBackgroundColor} events={{ "color": c.handleColorValueChange, "alpha": c.handleAlphaValueChange }}></SettingsCustomThemeInput>
    <SettingsCustomThemeInput label={"Furigana Partial Hide Font"} attribute={"hintFuriganaFontColor"} values={c.customTheme.hintFuriganaFontColor} events={{ "color": c.handleColorValueChange, "alpha": c.handleAlphaValueChange }}></SettingsCustomThemeInput>
    <SettingsCustomThemeInput label={"Furigana Partial/Full Hide Shadow"} attribute={"hintFuriganaShadowColor"} values={c.customTheme.hintFuriganaShadowColor} events={{ "color": c.handleColorValueChange, "alpha": c.handleAlphaValueChange }}></SettingsCustomThemeInput>
    <SettingsCustomThemeInput label={"Footer Font"} attribute={"tooltipTextFontColor"} values={c.customTheme.tooltipTextFontColor} events={{ "color": c.handleColorValueChange, "alpha": c.handleAlphaValueChange }}></SettingsCustomThemeInput>
    <Input type={"text"} placeholder={"Theme Name"} aria-label={"Theme name"} aria-invalid={Boolean(c.nameError)} aria-describedby={c.nameError ? 'custom-theme-name-error' : undefined} onInput={c.clearNameError} value={c.themeName} ref={c.themeNameElm} className={["min-h-11 sm:col-span-2"].filter(Boolean).join(' ')} bindings={{ "value": (value) => { c.controller.changed(c.themeName = value); }, "ref": (value) => { c.controller.changed(c.themeNameElm = value); } }}></Input>
    <Dom as="div" data-theme-preview={true} aria-hidden={"true"} styleText={c.themeStyle} className={["flex min-h-11 items-center justify-center rounded-xl border-2 border-border p-2 text-lg"].filter(Boolean).join(' ')}>{" ぁあ "}</Dom>
    </Dom>
        {(c.nameError) ? <><Dom as="p" id={"custom-theme-name-error"} role={"alert"} className={["mt-3"].filter(Boolean).join(' ')}>{c.nameError}</Dom></> : null}
    </Dom>
    <Dom as="div" slot={"footer"} className={["mt-2 flex grow justify-between gap-2"].filter(Boolean).join(' ')}>
    <Button variant={"ghost"} onClick={() => c.dispatch('close')}>{"Cancel"}</Button>
    <Button variant={"secondary"} onClick={c.handleSave}>{"Save"}</Button>
    </Dom>
    </DialogTemplate></div></SettingsContext.Provider>;
}
