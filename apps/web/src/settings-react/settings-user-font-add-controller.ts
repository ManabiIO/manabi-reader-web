/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import { reservedFontNames } from '$lib/data/fonts';
import { userFonts$ } from '$lib/data/store';
import { fontActionError, saveUserFont } from '../lib/components/settings/user-font-actions';
import { ReaderController, readerTick, writeStore, type StoreValue } from '../reader-react/controller';
import { type SettingsContextValue } from './context';


const Button = 'Button';
const Input = 'Input';
export interface SettingsUserFontAddProps {
isLoading?: boolean;
fontCache: Cache;
}

export function createSettingsUserFontAdd(props: SettingsUserFontAddProps, emit: (name: string, detail?: unknown) => void = () => {}, componentContext: SettingsContextValue) {
const __readerController = new ReaderController();


let isLoading = props.isLoading !== undefined ? props.isLoading : false;
let fontCache: Cache = props.fontCache;
const dispatch = (name: string, detail?: unknown) => emit(name, detail);
const formId = `custom-font-${crypto.randomUUID()}`;
let fileElement: HTMLInputElement | null = null;
let fontName = '';
let fontFile: File | undefined;
let currentError = '';
let alive = true;
__readerController.onDestroy(() => {
    __readerController.changed(alive = false);
});
function handleFileChange(event: Event) {
    __readerController.changed(fontFile = (event.currentTarget as HTMLInputElement).files?.[0]);
    __readerController.changed(currentError = '');
}
async function addFont() {
    if (isLoading || !alive)
        return;
    __readerController.changed(isLoading = true);
    __readerController.changed(currentError = '');
    try {
        await saveUserFont(fontCache, { read: () => userFonts$.getValue(), write: (fonts) => userFonts$.next(fonts) }, fontName, fontFile, reservedFontNames);
        if (!alive)
            return;
        __readerController.changed(fontName = '');
        __readerController.changed(fontFile = undefined);
        if (fileElement)
            __readerController.changed(fileElement.value = '');
        __readerController.changed(isLoading = false);
        dispatch('saved');
    }
    catch (error) {
        if (alive)
            __readerController.changed(currentError = fontActionError(error));
    }
    finally {
        if (alive)
            __readerController.changed(isLoading = false);
    }
}

const api = { controller: __readerController, handleFileChange, addFont,
get isLoading() { return isLoading; }, set isLoading(nextValue: typeof isLoading) { if (Object.is(isLoading, nextValue)) return; isLoading = nextValue; __readerController.invalidate(); },
get fontCache() { return fontCache; }, set fontCache(nextValue: typeof fontCache) { if (Object.is(fontCache, nextValue)) return; fontCache = nextValue; __readerController.invalidate(); },
get dispatch() { return dispatch; },
get formId() { return formId; },
get fileElement() { return fileElement; }, set fileElement(nextValue: typeof fileElement) { if (Object.is(fileElement, nextValue)) return; fileElement = nextValue; __readerController.invalidate(); },
get fontName() { return fontName; }, set fontName(nextValue: typeof fontName) { if (Object.is(fontName, nextValue)) return; fontName = nextValue; __readerController.invalidate(); },
get fontFile() { return fontFile; }, set fontFile(nextValue: typeof fontFile) { if (Object.is(fontFile, nextValue)) return; fontFile = nextValue; __readerController.invalidate(); },
get currentError() { return currentError; }, set currentError(nextValue: typeof currentError) { if (Object.is(currentError, nextValue)) return; currentError = nextValue; __readerController.invalidate(); },
get alive() { return alive; }, set alive(nextValue: typeof alive) { if (Object.is(alive, nextValue)) return; alive = nextValue; __readerController.invalidate(); },
updateProps(next: Record<string, unknown>) {
if ('isLoading' in next && next.isLoading !== undefined) api.isLoading = next.isLoading as typeof isLoading;
if ('fontCache' in next) api.fontCache = next.fontCache as typeof fontCache;
}
};
return api;
}
