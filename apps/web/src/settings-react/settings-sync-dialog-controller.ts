/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import { InternalStorageSources, StorageKey } from '$lib/data/storage/storage-types';
import type { BooksDbStorageSource } from '$lib/data/database/books-db/versions/books-db';
import type { SyncSelection } from '$lib/data/dialog-manager';
import { lastSyncedSettingsSource$, lastSyncedSettingsTarget$ } from '$lib/data/store';
import { ReaderController, readerTick, writeStore, type StoreValue } from '../reader-react/controller';
import { type SettingsContextValue } from './context';


const faArrowsUpDown = 'faArrowsUpDown';
const DialogTemplate = 'DialogTemplate';
const Button = 'Button';
const AppIcon = 'AppIcon';
export interface SettingsSyncDialogProps {
settingsSyncHeader?: string;
storageSources?: BooksDbStorageSource[];
resolver: (arg0: SyncSelection[]) => void;
}

export function createSettingsSyncDialog(props: SettingsSyncDialogProps, emit: (name: string, detail?: unknown) => void = () => {}, componentContext: SettingsContextValue) {
const __readerController = new ReaderController();
let sources: any;
let targets: any;
let $lastSyncedSettingsSource$: StoreValue<typeof lastSyncedSettingsSource$> = __readerController.read(lastSyncedSettingsSource$);
let $lastSyncedSettingsTarget$: StoreValue<typeof lastSyncedSettingsTarget$> = __readerController.read(lastSyncedSettingsTarget$);
let settingsSyncHeader = props.settingsSyncHeader !== undefined ? props.settingsSyncHeader : '';
let storageSources: BooksDbStorageSource[] = props.storageSources !== undefined ? props.storageSources : [];
let resolver: (arg0: SyncSelection[]) => void = props.resolver;
const dispatch = (name: string, detail?: unknown) => emit(name, detail);
const syncSources: SyncSelection[] = [
    { id: InternalStorageSources.INTERNAL_BROWSER, label: 'Browser DB', type: StorageKey.BROWSER },
    { id: InternalStorageSources.INTERNAL_ZIP, label: 'ZIP File', type: StorageKey.BACKUP },
    ...storageSources.map((storageSource) => ({
        id: storageSource.name,
        label: `${storageSource.name} (${storageSource.type})`,
        type: storageSource.type
    }))
];
let settled = false;
__readerController.onDestroy(() => {
    if (settled)
        return;
    __readerController.changed(settled = true);
    resolver([]);
});
let selectedSource = syncSources.find((entry) => entry.id === $lastSyncedSettingsSource$)?.id || syncSources[0].id;
let selectedTarget = syncSources.find((entry) => entry.id === $lastSyncedSettingsTarget$)?.id || syncSources[1].id;
__readerController.effect(() => [syncSources, selectedTarget], () => { __readerController.changed(sources = syncSources.filter((entry) => entry.id !== selectedTarget && entry.id !== InternalStorageSources.INTERNAL_ZIP)); });
__readerController.effect(() => [syncSources, selectedSource], () => { __readerController.changed(targets = syncSources.filter((entry) => entry.id !== selectedSource)); });
function closeDialog(wasCanceled = false) {
    if (settled)
        return;
    __readerController.changed(settled = true);
    if (!wasCanceled) {
        writeStore(lastSyncedSettingsSource$, selectedSource);
        writeStore(lastSyncedSettingsTarget$, selectedTarget);
    }
    resolver(wasCanceled
        ? []
        : [
            syncSources.find((entry) => entry.id === selectedSource)!,
            syncSources.find((entry) => entry.id === selectedTarget)!
        ]);
    dispatch('close');
}
__readerController.observeSource(() => lastSyncedSettingsSource$, (value) => { $lastSyncedSettingsSource$ = value; });
__readerController.observeSource(() => lastSyncedSettingsTarget$, (value) => { $lastSyncedSettingsTarget$ = value; });
const api = { controller: __readerController, closeDialog,
get settingsSyncHeader() { return settingsSyncHeader; }, set settingsSyncHeader(nextValue: typeof settingsSyncHeader) { if (Object.is(settingsSyncHeader, nextValue)) return; settingsSyncHeader = nextValue; __readerController.invalidate(); },
get storageSources() { return storageSources; }, set storageSources(nextValue: typeof storageSources) { if (Object.is(storageSources, nextValue)) return; storageSources = nextValue; __readerController.invalidate(); },
get resolver() { return resolver; }, set resolver(nextValue: typeof resolver) { if (Object.is(resolver, nextValue)) return; resolver = nextValue; __readerController.invalidate(); },
get dispatch() { return dispatch; },
get syncSources() { return syncSources; },
get settled() { return settled; }, set settled(nextValue: typeof settled) { if (Object.is(settled, nextValue)) return; settled = nextValue; __readerController.invalidate(); },
get selectedSource() { return selectedSource; }, set selectedSource(nextValue: typeof selectedSource) { if (Object.is(selectedSource, nextValue)) return; selectedSource = nextValue; __readerController.invalidate(); },
get selectedTarget() { return selectedTarget; }, set selectedTarget(nextValue: typeof selectedTarget) { if (Object.is(selectedTarget, nextValue)) return; selectedTarget = nextValue; __readerController.invalidate(); },
get sources() { return sources; }, set sources(nextValue: typeof sources) { if (Object.is(sources, nextValue)) return; sources = nextValue; __readerController.invalidate(); },
get targets() { return targets; }, set targets(nextValue: typeof targets) { if (Object.is(targets, nextValue)) return; targets = nextValue; __readerController.invalidate(); },
get $lastSyncedSettingsSource$() { return $lastSyncedSettingsSource$; }, set $lastSyncedSettingsSource$(nextValue: typeof $lastSyncedSettingsSource$) { writeStore(lastSyncedSettingsSource$, nextValue); },
get $lastSyncedSettingsTarget$() { return $lastSyncedSettingsTarget$; }, set $lastSyncedSettingsTarget$(nextValue: typeof $lastSyncedSettingsTarget$) { writeStore(lastSyncedSettingsTarget$, nextValue); },
updateProps(next: Record<string, unknown>) {
if ('settingsSyncHeader' in next && next.settingsSyncHeader !== undefined) api.settingsSyncHeader = next.settingsSyncHeader as typeof settingsSyncHeader;
if ('storageSources' in next && next.storageSources !== undefined) api.storageSources = next.storageSources as typeof storageSources;
if ('resolver' in next) api.resolver = next.resolver as typeof resolver;
}
};
return api;
}
