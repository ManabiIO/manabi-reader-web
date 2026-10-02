/** @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors. All rights reserved. */
import React from 'react';
import { useReaderController, readerTick } from '../reader-react/controller';
import { Dom, SurfaceEvents, Head, Icon, AppIcon, Button, Input, Switch, Field, Popover, DialogTemplate, ActionMenu, AppNav, Menu, useLatest, useReaderBindings, slotContent, Slot, type ReaderViewProps } from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import { createSharedLibraryScreen, type SharedLibraryScreenProps } from './shared-library-screen-controller';
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
export function SharedLibraryScreen(props: Partial<SharedLibraryScreenProps> & ReaderViewProps & {
    children?: React.ReactNode;
    onClose?: () => void;
    slot?: string;
}) {
    const latest = useLatest(props);
    const context = useSettingsContext();
    const c = useReaderController(() => createSharedLibraryScreen(props as SharedLibraryScreenProps, (name, detail) => { latest.current.events?.[name]?.({ detail }); if (name === 'close')
        latest.current.onClose?.(); }, context), props);
    useReaderBindings(c, props);
    if (!c)
        return null;
    return <SettingsContext.Provider value={context}><div className="react-settings-shared-library-screen" style={{ display: 'contents' }}>
    <Dom as="header" className={["app-header flex min-h-12 items-center justify-end border-b border-border bg-card px-3"].filter(Boolean).join(' ')}>
    <AppNav></AppNav>
    </Dom>
    <Head><Dom as="title">{"Shared Ttu Ebook Reader libraries · Manabi Reader"}</Dom></Head>
    <Dom as="main">
    <Dom as="nav" aria-label={"Context navigation"} className={["page-navigation"].filter(Boolean).join(' ')}>
    <Button href={resolve('/connections')} variant={"link"} size={"sm"} aria-label={"Back to Accounts and libraries"}>{"← Accounts and libraries"}</Button>
    </Dom>
    <Dom as="h1">{"Shared Ttu Ebook Reader libraries"}</Dom>
    <Dom as="p">{" Use the same "}<Dom as="code">{"ttu-reader-data"}</Dom>{" library as Ttu Ebook Reader. This mode stores book packages, bookmarks, and statistics in Ttu Ebook Reader’s existing format—not private Manabi Web sidecars. "}</Dom>
    <Dom as="section" aria-labelledby={"connect-folder"}>
    <Dom as="h2" id={"connect-folder"}>{"Connect a local or cloud-synced folder"}</Dom>
    <Dom as="p">{" Select "}<Dom as="code">{"ttu-reader-data"}</Dom>{" itself, or its parent. Selecting the root does not create another nested library. Books already downloaded locally remain readable without an account. "}</Dom>
        {(c.supported) ? <><Button variant={"default"} disabled={c.busy} onClick={() => c.choose(false)}>{"Add existing shared folder"}</Button>
        <Button variant={"outline"} disabled={c.busy} onClick={() => c.choose(true)}>{"Create shared library in a folder"}</Button></> : <> <Dom as="p">{" This browser does not expose the modern directory picker. Individual file import still works from the Books page. "}</Dom></>}
    <Dom as="p">{" Read/write permission is requested because this is a sync destination. For read-only access to ordinary EPUB files, use "}<Dom as="a" href={resolve('/connections')}>{"Add local folder"}</Dom>{" instead. "}</Dom>
    </Dom>
    <Dom as="p" role={"status"}>{c.message}</Dom>
        {(c.sources.length) ? <><Dom as="section" aria-labelledby={"connected-folder"}>
        <Dom as="h2" id={"connected-folder"}>{"Connected shared library"}</Dom>
        <Dom as="label">{"Shared folder"}<Dom as="select" value={c.selected} disabled={c.busy} events={{ "change": () => c.run(c.refresh) }} bindings={{ "value": (value: typeof c.selected) => { c.controller.changed(c.selected = value); } }}>{(c.sources ?? []).map((item, index0) => <React.Fragment key={item.name}><Dom as="option" value={item.name}>{item.name}</Dom></React.Fragment>)}</Dom></Dom>
            {(c.source) ? <><Dom as="p">{filesystemData(c.source).fsPath}</Dom>
            <Dom as="div" className={["actions"].filter(Boolean).join(' ')}>
            <Button variant={"outline"} disabled={c.busy} onClick={c.reconnect}>{"Reconnect folder permission"}</Button>
            <Button variant={"default"} disabled={c.busy} onClick={() => c.run(async () => {
                    if (!c.source)
                        return;
                    await openSharedFolder(c.source);
                    await goto(resolve('/manage'));
                })}>{"Open shared library"}</Button>
            <Button variant={"ghost"} disabled={c.busy} onClick={() => c.run(c.refresh)}>{"Refresh shared library"}</Button>
            </Dom>
            <Dom as="label"><Dom as="input" type={"checkbox"} checked={c.$syncTarget$ === c.source.name && c.$autoReplication$ === AutoReplicationType.All} disabled={c.busy} events={{ "change": (event: Event & { currentTarget: HTMLInputElement }) => c.setAutomatic(event.currentTarget.checked) }}/>{"Use this library as the automatic Ttu Ebook Reader import/export target"}</Dom>
            <Dom as="p" className={["note"].filter(Boolean).join(' ')}>{" This replaces the current automatic sync target. Read the shared copy from “Open shared library” so its identity stays associated with this source. Concurrent edits from other apps may require conflict recovery; the OS cloud client finishes its own upload separately. "}</Dom></> : null}
        </Dom>
        <Dom as="section" aria-labelledby={"shared-books"}>
        <Dom as="h2" id={"shared-books"}>{"Shared books"}</Dom>
            {(c.remoteTitles ?? []).map((title, index1) => <React.Fragment key={title}><Dom as="label"><Dom as="input" type={"checkbox"} group={c.imports} value={title} bindings={{ "group": (value: typeof c.imports) => { c.controller.changed(c.imports = value); } }}/>{title}</Dom></React.Fragment>)}
        {(!c.remoteTitles.length) ? <><Dom as="p">{" No Ttu Ebook Reader book packages are present yet. A folder of EPUBs alone is not a Ttu Ebook Reader library; publish selected books below. "}</Dom></> : null}
        <Button variant={"secondary"} disabled={c.busy || !c.source || !c.imports.length} onClick={() => c.run(async () => {
                if (!c.source)
                    return;
                await transferSharedBooks(c.source, 'import', c.imports);
                await c.refresh();
                c.controller.changed(c.message = 'Selected books, bookmarks and statistics imported.');
            })}>{"Import selected shared books"}</Button>
        </Dom>
        <Dom as="section" aria-labelledby={"publish-books"}>
        <Dom as="h2" id={"publish-books"}>{"Publish browser books"}</Dom>
        <Dom as="p">{" Publish only the books you select. This creates Ttu Ebook Reader book packages and their reading-data files; it does not modify original EPUB files or replace existing shared packages. "}</Dom>
            {(c.localBooks.filter((book) => !c.remoteTitles.includes(book.title)) ?? []).map((book, index2) => <React.Fragment key={book.title}><Dom as="div">
            <Dom as="label"><Dom as="input" type={"checkbox"} group={c.exports} value={book.title} disabled={c.busy || book.copies !== 1} bindings={{ "group": (value: typeof c.exports) => { c.controller.changed(c.exports = value); } }}/>{book.title}</Dom>
                {(book.copies !== 1) ? <><Dom as="p" className={["note"].filter(Boolean).join(' ')}>
                {book.copies}{" local copies share this title. Ttu Ebook Reader libraries identify books by title. Resolve the duplicate titles before sharing; your local copies are unchanged. "}</Dom></> : null}
            </Dom></React.Fragment>)}
        <Button variant={"secondary"} disabled={c.busy || !c.source || !c.exports.length} onClick={() => c.run(async () => {
                if (!c.source)
                    return;
                await transferSharedBooks(c.source, 'publish', c.exports);
                await c.refresh();
                c.controller.changed(c.message =
                    'Selected books published in Ttu Ebook Reader format. Your cloud client manages remote upload.');
            })}>{"Publish selected browser books"}</Button>
        </Dom></> : null}
    <Dom as="section" aria-labelledby={"native-compatibility"}>
    <Dom as="h2" id={"native-compatibility"}>{"Using the native Manabi app"}</Dom>
    <Dom as="p">{" The native app’s current main-branch Ttu Ebook Reader integration reads a Google Drive "}<Dom as="code">{"ttu-reader-data"}</Dom>{" library. Point both apps at the same visible library, and ensure their Google authorizations can see the same files. The same Google account alone does not guarantee that. "}</Dom>
    <Dom as="p">{" Native OneDrive, Dropbox, and local Ttu Ebook Reader-folder connections are not implemented by the existing Google-only native connector. The managed cloud connections on the Accounts page currently use a different reading-data format and are not a replacement for this shared-library mode. "}</Dom>
    </Dom>
    </Dom>
    </div></SettingsContext.Provider>;
}
