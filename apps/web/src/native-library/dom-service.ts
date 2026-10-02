/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Import only inside the single DOM reader runtime. Native UI imports contract.ts instead.
 */

import { database } from '$lib/data/store';
import { get } from '$lib/state/store';
import { integrationDB, metadata } from '$lib/manabi/persistence';
import { davSources } from '$lib/webdav/source';
import { captureLibraryOperation } from '$lib/manabi/operation-scope';
import {
  organization,
  reloadOrganization,
  presentBooks,
  setMembershipMany,
  createCollection,
  updateOrganization
} from '$lib/library/organization';
import { cachedCatalog, type Catalog, type SourceDescriptor } from '$lib/library/catalog';
import { buildShelf } from '$lib/library/view-model';
import { previews } from '$lib/library/previews';
import { sourceKey } from '$lib/library/organization-keys';
import { nativeOwnedCards } from './view-model';
import { NativeLibraryService, type LibraryRepository } from './service';
import { readNativeLibrarySummaries } from './cover-records';
import { renderNativeLibraryCover } from './cover-dom';
import { commitNativeCompletion } from './completion';
import { readAdmittedBook } from '$lib/data/database/books-db/admitted-book-read';
import type { LibraryAuthority } from './contract';

async function owned<T>(
  authority: LibraryAuthority,
  work: (profile: string | null, combined: LibraryAuthority) => Promise<T>
) {
  const scope = captureLibraryOperation();
  const controller = new AbortController();
  const abort = () => controller.abort();
  authority.signal.addEventListener('abort', abort, { once: true });
  scope.signal.addEventListener('abort', abort, { once: true });
  const combined: LibraryAuthority = {
    key: authority.key,
    signal: controller.signal,
    assertCurrent() {
      authority.signal.throwIfAborted();
      scope.assertCurrent();
      authority.assertCurrent();
    }
  };
  try {
    combined.assertCurrent();
    return await work(scope.profileId, combined);
  } finally {
    authority.signal.removeEventListener('abort', abort);
    scope.signal.removeEventListener('abort', abort);
    scope.stop();
  }
}
export function createNativeLibraryService() {
  const repository: LibraryRepository = {
    cover: (target, authority) =>
      owned(authority, async (profile, guard) => {
        const db = await database.db;
        guard.assertCurrent();
        return renderNativeLibraryCover(db, target, profile, guard, async () => {
          await reloadOrganization();
          guard.assertCurrent();
          return get(organization);
        });
      }),
    load: (authority) =>
      owned(authority, async (profile, guard) => {
        await reloadOrganization();
        guard.assertCurrent();
        const db = await database.db;
        guard.assertCurrent();
        const { summaries, coverIdentities } = await readNativeLibrarySummaries(db, guard);
        guard.assertCurrent();
        const integration = await integrationDB();
        guard.assertCurrent();
        const [links, bookmarks, scopes, locals, dav, cloud] = await Promise.all([
          integration.getAll('books'),
          db.getAll('bookmark'),
          db.getAll('readerBookScope'),
          integration.getAll('localLibraries'),
          davSources(),
          profile ? metadata<SourceDescriptor[]>(`library-sources:${profile}`) : Promise.resolve([])
        ]);
        guard.assertCurrent();
        const visible = nativeOwnedCards(summaries, links, bookmarks, scopes, profile);
        // Native Library browsing reads only cached provider metadata. It never refreshes auth or requests file access.
        const descriptors: SourceDescriptor[] = [
          ...locals.map((source) => ({
            id: source.id,
            name: source.name,
            root: '',
            owner: null,
            provider: 'local'
          })),
          ...dav.map((source) => ({
            id: source.id,
            name: source.name,
            root: source.url,
            owner: null,
            provider: 'webdav'
          })),
          ...(cloud ?? [])
        ];
        const sources = descriptors.filter(
          (source) => source.owner === null || source.owner === profile
        );
        const cached = await Promise.all(sources.map((source) => cachedCatalog(source)));
        guard.assertCurrent();
        const catalogs = cached.filter(
          (catalog, index): catalog is Catalog =>
            !!catalog && sourceKey(catalog.source) === sourceKey(sources[index])
        );
        const value = structuredClone(get(organization));
        return {
          tree: buildShelf(visible.cards, visible.links, catalogs, sources, value, get(previews)),
          organization: value,
          coverIdentities,
          sources
        };
      }),
    write: (action, targets, expected, authority) =>
      owned(authority, async (profile, guard) => {
        const current = () => {
          guard.assertCurrent();
          return true;
        };
        if (action.type === 'presentation') {
          if (action.change.cover !== undefined) {
            // Check the real reader record/profile in its final readonly transaction.
            // The separate organization commit writes only its immutable content key.
            const db = await database.db;
            current();
            for (const book of targets) {
              if (
                !book.bookId ||
                !book.contentHash ||
                book.organizationKey !== `content:${book.contentHash}`
              )
                throw new Error(
                  'The selected cover destination is not an immutable imported book.'
                );
              await readAdmittedBook(
                db,
                {
                  bookId: book.bookId,
                  contentHash: book.contentHash,
                  readerBookKey: book.organizationKey,
                  title: book.canonicalTitle,
                  lastBookModified: book.lastBookModified
                },
                { ...guard, profileId: profile }
              );
              current();
            }
          }
          // The canonical key and every legacy alias were shown in the same edit snapshot.
          const editingCurrent = () => {
            current();
            const live = get(organization).books;
            for (const target of targets)
              for (const alias of target.organizationAliases)
                if (JSON.stringify(live[alias]) !== JSON.stringify(expected[alias]))
                  throw new Error('This book was edited elsewhere. Reopen its metadata.');
            return true;
          };
          await presentBooks(
            targets.map((book) => book.organizationKey),
            action.change,
            editingCurrent,
            expected,
            !!action.preserveSeriesIndex,
            guard.signal
          );
        } else if (action.type === 'membership') {
          await setMembershipMany(
            action.collection,
            targets,
            action.included,
            current,
            guard.signal
          );
        } else if (action.type === 'collection.create') {
          await createCollection(
            action.name,
            targets.map((book) => book.organizationKey),
            current,
            guard.signal
          );
        } else if (action.type === 'collection.rename' || action.type === 'collection.remove') {
          const name =
            action.type === 'collection.rename'
              ? action.name.replace(/\s+/gu, ' ').trim().normalize('NFC')
              : undefined;
          const baseline = get(organization).collections.find(
            (collection) => collection.id === action.collection
          );
          if (!baseline) throw new Error('This collection no longer exists.');
          await updateOrganization(
            (value) => {
              const collection = value.collections.find((item) => item.id === action.collection);
              if (!collection || collection.name !== baseline.name)
                throw new Error('This collection changed. Refresh before saving.');
              if (action.type === 'collection.rename') collection.name = name!;
              else
                value.collections = value.collections.filter(
                  (item) => item.id !== action.collection
                );
            },
            undefined,
            () => {
              current();
            },
            guard.signal
          );
        } else if (action.type === 'completion') {
          const db = await database.db;
          current();
          await commitNativeCompletion(db, targets, action.state, action.day, profile, guard);
          database.bookmarksChanged$.next();
        }
      })
  };
  return new NativeLibraryService(repository);
}
