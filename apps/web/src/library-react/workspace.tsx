/** @license BSD-3-Clause; Copyright (c) 2026, ッツ Reader Authors */
import { Fragment, type ReactNode, type CSSProperties } from 'react';
/** @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors. All rights reserved.
 * React/controller port of lib/library/library-workspace.svelte; transactions retain their original guards.
 */
import { foldSearch } from '$lib/library/search-normalization';
import { bookTitleMatchIndex } from '$lib/search/book-title-match-text';
import { librarySelection } from '$lib/library/selection-action';
import { librarySelectionScopeKey, type LibrarySelectionEligibility } from '$lib/library/selection';
import type { BookPresentation, PresentationChange } from '$lib/library/organization';
import { page } from '$app/stores';
import { goto, replaceState } from '$app/navigation';
import { resolve } from '$app/paths';
import { booklistSortOptions$ } from '$lib/data/store';
import { StorageKey } from '$lib/data/storage/storage-types';
import type { SortOption } from '$lib/data/sort-types';
import type { BookCardProps } from '$lib/components/book-card/book-card-props';
import { account, currentUser, localProfileUser, localUser, requestSeriesWriteAccess } from '$lib/manabi/client';
import { allLinkedBooks, linkedBooks, refreshLinkedBooks, importLibraryBook } from '$lib/manabi/books';
import { integrationDB, type LocalLibrary } from '$lib/manabi/persistence';
import { reconnectLocalLibrary, sha256 } from '$lib/manabi/sources';
import { sourceDescriptors, cachedCatalog, librarySource, scanCatalog, type Catalog, type SourceDescriptor } from '$lib/library/catalog';
import { organization, watchOrganization, presentBook, presentBooks, setMembershipMany, setMembership, setWantToRead, createCollection } from '$lib/library/organization';
import { buildShelf, allBooks, seriesTrail, visibleShelf, type ShelfBook, type ShelfSeries } from '$lib/library/view-model';
import { isFinished, finishedDay, calendarDay } from '$lib/library/completion';
import { visibleLibraryEntries } from '$lib/library/account-visibility';
import { WANT_TO_READ_ID, wantToReadCollection, collectionContains, collectionItemCount } from '$lib/library/want-to-read';
import { setCompletion } from '$lib/library/commands';
import { createLocalSeries, renameLocalSeries, resumeLocalSeries, pendingMoves } from '$lib/library/local-series';
import { previews, PreviewQueue } from '$lib/library/previews';
import type { ShelfNode } from '$lib/library/view-model';
import type { MovePlan } from '$lib/library/file-operations';
import type { ReaderLocator } from '$lib/reader-location';
import { libraryShelfSearchQuery, parseLibrarySearchScope, type LibrarySearchScope } from '$lib/search/library-search-scope';
import { snippetItems } from '$lib/snippets/service';
import { snippetKey } from '$lib/snippets/document';
import { creatorLine, sharedCreatorLine } from '$lib/library/book-metadata';
import { coverOverride } from '$lib/library/cover-override';
import { contentBookKey, sourceKey } from '$lib/library/organization';
import { advanceCloudSeries, cancelCloudSeries, cloudSeriesStatus, cloudSeriesCapabilities, prepareCloudSeries, recentCloudSeries, type CloudSeriesCapability, type CloudSeriesPlan } from '$lib/library/cloud-series';
import type { LibraryMenuModel } from '$lib/library/library-menu';
import { continueBooks, finishedGroups, formatCalendarDay, hasReadingEvidence, readingLabel, seriesReadingTarget } from '$lib/library/reading-state';
import { WorkspaceController } from './workspace-controller';
import { readStore, tick } from './observable-controller';
import { Action, Button, Dialog, Menu, Sheet, CloseButton, Icon } from './primitives';
import { BookCover, CoverStack, SourceIcon } from './covers';
import { CollectionsSheet } from './collections';
import { OrganizationDialog as BookOrganizationDialog } from './organization';
import { UnifiedSearch } from './search';
import { SnippetShelf } from './snippet-shelf';
import { BookOpen, BookmarkSimple, Books, CalendarBlank, CheckCircle as CircleCheck, DotsThree as MoreHorizontal, DownloadSimple, FolderOpen, ImageSquare, Info, List, PencilSimple, Plus, Trash, CaretRight, FileText, Video } from '@phosphor-icons/react';
export function WorkspaceView({ c, children }: {
    c: WorkspaceController;
    children?: ReactNode;
}) {
    const bookMenu = (book: ShelfBook, labelSuffix: string) => <>
    <Menu.Root>
    <Menu.Trigger child={({ props }: {
        props: Record<string, any>;
    }) => <><Button {...props} variant={"ghost"} size={"icon"} aria-label={`Actions for ${book.title}${labelSuffix}`} title={`Actions for ${book.title}${labelSuffix}`} disabled={c.busy} className={["min-h-11 min-w-11"].filter(Boolean).join(" ")}><MoreHorizontal weight={"bold"} aria-hidden={"true"} className={["size-6"].filter(Boolean).join(" ")}/></Button></>}/>
    <Menu.Content align={"end"} className={["library-menu w-64 max-w-[calc(100vw-1rem)]"].filter(Boolean).join(" ")}>
    {!book.bookId ? <><Menu.Item onSelect={() => c.saveBook(book)}><DownloadSimple aria-hidden={"true"}/>{"Save to this browser"}</Menu.Item></> : null}
    {!book.bookId ? <><Menu.Separator /></> : null}
    <Menu.Item onSelect={() => c.editBook(book, 'details')}><Info aria-hidden={"true"}/>{"Book Details"}</Menu.Item>
    <Menu.Item onSelect={() => c.saveWantToRead([book], !collectionContains(c.wantToRead, book))}><BookmarkSimple weight={collectionContains(c.wantToRead, book) ? 'fill' : 'regular'} aria-hidden={"true"}/>{collectionContains(c.wantToRead, book)
            ? 'Remove from Want to Read'
            : 'Add to Want to Read'}</Menu.Item>
    <Menu.Item onSelect={() => c.editBook(book, 'rename')}><PencilSimple aria-hidden={"true"}/>{"Rename…"}</Menu.Item>
    <Menu.Item onSelect={() => c.editOrganization('metadata', [book])}><PencilSimple aria-hidden={"true"}/>{"Edit Metadata…"}</Menu.Item>
    <Menu.Item onSelect={() => c.editBook(book, 'membership')}><Books aria-hidden={"true"}/>{"Add to Collection…"}</Menu.Item>
    <Menu.Item onSelect={() => c.editOrganization('series', [book])}><Books aria-hidden={"true"}/>{"Add to Series…"}</Menu.Item>
    <Menu.Item onSelect={() => c.blurBooks([book], !book.coverBlur)}><ImageSquare aria-hidden={"true"}/>{book.coverBlur
            ? 'Unblur Cover'
            : 'Blur Cover'}</Menu.Item>
    <Menu.Item onSelect={() => c.finish(book)}>{isFinished(book) ? <><BookOpen aria-hidden={"true"}/>{"Mark as Still Reading"}</> : <><CircleCheck aria-hidden={"true"}/>{"Mark as Finished"}</>}</Menu.Item>
        {isFinished(book) ? <><Menu.Item onSelect={() => c.editBook(book, 'date')}><CalendarBlank aria-hidden={"true"}/>{finishedDay(book)
                ? 'Edit Finished Date…'
                : 'Set Finished Date…'}</Menu.Item></> : null}
    <Menu.Separator />
    <Menu.Item onSelect={() => c.chooseCover(book)}><ImageSquare aria-hidden={"true"}/>{"Change Cover…"}</Menu.Item>
    {readStore(organization).books[book.organizationKey]?.cover ? <><Menu.Item onSelect={() => void c.action(() => presentBook(book.organizationKey, { cover: undefined }))}><ImageSquare aria-hidden={"true"}/>{"Use Original Cover"}</Menu.Item></> : null}
    {book.bookId ? <><Menu.Separator /><Menu.Item variant={"destructive"} onSelect={() => c.onRemoveBook(book.bookId!)}><Trash aria-hidden={"true"}/>{"Remove from this browser…"}</Menu.Item></> : null}
    </Menu.Content>
    </Menu.Root>
    </>;
    const seriesMenu = (value: ShelfSeries) => <>
    <Menu.Root><Menu.Trigger child={({ props }: {
        props: Record<string, any>;
    }) => <><Button {...props} variant={"ghost"} size={"icon"} aria-label={`Actions for series ${value.name}`} disabled={c.busy} className={["min-h-11 min-w-11"].filter(Boolean).join(" ")}><MoreHorizontal weight={"bold"} aria-hidden={"true"} className={["size-6"].filter(Boolean).join(" ")}/></Button></>}/>
    <Menu.Content align={"end"} className={["library-menu"].filter(Boolean).join(" ")}><Menu.Item onSelect={() => c.navigate(value.id)}><FolderOpen aria-hidden={"true"}/>{"Open Series"}</Menu.Item>
        {value.personal ? <><Menu.Item onSelect={() => c.editOrganization('series', value.books)}><PencilSimple aria-hidden={"true"}/>{"Edit Series…"}</Menu.Item>
        </> : <>{value.source?.owner === null || value.source?.provider === 'onedrive' ? <><Menu.Item onSelect={() => c.editSeries(value)}><PencilSimple aria-hidden={"true"}/>{"Rename Series…"}</Menu.Item>
            </> : <><Menu.Label>{"This cloud provider cannot edit series yet."}</Menu.Label></>}</>}
    </Menu.Content>
    </Menu.Root>
    </>;
    return <>
    <input hidden={true} type={"file"} accept={"image/png,image/jpeg,image/webp"} aria-label={"Choose replacement cover"} onChange={(event: any) => c.coverChanged(event.currentTarget.files)} ref={(element: any) => { c.coverInput = element; }}/>


    <div className={["library-frame"].filter(Boolean).join(" ")}>
    <aside id={"library-collections-navigation"} aria-label={"Collections"} className={["library-rail"].filter(Boolean).join(" ")}>
    <h2>{"Library"}</h2>
    <nav>
    <button aria-current={c.collectionId === 'books' ? 'page' : undefined} onClick={() => {
            c.query = '';
            c.navigate(undefined, 'books', false);
        }}><BookOpen aria-hidden={"true"}/><span>{"Books"}</span><span>{c.books.length}</span></button>
    <a href={resolve('/snippets')} className={["flex items-center gap-3 rounded-xl p-3 text-sm"].filter(Boolean).join(" ")}><Books aria-hidden={"true"}/><span>{"Snippets"}</span><span>{readStore(snippetItems).filter((item) => !item.trashedAt).length}</span></a>
    <button aria-current={c.collectionId === WANT_TO_READ_ID ? 'page' : undefined} onClick={() => {
            c.query = '';
            c.navigate(undefined, WANT_TO_READ_ID, false);
        }}><BookmarkSimple aria-hidden={"true"}/><span>{"Want to Read"}</span><span>{c.wantToReadCount}</span></button>
    <button aria-current={c.collectionId === 'finished' ? 'page' : undefined} onClick={() => {
            c.query = '';
            c.navigate(undefined, 'finished', false);
        }}><CircleCheck aria-hidden={"true"}/><span>{"Finished"}</span><span>{c.books.filter(isFinished).length}</span></button>
    <h3>{"My Collection"}</h3>
        {(c.customCollections).map((collection, __index) => <Fragment key={collection.id}><button aria-current={c.collectionId === collection.id ? 'page' : undefined} onClick={() => {
                c.query = '';
                c.navigate(undefined, collection.id, false);
            }}><List aria-hidden={"true"}/><span>{collection.name}</span><span>{c.customCollectionCounts[collection.id] ?? 0}</span></button></Fragment>)}
    <button onClick={() => (c.collectionsOpen = true)}><Plus aria-hidden={"true"}/><span>{"New Collection…"}</span></button>
    </nav>
    </aside>
    <Action tabIndex={-1} aria-label={"Library shelves"} aria-busy={c.busy || c.scanning} data-hydrated={c.alive} ref={(element: any) => { c.shelfElement = element; }} className={["library-workspace"].filter(Boolean).join(" ")} as={"section"} action={librarySelection} options={{
            enabled: c.selectMode,
            busy: c.busy,
            scope: c.selectionScopeKey,
            selected: c.selectedKeys,
            change: c.changeSelectedKeys,
            cancel: () => c.onSelectionCancel()
        }}>
        {!c.series && c.collectionId === 'books' && !c.normalizedQuery ? <>
        <div className={["library-toolbar"].filter(Boolean).join(" ")}>
        <h2 id={c.recentBooks.length ? 'continue-heading' : 'books-heading'} className={["shelf-heading"].filter(Boolean).join(" ")}>
        {c.recentBooks.length ? 'Continue' : 'Books'}
        </h2>
        </div>
        </> : null}
    {c.selectMode ? <><p className={["mb-5 text-sm text-muted-foreground"].filter(Boolean).join(" ")}>{" Selecting a series includes its matching saved books. Connected previews must be saved before they can be exported. "}</p></> : null}
        {c.error ? <><p role={"alert"} className={["mb-5 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"].filter(Boolean).join(" ")}>
        {c.error}
        </p></> : null}
    {c.notice ? <><p role={"status"} className={["mb-4 text-sm text-muted-foreground"].filter(Boolean).join(" ")}>{c.notice}</p></> : null}
    {c.scanning ? <><p role={"status"} className={["mb-4 text-sm text-muted-foreground"].filter(Boolean).join(" ")}>{" Reading connected folders… "}</p></> : null}
        {(c.pending).map((plan, __index) => <Fragment key={plan.id}><div className={["mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-border p-4"].filter(Boolean).join(" ")}>
        <p className={["flex-1 text-sm"].filter(Boolean).join(" ")}>{" A folder change for “"}{plan.name}{"” needs to finish. Verified copies and remaining originals have been kept. "}</p>
        <Button onClick={() => c.resumeMove(plan)} disabled={c.busy}>{"Resume Folder Change"}</Button>
        </div></Fragment>)}
        {(c.cloudPlans).map((entry, __index) => <Fragment key={`${sourceKey(entry.source)}:${entry.plan.id}`}>
        <div className={["mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-border p-4"].filter(Boolean).join(" ")}>
        <p className={["flex-1 text-sm"].filter(Boolean).join(" ")}>{" A OneDrive series change is "}{entry.plan.status === 'paused' ? 'paused' : 'unfinished'}{": "}{entry.plan.steps.filter((step) => step.state === 'done').length}{" of "}{entry.plan.steps.length}{" steps complete. Completed moves remain in OneDrive. "}</p>
        <Button variant={"outline"} onClick={() => c.resumeCloudPlan(entry.source, entry.plan)} disabled={c.busy}>{"Review Change"}</Button>
        </div>
        </Fragment>)}
    {c.previewFailures ? <><p className={["mb-4 text-sm text-muted-foreground"].filter(Boolean).join(" ")}>{" Some cover previews could not be loaded. Your files are unchanged. Refresh connected folders to retry. "}</p></> : null}
        {c.warnings.length ? <><details className={["mb-4 rounded-2xl border border-border p-4 text-sm"].filter(Boolean).join(" ")}>
        <summary>{"Some series names could not be read ("}{c.warnings.length}{")"}</summary>{(c.warnings).map((warning, index) => <Fragment key={index}><p className={["mt-2 break-words"].filter(Boolean).join(" ")}>{warning}</p></Fragment>)}
        </details></> : null}
        {!c.normalizedQuery && !c.series && !c.selectMode && (c.collectionId === 'books' || c.selectedCollection) && readStore(snippetItems).some((item) => !item.trashedAt && (!c.selectedCollection || c.selectedCollection.members.includes(snippetKey(item.id)))) ? <>
        <section aria-label={"Snippets in this library"} className={["my-6"].filter(Boolean).join(" ")}>
        <div className={["mb-4 flex items-center justify-between"].filter(Boolean).join(" ")}>
        <h2 className={["text-xl font-semibold"].filter(Boolean).join(" ")}>{"Snippets"}</h2>
        <Button variant={"ghost"} href={c.selectedCollection ? resolve(`/snippets?collection=${encodeURIComponent(c.selectedCollection.id)}`)
                : resolve('/snippets')}>{"Manage snippets"}</Button>
        </div>
        <SnippetShelf members={c.selectedCollection?.members} showEmpty={false}/>
        </section>
        </> : null}
        {c.recentBooks.length ? <>
        <section aria-labelledby={"continue-heading"} className={["continue-section mb-7"].filter(Boolean).join(" ")}>
        <div role={"list"} className={["continue-track"].filter(Boolean).join(" ")}>
            {(c.recentBooks).map((book, __index) => <Fragment key={book.key}>
            <article role={"listitem"} className={["continue-card"].filter(Boolean).join(" ")}>
            <button data-selection-key={`continue:${book.key}`} data-selection-ids={JSON.stringify([book.key])} onClick={() => c.openBook(book)} aria-label={`Continue ${book.title}`} className={["continue-open"].filter(Boolean).join(" ")}>
            <div className={["continue-cover"].filter(Boolean).join(" ")}>
            <BookCover imagePath={book.imagePath} blurred={book.coverBlur} title={book.title} author={creatorLine(book.creators)} identity={book.key} direction={book.direction}/>
            </div>
            <span className={["min-w-0 flex-1"].filter(Boolean).join(" ")}>
            <strong className={["continue-title"].filter(Boolean).join(" ")}>{book.title}</strong>
            {creatorLine(book.creators) ? <><span className={["continue-author"].filter(Boolean).join(" ")}>{creatorLine(book.creators)}</span></> : null}
            <span className={["continue-progress"].filter(Boolean).join(" ")}>{readingLabel(book)}</span>
            </span>
            </button>
            <SourceIcon provider={book.source?.provider} name={book.source?.name || ''}/>
            {bookMenu(book, ' in Continue')}
            </article>
            </Fragment>)}
        </div>
        </section>
        </> : null}
        {c.series && !c.normalizedQuery ? <>
        <Action className={["series-hero mb-10 rounded-3xl px-6 pt-8 pb-7 text-center"].filter(Boolean).join(" ")} as={"header"} action={c.previewVisible} options={c.series}>
        <div className={["series-hero-art"].filter(Boolean).join(" ")}><CoverStack books={c.scopedSeriesBooks} hero={true}/></div>
        <div className={["series-hero-copy"].filter(Boolean).join(" ")}>
        <div className={["series-title-row"].filter(Boolean).join(" ")}>
        <p className={["min-w-0 break-words font-serif text-3xl font-semibold sm:text-4xl"].filter(Boolean).join(" ")}>
        {c.series.name}
        </p>
        {seriesMenu(c.series)}
        </div>
        <p className={["mt-2 text-sm text-muted-foreground"].filter(Boolean).join(" ")}>{" Series · "}{c.scopedSeriesBooks.length}
        {c.scopedSeriesBooks.length === 1 ? 'Book' : 'Books'}{c.collectionId !== 'books' ? <><span>{" in "}{c.collectionTitle}</span></> : null}
        </p>
            {c.seriesCreators ? <><p className={["mt-1 text-sm text-muted-foreground"].filter(Boolean).join(" ")}>
            {c.seriesCreators}
            </p></> : null}
            {c.resume ? <><Button onClick={() => c.openBook(c.resume!)} disabled={c.busy} className={["mt-6 h-auto min-h-14 max-w-lg flex-col whitespace-normal px-6 py-3"].filter(Boolean).join(" ")}><span className={["font-semibold"].filter(Boolean).join(" ")}>{hasReadingEvidence(c.resume) ? 'Continue Reading' : 'Start Reading'}</span><span className={["max-w-full truncate font-normal opacity-80"].filter(Boolean).join(" ")}>{c.resume.title}</span></Button></> : <><p className={["mt-6 inline-flex items-center gap-2 text-sm"].filter(Boolean).join(" ")}>
            <CircleCheck aria-hidden={"true"} className={["size-4"].filter(Boolean).join(" ")}/>{"All books finished "}</p></>}
        {c.collectionId !== 'books' ? <><Button variant={"ghost"} onClick={() => { const series = c.series; if (series) c.navigate(series.id, 'books', false); }} className={["mt-3"].filter(Boolean).join(" ")}>{"View full series"}</Button></> : null}
        </div>
        </Action>
        </> : <>{c.recentBooks.length && !c.normalizedQuery ? <><h2 id={"books-heading"} className={["shelf-heading mb-4"].filter(Boolean).join(" ")}>{" Books "}</h2></> : null}</>}
        {c.normalizedQuery && !c.selectMode ? <>
        <UnifiedSearch query={c.query} searchScope={c.librarySearchScope} books={c.searchableBooks} matches={c.metadataMatches} bookMatchText={c.metadataMatchText} openBook={c.openBook} onquery={c.setQuery} onscope={c.setSearchScope} returnTo={readStore(page).url.pathname + readStore(page).url.search}/>
        </> : <>{c.completedGroups.length && c.collectionId === 'finished' && !c.series && c.currentLayout === 'timeline' ? <>
            <div role={"list"} aria-label={"Finished books"} className={["finished-timeline"].filter(Boolean).join(" ")}>
                {(c.completedGroups).map((group, __index) => <Fragment key={group.day || 'unknown'}>
                <section aria-labelledby={`finished-${group.day || 'unknown'}`} className={["finished-group"].filter(Boolean).join(" ")}>
                <h3 id={`finished-${group.day || 'unknown'}`} className={["finished-day"].filter(Boolean).join(" ")}>
                {group.day ? formatCalendarDay(group.day) : 'Date not set'}
                </h3>
                <div className={["finished-group-books"].filter(Boolean).join(" ")}>
                    {(group.books).map((book, __index) => <Fragment key={book.key}>
                    <article role={"listitem"} className={["finished-row"].filter(Boolean).join(" ")}>
                    <button data-selection-key={book.key} data-selection-ids={JSON.stringify([book.key])} aria-pressed={c.selectMode ? c.selectedKeys.has(book.key) : undefined} onClick={() => c.openBook(book)} aria-label={`Read ${book.title}`} className={["finished-open", (c.selectedKeys.has(book.key) ? "selected" : '')].filter(Boolean).join(" ")}>
                    <div className={["finished-cover"].filter(Boolean).join(" ")}>
                    <BookCover imagePath={book.imagePath} blurred={book.coverBlur} title={book.title} author={creatorLine(book.creators)} identity={book.key} direction={book.direction}/>
                    </div>
                    <span className={["min-w-0 flex-1"].filter(Boolean).join(" ")}>
                    <strong className={["finished-title"].filter(Boolean).join(" ")}>{book.title}</strong>
                    {creatorLine(book.creators) ? <><span className={["finished-author"].filter(Boolean).join(" ")}>{creatorLine(book.creators)}</span></> : null}
                    <span className={["finished-detail"].filter(Boolean).join(" ")}>{"Finished"}{group.day ? ` · ${formatCalendarDay(group.day)}` : ''}</span>
                    </span>
                    </button>
                    <SourceIcon provider={book.source?.provider} name={book.source?.name || ''}/>
                    {bookMenu(book, '')}
                    </article>
                    </Fragment>)}
                </div>
                </section>
                </Fragment>)}
            </div>
            <p className={["mt-12 text-center text-sm text-muted-foreground"].filter(Boolean).join(" ")}>
            {c.visibleBooks.length}
            {c.visibleBooks.length === 1 ? 'book' : 'books'}
            </p>
            </> : <>{c.displayed.length ? <>
                <div role={"list"} aria-label={c.series?.name || c.collectionTitle} className={[(c.currentLayout === 'grid' ? "shelf-grid" : ''), (c.currentLayout === 'list' ? "shelf-list" : '')].filter(Boolean).join(" ")}>
                    {(c.displayed).map((node, __index) => <Fragment key={node.id}>
                    <Action role={"listitem"} data-book-key={node.kind === 'book' ? node.book.key : undefined} className={["shelf-item", (node.kind === 'series' ? "series-item" : '')].filter(Boolean).join(" ")} as={"article"} action={c.previewVisible} options={node}>
                        {node.kind === 'series' ? <>{(() => {
                                const seriesBookKeys = node.books.map((book) => book.key);
                                const selectedInSeries = seriesBookKeys.filter((key) => c.selectedKeys.has(key)).length;
                                return <>


                                <button data-selection-key={node.id} data-selection-ids={JSON.stringify(seriesBookKeys)} aria-pressed={c.selectMode ? selectedInSeries === 0
                                        ? false
                                        : selectedInSeries === seriesBookKeys.length
                                            ? true
                                            : 'mixed'
                                        : undefined} onClick={() => c.selectMode ? c.changeSelectedKeys(new Set(seriesBookKeys)) : c.navigate(node.id)} aria-label={`${c.selectMode ? 'Select' : 'Open'} series ${node.name}`} className={["book-open", (c.selectMode && selectedInSeries > 0 ? "selected" : '')].filter(Boolean).join(" ")}>
                                <div className={["book-thumbnail"].filter(Boolean).join(" ")}>
                                <CoverStack books={node.books}/>
                                {c.selectMode && selectedInSeries > 0 ? <><span className={["selection-label"].filter(Boolean).join(" ")}>{selectedInSeries}{" selected"}</span></> : null}
                                </div>
                                <div className={["book-copy series-copy"].filter(Boolean).join(" ")}>
                                <h3>{node.name}</h3>
                                <p className={["list-detail"].filter(Boolean).join(" ")}>{"Series · "}{node.books.length}{" books"}</p>
                                </div>
                                </button>
                                <div className={["book-status"].filter(Boolean).join(" ")}>
                                <span className={["progress-label"].filter(Boolean).join(" ")}>{node.books.length}{" books"}</span><SourceIcon provider={node.source?.provider} name={node.source?.name || 'Personal series'}/>{!c.selectMode ? <>{seriesMenu(node)}</> : null}
                                </div>
                                </>;
                            })()}</> : <>{(() => {
                                const book = node.book;
                                return <>

                                <button data-selection-key={node.id} data-selection-ids={JSON.stringify([book.key])} aria-pressed={c.selectMode ? c.selectedKeys.has(book.key) : undefined} aria-label={`${c.selectMode ? 'Select' : 'Read'} ${book.title}`} aria-describedby={isFinished(book) && book.bookId
                                        ? `finished-description-${book.bookId}`
                                        : undefined} onClick={() => c.selectMode ? c.changeSelectedKeys(new Set([book.key])) : c.openBook(book)} className={["book-open", (c.selectedKeys.has(book.key) ? "selected" : '')].filter(Boolean).join(" ")}>
                                <div className={["book-thumbnail"].filter(Boolean).join(" ")}>
                                <BookCover imagePath={book.imagePath} blurred={book.coverBlur} title={book.title} author={creatorLine(book.creators)} identity={book.key} direction={book.direction} onWidth={(fraction) => c.rememberCoverWidth(book.key, fraction)}/>{c.selectedKeys.has(book.key) ? <><span className={["selection-label"].filter(Boolean).join(" ")}>{"Selected"}</span></> : null}
                                </div>
                                <div className={["book-copy"].filter(Boolean).join(" ")}>
                                <h3>{book.title}</h3>
                                    {creatorLine(book.creators) ? <><p className={["book-author"].filter(Boolean).join(" ")}>
                                    {creatorLine(book.creators)}
                                    </p></> : null}
                                <p className={["list-detail"].filter(Boolean).join(" ")}>
                                {readingLabel(book) === 'Unread' ? <><span title={"Unread"} className={["new-badge"].filter(Boolean).join(" ")}>{"NEW"}</span></> : <>{readingLabel(book)}</>}{isFinished(book) && finishedDay(book) ? <>{" · "}{finishedDay(book)}</> : <>{book.bookId && book.bookId === c.currentBookId ? <>{" · Reading now"}</> : null}</>}
                                </p>
                                </div>
                                </button>
                                    {isFinished(book) && book.bookId ? <><span id={`finished-description-${book.bookId}`} className={["sr-only"].filter(Boolean).join(" ")}>{finishedDay(book)
                                            ? `Finished ${formatCalendarDay(finishedDay(book)!)}.`
                                            : 'Finished. Date not set.'}</span></> : null}
                                <div className={["book-status"].filter(Boolean).join(" ")} style={({ "--book-cover-width": `${(c.coverWidths[book.key] ?? 1) * 100}%` } as CSSProperties)}>
                                <span title={readingLabel(book) === 'Unread' ? 'Unread' : undefined} className={["progress-label", (readingLabel(book) === 'Unread' ? "new-badge" : '')].filter(Boolean).join(" ")}>{readingLabel(book) === 'Unread' ? 'NEW' : readingLabel(book)}</span><SourceIcon provider={book.source?.provider} name={book.source?.name || ''}/>{!c.selectMode ? <>{bookMenu(book, '')}</> : null}
                                </div>
                                </>;
                            })()}</>}
                    </Action>
                    </Fragment>)}
                </div>
                <p className={["mt-12 text-center text-sm text-muted-foreground"].filter(Boolean).join(" ")}>
                {c.visibleBooks.length}
                {c.visibleBooks.length === 1 ? 'book' : 'books'}
                </p>
                </> : <>{c.books.length || c.series || c.collectionId !== 'books' ? <>
                    <div className={["py-16 text-center"].filter(Boolean).join(" ")}>
                        {c.collectionId === WANT_TO_READ_ID && !c.normalizedQuery && !c.notFinished ? <>
                        <BookmarkSimple aria-hidden={"true"} className={["mx-auto mb-4 size-10 text-muted-foreground"].filter(Boolean).join(" ")}/>
                        </> : null}
                    <h3 className={["text-lg font-medium"].filter(Boolean).join(" ")}>
                        {c.normalizedQuery ? 'No matching books'
                            : c.collectionId === 'finished'
                                ? 'No finished books'
                                : c.notFinished ? 'All books here are finished'
                                    : c.collectionId === WANT_TO_READ_ID
                                        ? 'What will you read next?'
                                        : c.selectedCollection ? 'No books in this collection'
                                            : 'No books here'}
                    </h3>
                    <p className={["mt-2 text-sm text-muted-foreground"].filter(Boolean).join(" ")}>
                        {c.normalizedQuery ? 'Try another search or clear the current search.'
                            : c.collectionId === 'finished'
                                ? 'Books you finish will appear here.'
                                : c.notFinished ? 'Show all books to include finished titles.'
                                    : c.collectionId === WANT_TO_READ_ID
                                        ? 'Choose Add to Want to Read from a book’s menu to save it for later.'
                                        : 'Add books to this collection from a book’s menu.'}
                    </p>
                        {c.normalizedQuery || c.notFinished ? <><Button variant={"outline"} onClick={() => {
                                if (c.normalizedQuery)
                                    c.query = '';
                                else
                                    c.navigate(c.series?.id, c.collectionId, false);
                            }} className={["mt-5"].filter(Boolean).join(" ")}>{c.normalizedQuery ? 'Clear Search' : 'Show All'}</Button></> : null}
                        {c.collectionId === WANT_TO_READ_ID && !c.normalizedQuery && !c.notFinished ? <>
                        <Button variant={"outline"} data-empty-library-action={true} onClick={() => c.navigate(undefined, 'books', false)} className={["mt-5 min-h-11 px-5"].filter(Boolean).join(" ")}>{"Browse Library"}</Button>
                        </> : null}
                    </div>
                    </> : <>{children}</>}</>}</>}</>}
    </Action>
    </div>
    <CollectionsSheet books={c.books} active={c.collectionId} onchoose={(id) => {
            c.query = '';
            c.navigate(undefined, id, false);
        }} open={c.collectionsOpen} onOpenChange={(value: any) => { c.collectionsOpen = value; }}/>
        {c.organizationDialog ? <>
        <Fragment key={c.organizationEpoch}>
        <BookOrganizationDialog mode={c.organizationDialog} targets={c.organizationTargets} collections={[c.wantToRead, ...c.customCollections]} seriesNames={c.personalSeriesNames} save={c.saveOrganization} membership={c.saveBatchMembership} create={c.createBatchCollection} close={() => {
                c.organizationDialog = undefined;
                c.organizationEpoch++;
            }}/>
        </Fragment>
        </> : null}
    <Dialog.Root open={c.dialogOpen} onOpenChange={(value: any) => { c.dialogOpen = value; }}>
    <Dialog.Content onOpenAutoFocus={(event: any) => {
            if (c.dialog !== 'membership')
                return;
            // Bits UI may otherwise move focus between the new-collection field and
            // an existing membership checkbox while the portalled dialog settles in
            // WebKit. Own the initial target so typing/Enter cannot submit an empty
            // required field after focus is stolen.
            event.preventDefault();
            c.newCollectionInput?.focus();
        }} className={[`max-h-[85dvh] overflow-y-auto [&_[data-slot=dialog-close]]:top-3 [&_[data-slot=dialog-close]]:right-3 [&_[data-slot=dialog-close]]:size-11 [&_[data-slot=dialog-footer]_button]:min-h-11 ${c.dialog === 'new-series' ? 'sm:max-w-xl' : ''}`].filter(Boolean).join(" ")}>
    <Dialog.Header>
    <Dialog.Title className={["pr-8"].filter(Boolean).join(" ")}>{c.dialog === 'details'
            ? 'Book details'
            : c.dialog === 'rename'
                ? 'Rename book'
                : c.dialog === 'date'
                    ? 'Edit finished date'
                    : c.dialog === 'membership'
                        ? 'Add to collection'
                        : c.dialog === 'series-name'
                            ? 'Rename series'
                            : 'Create series'}</Dialog.Title>
    <Dialog.Description>{c.dialog === 'details'
            ? c.targetBook?.title
            : c.dialog === 'rename'
                ? 'Change the display name. The original file, reading position and history are unchanged.'
                : c.dialog === 'date'
                    ? 'Change the completion date without changing reading progress or statistics.'
                    : c.dialog === 'membership'
                        ? 'A book can belong to more than one collection. This does not move files.'
                        : c.dialog === 'series-name'
                            ? 'Save the display name in this folder’s .manabi-reader.yaml. The folder path stays the same.'
                            : 'Move selected ebook files into a new subfolder. Reading progress, notes and collections stay with the books.'}</Dialog.Description>
    </Dialog.Header>
        {c.dialog === 'details' && c.targetBook ? <>
        <dl className={["grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-3 text-sm"].filter(Boolean).join(" ")}>
        <dt className={["text-muted-foreground"].filter(Boolean).join(" ")}>{"Characters"}</dt>
        <dd>{c.targetBook.characters || 'No data'}</dd>
        <dt className={["text-muted-foreground"].filter(Boolean).join(" ")}>{"Last read"}</dt>
        <dd>{c.dateInfo(c.targetBook.lastBookOpen)}</dd>
        <dt className={["text-muted-foreground"].filter(Boolean).join(" ")}>{"Bookmarked"}</dt>
        <dd>{c.dateInfo(c.targetBook.lastBookmarkModified)}</dd>
        <dt className={["text-muted-foreground"].filter(Boolean).join(" ")}>{"Last update"}</dt>
        <dd>{c.dateInfo(c.targetBook.lastBookModified)}</dd>
        </dl>
        <Dialog.Footer><Button variant={"secondary"} onClick={() => (c.dialogOpen = false)}>{"Done"}</Button></Dialog.Footer>
        </> : <>{c.dialog === 'membership' && c.targetBook ? <>
            <div className={["grid max-h-[40dvh] gap-3 overflow-y-auto"].filter(Boolean).join(" ")}>
                {([c.wantToRead, ...c.customCollections]).map((collection, __index) => <Fragment key={collection.id}><label className={["flex min-h-11 items-center gap-3 rounded-xl border border-border px-3"].filter(Boolean).join(" ")}><input type={"checkbox"} checked={c.targetBook?.organizationAliases.some((alias) => collection.members.includes(alias)) ?? false} disabled={c.busy} onChange={(event: any) => {
                        const included = event.currentTarget.checked;
                        const selected = c.targetBook;
                        if (!selected) return;
                        void c.action(async () => {
                            const stable = await c.stableOrganizationBook(selected);
                            c.targetBook = stable;
                            await setMembership(collection.id, stable.organizationKey, included, stable.organizationAliases);
                        });
                    }}/>{collection.id === WANT_TO_READ_ID ? <><BookmarkSimple aria-hidden={"true"} className={["size-5"].filter(Boolean).join(" ")}/></> : null}<span>{collection.name}</span></label></Fragment>)}
            {!c.customCollections.length ? <><p className={["text-sm text-muted-foreground"].filter(Boolean).join(" ")}>{" Create a custom collection below. "}</p></> : null}
            </div>
            <form onSubmit={(event: any) => {
                    event.preventDefault();
                    void c.action(async () => {
                        const stable = await c.stableOrganizationBook(c.targetBook!);
                        c.targetBook = stable;
                        await createCollection(c.newCollectionName, [stable.organizationKey]);
                        c.newCollectionName = '';
                    });
                }} className={["flex gap-2"].filter(Boolean).join(" ")}>
            <label className={["min-w-0 flex-1"].filter(Boolean).join(" ")}><span className={["sr-only"].filter(Boolean).join(" ")}>{"New collection name"}</span><input placeholder={"New collection name"} maxLength={240} required={true} ref={(element: any) => { c.newCollectionInput = element; }} value={c.newCollectionName} onChange={(event: any) => { c.newCollectionName = event.currentTarget.value; }} className={["min-h-11 w-full rounded-xl border border-input bg-background px-3"].filter(Boolean).join(" ")}/></label><Button type={"submit"} variant={"secondary"} disabled={c.busy} className={["min-h-11"].filter(Boolean).join(" ")}>{"Create"}</Button>
            </form>
            {c.error ? <><p role={"alert"} className={["text-sm text-destructive"].filter(Boolean).join(" ")}>{c.error}</p></> : null}
            <Dialog.Footer><Button variant={"secondary"} onClick={() => (c.dialogOpen = false)}>{"Done"}</Button></Dialog.Footer>
            </> : <>{c.cloudPlan && c.cloudPlanSource ? <>
                <div className={["grid gap-4"].filter(Boolean).join(" ")}>
                <p className={["text-sm"].filter(Boolean).join(" ")}>
                    {c.cloudPlan.status === 'preparing'
                        ? `Checking the selected books in ${c.cloudPlanSource.name}. No files have been changed.`
                        : c.cloudPlan.status === 'prepared'
                            ? `Review this change to ${c.cloudPlanSource.name} before writing to OneDrive.`
                            : 'Confirmed changes continue on the server even when this dialog is closed.'}
                </p>
                <dl className={["grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-xl border border-border p-4 text-sm"].filter(Boolean).join(" ")}>
                <dt className={["text-muted-foreground"].filter(Boolean).join(" ")}>{"Action"}</dt>
                <dd>
                    {c.cloudPlan.operation === 'create_series'
                        ? 'Create series'
                        : c.cloudPlan.operation === 'rename_series'
                            ? 'Rename series'
                            : 'Move books'}
                </dd>
                <dt className={["text-muted-foreground"].filter(Boolean).join(" ")}>{"Series"}</dt>
                <dd>{c.cloudPlan.preview.name || c.cloudPlan.preview.folder_name || 'Existing series'}</dd>
                <dt className={["text-muted-foreground"].filter(Boolean).join(" ")}>{"Books"}</dt>
                <dd>
                    {c.cloudPlan.status === 'preparing' && c.cloudPlan.preparation
                        ? `${c.cloudPlan.preparation.completed_books} of ${c.cloudPlan.preparation.total_books} checked`
                        : c.cloudPlan.preview.book_names.length}
                </dd>
                <dt className={["text-muted-foreground"].filter(Boolean).join(" ")}>{"Steps"}</dt>
                <dd>
                {c.cloudPlan.steps.filter((step) => step.state === 'done').length}{" of "}{c.cloudPlan.steps
                        .length}{" complete "}</dd>
                </dl>
                    {c.cloudPlan.preview.book_names.length ? <><p className={["max-h-32 overflow-y-auto text-sm"].filter(Boolean).join(" ")}>
                    {c.cloudPlan.preview.book_names.join(' · ')}
                    </p></> : null}
                {c.cloudPlan.status === 'paused' ? <><p role={"alert"} className={["text-sm text-destructive"].filter(Boolean).join(" ")}>{" This change is paused ("}{c.cloudPlan.issue}{"). No further files will move. The completed steps remain visible in OneDrive. Abandoning this change does not undo those steps. "}</p></> : null}
                {c.cloudPlan.status === 'reconcile' ? <><p role={"status"} className={["text-sm text-muted-foreground"].filter(Boolean).join(" ")}>{" OneDrive may have completed the last step, but its response was uncertain. The server will reconcile it before moving another book. You can close this dialog safely. "}</p></> : null}
                {c.error ? <><p role={"alert"} className={["text-sm text-destructive"].filter(Boolean).join(" ")}>{c.error}</p></> : null}
                <Dialog.Footer>
                <Button variant={"outline"} disabled={c.busy} onClick={() => (c.dialogOpen = false)}>{"Close"}</Button>
                    {['preparing', 'prepared', 'paused'].includes(c.cloudPlan.status) ? <>
                    <Button variant={"outline"} disabled={c.busy} onClick={c.abandonCloudPlan}>{c.cloudPlan.status === 'paused'
                            ? 'Abandon unfinished change'
                            : 'Cancel change'}</Button>
                    </> : null}
                    {c.cloudPlan.status !== 'paused' && c.cloudPlan.status !== 'cancelled' ? <>
                    <Button disabled={c.busy || c.cloudPlan.status !== 'prepared'} onClick={c.confirmCloudPlan}>{c.cloudPlan.status === 'prepared'
                            ? 'Confirm Change'
                            : c.cloudPlan.status === 'preparing'
                                ? 'Checking books…'
                                : 'Updating…'}</Button>
                    </> : null}
                </Dialog.Footer>
                </div>
                </> : <>
                <form onSubmit={(event: any) => {
                        event.preventDefault();
                        c.submit();
                    }} className={["grid gap-5"].filter(Boolean).join(" ")}>
                    {c.dialog === 'date' ? <><label className={["grid gap-2"].filter(Boolean).join(" ")}>{"Finished on"}<input type={"date"} max={calendarDay()} required={true} value={c.date} onChange={(event: any) => { c.date = event.currentTarget.value; }} className={["min-h-11 rounded-xl border border-input bg-background px-3"].filter(Boolean).join(" ")}/></label>
                    </> : <><label className={["grid gap-2"].filter(Boolean).join(" ")}>{"Name"}<input required={true} maxLength={240} value={c.name} onChange={(event: any) => { c.name = event.currentTarget.value; }} className={["min-h-11 rounded-xl border border-input bg-background px-3"].filter(Boolean).join(" ")}/></label></>}
                    {c.dialog === 'new-series' ? <>
                    <label className={["grid gap-2"].filter(Boolean).join(" ")}>{"Source folder"}<select value={c.groupSource} onChange={(event: any) => { c.groupSource = event.currentTarget.value; c.groupFiles = []; }} className={["min-h-11 rounded-xl border border-input bg-background px-3"].filter(Boolean).join(" ")}>{(c.sources).map((source, __index) => <Fragment key={sourceKey(source)}><option value={c.groupKey(source)} disabled={source.owner !== null && source.provider !== 'onedrive'}>{source.name}{source.owner ? ` · ${source.provider}` : ' · local'}</option></Fragment>)}</select></label>
                    {!c.sources.length ? <><p className={["text-sm text-muted-foreground"].filter(Boolean).join(" ")}>{" Connect a local folder or OneDrive library to arrange original ebook files. "}<a href={resolve('/connections')} className={["underline"].filter(Boolean).join(" ")}>{"Manage connected libraries"}</a>{". "}</p></> : null}
                        {c.groupCloudSource && !c.cloudCapabilities[sourceKey(c.groupCloudSource)]?.can_edit ? <>
                        <p className={["text-sm text-muted-foreground"].filter(Boolean).join(" ")}>{" This OneDrive library needs write access for physical series changes. "}</p>
                            {c.cloudCapabilities[sourceKey(c.groupCloudSource)]?.scope_upgrade ? <>
                            <Button variant={"outline"} type={"button"} onClick={() => {
                                    void requestSeriesWriteAccess(c.groupCloudSource!.id).catch((e) => (c.error =
                                        e instanceof Error ? e.message : 'Could not request OneDrive access.'));
                                }}>{"Allow Series Editing"}</Button>
                            </> : null}
                        </> : null}
                    <div aria-label={"Books to combine"} className={["grid max-h-[30dvh] gap-2 overflow-y-auto rounded-xl border border-border p-3"].filter(Boolean).join(" ")}>
                    {(c.groupCandidates).map((book, __index) => <Fragment key={book.file!.id}><label className={["flex items-center gap-3 py-2"].filter(Boolean).join(" ")}><input type={"checkbox"} checked={c.groupFiles.includes(book.file!.id)} onChange={(event: any) => c.toggleGroup(book.file!.id, event.currentTarget.checked)}/><span className={["min-w-0"].filter(Boolean).join(" ")}><span className={["block"].filter(Boolean).join(" ")}>{book.title}</span><span className={["block break-all text-xs text-muted-foreground"].filter(Boolean).join(" ")}>{book.file!.id}</span></span></label></Fragment>)}
                    </div>
                    <p className={["text-xs text-muted-foreground"].filter(Boolean).join(" ")}>
                    {c.groupFiles.length}{" selected · Select at least two books from the same source. "}</p>
                    </> : null}
                    {c.dialog === 'series-name' && c.targetSeries?.source?.owner && !c.cloudCapabilities[sourceKey(c.targetSeries.source)]?.can_edit ? <>
                    <p className={["text-sm text-muted-foreground"].filter(Boolean).join(" ")}>{" This OneDrive library needs write access to change its series marker. "}</p>
                        {c.cloudCapabilities[sourceKey(c.targetSeries.source)]?.scope_upgrade ? <>
                        <Button variant={"outline"} type={"button"} onClick={() => {
                                void requestSeriesWriteAccess(c.targetSeries!.source!.id).catch((e) => (c.error = e instanceof Error ? e.message : 'Could not request OneDrive access.'));
                            }}>{"Allow Series Editing"}</Button>
                        </> : null}
                    </> : null}
                {c.error ? <><p role={"alert"} className={["text-sm text-destructive"].filter(Boolean).join(" ")}>{c.error}</p></> : null}
                <Dialog.Footer><Button variant={"outline"} disabled={c.busy} onClick={() => (c.dialogOpen = false)}>{"Cancel"}</Button><Button type={"submit"} disabled={c.busy || (c.dialog === 'new-series' && c.groupFiles.length < 2)}>{c.busy ? 'Saving…' : c.dialog === 'new-series' ? 'Move into Series' : 'Save'}</Button></Dialog.Footer>
                </form>
                </>}</>}</>}
    </Dialog.Content>
    </Dialog.Root>
    </>;
}

