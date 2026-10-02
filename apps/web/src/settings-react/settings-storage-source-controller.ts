/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import { browser } from '$app/environment';
import type { BooksDbStorageSource } from '$lib/data/database/books-db/versions/books-db';
import { gDriveRevokeEndpoint } from '$lib/data/env';
import { resolveTtuRoot } from '$lib/manabi/ttu-folder-contract';
import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
import { StorageOAuthManager, storageOAuthTokens } from '$lib/data/storage/storage-oauth-manager';
import { encrypt, isAppDefault, type FsHandle, type StorageSourceSaveResult, type StorageUnlockAction } from '$lib/data/storage/storage-source-manager';
import { StorageKey } from '$lib/data/storage/storage-types';
import { database, isOnline$ } from '$lib/data/store';
import { ReaderController, readerTick, writeStore, type StoreValue } from '../reader-react/controller';
import { type SettingsContextValue } from './context';


const DialogTemplate = 'DialogTemplate';
const Button = 'Button';
const Input = 'Input';
const faTriangleExclamation = 'faTriangleExclamation';
const AppIcon = 'AppIcon';
export interface SettingsStorageSourceProps {
configuredName: string;
configuredIsSyncTarget: boolean;
configuredIsStorageSourceDefault: boolean;
configuredType: StorageKey;
configuredRemoteData: StorageUnlockAction;
configuredFSData: FsHandle;
configuredStoredInManager: boolean;
configuredEncryptionDisabled: boolean;
resolver: (arg0: StorageSourceSaveResult | undefined) => void;
}

