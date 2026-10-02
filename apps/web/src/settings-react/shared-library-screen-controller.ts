/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import { resolve } from '$app/paths';
import { goto } from '$app/navigation';
import type BooksDb from '$lib/data/database/books-db/versions/books-db';
import type { BooksDbStorageSource } from '$lib/data/database/books-db/versions/books-db';
import { account } from '$lib/manabi/client';
import { allLinkedBooks } from '$lib/manabi/books';
import { visibleLibraryEntries } from '$lib/library/account-visibility';
import { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';
import { database, autoReplication$, syncTarget$ } from '$lib/data/store';
import { AutoReplicationType } from '$lib/functions/replication/replication-options';
import { inspectTtuRoot } from '$lib/manabi/ttu-folder-contract';
import { sharedPublishChoices } from '$lib/manabi/shared-title-selection';
import { addSharedFolder, filesystemData, openSharedFolder, reconnectSharedFolder, sharedFolderSources, transferSharedBooks } from '$lib/manabi/shared-library';
import { ReaderController, readerTick, writeStore, type StoreValue } from '../reader-react/controller';
import { type SettingsContextValue } from './context';


const AppNav = 'AppNav';
const Button = 'Button';
export interface SharedLibraryScreenProps {

}

export function createSharedLibraryScreen(props: SharedLibraryScreenProps, emit: (name: string, detail?: unknown) => void = () => {}, componentContext: SettingsContextValue) {
const __readerController = new ReaderController();
let viewer: string | null = null;
let localBooks: ReturnType<typeof sharedPublishChoices> = [];
let source: BooksDbStorageSource | undefined;
let $account: StoreValue<typeof account> = __readerController.read(account);
let $allLinkedBooks: StoreValue<typeof allLinkedBooks> = __readerController.read(allLinkedBooks);
let $syncTarget$: StoreValue<typeof syncTarget$> = __readerController.read(syncTarget$);
let $autoReplication$: StoreValue<typeof autoReplication$> = __readerController.read(autoReplication$);
let sources: BooksDbStorageSource[] = [];
let selected = '';
let remoteTitles: string[] = [];
let localRows: BooksDb['data']['value'][] = [];
__readerController.effect(() => [$account], () => { __readerController.changed(viewer = $account.session?.user?.id ?? null); });
__readerController.effect(() => [localRows, $allLinkedBooks, viewer], () => { __readerController.changed(localBooks = sharedPublishChoices(visibleLibraryEntries(localRows, $allLinkedBooks, viewer).cards)); });
__readerController.effect(() => [viewer], () => {
    viewer;
    __readerController.changed(imports = []);
    __readerController.changed(exports = []);
});
let imports: string[] = [];
let exports: string[] = [];
let busy = false;
let message = '';
let supported = false;
__readerController.effect(() => [sources, selected], () => { __readerController.changed(source = sources.find((item) => item.name === selected)); });
async function run(work: () => Promise<unknown>) {
    if (busy)
        return;
    __readerController.changed(busy = true);
    __readerController.changed(message = '');
    try {
        await work();
    }
    catch (error) {
        __readerController.changed(message =
            error instanceof Error
                ? error.message
                : 'The folder could not be accessed. Existing books were not removed.');
    }
    finally {
        __readerController.changed(busy = false);
    }
}
async function refresh() {
    __readerController.changed(sources = await sharedFolderSources());
    if (!sources.some((item) => item.name === selected))
        __readerController.changed(selected = sources[0]?.name ?? '');
    __readerController.changed(localRows = await (await database.db).getAll('data'));
    const current = sources.find((item) => item.name === selected);
    __readerController.changed(remoteTitles = current
        ? (await inspectTtuRoot(filesystemData(current).directoryHandle)).map(BaseStorageHandler.desanitizeFilename)
        : []);
    __readerController.changed(imports = []);
    __readerController.changed(exports = []);
}
function choose(create: boolean) {
    if (busy)
        return;
    const picking = addSharedFolder(create);
    void run(async () => {
        const added = await picking;
        if (!added)
            return;
        __readerController.changed(selected = added.name);
        await refresh();
        __readerController.changed(message =
            'Shared library connected. No books were uploaded and your sync target was not changed.');
    });
}
function reconnect() {
    if (!source || busy)
        return;
    const permission = reconnectSharedFolder(source);
    void run(async () => {
        await permission;
        await refresh();
    });
}
function setAutomatic(enabled: boolean) {
    if (!source)
        return;
    if (enabled) {
        syncTarget$.next(source.name);
        autoReplication$.next(AutoReplicationType.All);
    }
    else if ($syncTarget$ === source.name) {
        syncTarget$.next('');
        autoReplication$.next(AutoReplicationType.Off);
    }
}
__readerController.onMount(() => {
    __readerController.changed(supported = window.isSecureContext && 'showDirectoryPicker' in window);
    void run(refresh);
});
__readerController.observeSource(() => account, (value) => { $account = value; });
__readerController.observeSource(() => allLinkedBooks, (value) => { $allLinkedBooks = value; });
__readerController.observeSource(() => syncTarget$, (value) => { $syncTarget$ = value; });
__readerController.observeSource(() => autoReplication$, (value) => { $autoReplication$ = value; });
const api = { controller: __readerController, run, refresh, choose, reconnect, setAutomatic,
get sources() { return sources; }, set sources(nextValue: typeof sources) { if (Object.is(sources, nextValue)) return; sources = nextValue; __readerController.invalidate(); },
get selected() { return selected; }, set selected(nextValue: typeof selected) { if (Object.is(selected, nextValue)) return; selected = nextValue; __readerController.invalidate(); },
get remoteTitles() { return remoteTitles; }, set remoteTitles(nextValue: typeof remoteTitles) { if (Object.is(remoteTitles, nextValue)) return; remoteTitles = nextValue; __readerController.invalidate(); },
get localRows() { return localRows; }, set localRows(nextValue: typeof localRows) { if (Object.is(localRows, nextValue)) return; localRows = nextValue; __readerController.invalidate(); },
get imports() { return imports; }, set imports(nextValue: typeof imports) { if (Object.is(imports, nextValue)) return; imports = nextValue; __readerController.invalidate(); },
get exports() { return exports; }, set exports(nextValue: typeof exports) { if (Object.is(exports, nextValue)) return; exports = nextValue; __readerController.invalidate(); },
get busy() { return busy; }, set busy(nextValue: typeof busy) { if (Object.is(busy, nextValue)) return; busy = nextValue; __readerController.invalidate(); },
get message() { return message; }, set message(nextValue: typeof message) { if (Object.is(message, nextValue)) return; message = nextValue; __readerController.invalidate(); },
get supported() { return supported; }, set supported(nextValue: typeof supported) { if (Object.is(supported, nextValue)) return; supported = nextValue; __readerController.invalidate(); },
get viewer() { return viewer; }, set viewer(nextValue: typeof viewer) { if (Object.is(viewer, nextValue)) return; viewer = nextValue; __readerController.invalidate(); },
get localBooks() { return localBooks; }, set localBooks(nextValue: typeof localBooks) { if (Object.is(localBooks, nextValue)) return; localBooks = nextValue; __readerController.invalidate(); },
get source() { return source; }, set source(nextValue: typeof source) { if (Object.is(source, nextValue)) return; source = nextValue; __readerController.invalidate(); },
get $account() { return $account; }, set $account(nextValue: typeof $account) { writeStore(account, nextValue); },
get $allLinkedBooks() { return $allLinkedBooks; }, set $allLinkedBooks(nextValue: typeof $allLinkedBooks) { writeStore(allLinkedBooks, nextValue); },
get $syncTarget$() { return $syncTarget$; }, set $syncTarget$(nextValue: typeof $syncTarget$) { writeStore(syncTarget$, nextValue); },
get $autoReplication$() { return $autoReplication$; }, set $autoReplication$(nextValue: typeof $autoReplication$) { writeStore(autoReplication$, nextValue); },
updateProps(next: Record<string, unknown>) {

}
};
return api;
}
