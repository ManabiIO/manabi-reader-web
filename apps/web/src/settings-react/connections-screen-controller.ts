/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import { davSyncStatus, setDavBookSync } from '$lib/webdav/sync';
import { WebDavSource } from '$lib/webdav/source';
import { DavError } from '$lib/webdav/client';
import { resolve } from '$app/paths';
import { account, currentUser, refreshAccount, request, connectProvider, signOut, providerLabels, IntegrationError } from '$lib/manabi/client';
import { preferenceStatus, enablePreferenceSync, syncPreferences } from '$lib/manabi/preferences';
import { bookSyncStatus, linkedBooks, refreshLinkedBooks, importLibraryBook, syncBook, syncAllLinkedBooks } from '$lib/manabi/books';
import { personalSyncStatus, resolvePersonalConflict } from '$lib/manabi/personal-sync';
import { integrationDB, type LocalLibrary } from '$lib/manabi/persistence';
import { CloudLibrary, LocalLibrarySource, addLocalLibrary, reconnectLocalLibrary, removeLocalLibrary, supportsLocalLibraries, supportedBook, type CloudConnection, type LibraryEntry, type LibrarySource } from '$lib/manabi/sources';
import { fontSize$, writingMode$ } from '$lib/data/store';
import { ReaderController, readerTick, writeStore, type StoreValue } from '../reader-react/controller';
import { type SettingsContextValue } from './context';

import { DavConnections } from './dav-connections';
const AppNav = 'AppNav';
const Button = 'Button';
export interface ConnectionsScreenProps {

}

