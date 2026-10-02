/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import { userFontsCacheName, type UserFont } from '$lib/data/fonts';
import { userFonts$ } from '$lib/data/store';
import type { BehaviorSubject } from 'rxjs';
import { fontActionError, removeUserFont, sameUserFont, storedFontPaths } from '../lib/components/settings/user-font-actions';
import { ReaderController, readerTick, writeStore, type StoreValue } from '../reader-react/controller';
import { type SettingsContextValue } from './context';

import { SettingsUserFontAdd } from './settings-user-font-add';
const DialogTemplate = 'DialogTemplate';
const Button = 'Button';
export interface SettingsUserFontDialogProps {
fontFamily: BehaviorSubject<string>;
}

export function createSettingsUserFontDialog(props: SettingsUserFontDialogProps, emit: (name: string, detail?: unknown) => void = () => {}, componentContext: SettingsContextValue) {
const __readerController = new ReaderController();

let $userFonts$: StoreValue<typeof userFonts$> = __readerController.read(userFonts$);
let fontFamily: BehaviorSubject<string> = props.fontFamily;
const dispatch = (name: string, detail?: unknown) => emit(name, detail);
let isLoading = false;
let cacheLoaded = false;
let currentTab = 'Stored';
let fontCache: Cache | undefined;
let availablePaths = new Set<string>();
let error = '';
let alive = false;
let loadGeneration = 0;
__readerController.onMount(() => {
    __readerController.changed(alive = true);
    void loadCache();
    return () => {
        __readerController.changed(alive = false);
        __readerController.changed(loadGeneration += 1);
    };
});
async function loadCache() {
    const generation = __readerController.changed(++loadGeneration);
    __readerController.changed(cacheLoaded = false);
    __readerController.changed(error = '');
    try {
        const cache = await caches.open(userFontsCacheName);
        const paths = await storedFontPaths(cache);
        if (!alive || generation !== loadGeneration)
            return;
        __readerController.changed(fontCache = cache);
        __readerController.changed(availablePaths = paths);
    }
    catch (cause) {
        if (!alive || generation !== loadGeneration)
            return;
        __readerController.changed(fontCache = undefined);
        __readerController.changed(error = fontActionError(cause));
    }
    finally {
        if (alive && generation === loadGeneration)
            __readerController.changed(cacheLoaded = true);
    }
}
async function selectFont(target: UserFont) {
    if (!alive || isLoading || !fontCache)
        return;
    const font = { ...target };
    const family = fontFamily;
    __readerController.changed(isLoading = true);
    __readerController.changed(error = '');
    try {
        const present = await fontCache.match(font.path);
        if (!alive || family !== fontFamily)
            return;
        if (!present || !$userFonts$.some((entry) => sameUserFont(entry, font))) {
            __readerController.changed(error = 'This font file is no longer available. Add it again to use it.');
            __readerController.changed(availablePaths = new Set([...availablePaths].filter((path) => path !== font.path)));
            return;
        }
        family.next(font.name);
        dispatch('close');
    }
    catch (cause) {
        if (alive)
            __readerController.changed(error = fontActionError(cause));
    }
    finally {
        if (alive)
            __readerController.changed(isLoading = false);
    }
}
async function removeFont(path: string) {
    const target = $userFonts$.find((entry) => entry.path === path);
    if (!target)
        return;
    if (!alive || isLoading || !fontCache)
        return;
    const family = fontFamily;
    __readerController.changed(isLoading = true);
    __readerController.changed(error = '');
    try {
        await removeUserFont(fontCache, { read: () => userFonts$.getValue(), write: (fonts) => userFonts$.next(fonts) }, target, { read: () => family.getValue(), write: (name) => family.next(name) });
        if (alive)
            await loadCache();
    }
    catch (cause) {
        if (alive)
            __readerController.changed(error = fontActionError(cause));
    }
    finally {
        if (alive)
            __readerController.changed(isLoading = false);
    }
}
__readerController.observeSource(() => userFonts$, (value) => { $userFonts$ = value; });
const api = { controller: __readerController, loadCache, selectFont, removeFont,
get fontFamily() { return fontFamily; }, set fontFamily(nextValue: typeof fontFamily) { if (Object.is(fontFamily, nextValue)) return; fontFamily = nextValue; __readerController.invalidate(); },
get dispatch() { return dispatch; },
get isLoading() { return isLoading; }, set isLoading(nextValue: typeof isLoading) { if (Object.is(isLoading, nextValue)) return; isLoading = nextValue; __readerController.invalidate(); },
get cacheLoaded() { return cacheLoaded; }, set cacheLoaded(nextValue: typeof cacheLoaded) { if (Object.is(cacheLoaded, nextValue)) return; cacheLoaded = nextValue; __readerController.invalidate(); },
get currentTab() { return currentTab; }, set currentTab(nextValue: typeof currentTab) { if (Object.is(currentTab, nextValue)) return; currentTab = nextValue; __readerController.invalidate(); },
get fontCache() { return fontCache; }, set fontCache(nextValue: typeof fontCache) { if (Object.is(fontCache, nextValue)) return; fontCache = nextValue; __readerController.invalidate(); },
get availablePaths() { return availablePaths; }, set availablePaths(nextValue: typeof availablePaths) { if (Object.is(availablePaths, nextValue)) return; availablePaths = nextValue; __readerController.invalidate(); },
get error() { return error; }, set error(nextValue: typeof error) { if (Object.is(error, nextValue)) return; error = nextValue; __readerController.invalidate(); },
get alive() { return alive; }, set alive(nextValue: typeof alive) { if (Object.is(alive, nextValue)) return; alive = nextValue; __readerController.invalidate(); },
get loadGeneration() { return loadGeneration; }, set loadGeneration(nextValue: typeof loadGeneration) { if (Object.is(loadGeneration, nextValue)) return; loadGeneration = nextValue; __readerController.invalidate(); },
get $userFonts$() { return $userFonts$; }, set $userFonts$(nextValue: typeof $userFonts$) { writeStore(userFonts$, nextValue); },
updateProps(next: Record<string, unknown>) {
if ('fontFamily' in next) api.fontFamily = next.fontFamily as typeof fontFamily;
}
};
return api;
}
