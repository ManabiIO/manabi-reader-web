/** @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors. All rights reserved.
 * React/controller port of lib/search/unified-search.svelte; transactions retain their original guards.
 */
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { localUser, localProfileUser } from '$lib/manabi/client';
import { videoLearningEnabled } from '$lib/media/feature';
import { snippetItems, scope } from '$lib/snippets/service';
import { snippetKey, type SnippetHit } from '$lib/snippets/document';
import { searchBodies } from '$lib/snippets/search';
import type { ShelfBook } from '$lib/library/view-model';
import type { ReaderLocator } from '$lib/reader-location';
import type { SnippetSummary } from '$lib/snippets/summary';
import { searchBookContents } from '$lib/search/book-content-source';
import type { BookTitleMatchContext } from '$lib/search/book-title-match-text';
import { bookTitleRows, scopedSnippetTitleRows, videoTitleRows, sortTitleRows, bookContentRows, snippetContentRows, videoContentRows, type SearchRow } from '$lib/search/result-rows';
import { startSearchSources, type SearchSource, type SearchResults } from '$lib/search/source-session';
import { queryTask, type SearchState } from '$lib/search/query-task.mjs';
import { advanceMediaSearchRevisions, searchResultPlan, type SearchResultFilter } from '$lib/search/invalidation';
import { librarySearchScopePlan, librarySearchScopes, type LibrarySearchScope } from '$lib/search/library-search-scope';
type Results = SearchResults<SearchRow>;
type LazyMediaRuntime = {
    store: import('$lib/media/store').MediaStore;
    search: typeof import('$lib/media/video-search');
};
import { ObservableController, readStore, writeStore, tick } from './observable-controller';
export class SearchController extends ObservableController {
    query = '';
    searchScope: LibrarySearchScope = 'everything';
    books: ShelfBook[] = [];
    matches: ShelfBook[] = [];
    bookMatchText: Record<string, readonly BookTitleMatchContext[]> = {};
    snippetMembers: string[] | undefined = undefined;
    returnTo = '/manage';
    openBook!: (book: ShelfBook, locator?: ReaderLocator) => void;
    onquery: (query: string) => void = () => { };
    onscope!: (scope: LibrarySearchScope) => void;
    filters: {
        id: SearchResultFilter;
        label: string;
    }[] = [
        { id: 'all', label: 'All' },
        { id: 'dictionary', label: 'Dictionary' },
        { id: 'titles', label: 'Titles' },
        { id: 'content', label: 'Content' }
    ];
    filter: SearchResultFilter = 'all';
    mounted = false;
    titleSignature = '';
    contentSignature = '';
    titleLimit = 30;
    contentLimit = 30;
    titles: SearchState<Results> = { state: 'idle' };
    content: SearchState<Results> = { state: 'idle' };
    results!: HTMLElement;
    titleFocusGeneration = 0;
    contentFocusGeneration = 0;
    titleTask = queryTask<Results>((value) => {
        this.titles = value;
    });
    mediaRuntimePromise!: Promise<LazyMediaRuntime> | undefined;
    mediaSubscribed = false;
    mediaDisposed = false;
    mediaEpoch = 0;
    stopMedia: () => void = () => { };
    mediaTitleRevision = 0;
    mediaContentRevision = 0;
    contentTask = queryTask<Results>((value) => {
        this.content = value;
    });
    async mediaRuntime(): Promise<LazyMediaRuntime> {
        const epoch = this.mediaEpoch;
        if (!videoLearningEnabled)
            throw new Error('Video learning is disabled.');
        if (!this.mediaRuntimePromise) {
            const pending = Promise.all([import('$lib/media/store'), import('$lib/media/video-search')]).then(([store, search]) => ({ store: new store.MediaStore(), search }));
            this.mediaRuntimePromise = pending;
            void pending.catch(() => {
                if (this.mediaRuntimePromise === pending)
                    this.mediaRuntimePromise = undefined;
            });
        }
        const runtime = await this.mediaRuntimePromise;
        if (this.mediaDisposed || epoch !== this.mediaEpoch) {
            await runtime.store.close();
            throw new DOMException('Search was closed', 'AbortError');
        }
        if (!this.mediaSubscribed) {
            this.mediaSubscribed = true;
            this.stopMedia = runtime.store.subscribe((captionsChanged, metadataChanged) => {
                if (!this.mounted || (!captionsChanged && !metadataChanged))
                    return;
                const next = advanceMediaSearchRevisions({ titles: this.mediaTitleRevision, content: this.mediaContentRevision }, captionsChanged, metadataChanged);
                this.mediaTitleRevision = next.titles;
                this.mediaContentRevision = next.content;
            });
        }
        return runtime;
    }
    get owner() { return readStore(localUser)?.id ?? null; }
    get eligible() { return readStore(snippetItems).filter((item) => !item.trashedAt && (!this.snippetMembers || this.snippetMembers.includes(snippetKey(item.id)))); }
    get scopePlan() { return librarySearchScopePlan(this.searchScope); }
    get resultPlan() { return searchResultPlan(this.filter); }
    get availableFilters() {
        return this.scopePlan.dictionary
            ? this.filters : this.filters.filter((item) => item.id !== 'dictionary');
    }
    get nextTitleSignature() {
        return this.resultPlan.titles
            ? JSON.stringify([
                this.query,
                this.owner,
                this.searchScope,
                this.scopePlan.books
                    ? this.matches.map((book) => [
                        book.key,
                        book.title,
                        book.canonicalTitle,
                        (book.creators ?? []).map((creator) => creator.name),
                        book.series?.name ?? null,
                        this.bookMatchText[book.key] ?? []
                    ])
                    : [],
                this.scopePlan.snippets ? this.eligible.map((item) => [item.key, item.title]) : [],
                videoLearningEnabled && this.searchScope === 'everything' ? this.mediaTitleRevision : 0
            ])
            : 'inactive';
    }
    get nextContentSignature() {
        return this.resultPlan.content
            ? JSON.stringify([
                this.query,
                this.owner,
                this.searchScope,
                this.scopePlan.books
                    ? this.books.map((book) => [
                        book.key,
                        book.bookId,
                        book.title,
                        book.contentHash,
                        book.lastBookModified
                    ])
                    : [],
                this.scopePlan.snippets
                    ? this.eligible.map((item) => [item.key, item.title, item.revision])
                    : [],
                videoLearningEnabled && this.searchScope === 'everything' ? this.mediaContentRevision : 0
            ])
            : 'inactive';
    }
    get visibleTitles() { return (this.titles.value?.rows ?? []).slice(0, this.filter === 'all' ? 2 : this.titleLimit); }
    get visibleContent() { return (this.content.value?.rows ?? []).slice(0, this.filter === 'all' ? 2 : this.contentLimit); }
    openSnippet(item: SnippetSummary, hit?: SnippetHit) {
        const params = new URLSearchParams({ id: item.id, returnTo: this.returnTo });
        if (hit)
            params.set('locator', JSON.stringify(hit.locator));
        void goto(resolve(`/snippets?${params}`));
    }
    openRow(row: SearchRow) {
        const target = row.target;
        if (target.kind === 'book')
            this.openBook(target.book, target.locator);
        else if (target.kind === 'snippet')
            this.openSnippet(target.snippet, target.hit);
        else
            this.openVideo(target.key, target.time, target.track);
    }
    openVideo(key: string, time?: number, track?: string) {
        const params = new URLSearchParams({ media: key });
        if (time !== undefined)
            params.set('time', String(time));
        if (track)
            params.set('track', track);
        void goto(resolve(`/videos?${params}`));
    }
    startTitles() {
        const plan = librarySearchScopePlan(this.searchScope);
        const selectedBooks = plan.books ? [...this.matches] : [], selectedSnippets = plan.snippets ? [...this.eligible] : [], selectedOwner = this.owner, selectedQuery = this.query, runVideos = videoLearningEnabled && this.searchScope === 'everything', selectedBookMatchText = this.bookMatchText;
        this.titleTask.start(async (signal, publish) => {
            const guard = () => {
                signal.throwIfAborted();
                if (selectedOwner !== (localProfileUser()?.id ?? null))
                    throw new DOMException('Account changed', 'AbortError');
            };
            let snippetScope: ReturnType<typeof scope> | undefined, snippetRows: SearchRow[] = [], snippetFailed = 0;
            if (plan.snippets && selectedSnippets.length) {
                try {
                    snippetScope = scope();
                }
                catch {
                    snippetFailed = 1;
                }
            }
            const refreshSnippetRows = () => {
                if (!snippetScope)
                    return;
                const admitted = scopedSnippetTitleRows(selectedSnippets, selectedQuery, snippetScope.guard);
                snippetRows = admitted.rows;
                if (admitted.failed) {
                    snippetFailed = 1;
                    snippetScope = undefined;
                }
            };
            // Metadata stays local and independent of dictionary initialization and
            // expensive body projection. Do not normalize the editable query to kana.
            const bookRows = bookTitleRows(selectedBooks, selectedBookMatchText, selectedQuery);
            refreshSnippetRows();
            guard();
            publish({
                state: 'loading',
                value: {
                    rows: sortTitleRows([...bookRows, ...snippetRows], selectedQuery),
                    failed: snippetFailed,
                    truncated: false
                }
            });
            let videoRows: SearchRow[] = [], videoFailed = 0, videoTruncated = false;
            if (runVideos) {
                try {
                    const media = await this.mediaRuntime();
                    signal.throwIfAborted();
                    const result = await media.search.searchVideoTitles(media.store, media.search.mediaScope(selectedOwner), selectedQuery, signal);
                    guard();
                    videoTruncated = result.truncated;
                    videoRows = videoTitleRows(result.hits, selectedQuery);
                }
                catch (error) {
                    if (signal.aborted)
                        throw error;
                    guard();
                    videoFailed = 1;
                }
            }
            guard();
            refreshSnippetRows();
            publish({
                state: 'ready',
                value: {
                    rows: sortTitleRows([...bookRows, ...videoRows, ...snippetRows], selectedQuery),
                    failed: snippetFailed + videoFailed,
                    truncated: videoTruncated
                }
            });
        }, 0);
    }
    startContent() {
        const plan = librarySearchScopePlan(this.searchScope);
        const selectedBooks = plan.books ? [...this.books] : [], selectedSnippets = plan.snippets ? [...this.eligible] : [], needle = this.query, selectedOwner = this.owner, runVideos = videoLearningEnabled && this.searchScope === 'everything', selectedBooksById = new Map(selectedBooks.flatMap((book) => (book.bookId ? [[book.bookId, book] as const] : [])));
        this.contentTask.start((signal, publish) => {
            const guard = () => {
                signal.throwIfAborted();
                if (selectedOwner !== (localProfileUser()?.id ?? null))
                    throw new DOMException('Account changed', 'AbortError');
            };
            // Display order is Books, Videos, Snippets. Admission is independent;
            // no source waits for a sibling's imports, descriptors or database reads.
            const sources: SearchSource<SearchRow>[] = [];
            if (plan.books && selectedBooks.length)
                sources.push({
                    start: (signal, receive) => searchBookContents(needle, selectedBooks, selectedOwner, signal, (batch) => receive({ ...batch, rows: bookContentRows(batch.hits, selectedBooksById) }), { progress: false })
                });
            if (runVideos)
                sources.push({
                    start: async (signal, receive) => {
                        const media = await this.mediaRuntime();
                        signal.throwIfAborted();
                        const result = await media.search.searchVideoTranscripts(media.store, media.search.mediaScope(selectedOwner), needle, signal, (batch) => receive({
                            rows: videoContentRows(batch.hits),
                            busy: batch.scanned < batch.total,
                            failed: batch.failed,
                            truncated: batch.truncated
                        }), { progress: false });
                        receive({
                            rows: videoContentRows(result.hits),
                            busy: false,
                            failed: result.failed,
                            truncated: result.truncated
                        });
                    }
                });
            if (plan.snippets && selectedSnippets.length)
                sources.push({
                    start: (_signal, receive) => {
                        let latest = { rows: [] as SearchRow[], failed: 0, truncated: false };
                        return searchBodies(needle, selectedSnippets.map((item) => item.id), scope(), (batch) => {
                            latest = {
                                rows: snippetContentRows(batch.hits, selectedSnippets),
                                failed: batch.failed,
                                truncated: batch.truncated
                            };
                            receive({ ...batch, rows: latest.rows });
                        }, {
                            progress: false,
                            invalidated: () => receive({
                                ...latest,
                                busy: false,
                                failed: Math.max(1, latest.failed)
                            })
                        });
                    }
                });
            return startSearchSources(sources, signal, publish, guard);
        });
    }
    refreshTitles() {
        this.titleFocusGeneration++;
        this.titleTask.stop();
        this.titles = { state: 'idle' };
        this.titleLimit = 30;
        if (!this.resultPlan.titles || !this.query.trim() || [...this.query].length > 512)
            return;
        this.startTitles();
    }
    refreshContent() {
        this.contentFocusGeneration++;
        this.contentTask.stop();
        this.content = { state: 'idle' };
        this.contentLimit = 30;
        if (!this.resultPlan.content || !this.query.trim() || [...this.query].length > 512)
            return;
        this.startContent();
    }
    async choose(value: SearchResultFilter) {
        this.filter = value;
        await tick();
        // Keep the selected chip, rather than a now-removed See all button, as the
        // keyboard anchor. Ordinary pressed buttons avoid async automatic tabs.
        this.results.querySelector<HTMLButtonElement>(`[data-search-filter="${value}"]`)
            ?.focus({ preventScroll: true });
    }
    async chooseScope(value: LibrarySearchScope) {
        this.searchScope = value;
        this.onscope(value);
        if (!librarySearchScopePlan(value).dictionary && this.filter === 'dictionary')
            this.filter = 'all';
        await tick();
        this.results.querySelector<HTMLButtonElement>(`[data-search-scope="${value}"]`)
            ?.focus({ preventScroll: true });
    }
    async more(kind: 'titles' | 'content') {
        const admitted = kind === 'titles' ? this.titleFocusGeneration : this.contentFocusGeneration;
        const before = kind === 'titles' ? this.titleLimit : this.contentLimit;
        if (kind === 'titles')
            this.titleLimit += 30;
        else
            this.contentLimit += 30;
        await tick();
        const current = kind === 'titles' ? this.titleFocusGeneration : this.contentFocusGeneration;
        if (admitted !== current || !this.mounted)
            return;
        const target = this.results.querySelectorAll<HTMLButtonElement>(`[data-search-row="${kind}"]`)[before];
        target?.focus({ preventScroll: true });
        target?.scrollIntoView({ block: 'nearest' });
    }
    reconcile() {
        if (!this.scopePlan.dictionary && this.filter === 'dictionary')
            this.filter = 'all';
        if (this.mounted && this.nextTitleSignature !== this.titleSignature) {
            this.titleSignature = this.nextTitleSignature;
            this.refreshTitles();
        }
        if (this.mounted && this.nextContentSignature !== this.contentSignature) {
            this.contentSignature = this.nextContentSignature;
            this.refreshContent();
        }
    }
    start() {
        this.watch(localUser, snippetItems);
        return (() => {
            this.mediaDisposed = false;
            this.titleSignature = '';
            this.contentSignature = '';
            this.mounted = true;
            return () => {
                this.mounted = false;
                this.mediaDisposed = true;
                this.mediaEpoch++;
                this.mediaSubscribed = false;
                this.titleTask.stop();
                this.contentTask.stop();
                this.stopMedia();
                const previous = this.mediaRuntimePromise;
                this.mediaRuntimePromise = undefined;
                if (previous)
                    void previous.then(({ store }) => store.close()).catch(() => undefined);
            };
        })();
    }
}

