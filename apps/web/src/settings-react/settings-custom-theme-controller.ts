/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import type { ToggleOption } from '$lib/components/button-toggle-group/toggle-option';
import { customThemes$, theme$ } from '$lib/data/store';
import { availableThemes, themeForMode, customThemeValues, type CustomThemeValue, type ThemeOption } from '$lib/data/theme-option';
import { resolvedMode$ } from '$lib/appearance/state';
import { ReaderController, readerTick, writeStore, type StoreValue } from '../reader-react/controller';
import { type SettingsContextValue } from './context';

import { SettingsCustomThemeInput } from './settings-custom-theme-input';
const DialogTemplate = 'DialogTemplate';
const Button = 'Button';
const Input = 'Input';
export interface SettingsCustomThemeProps {
selectedTheme?: string;
existingThemes?: ToggleOption<string>[];
}

export function createSettingsCustomTheme(props: SettingsCustomThemeProps, emit: (name: string, detail?: unknown) => void = () => {}, componentContext: SettingsContextValue) {
const __readerController = new ReaderController();
let themeStyle: any;
let $theme$: StoreValue<typeof theme$> = __readerController.read(theme$);
let $resolvedMode$: StoreValue<typeof resolvedMode$> = __readerController.read(resolvedMode$);
let $customThemes$: StoreValue<typeof customThemes$> = __readerController.read(customThemes$);
let selectedTheme = props.selectedTheme !== undefined ? props.selectedTheme : '';
let existingThemes: ToggleOption<string>[] = props.existingThemes !== undefined ? props.existingThemes : [];
const dispatch = (name: string, detail?: unknown) => emit(name, detail);
let themeToCopy = $theme$;
let customTheme: Record<keyof ThemeOption, CustomThemeValue> = customThemeValues(themeForMode(themeToCopy, $resolvedMode$, $customThemes$));
let themeName = '';
let nameError = '';
// Input's bindable ref has a null fallback; passing undefined throws at runtime.
let themeNameElm: HTMLInputElement | null = null;
__readerController.effect(() => [customTheme], () => { __readerController.changed(themeStyle = `color: ${customTheme.fontColor.rgbaExpression}; background-color: ${customTheme.backgroundColor.rgbaExpression}`); });
__readerController.onMount(() => {
    const existingThemeObject = Object.hasOwn($customThemes$, selectedTheme)
        ? $customThemes$[selectedTheme]
        : undefined;
    if (!existingThemeObject) {
        return;
    }
    __readerController.changed(customTheme = customThemeValues(existingThemeObject));
    __readerController.changed(themeName = selectedTheme);
});
function handleCopyTheme() {
    copyTheme(themeForMode(themeToCopy, $resolvedMode$, $customThemes$));
}
function handleColorValueChange(event: CustomEvent<{
    attribute: keyof ThemeOption;
    value: string;
}>) {
    const { attribute, value } = event.detail;
    const entry = customTheme[attribute];
    __readerController.changed(customTheme = {
        ...customTheme,
        ...{
            [attribute]: {
                hexExpression: value,
                alphaValue: entry.alphaValue,
                rgbaExpression: hexToRGB(value, entry.alphaValue)
            }
        }
    });
}
function handleAlphaValueChange(event: CustomEvent<{
    attribute: keyof ThemeOption;
    value: number;
}>) {
    const { attribute, value } = event.detail;
    const entry = customTheme[attribute];
    __readerController.changed(customTheme = {
        ...customTheme,
        ...{
            [attribute]: {
                hexExpression: entry.hexExpression,
                alphaValue: value,
                rgbaExpression: hexToRGB(entry.hexExpression, value)
            }
        }
    });
}
function clearNameError() {
    __readerController.changed(nameError = '');
    themeNameElm?.setCustomValidity('');
}
function invalidName(message: string) {
    __readerController.changed(nameError = message);
    themeNameElm?.setCustomValidity(message);
    themeNameElm?.focus();
}
function handleSave() {
    clearNameError();
    __readerController.changed(themeName = themeName.trim());
    if (!themeName) {
        invalidName('Enter a theme name.');
        return;
    }
    if (availableThemes.has(themeName) || themeName === 'system-theme') {
        invalidName('This name is reserved for a built-in theme.');
        return;
    }
    if (themeName !== selectedTheme && Object.hasOwn($customThemes$, themeName)) {
        invalidName('A theme with this name already exists. Choose another name.');
        return;
    }
    const newTheme: any = {};
    const entries = [...Object.entries(customTheme)];
    for (let index = 0, { length } = entries; index < length; index += 1) {
        const [key, value] = entries[index];
        newTheme[key] = value.rgbaExpression;
    }
    const themes = { ...$customThemes$, [themeName]: newTheme };
    if (selectedTheme && selectedTheme !== themeName)
        delete themes[selectedTheme];
    writeStore(customThemes$, themes);
    writeStore(theme$, themeName);
    dispatch('close');
}
function copyTheme(theme: Record<keyof ThemeOption, string> | undefined) {
    if (!theme) {
        return;
    }
    __readerController.changed(customTheme = customThemeValues(theme));
}
function hexToRGB(h: string, alpha: number) {
    let r = '0';
    let g = '0';
    let b = '0';
    if (h.length === 4) {
        r = `0x${h[1]}${h[1]}`;
        g = `0x${h[2]}${h[2]}`;
        b = `0x${h[3]}${h[3]}`;
    }
    else if (h.length === 7) {
        r = `0x${h[1]}${h[2]}`;
        g = `0x${h[3]}${h[4]}`;
        b = `0x${h[5]}${h[6]}`;
    }
    return `rgba(${+r},${+g},${+b},${alpha})`;
}
__readerController.observeSource(() => theme$, (value) => { $theme$ = value; });
__readerController.observeSource(() => resolvedMode$, (value) => { $resolvedMode$ = value; });
__readerController.observeSource(() => customThemes$, (value) => { $customThemes$ = value; });
const api = { controller: __readerController, handleCopyTheme, handleColorValueChange, handleAlphaValueChange, clearNameError, invalidName, handleSave, copyTheme, hexToRGB,
get selectedTheme() { return selectedTheme; }, set selectedTheme(nextValue: typeof selectedTheme) { if (Object.is(selectedTheme, nextValue)) return; selectedTheme = nextValue; __readerController.invalidate(); },
get existingThemes() { return existingThemes; }, set existingThemes(nextValue: typeof existingThemes) { if (Object.is(existingThemes, nextValue)) return; existingThemes = nextValue; __readerController.invalidate(); },
get dispatch() { return dispatch; },
get themeToCopy() { return themeToCopy; }, set themeToCopy(nextValue: typeof themeToCopy) { if (Object.is(themeToCopy, nextValue)) return; themeToCopy = nextValue; __readerController.invalidate(); },
get customTheme() { return customTheme; }, set customTheme(nextValue: typeof customTheme) { if (Object.is(customTheme, nextValue)) return; customTheme = nextValue; __readerController.invalidate(); },
get themeName() { return themeName; }, set themeName(nextValue: typeof themeName) { if (Object.is(themeName, nextValue)) return; themeName = nextValue; __readerController.invalidate(); },
get nameError() { return nameError; }, set nameError(nextValue: typeof nameError) { if (Object.is(nameError, nextValue)) return; nameError = nextValue; __readerController.invalidate(); },
get themeNameElm() { return themeNameElm; }, set themeNameElm(nextValue: typeof themeNameElm) { if (Object.is(themeNameElm, nextValue)) return; themeNameElm = nextValue; __readerController.invalidate(); },
get themeStyle() { return themeStyle; }, set themeStyle(nextValue: typeof themeStyle) { if (Object.is(themeStyle, nextValue)) return; themeStyle = nextValue; __readerController.invalidate(); },
get $theme$() { return $theme$; }, set $theme$(nextValue: typeof $theme$) { writeStore(theme$, nextValue); },
get $resolvedMode$() { return $resolvedMode$; },
get $customThemes$() { return $customThemes$; }, set $customThemes$(nextValue: typeof $customThemes$) { writeStore(customThemes$, nextValue); },
updateProps(next: Record<string, unknown>) {
if ('selectedTheme' in next && next.selectedTheme !== undefined) api.selectedTheme = next.selectedTheme as typeof selectedTheme;
if ('existingThemes' in next && next.existingThemes !== undefined) api.existingThemes = next.existingThemes as typeof existingThemes;
}
};
return api;
}
