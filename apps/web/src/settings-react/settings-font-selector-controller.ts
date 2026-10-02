/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import { LocalFont } from '$lib/data/fonts';
import { ReaderController, readerTick, writeStore, type StoreValue } from '../reader-react/controller';
import { type SettingsContextValue } from './context';


const Menu = 'Menu';
const ActionMenu = 'ActionMenu';
export interface SettingsFontSelectorProps {
availableFonts?: LocalFont[];
fontValue: string;
selectedFont?: string | undefined;
label?: string;
}

export function createSettingsFontSelector(props: SettingsFontSelectorProps, emit: (name: string, detail?: unknown) => void = () => {}, componentContext: SettingsContextValue) {
const __readerController = new ReaderController();


let availableFonts: LocalFont[] = props.availableFonts !== undefined ? props.availableFonts : [LocalFont.NOTOSANSJP];
let fontValue: string = props.fontValue;
let selectedFont: string | undefined = props.selectedFont !== undefined ? props.selectedFont : undefined;
let label = props.label !== undefined ? props.label : 'Show available fonts';

const api = { controller: __readerController, 
get availableFonts() { return availableFonts; }, set availableFonts(nextValue: typeof availableFonts) { if (Object.is(availableFonts, nextValue)) return; availableFonts = nextValue; __readerController.invalidate(); },
get fontValue() { return fontValue; }, set fontValue(nextValue: typeof fontValue) { if (Object.is(fontValue, nextValue)) return; fontValue = nextValue; __readerController.invalidate(); },
get selectedFont() { return selectedFont; }, set selectedFont(nextValue: typeof selectedFont) { if (Object.is(selectedFont, nextValue)) return; selectedFont = nextValue; __readerController.invalidate(); },
get label() { return label; }, set label(nextValue: typeof label) { if (Object.is(label, nextValue)) return; label = nextValue; __readerController.invalidate(); },
updateProps(next: Record<string, unknown>) {
if ('availableFonts' in next && next.availableFonts !== undefined) api.availableFonts = next.availableFonts as typeof availableFonts;
if ('fontValue' in next) api.fontValue = next.fontValue as typeof fontValue;
if ('selectedFont' in next) api.selectedFont = next.selectedFont as typeof selectedFont;
if ('label' in next && next.label !== undefined) api.label = next.label as typeof label;
}
};
return api;
}