export function createConnectionsScreen(props: ConnectionsScreenProps, emit: (name: string, detail?: unknown) => void = () => {}, componentContext: SettingsContextValue) {
const __readerController = new ReaderController();

let $account: StoreValue<typeof account> = __readerController.read(account);
let $preferenceStatus: StoreValue<typeof preferenceStatus> = __readerController.read(preferenceStatus);
let $fontSize$: StoreValue<typeof fontSize$> = __readerController.read(fontSize$);
let $writingMode$: StoreValue<typeof writingMode$> = __readerController.read(writingMode$);
let $personalSyncStatus: StoreValue<typeof personalSyncStatus> = __readerController.read(personalSyncStatus);
let $linkedBooks: StoreValue<typeof linkedBooks> = __readerController.read(linkedBooks);
let $davSyncStatus: StoreValue<typeof davSyncStatus> = __readerController.read(davSyncStatus);
let $bookSyncStatus: StoreValue<typeof bookSyncStatus> = __readerController.read(bookSyncStatus);
let connections: CloudConnection[] = [];
let localLibraries: LocalLibrary[] = [];
let folderPicker: {
    connection: CloudConnection;
    folders: LibraryEntry[];
    selected: string[];
} | null = null;
let source: LibrarySource | null = null;
let sourceName = '';
let entries: LibraryEntry[] = [];
let trail: {
    id: string;
    name: string;
}[] = [];
let cursor = '';
let nativeFolders = false;
let busy = false;
let message = '';
let lastImported: {
    bookId: number;
    title: string;
} | null = null;
let preferenceChoice: 'remote' | 'local' = 'remote';
let navigation = 0;
let stopped = false;
const connectionReturn = encodeURIComponent(resolve('/connections'));
function report(error: unknown) {
    __readerController.changed(message =
        error instanceof IntegrationError || error instanceof DavError
            ? error.message
            : error instanceof DOMException && error.name === 'AbortError'
                ? ''
                : 'The operation could not complete. Original books and local reading data were kept.');
}
async function action(work: () => Promise<unknown>) {
    if (busy)
        return;
    __readerController.changed(busy = true);
    __readerController.changed(message = '');
    try {
        await work();
    }
    catch (error) {
        report(error);
    }
    finally {
        __readerController.changed(busy = false);
    }
}
async function reload() {
    __readerController.changed(localLibraries = await (await integrationDB()).getAll('localLibraries'));
    await refreshLinkedBooks();
    if (currentUser())
        __readerController.changed(connections = (await request<{
            items: CloudConnection[];
        }>('connections/')).items);
    else
        __readerController.changed(connections = []);
}
async function pickLocal() {
    // addLocalLibrary opens the native picker before its first asynchronous DB call.
    const pending = addLocalLibrary();
    await action(async () => {
        const library = await pending;
        if (library) {
            await reload();
            await openLocal(library);
        }
    });
}
async function grant(library: LocalLibrary, write: boolean) {
    const pending = reconnectLocalLibrary(library, write);
    await action(async () => {
        await pending;
        await reload();
        await openLocal(library);
    });
}
async function openDav(value: WebDavSource) {
    await action(async () => {
        __readerController.changed(source = value);
        __readerController.changed(sourceName = value.configuration.name);
        __readerController.changed(trail = [{ id: value.root, name: sourceName }]);
        await browse(value.root, false);
    });
}
async function uploadDav(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    const active = source;
    const parent = trail[trail.length - 1]?.id;
    input.value = '';
    if (!file || !(active instanceof WebDavSource) || !parent)
        return;
    await action(async () => {
        await active.uploadNew(file, parent);
        if (source !== active || stopped)
            return;
        await browse(parent);
        __readerController.changed(message = `Uploaded and verified ${file.name}.`);
    });
}
async function downloadDavBackup(entry: LibraryEntry) {
    const active = source;
    if (!(active instanceof WebDavSource))
        return;
    await action(async () => {
        const file = await active.downloadBackup(entry);
        if (source !== active || stopped)
            return;
        const url = URL.createObjectURL(file);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = entry.name;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
}
async function openLocal(library: LocalLibrary) {
    __readerController.changed(source = new LocalLibrarySource(library));
    __readerController.changed(sourceName = library.name);
    __readerController.changed(trail = [{ id: '', name: library.name }]);
    await browse('', false);
}
async function openCloud(connection: CloudConnection, root: string) {
    const owner = currentUser()?.id;
    if (!owner)
        throw new IntegrationError('sign_in_required');
    __readerController.changed(source = new CloudLibrary(connection.id, owner, root));
    __readerController.changed(sourceName = `${providerLabels[connection.provider] ?? connection.provider} · ${root}`);
    __readerController.changed(trail = [{ id: root, name: 'Selected folder' }]);
    await browse(root, false);
}
async function browse(parent: string, more = false) {
    const activeSource = source;
    if (!activeSource)
        return;
    const serial = __readerController.changed(++navigation);
    const result = await activeSource.list(parent, more ? cursor : '');
    if (serial !== navigation || source !== activeSource || stopped)
        return;
    __readerController.changed(entries = more ? [...entries, ...result.items] : result.items);
    __readerController.changed(cursor = result.cursor);
    __readerController.changed(lastImported = null);
}
async function enter(entry: LibraryEntry) {
    __readerController.changed(trail = [...trail, { id: entry.id, name: entry.name }]);
    await browse(entry.id);
}
async function chooseFolders(connection: CloudConnection) {
    const result = await request<{
        items: LibraryEntry[];
    }>(`connections/${connection.id}/folders/`);
    __readerController.changed(folderPicker = { connection, folders: result.items, selected: [...connection.roots] });
}
async function saveFolders() {
    if (!folderPicker)
        return;
    await request(`connections/${folderPicker.connection.id}/folders/`, {
        method: 'PUT',
        value: { roots: folderPicker.selected }
    });
    __readerController.changed(folderPicker = null);
    await reload();
}
async function disconnect(connection: CloudConnection) {
    const result = await request<{
        provider_revocation_confirmed: boolean;
        provider_revocation_supported?: boolean;
    }>(`connections/${connection.id}/`, { method: 'DELETE' });
    if (source?.id === connection.id) {
        __readerController.changed(source = null);
        __readerController.changed(entries = []);
    }
    await reload();
    __readerController.changed(message =
        result.provider_revocation_supported === false
            ? 'Disconnected locally. Remove Manabi access in the provider account settings to revoke its authorization.'
            : result.provider_revocation_confirmed
                ? 'Cloud access disconnected. Downloaded books are still available locally.'
                : 'Disconnected locally. Manabi will retry provider revocation; you can also remove access in the provider’s account settings.');
}
__readerController.onMount(() => {
    __readerController.changed(nativeFolders = supportsLocalLibraries());
    void action(async () => {
        await refreshAccount();
        await reload();
    });
    let previous: string | null | undefined;
    const unsubscribe = account.subscribe(({ session }) => {
        const user = session?.user?.id ?? null;
        if (user !== previous) {
            previous = user;
            __readerController.changed(connections = []);
            __readerController.changed(folderPicker = null);
            if (source?.owner !== null) {
                __readerController.changed(source = null);
                __readerController.changed(entries = []);
                __readerController.changed(navigation += 1);
            }
            void reload().catch(report);
        }
    });
    return () => {
        __readerController.changed(stopped = true);
        unsubscribe();
        __readerController.changed(navigation += 1);
    };
});
__readerController.observeSource(() => account, (value) => { $account = value; });
__readerController.observeSource(() => preferenceStatus, (value) => { $preferenceStatus = value; });
__readerController.observeSource(() => fontSize$, (value) => { $fontSize$ = value; });
__readerController.observeSource(() => writingMode$, (value) => { $writingMode$ = value; });
__readerController.observeSource(() => personalSyncStatus, (value) => { $personalSyncStatus = value; });
__readerController.observeSource(() => linkedBooks, (value) => { $linkedBooks = value; });
__readerController.observeSource(() => davSyncStatus, (value) => { $davSyncStatus = value; });
__readerController.observeSource(() => bookSyncStatus, (value) => { $bookSyncStatus = value; });
const api = { controller: __readerController, report, action, reload, pickLocal, grant, openDav, uploadDav, downloadDavBackup, openLocal, openCloud, browse, enter, chooseFolders, saveFolders, disconnect,
get connections() { return connections; }, set connections(nextValue: typeof connections) { if (Object.is(connections, nextValue)) return; connections = nextValue; __readerController.invalidate(); },
get localLibraries() { return localLibraries; }, set localLibraries(nextValue: typeof localLibraries) { if (Object.is(localLibraries, nextValue)) return; localLibraries = nextValue; __readerController.invalidate(); },
get folderPicker() { return folderPicker; }, set folderPicker(nextValue: typeof folderPicker) { if (Object.is(folderPicker, nextValue)) return; folderPicker = nextValue; __readerController.invalidate(); },
get source() { return source; }, set source(nextValue: typeof source) { if (Object.is(source, nextValue)) return; source = nextValue; __readerController.invalidate(); },
get sourceName() { return sourceName; }, set sourceName(nextValue: typeof sourceName) { if (Object.is(sourceName, nextValue)) return; sourceName = nextValue; __readerController.invalidate(); },
get entries() { return entries; }, set entries(nextValue: typeof entries) { if (Object.is(entries, nextValue)) return; entries = nextValue; __readerController.invalidate(); },
get trail() { return trail; }, set trail(nextValue: typeof trail) { if (Object.is(trail, nextValue)) return; trail = nextValue; __readerController.invalidate(); },
get cursor() { return cursor; }, set cursor(nextValue: typeof cursor) { if (Object.is(cursor, nextValue)) return; cursor = nextValue; __readerController.invalidate(); },
get nativeFolders() { return nativeFolders; }, set nativeFolders(nextValue: typeof nativeFolders) { if (Object.is(nativeFolders, nextValue)) return; nativeFolders = nextValue; __readerController.invalidate(); },
get busy() { return busy; }, set busy(nextValue: typeof busy) { if (Object.is(busy, nextValue)) return; busy = nextValue; __readerController.invalidate(); },
get message() { return message; }, set message(nextValue: typeof message) { if (Object.is(message, nextValue)) return; message = nextValue; __readerController.invalidate(); },
get lastImported() { return lastImported; }, set lastImported(nextValue: typeof lastImported) { if (Object.is(lastImported, nextValue)) return; lastImported = nextValue; __readerController.invalidate(); },
get preferenceChoice() { return preferenceChoice; }, set preferenceChoice(nextValue: typeof preferenceChoice) { if (Object.is(preferenceChoice, nextValue)) return; preferenceChoice = nextValue; __readerController.invalidate(); },
get navigation() { return navigation; }, set navigation(nextValue: typeof navigation) { if (Object.is(navigation, nextValue)) return; navigation = nextValue; __readerController.invalidate(); },
get stopped() { return stopped; }, set stopped(nextValue: typeof stopped) { if (Object.is(stopped, nextValue)) return; stopped = nextValue; __readerController.invalidate(); },
get connectionReturn() { return connectionReturn; },
get $account() { return $account; }, set $account(nextValue: typeof $account) { writeStore(account, nextValue); },
get $preferenceStatus() { return $preferenceStatus; }, set $preferenceStatus(nextValue: typeof $preferenceStatus) { writeStore(preferenceStatus, nextValue); },
get $fontSize$() { return $fontSize$; }, set $fontSize$(nextValue: typeof $fontSize$) { writeStore(fontSize$, nextValue); },
get $writingMode$() { return $writingMode$; }, set $writingMode$(nextValue: typeof $writingMode$) { writeStore(writingMode$, nextValue); },
get $personalSyncStatus() { return $personalSyncStatus; }, set $personalSyncStatus(nextValue: typeof $personalSyncStatus) { writeStore(personalSyncStatus, nextValue); },
get $linkedBooks() { return $linkedBooks; }, set $linkedBooks(nextValue: typeof $linkedBooks) { writeStore(linkedBooks, nextValue); },
get $davSyncStatus() { return $davSyncStatus; }, set $davSyncStatus(nextValue: typeof $davSyncStatus) { writeStore(davSyncStatus, nextValue); },
get $bookSyncStatus() { return $bookSyncStatus; }, set $bookSyncStatus(nextValue: typeof $bookSyncStatus) { writeStore(bookSyncStatus, nextValue); },
updateProps(next: Record<string, unknown>) {

}
};
return api;
}