export function createSettingsStorageSource(props: SettingsStorageSourceProps, emit: (name: string, detail?: unknown) => void = () => {}, componentContext: SettingsContextValue) {
const __readerController = new ReaderController();

let $isOnline$: StoreValue<typeof isOnline$> = __readerController.read(isOnline$);
let configuredName: string = props.configuredName;
let configuredIsSyncTarget: boolean = props.configuredIsSyncTarget;
let configuredIsStorageSourceDefault: boolean = props.configuredIsStorageSourceDefault;
let configuredType: StorageKey = props.configuredType;
let configuredRemoteData: StorageUnlockAction = props.configuredRemoteData;
let configuredFSData: FsHandle = props.configuredFSData;
let configuredStoredInManager: boolean = props.configuredStoredInManager;
let configuredEncryptionDisabled: boolean = props.configuredEncryptionDisabled;
let resolver: (arg0: StorageSourceSaveResult | undefined) => void = props.resolver;
const dispatch = (name: string, detail?: unknown) => emit(name, detail);
const storageSourceRefreshToken = configuredRemoteData?.refreshToken || '';
let containerElm: HTMLFormElement | null = null;
let nameElm: HTMLInputElement | null = null;
let pwConfirmElm: HTMLInputElement | null = null;
let password = configuredStoredInManager ? configuredRemoteData?.secret || '' : '';
let confirmedPassword = password;
let error = '';
let saving = false;
let selectingDirectory = false;
let active = true;
let settled = false;
const passwordManagerAvailable = browser && 'PasswordCredential' in window;
__readerController.onDestroy(() => {
    __readerController.changed(active = false);
    if (settled)
        return;
    __readerController.changed(settled = true);
    resolver(undefined);
});
let storageSourceName = configuredName || '';
let storageSourceIsSyncTarget = configuredIsSyncTarget || false;
let storageSourceIsSourceDefault = configuredIsStorageSourceDefault || false;
let storageSourceType = configuredType || StorageKey.GDRIVE;
let storageSourceClientId = configuredRemoteData?.clientId || '';
let storageSourceClientSecret = configuredRemoteData?.clientSecret || '';
let directoryHandle: FileSystemDirectoryHandle | undefined = configuredFSData?.directoryHandle;
let handleFsPath = configuredFSData?.fsPath || '';
let storageSourceStoredInManager = (passwordManagerAvailable && configuredStoredInManager) || false;
let storageSourceEncryptionDisabled = configuredEncryptionDisabled || false;
const storageSourceTypes = [
    { key: StorageKey.GDRIVE, label: 'Google Drive' },
    { key: StorageKey.ONEDRIVE, label: 'OneDrive' },
    ...(browser && 'showDirectoryPicker' in window
        ? [{ key: StorageKey.FS, label: 'Local folder' }]
        : [])
];
async function selectDirectory() {
    if (saving || selectingDirectory || !active)
        return;
    resetCustomValidity();
    __readerController.changed(selectingDirectory = true);
    try {
        const dirHandle = await window.showDirectoryPicker({
            id: 'ttu-reader-root',
            mode: 'readwrite'
        });
        const resolved = await resolveTtuRoot(dirHandle, true);
        if (!active)
            return;
        __readerController.changed(directoryHandle = resolved);
        __readerController.changed(handleFsPath =
            directoryHandle.name === dirHandle.name
                ? directoryHandle.name
                : `${dirHandle.name}/${directoryHandle.name}`);
    }
    catch (err: any) {
        if (!active)
            return;
        // Cancelling the picker retains the existing directory choice.
        if (err?.name !== 'AbortError') {
            __readerController.changed(error = err instanceof Error ? err.message : 'Could not select the directory.');
        }
    }
    finally {
        __readerController.changed(selectingDirectory = false);
    }
}
async function save() {
    if (saving || selectingDirectory || !active || !containerElm)
        return;
    resetCustomValidity();
    if (![...containerElm.querySelectorAll('input')].every((elm) => {
        let isValid = elm.reportValidity();
        if (!isValid) {
            return false;
        }
        if (elm === nameElm) {
            if (storageSourceType === StorageKey.FS && !directoryHandle) {
                elm.setCustomValidity('You need to select a directory');
                isValid = false;
            }
            else if (isAppDefault(storageSourceName)) {
                elm.setCustomValidity('Please select a different name');
                isValid = false;
            }
        }
        else if (elm === pwConfirmElm && password !== confirmedPassword) {
            elm.setCustomValidity('Password does not match');
            isValid = false;
        }
        if (!isValid) {
            elm.reportValidity();
        }
        return isValid;
    })) {
        return;
    }
    __readerController.changed(saving = true);
    try {
        let storageSourceData;
        let credentialsChanged = false;
        let invalidateToken = false;
        if (storageSourceStoredInManager) {
            await navigator.credentials
                .store(new PasswordCredential({
                id: storageSourceName,
                name: `${storageSourceName} (${storageSourceType})`,
                password: confirmedPassword
            }))
                .catch(({ message }: any) => {
                throw new Error(`Failed to store Password: ${message}`);
            });
        }
        if (storageSourceType === StorageKey.FS) {
            if (!directoryHandle) {
                throw new Error('Directory handle not defined');
            }
            storageSourceData = { directoryHandle, fsPath: handleFsPath };
        }
        else {
            credentialsChanged =
                storageSourceClientId !== configuredRemoteData?.clientId ||
                    storageSourceClientSecret !== configuredRemoteData?.clientSecret;
            invalidateToken = !storageSourceClientSecret || credentialsChanged;
            const willInvalidateToken = invalidateToken &&
                configuredType === StorageKey.GDRIVE &&
                configuredRemoteData?.refreshToken;
            if (willInvalidateToken && !$isOnline$) {
                throw new Error('You need to be online in order to make this change to the credentials');
            }
            if (storageSourceEncryptionDisabled) {
                storageSourceData = {
                    clientId: storageSourceClientId,
                    clientSecret: storageSourceClientSecret,
                    refreshToken: invalidateToken ? '' : storageSourceRefreshToken
                };
            }
            else {
                storageSourceData = await encrypt(window, JSON.stringify({
                    clientId: storageSourceClientId,
                    clientSecret: storageSourceClientSecret,
                    refreshToken: invalidateToken ? '' : storageSourceRefreshToken
                }), confirmedPassword);
            }
        }
        const toSave: BooksDbStorageSource = {
            name: storageSourceName,
            type: storageSourceType,
            storedInManager: storageSourceStoredInManager,
            encryptionDisabled: storageSourceEncryptionDisabled,
            data: storageSourceData,
            lastSourceModified: Date.now()
        };
        await database.saveStorageSource(toSave, configuredName, storageSourceIsSyncTarget, storageSourceIsSourceDefault);
        if (invalidateToken &&
            configuredType === StorageKey.GDRIVE &&
            configuredRemoteData?.refreshToken) {
            StorageOAuthManager.revokeToken(gDriveRevokeEndpoint, configuredRemoteData.refreshToken);
        }
        if (credentialsChanged) {
            storageOAuthTokens.delete(configuredName);
            if (storageSourceType !== StorageKey.FS) {
                getStorageHandler(window, storageSourceType).clearData();
            }
        }
        if (storageSourceType === StorageKey.FS &&
            directoryHandle &&
            !(await configuredFSData?.directoryHandle?.isSameEntry(directoryHandle))) {
            getStorageHandler(window, StorageKey.FS).clearData();
        }
        closeDialog({ new: toSave, old: configuredName });
    }
    catch (err: unknown) {
        if (active)
            __readerController.changed(error = err instanceof Error ? err.message : 'Could not save the storage source.');
    }
    finally {
        __readerController.changed(saving = false);
    }
}
function resetCustomValidity() {
    __readerController.changed(error = '');
    nameElm?.setCustomValidity('');
    pwConfirmElm?.setCustomValidity('');
}
function closeDialog(data?: StorageSourceSaveResult) {
    if (!active || settled)
        return;
    __readerController.changed(settled = true);
    resolver(data);
    dispatch('close');
}
__readerController.observeSource(() => isOnline$, (value) => { $isOnline$ = value; });
const api = { controller: __readerController, selectDirectory, save, resetCustomValidity, closeDialog,
get configuredName() { return configuredName; }, set configuredName(nextValue: typeof configuredName) { if (Object.is(configuredName, nextValue)) return; configuredName = nextValue; __readerController.invalidate(); },
get configuredIsSyncTarget() { return configuredIsSyncTarget; }, set configuredIsSyncTarget(nextValue: typeof configuredIsSyncTarget) { if (Object.is(configuredIsSyncTarget, nextValue)) return; configuredIsSyncTarget = nextValue; __readerController.invalidate(); },
get configuredIsStorageSourceDefault() { return configuredIsStorageSourceDefault; }, set configuredIsStorageSourceDefault(nextValue: typeof configuredIsStorageSourceDefault) { if (Object.is(configuredIsStorageSourceDefault, nextValue)) return; configuredIsStorageSourceDefault = nextValue; __readerController.invalidate(); },
get configuredType() { return configuredType; }, set configuredType(nextValue: typeof configuredType) { if (Object.is(configuredType, nextValue)) return; configuredType = nextValue; __readerController.invalidate(); },
get configuredRemoteData() { return configuredRemoteData; }, set configuredRemoteData(nextValue: typeof configuredRemoteData) { if (Object.is(configuredRemoteData, nextValue)) return; configuredRemoteData = nextValue; __readerController.invalidate(); },
get configuredFSData() { return configuredFSData; }, set configuredFSData(nextValue: typeof configuredFSData) { if (Object.is(configuredFSData, nextValue)) return; configuredFSData = nextValue; __readerController.invalidate(); },
get configuredStoredInManager() { return configuredStoredInManager; }, set configuredStoredInManager(nextValue: typeof configuredStoredInManager) { if (Object.is(configuredStoredInManager, nextValue)) return; configuredStoredInManager = nextValue; __readerController.invalidate(); },
get configuredEncryptionDisabled() { return configuredEncryptionDisabled; }, set configuredEncryptionDisabled(nextValue: typeof configuredEncryptionDisabled) { if (Object.is(configuredEncryptionDisabled, nextValue)) return; configuredEncryptionDisabled = nextValue; __readerController.invalidate(); },
get resolver() { return resolver; }, set resolver(nextValue: typeof resolver) { if (Object.is(resolver, nextValue)) return; resolver = nextValue; __readerController.invalidate(); },
get dispatch() { return dispatch; },
get storageSourceRefreshToken() { return storageSourceRefreshToken; },
get containerElm() { return containerElm; }, set containerElm(nextValue: typeof containerElm) { if (Object.is(containerElm, nextValue)) return; containerElm = nextValue; __readerController.invalidate(); },
get nameElm() { return nameElm; }, set nameElm(nextValue: typeof nameElm) { if (Object.is(nameElm, nextValue)) return; nameElm = nextValue; __readerController.invalidate(); },
get pwConfirmElm() { return pwConfirmElm; }, set pwConfirmElm(nextValue: typeof pwConfirmElm) { if (Object.is(pwConfirmElm, nextValue)) return; pwConfirmElm = nextValue; __readerController.invalidate(); },
get password() { return password; }, set password(nextValue: typeof password) { if (Object.is(password, nextValue)) return; password = nextValue; __readerController.invalidate(); },
get confirmedPassword() { return confirmedPassword; }, set confirmedPassword(nextValue: typeof confirmedPassword) { if (Object.is(confirmedPassword, nextValue)) return; confirmedPassword = nextValue; __readerController.invalidate(); },
get error() { return error; }, set error(nextValue: typeof error) { if (Object.is(error, nextValue)) return; error = nextValue; __readerController.invalidate(); },
get saving() { return saving; }, set saving(nextValue: typeof saving) { if (Object.is(saving, nextValue)) return; saving = nextValue; __readerController.invalidate(); },
get selectingDirectory() { return selectingDirectory; }, set selectingDirectory(nextValue: typeof selectingDirectory) { if (Object.is(selectingDirectory, nextValue)) return; selectingDirectory = nextValue; __readerController.invalidate(); },
get active() { return active; }, set active(nextValue: typeof active) { if (Object.is(active, nextValue)) return; active = nextValue; __readerController.invalidate(); },
get settled() { return settled; }, set settled(nextValue: typeof settled) { if (Object.is(settled, nextValue)) return; settled = nextValue; __readerController.invalidate(); },
get passwordManagerAvailable() { return passwordManagerAvailable; },
get storageSourceName() { return storageSourceName; }, set storageSourceName(nextValue: typeof storageSourceName) { if (Object.is(storageSourceName, nextValue)) return; storageSourceName = nextValue; __readerController.invalidate(); },
get storageSourceIsSyncTarget() { return storageSourceIsSyncTarget; }, set storageSourceIsSyncTarget(nextValue: typeof storageSourceIsSyncTarget) { if (Object.is(storageSourceIsSyncTarget, nextValue)) return; storageSourceIsSyncTarget = nextValue; __readerController.invalidate(); },
get storageSourceIsSourceDefault() { return storageSourceIsSourceDefault; }, set storageSourceIsSourceDefault(nextValue: typeof storageSourceIsSourceDefault) { if (Object.is(storageSourceIsSourceDefault, nextValue)) return; storageSourceIsSourceDefault = nextValue; __readerController.invalidate(); },
get storageSourceType() { return storageSourceType; }, set storageSourceType(nextValue: typeof storageSourceType) { if (Object.is(storageSourceType, nextValue)) return; storageSourceType = nextValue; __readerController.invalidate(); },
get storageSourceClientId() { return storageSourceClientId; }, set storageSourceClientId(nextValue: typeof storageSourceClientId) { if (Object.is(storageSourceClientId, nextValue)) return; storageSourceClientId = nextValue; __readerController.invalidate(); },
get storageSourceClientSecret() { return storageSourceClientSecret; }, set storageSourceClientSecret(nextValue: typeof storageSourceClientSecret) { if (Object.is(storageSourceClientSecret, nextValue)) return; storageSourceClientSecret = nextValue; __readerController.invalidate(); },
get directoryHandle() { return directoryHandle; }, set directoryHandle(nextValue: typeof directoryHandle) { if (Object.is(directoryHandle, nextValue)) return; directoryHandle = nextValue; __readerController.invalidate(); },
get handleFsPath() { return handleFsPath; }, set handleFsPath(nextValue: typeof handleFsPath) { if (Object.is(handleFsPath, nextValue)) return; handleFsPath = nextValue; __readerController.invalidate(); },
get storageSourceStoredInManager() { return storageSourceStoredInManager; }, set storageSourceStoredInManager(nextValue: typeof storageSourceStoredInManager) { if (Object.is(storageSourceStoredInManager, nextValue)) return; storageSourceStoredInManager = nextValue; __readerController.invalidate(); },
get storageSourceEncryptionDisabled() { return storageSourceEncryptionDisabled; }, set storageSourceEncryptionDisabled(nextValue: typeof storageSourceEncryptionDisabled) { if (Object.is(storageSourceEncryptionDisabled, nextValue)) return; storageSourceEncryptionDisabled = nextValue; __readerController.invalidate(); },
get storageSourceTypes() { return storageSourceTypes; },
get $isOnline$() { return $isOnline$; }, set $isOnline$(nextValue: typeof $isOnline$) { writeStore(isOnline$, nextValue); },
updateProps(next: Record<string, unknown>) {
if ('configuredName' in next) api.configuredName = next.configuredName as typeof configuredName;
if ('configuredIsSyncTarget' in next) api.configuredIsSyncTarget = next.configuredIsSyncTarget as typeof configuredIsSyncTarget;
if ('configuredIsStorageSourceDefault' in next) api.configuredIsStorageSourceDefault = next.configuredIsStorageSourceDefault as typeof configuredIsStorageSourceDefault;
if ('configuredType' in next) api.configuredType = next.configuredType as typeof configuredType;
if ('configuredRemoteData' in next) api.configuredRemoteData = next.configuredRemoteData as typeof configuredRemoteData;
if ('configuredFSData' in next) api.configuredFSData = next.configuredFSData as typeof configuredFSData;
if ('configuredStoredInManager' in next) api.configuredStoredInManager = next.configuredStoredInManager as typeof configuredStoredInManager;
if ('configuredEncryptionDisabled' in next) api.configuredEncryptionDisabled = next.configuredEncryptionDisabled as typeof configuredEncryptionDisabled;
if ('resolver' in next) api.resolver = next.resolver as typeof resolver;
}
};
return api;
}
