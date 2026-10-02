/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import { browser } from '$app/environment';
import type { BooksDbStorageSource } from '$lib/data/database/books-db/versions/books-db';
import { dialogManager } from '$lib/data/dialog-manager';
import { gDriveRevokeEndpoint } from '$lib/data/env';
import { StorageOAuthManager, storageOAuthTokens } from '$lib/data/storage/storage-oauth-manager';
import { isAppDefault, setStorageSourceDefault, type FsHandle, type StorageSourceSaveResult, type StorageUnlockAction, type RemoteContext, unlockStorageData } from '$lib/data/storage/storage-source-manager';
import { StorageKey } from '$lib/data/storage/storage-types';
import { getStorageIconData } from '$lib/data/storage/storage-view';
import { autoReplication$, database, fsStorageSource$, gDriveStorageSource$, isOnline$, oneDriveStorageSource$, syncTarget$ } from '$lib/data/store';
import { AutoReplicationType } from '$lib/functions/replication/replication-options';
import { ReaderController, readerTick, writeStore, type StoreValue } from '../reader-react/controller';
import { type SettingsContextValue } from './context';
import { MessageDialog } from '../ui/dialogs';
import { SettingsStorageSource } from './settings-storage-source';
const faCircleQuestion = 'faCircleQuestion';
const faCloudArrowUp = 'faCloudArrowUp';
const faPenToSquare = 'faPenToSquare';
const faPlus = 'faPlus';
const faSpinner = 'faSpinner';
const faTableList = 'faTableList';
const faTrash = 'faTrash';
const faTriangleExclamation = 'faTriangleExclamation';
const Popover = 'Popover';
const Button = 'Button';
const AppIcon = 'AppIcon';
export interface SettingsStorageSourceListProps {
storageSources: BooksDbStorageSource[];
}

