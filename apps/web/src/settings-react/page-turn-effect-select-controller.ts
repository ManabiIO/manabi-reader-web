/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import { pageTurnEffect$ } from '$lib/data/page-turn-preferences';
import { normalizePageTurnEffect } from '$lib/foliate-epub/page-turn-effect';
import { ReaderController, readerTick, writeStore, type StoreValue } from '../reader-react/controller';
import { type SettingsContextValue } from './context';



export interface PageTurnEffectSelectProps {

}

export function createPageTurnEffectSelect(props: PageTurnEffectSelectProps, emit: (name: string, detail?: unknown) => void = () => {}, componentContext: SettingsContextValue) {
const __readerController = new ReaderController();

let $pageTurnEffect$: StoreValue<typeof pageTurnEffect$> = __readerController.read(pageTurnEffect$);

__readerController.observeSource(() => pageTurnEffect$, (value) => { $pageTurnEffect$ = value; });
const api = { controller: __readerController, 
get $pageTurnEffect$() { return $pageTurnEffect$; }, set $pageTurnEffect$(nextValue: typeof $pageTurnEffect$) { writeStore(pageTurnEffect$, nextValue); },
updateProps(next: Record<string, unknown>) {

}
};
return api;
}
