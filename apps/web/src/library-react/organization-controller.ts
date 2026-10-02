/** @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors. All rights reserved.
 * React/controller port of lib/library/book-organization-dialog.svelte; transactions retain their original guards.
 */
import type { ShelfBook } from '$lib/library/view-model';
import type { Collection, PresentationChange } from '$lib/library/organization';
import { validBookMetadata, validBookSeries } from '$lib/library/book-presentation';
import { ObservableController, readStore, writeStore, tick } from './observable-controller';
export class OrganizationController extends ObservableController {
    mode: 'metadata' | 'series' | 'collections' = 'metadata';
    targets: ShelfBook[] = [];
    collections: Collection[] = [];
    seriesNames: string[] = [];
    save!: (change: PresentationChange) => Promise<void>;
    membership!: (id: string, included: boolean) => Promise<void>;
    create!: (name: string) => Promise<void>;
    close!: () => void;
    open = true;
    busy = false;
    alive = true;
    error = '';
    get book() { return this.targets[0]; }
    title = this.book?.title ?? '';
    authors = this.book?.creators?.map((creator) => creator.name).join('\n') ?? '';
    authorSort = this.book?.creators?.map((creator) => creator.sortAs ?? '').join('\n') ?? '';
    language = this.book?.metadata?.language ?? '';
    publisher = this.book?.metadata?.publisher ?? '';
    published = this.book?.metadata?.published ?? '';
    description = this.book?.metadata?.description ?? '';
    subjects = this.book?.metadata?.subjects?.join('\n') ?? '';
    seriesName = this.targets.every((target) => target.series?.name === this.book?.series?.name)
        ? (this.book?.series?.name ?? '')
        : '';
    seriesIndex = this.mode === 'metadata' && this.book?.series?.index !== undefined ? String(this.book.series.index) : '';
    collectionName = '';
    coverBlur = this.book?.coverBlur ?? false;
    initialize() {
        this.title = this.book?.title ?? '';
        this.authors = this.book?.creators?.map((creator) => creator.name).join('\n') ?? '';
        this.authorSort = this.book?.creators?.map((creator) => creator.sortAs ?? '').join('\n') ?? '';
        this.language = this.book?.metadata?.language ?? '';
        this.publisher = this.book?.metadata?.publisher ?? '';
        this.published = this.book?.metadata?.published ?? '';
        this.description = this.book?.metadata?.description ?? '';
        this.subjects = this.book?.metadata?.subjects?.join('\n') ?? '';
        this.seriesName = this.targets.every((target) => target.series?.name === this.book?.series?.name)
            ? (this.book?.series?.name ?? '')
            : '';
        this.seriesIndex = this.mode === 'metadata' && this.book?.series?.index !== undefined ? String(this.book.series.index) : '';
        this.collectionName = '';
        this.coverBlur = this.book?.coverBlur ?? false;
    }
    async run(work: () => Promise<void>, finish = false) {
        if (this.busy)
            return;
        this.busy = true;
        this.error = '';
        try {
            await work();
            if (this.alive && finish)
                this.open = false;
        }
        catch (cause) {
            if (this.alive)
                this.error = cause instanceof Error ? cause.message : 'The change could not be saved.';
        }
        finally {
            if (this.alive)
                this.busy = false;
        }
    }
    seriesValue() {
        return this.seriesName.trim()
            ? {
                name: this.seriesName.replace(/\s+/gu, ' ').trim().normalize('NFC'),
                ...(this.seriesIndex.trim() ? { index: Number(this.seriesIndex) } : {})
            }
            : null;
    }
    submit() {
        void this.run(async () => {
            const series = this.seriesValue();
            if (!validBookSeries(series))
                throw new Error('Use a series name up to 240 characters and a nonnegative number.');
            if (this.mode === 'series') {
                await this.save({ series });
                return;
            }
            const sorts = this.authorSort.split(/\r?\n/);
            const metadata = {
                creators: this.authors.split(/\r?\n/)
                    .flatMap((rawName, index) => {
                    const name = rawName.replace(/\s+/gu, ' ').trim();
                    if (!name)
                        return [];
                    return [
                        {
                            name,
                            ...(sorts[index]?.trim()
                                ? { sortAs: sorts[index].replace(/\s+/gu, ' ').trim() }
                                : {})
                        }
                    ];
                }),
                language: this.language.trim(),
                publisher: this.publisher.trim(),
                published: this.published.trim(),
                description: this.description,
                subjects: this.subjects.split(/\r?\n/)
                    .map((subject) => subject.trim())
                    .filter(Boolean)
            };
            if (!validBookMetadata(metadata))
                throw new Error('Check the metadata: use at most 32 authors and 64 tags within the field limits.');
            await this.save({
                ...(this.title === this.book.title ? {} : { title: this.title }),
                metadata,
                series,
                coverBlur: this.coverBlur
            });
        }, true);
    }
    members(collection: Collection) {
        return this.targets.filter((target) => target.organizationAliases.some((alias) => collection.members.includes(alias))).length;
    }
    mixed(input: HTMLInputElement, value: boolean) {
        input.indeterminate = value;
        return {
            update(next: boolean) {
                input.indeterminate = next;
            }
        };
    }
    reconcile() {
        if (!this.open)
            this.close();
    }
    start() {
        this.alive = true;
        this.retain(() => {
            this.alive = false;
        });
        this.watch();
    }
}