export function createSettingsStorageSourceList(props: SettingsStorageSourceListProps, emit: (name: string, detail?: unknown) => void = () => {}, componentContext: SettingsContextValue) {
const __readerController = new ReaderController();
let fileSystemAvailable: any;
let $gDriveStorageSource$: StoreValue<typeof gDriveStorageSource$> = __readerController.read(gDriveStorageSource$);
let $oneDriveStorageSource$: StoreValue<typeof oneDriveStorageSource$> = __readerController.read(oneDriveStorageSource$);
let $fsStorageSource$: StoreValue<typeof fsStorageSource$> = __readerController.read(fsStorageSource$);
let $syncTarget$: StoreValue<typeof syncTarget$> = __readerController.read(syncTarget$);
let $isOnline$: StoreValue<typeof isOnline$> = __readerController.read(isOnline$);
let $autoReplication$: StoreValue<typeof autoReplication$> = __readerController.read(autoReplication$);
let storageSources: BooksDbStorageSource[] = props.storageSources;
let listLoading = true;
let listTooltip = 'Allows you to add a custom set of credentials';
__readerController.effect(() => [storageSources], () => { if (storageSources) {
    __readerController.changed(listLoading = false);
} });
__readerController.effect(() => [], () => { __readerController.changed(fileSystemAvailable = browser && 'showDirectoryPicker' in window); });
__readerController.effect(() => [fileSystemAvailable], () => { if (fileSystemAvailable) {
    __readerController.changed(listTooltip += ' or filesystem access');
} });
function isSyncTarget(name: string, referenceName: string) {
    return name === referenceName;
}
function isStorageSourceDefault(name: string, type: StorageKey, _sources: string[] = []) {
    let configuredIsSourceDefault = false;
    switch (type) {
        case StorageKey.GDRIVE:
            configuredIsSourceDefault = name === $gDriveStorageSource$;
            break;
        case StorageKey.ONEDRIVE:
            configuredIsSourceDefault = name === $oneDriveStorageSource$;
            break;
        case StorageKey.FS:
            configuredIsSourceDefault = name === $fsStorageSource$;
            break;
        default:
            break;
    }
    return configuredIsSourceDefault;
}
async function modifyStorageSource(storageSource?: BooksDbStorageSource) {
    let configuredRemoteData: StorageUnlockAction | undefined;
    let configuredFSData: FsHandle | undefined;
    if (storageSource && storageSource.type !== StorageKey.FS) {
        const unlockResult = await unlockStorageData(storageSource, 'You are trying to access protected data', {
            action: `Enter the correct password for ${storageSource.name} to proceed`,
            encryptedData: storageSource.data
        });
        if (!unlockResult) {
            return;
        }
        configuredRemoteData = unlockResult;
    }
    else if (storageSource && isFSHandle(storageSource.type, storageSource.data)) {
        configuredFSData = {
            directoryHandle: storageSource.data.directoryHandle,
            fsPath: storageSource.data.fsPath
        };
    }
    const saveResult = await new Promise<StorageSourceSaveResult>((resolver) => {
        dialogManager.dialogs$.next([
            {
                component: SettingsStorageSource,
                props: {
                    configuredName: storageSource?.name,
                    configuredType: storageSource?.type,
                    configuredIsSyncTarget: storageSource ? $syncTarget$ === storageSource.name : false,
                    configuredIsStorageSourceDefault: storageSource
                        ? isStorageSourceDefault(storageSource.name, storageSource.type)
                        : false,
                    configuredFSData,
                    configuredRemoteData,
                    configuredStoredInManager: storageSource?.storedInManager,
                    configuredEncryptionDisabled: storageSource?.encryptionDisabled,
                    resolver
                },
                disableCloseOnClick: true
            }
        ]);
    });
    if (!saveResult) {
        return;
    }
    if (saveResult.old) {
        const oldToken = storageOAuthTokens.get(saveResult.old);
        storageOAuthTokens.delete(saveResult.old);
        if (oldToken && saveResult.new.type === storageSource?.type) {
            storageOAuthTokens.set(saveResult.new.name, oldToken);
        }
        database.storageSourcesChanged$.next(storageSources.map((entry) => (entry.name === saveResult.old ? saveResult.new : entry)));
    }
    else {
        database.storageSourcesChanged$.next([...storageSources, saveResult.new]);
    }
}
function isFSHandle(type: StorageKey, data: FsHandle | ArrayBuffer | RemoteContext): data is FsHandle {
    return data && type === StorageKey.FS;
}
async function deleteStorageSource(storageSource: BooksDbStorageSource, wasSyncTarget: boolean, wasSourceDefault: boolean) {
    const unlockResult = await unlockStorageData(storageSource, storageSource.type === StorageKey.FS
        ? 'You are trying to delete data'
        : 'You are trying to delete protected data', {
        action: storageSource.type === StorageKey.FS
            ? `Please confirm to proceed with deleting ${storageSource.name}`
            : `Enter the correct password for ${storageSource.name} to proceed`,
        requiresSecret: storageSource.type !== StorageKey.FS,
        showCancel: true,
        encryptedData: storageSource.type !== StorageKey.FS ? storageSource.data : undefined
    });
    if (!unlockResult) {
        return;
    }
    const invalidateToken = storageSource.type === StorageKey.GDRIVE && unlockResult.refreshToken;
    if (invalidateToken && !$isOnline$) {
        dialogManager.dialogs$.next([
            {
                component: MessageDialog,
                props: {
                    title: 'Error',
                    message: 'You need to be online to delete this storage source'
                },
                disableCloseOnClick: true
            }
        ]);
        return;
    }
    await database.deleteStorageSource(storageSource, wasSyncTarget, wasSourceDefault);
    storageOAuthTokens.delete(storageSource.name);
    if (invalidateToken && unlockResult.refreshToken) {
        StorageOAuthManager.revokeToken(gDriveRevokeEndpoint, unlockResult.refreshToken);
    }
    database.storageSourcesChanged$.next(storageSources.filter((source) => source.name !== storageSource.name));
}
__readerController.observeSource(() => gDriveStorageSource$, (value) => { $gDriveStorageSource$ = value; });
__readerController.observeSource(() => oneDriveStorageSource$, (value) => { $oneDriveStorageSource$ = value; });
__readerController.observeSource(() => fsStorageSource$, (value) => { $fsStorageSource$ = value; });
__readerController.observeSource(() => syncTarget$, (value) => { $syncTarget$ = value; });
__readerController.observeSource(() => isOnline$, (value) => { $isOnline$ = value; });
__readerController.observeSource(() => autoReplication$, (value) => { $autoReplication$ = value; });
const api = { controller: __readerController, isSyncTarget, isStorageSourceDefault, modifyStorageSource, isFSHandle, deleteStorageSource,
get storageSources() { return storageSources; }, set storageSources(nextValue: typeof storageSources) { if (Object.is(storageSources, nextValue)) return; storageSources = nextValue; __readerController.invalidate(); },
get listLoading() { return listLoading; }, set listLoading(nextValue: typeof listLoading) { if (Object.is(listLoading, nextValue)) return; listLoading = nextValue; __readerController.invalidate(); },
get listTooltip() { return listTooltip; }, set listTooltip(nextValue: typeof listTooltip) { if (Object.is(listTooltip, nextValue)) return; listTooltip = nextValue; __readerController.invalidate(); },
get fileSystemAvailable() { return fileSystemAvailable; }, set fileSystemAvailable(nextValue: typeof fileSystemAvailable) { if (Object.is(fileSystemAvailable, nextValue)) return; fileSystemAvailable = nextValue; __readerController.invalidate(); },
get $gDriveStorageSource$() { return $gDriveStorageSource$; }, set $gDriveStorageSource$(nextValue: typeof $gDriveStorageSource$) { writeStore(gDriveStorageSource$, nextValue); },
get $oneDriveStorageSource$() { return $oneDriveStorageSource$; }, set $oneDriveStorageSource$(nextValue: typeof $oneDriveStorageSource$) { writeStore(oneDriveStorageSource$, nextValue); },
get $fsStorageSource$() { return $fsStorageSource$; }, set $fsStorageSource$(nextValue: typeof $fsStorageSource$) { writeStore(fsStorageSource$, nextValue); },
get $syncTarget$() { return $syncTarget$; }, set $syncTarget$(nextValue: typeof $syncTarget$) { writeStore(syncTarget$, nextValue); },
get $isOnline$() { return $isOnline$; }, set $isOnline$(nextValue: typeof $isOnline$) { writeStore(isOnline$, nextValue); },
get $autoReplication$() { return $autoReplication$; }, set $autoReplication$(nextValue: typeof $autoReplication$) { writeStore(autoReplication$, nextValue); },
updateProps(next: Record<string, unknown>) {
if ('storageSources' in next) api.storageSources = next.storageSources as typeof storageSources;
}
};
return api;
}
