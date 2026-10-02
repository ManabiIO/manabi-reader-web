/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import { backgrounds, chooseBackground, removeBackground, removeBackgrounds } from '../lib/appearance/backgrounds';
import { libraryBackgroundOptions$, readerBackgroundOptions$, type BackgroundMode, type BackgroundTarget } from '../lib/appearance/state';
import { ReaderController, readerTick, writeStore, type StoreValue } from '../reader-react/controller';
import { type SettingsContextValue } from './context';


const Button = 'Button';
const Switch = 'Switch';
export interface BackgroundSettingsProps {
target: BackgroundTarget;
label: string;
}

export function createBackgroundSettings(props: BackgroundSettingsProps, emit: (name: string, detail?: unknown) => void = () => {}, componentContext: SettingsContextValue) {
const __readerController = new ReaderController();
let options = props.target === 'library' ? libraryBackgroundOptions$ : readerBackgroundOptions$;
let state: any;
let busy: any;
let hasAnything: any;
let opacity: any;
let $backgrounds: StoreValue<typeof backgrounds> = __readerController.read(backgrounds);
let $options: StoreValue<typeof options> = __readerController.read(options);
let target: BackgroundTarget = props.target;
let label: string = props.label;
const modes: {
    value: BackgroundMode;
    label: string;
    fadeColor: string;
}[] = [
    { value: 'light', label: 'Light', fadeColor: '255 255 255' },
    { value: 'dark', label: 'Dark', fadeColor: '0 0 0' }
];
__readerController.effect(() => [target], () => { __readerController.changed(options = target === 'library' ? libraryBackgroundOptions$ : readerBackgroundOptions$); });
__readerController.effect(() => [$backgrounds, target], () => { __readerController.changed(state = $backgrounds[target]); });
__readerController.effect(() => [state], () => { __readerController.changed(busy = state.light.busy || state.dark.busy); });
__readerController.effect(() => [state], () => { __readerController.changed(hasAnything =
    !!state.light.url || !!state.dark.url || !!state.light.error || !!state.dark.error); });
__readerController.effect(() => [$options], () => { __readerController.changed(opacity = $options.fade ? $options.amount / 100 : 0); });
async function select(mode: BackgroundMode, event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file)
        await chooseBackground(target, mode, file).catch(() => undefined);
}
__readerController.observeSource(() => backgrounds, (value) => { $backgrounds = value; });
__readerController.observeSource(() => options, (value) => { $options = value; });
const api = { controller: __readerController, select,
get target() { return target; }, set target(nextValue: typeof target) { if (Object.is(target, nextValue)) return; target = nextValue; __readerController.invalidate(); },
get label() { return label; }, set label(nextValue: typeof label) { if (Object.is(label, nextValue)) return; label = nextValue; __readerController.invalidate(); },
get modes() { return modes; },
get options() { return options; }, set options(nextValue: typeof options) { if (Object.is(options, nextValue)) return; options = nextValue; __readerController.invalidate(); },
get state() { return state; }, set state(nextValue: typeof state) { if (Object.is(state, nextValue)) return; state = nextValue; __readerController.invalidate(); },
get busy() { return busy; }, set busy(nextValue: typeof busy) { if (Object.is(busy, nextValue)) return; busy = nextValue; __readerController.invalidate(); },
get hasAnything() { return hasAnything; }, set hasAnything(nextValue: typeof hasAnything) { if (Object.is(hasAnything, nextValue)) return; hasAnything = nextValue; __readerController.invalidate(); },
get opacity() { return opacity; }, set opacity(nextValue: typeof opacity) { if (Object.is(opacity, nextValue)) return; opacity = nextValue; __readerController.invalidate(); },
get $backgrounds() { return $backgrounds; }, set $backgrounds(nextValue: typeof $backgrounds) { writeStore(backgrounds, nextValue); },
get $options() { return $options; }, set $options(nextValue: typeof $options) { writeStore(options, nextValue); },
updateProps(next: Record<string, unknown>) {
if ('target' in next) api.target = next.target as typeof target;
if ('label' in next) api.label = next.label as typeof label;
}
};
return api;
}
