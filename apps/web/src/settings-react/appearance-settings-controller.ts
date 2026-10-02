/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import { appearance$, type BackgroundTarget } from '../lib/appearance/state';
import type { AppearanceMode } from '$lib/data/theme-option';
import { ReaderController, readerTick, writeStore, type StoreValue } from '../reader-react/controller';
import { type SettingsContextValue } from './context';

import { BackgroundSettings } from './background-settings';
const Button = 'Button';
export interface AppearanceSettingsProps {

}

export function createAppearanceSettings(props: AppearanceSettingsProps, emit: (name: string, detail?: unknown) => void = () => {}, componentContext: SettingsContextValue) {
const __readerController = new ReaderController();

let $appearance$: StoreValue<typeof appearance$> = __readerController.read(appearance$);
const modes: {
    value: AppearanceMode;
    label: string;
}[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' }
];
const backgrounds: {
    target: BackgroundTarget;
    label: string;
}[] = [
    { target: 'library', label: 'Book browser background' },
    { target: 'reader', label: 'Book reader background' }
];
__readerController.observeSource(() => appearance$, (value) => { $appearance$ = value; });
const api = { controller: __readerController, 
get modes() { return modes; },
get backgrounds() { return backgrounds; },
get $appearance$() { return $appearance$; }, set $appearance$(nextValue: typeof $appearance$) { writeStore(appearance$, nextValue); },
updateProps(next: Record<string, unknown>) {

}
};
return api;
}
