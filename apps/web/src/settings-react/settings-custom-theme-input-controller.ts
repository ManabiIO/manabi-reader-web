/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import type { CustomThemeValue, ThemeOption } from '$lib/data/theme-option';
import { ReaderController, readerTick, writeStore, type StoreValue } from '../reader-react/controller';
import { type SettingsContextValue } from './context';


const Input = 'Input';
export interface SettingsCustomThemeInputProps {
label: string;
attribute: keyof ThemeOption;
values: CustomThemeValue;
}

export function createSettingsCustomThemeInput(props: SettingsCustomThemeInputProps, emit: (name: string, detail?: unknown) => void = () => {}, componentContext: SettingsContextValue) {
const __readerController = new ReaderController();


let label: string = props.label;
let attribute: keyof ThemeOption = props.attribute;
let values: CustomThemeValue = props.values;
const dispatch = (name: string, detail?: unknown) => emit(name, detail);
function handleColorChange(event: Event) {
    const target = event.target as HTMLInputElement;
    dispatch('color', { attribute, value: target.value });
}
function handleAlphaChange(event: Event) {
    const target = event.target as HTMLInputElement;
    let value = target.value ? parseFloat(target.value) : undefined;
    if (!Number.isFinite(value) || value === undefined || value < 0 || value > 1) {
        value = 1;
        target.value = '1';
    }
    dispatch('alpha', { attribute, value });
}

const api = { controller: __readerController, handleColorChange, handleAlphaChange,
get label() { return label; }, set label(nextValue: typeof label) { if (Object.is(label, nextValue)) return; label = nextValue; __readerController.invalidate(); },
get attribute() { return attribute; }, set attribute(nextValue: typeof attribute) { if (Object.is(attribute, nextValue)) return; attribute = nextValue; __readerController.invalidate(); },
get values() { return values; }, set values(nextValue: typeof values) { if (Object.is(values, nextValue)) return; values = nextValue; __readerController.invalidate(); },
get dispatch() { return dispatch; },
updateProps(next: Record<string, unknown>) {
if ('label' in next) api.label = next.label as typeof label;
if ('attribute' in next) api.attribute = next.attribute as typeof attribute;
if ('values' in next) api.values = next.values as typeof values;
}
};
return api;
}
