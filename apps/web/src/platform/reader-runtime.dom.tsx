/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

'use dom';
import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { useDOMImperativeHandle, type DOMImperativeFactory, type DOMProps } from 'expo/dom';
import {
  BridgeAuthority,
  ImportTransfer,
  type BridgeRequest,
  type BridgeReply,
  BRIDGE_VERSION
} from './bridge-contract';
import type { RuntimeSnapshot, SettingField } from './runtime-contract';
import { settingDefinitions, validateSetting } from './settings-fields';
import * as reader from '$lib/data/store';
import { appearance$ } from '$lib/appearance/state';
import {
  account,
  accountGeneration,
  localProfileUser,
  localUser,
  refreshAccount,
  signOut
} from '$lib/manabi/client';
import { get } from '$lib/state/store';
import { readBookSummaries } from '$lib/data/database/books-db/book-records';
import { allLinkedBooks } from '$lib/manabi/books';
import { visibleLibraryEntries } from '$lib/library/account-visibility';
import { captureLibraryOperation } from '$lib/manabi/operation-scope';
import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
import { StorageKey } from '$lib/data/storage/storage-types';
import { importData } from '$lib/functions/replication/replicator';
import { BrowserRuntime } from '../runtime/BrowserRuntime';
import { ReaderScreen, type ReaderScreenHandle } from '../reader-react';
import { nativeNavigationPath } from './native-navigation';
import { base } from '../runtime/paths';
import { page } from '../runtime/stores';
import { installRouter } from '../runtime/navigation';
import {
  readStatisticsSnapshot,
  dispatchStatisticsAction
} from '../statistics-react/native-service';
import { NativeSnippetsService } from '../native-snippets/service';
import { createNativeSnippetsRepository } from '../native-snippets/dom-repository';
import { EmbeddedSnippetReader } from './snippet-reader';
import { isUUID } from '$lib/snippets/document';
import { getRecord as getSnippet, type SnippetRecord } from '$lib/snippets/database';
import { scope as captureSnippetScope, type SnippetScope } from '$lib/snippets/scope';
import { createNativeLibraryService } from '../native-library/dom-service';
import { createNativeLibraryContentSearchService } from '../native-library/content-search-dom';
import { clearLibraryLocation, queueLibraryLocation } from '$lib/library/search-navigation';
import type { BookAccessIdentity } from '$lib/data/database/books-db/book-identity';
import { readNativeSettingsState, dispatchNativeSettingsAction } from '../native-settings/service';
import type { NativeStatisticsAction } from '../statistics-react/native-contract';
import '../app.css';
import '../app.generated.css';

export interface ReaderRuntimeRef extends DOMImperativeFactory {
  execute(request: unknown): void;
}
type Subject = { getValue(): unknown; next(value: any): void };
function settingSubject(key: string): Subject {
  return key === 'appearance'
    ? appearance$
    : (reader as unknown as Record<string, Subject>)[`${key}$`];
}
export default function ReaderRuntime({
  ref,
  onSnapshot,
  onNavigate,
  onReply
}: {
  ref?: Ref<ReaderRuntimeRef>;
  dom?: DOMProps;
  onSnapshot(snapshot: RuntimeSnapshot): Promise<void>;
  onNavigate(path: string): Promise<void>;
  onReply(reply: BridgeReply): Promise<void>;
}) {
  const [snippet, setSnippet] = useState<{ record: SnippetRecord; scope: SnippetScope }>();
  const snippets = useMemo(() => new NativeSnippetsService(createNativeSnippetsRepository()), []);
  const [bookId, setBookId] = useState<number>();
  const [libraryLocationToken, setLibraryLocationToken] = useState<string>();
  const [expectedBook, setExpectedBook] = useState<BookAccessIdentity>();
  const [bookAuthority, setBookAuthority] = useState<{
    signal: AbortSignal;
    assertCurrent(): void;
  }>();
  const opened = useRef<
    { stop(): void; controller: AbortController; locationToken?: string } | undefined
  >(undefined);
  const retireBook = () => {
    setSnippet(undefined);
    if (opened.current?.locationToken) clearLibraryLocation(opened.current.locationToken);
    setLibraryLocationToken(undefined);
    opened.current?.controller.abort();
    opened.current?.stop();
    opened.current = undefined;
    setBookAuthority(undefined);
    setExpectedBook(undefined);
    setBookId(undefined);
  };
  const library = useMemo(() => createNativeLibraryService(), []);
  const contentSearch = useMemo(() => createNativeLibraryContentSearchService(library), [library]);
  const readingKind = useRef<'book' | 'snippet'>('book');
  const screen = useRef<ReaderScreenHandle | undefined>(undefined);
  const registerScreen = useCallback((handle: ReaderScreenHandle | undefined) => {
    screen.current = handle;
  }, []);
  const state = useMemo(
    () => ({
      session: crypto.randomUUID(),
      epoch: 0,
      revision: 0,
      openSequence: 0,
      libraryQuery: { query: '', offset: 0, limit: 100 },
      mounted: false,
      accountLifetime: new AbortController(),
      lifetime: new AbortController(),
      transfer: new ImportTransfer()
    }),
    []
  );
  const scope = () => ({ session: state.session, epoch: state.epoch });
  async function snapshot(): Promise<RuntimeSnapshot> {
    state.lifetime.signal.throwIfAborted();
    const epoch = state.epoch;
    const revision = ++state.revision;
    const profile = localProfileUser()?.id ?? null;
    const db = await reader.database.db;
    const summaries = await readBookSummaries(db);
    if (epoch !== state.epoch) throw new Error('Account changed while loading the Library.');
    const cards = visibleLibraryEntries(summaries, get(allLinkedBooks), profile).cards;
    const query = state.libraryQuery;
    const needle = query.query.normalize('NFKC').toLowerCase();
    const filtered = cards.filter(
      (card) =>
        !needle ||
        `${card.title} ${(card.creators ?? []).map((creator) => (typeof creator === 'string' ? creator : creator.name)).join(' ')}`
          .normalize('NFKC')
          .toLowerCase()
          .includes(needle)
    );
    const books = await Promise.all(
      filtered.slice(query.offset, query.offset + query.limit).map(async (card) => {
        const bookmark = await reader.database.getBookmark(card.id);
        return {
          id: card.id,
          title: card.title,
          creators: (card.creators ?? [])
            .map((creator) => (typeof creator === 'string' ? creator : creator.name))
            .join(', '),
          characters: card.characters ?? 0,
          progress: bookmark?.exploredCharCount ?? 0,
          lastRead: card.lastBookOpen ?? 0
        };
      })
    );
    if (epoch !== state.epoch) throw new Error('Account changed while loading reading progress.');
    const last = await reader.database.getAccessibleLastItem();
    if (epoch !== state.epoch) throw new Error('Account changed while loading resume position.');
    state.lifetime.signal.throwIfAborted();
    const current = get(account);
    return {
      ...scope(),
      revision,
      loading: current.status === 'loading',
      books,
      lastBookId: last?.dataId,
      totalBooks: filtered.length,
      libraryPage: { ...query },
      settings: settingDefinitions.map((field) => ({
        ...field,
        value: settingSubject(field.key).getValue()
      })) as SettingField[],
      account: { status: current.status, username: localProfileUser()?.username }
    };
  }
  const authority = useMemo(
    () =>
      new BridgeAuthority(
        scope,
        async (request) => {
          const operation = captureLibraryOperation();
          const admittedGeneration = accountGeneration();
          let retained = false;
          try {
            operation.assertCurrent();
            const payload = request.payload;
            const libraryAuthority = {
              key: `${request.session}:${request.epoch}`,
              signal: AbortSignal.any([
                operation.signal,
                state.lifetime.signal,
                state.accountLifetime.signal
              ]),
              assertCurrent() {
                operation.assertCurrent();
                if (
                  admittedGeneration !== accountGeneration() ||
                  request.session !== state.session ||
                  request.epoch !== state.epoch
                )
                  throw new Error('Reader ownership changed.');
              }
            };
            switch (request.method) {
              case 'snapshot':
                return snapshot();
              case 'route': {
                if (typeof payload.path !== 'string') throw new Error('Invalid native route.');
                const route = nativeNavigationPath(payload.path, base);
                if (!route) throw new Error('Invalid native route.');
                if (route !== '/b') {
                  const url = new URL(`${base}${route}`, location.href);
                  page.set({ url, params: {}, state: {}, data: {} });
                }
                return null;
              }
              case 'library.query': {
                const { query = '', offset = 0, limit = 100 } = payload;
                if (
                  typeof query !== 'string' ||
                  query.length > 500 ||
                  !Number.isSafeInteger(offset) ||
                  (offset as number) < 0 ||
                  !Number.isSafeInteger(limit) ||
                  (limit as number) < 1 ||
                  (limit as number) > 200
                )
                  throw new Error('Invalid Library query.');
                state.libraryQuery = { query, offset: offset as number, limit: limit as number };
                return snapshot();
              }
              case 'library.state':
                return library.state(payload, libraryAuthority);
              case 'library.action':
                return library.action(payload, libraryAuthority);
              case 'library.cover.read':
                return library.readCover(payload, libraryAuthority);
              case 'library.cover.cancel':
                return library.cancelCover(payload, libraryAuthority);
              case 'library.content.start':
                return contentSearch.start(payload, libraryAuthority);
              case 'library.content.read':
                return contentSearch.read(payload, libraryAuthority);
              case 'library.content.cancel':
                return contentSearch.cancel(payload, libraryAuthority);
              case 'settings.state':
                return readNativeSettingsState(payload);
              case 'settings.action':
                return dispatchNativeSettingsAction(payload);
              case 'snippets.state':
                return snippets.state(payload, libraryAuthority);
              case 'snippets.action': {
                const admission = payload.type === 'read' ? ++state.openSequence : undefined;
                const result = await snippets.action(payload, libraryAuthority);
                if (result.readerId) {
                  const controller = new AbortController();
                  const selected = captureSnippetScope();
                  const readScope = {
                    owner: selected.owner,
                    guard() {
                      controller.signal.throwIfAborted();
                      libraryAuthority.signal.throwIfAborted();
                      libraryAuthority.assertCurrent();
                      selected.guard();
                    }
                  };
                  const record = await getSnippet(selected.owner, result.readerId);
                  readScope.guard();
                  if (
                    !record ||
                    record.document.trashedAt ||
                    record.document.revision !== result.readerRevision
                  )
                    throw new Error('This snippet changed. Refresh before reading.');
                  if (admission !== state.openSequence)
                    throw new Error('A newer reader navigation replaced this snippet.');
                  retireBook();
                  opened.current = { stop: operation.stop, controller };
                  retained = true;
                  readingKind.current = 'snippet';
                  setSnippet({ record, scope: readScope });
                }
                return result;
              }
              case 'statistics.read':
                return readStatisticsSnapshot(payload, libraryAuthority);
              case 'statistics.action':
                return dispatchStatisticsAction(
                  payload as unknown as NativeStatisticsAction,
                  libraryAuthority
                );
              case 'open': {
                const admission = ++state.openSequence;
                if (payload.snippetId !== undefined) {
                  if (
                    !isUUID(payload.snippetId) ||
                    Object.keys(payload).some((key) => key !== 'snippetId')
                  )
                    throw new Error('Invalid snippet reading identity.');
                  const controller = new AbortController();
                  const selected = captureSnippetScope();
                  const readScope = {
                    owner: selected.owner,
                    guard() {
                      controller.signal.throwIfAborted();
                      libraryAuthority.signal.throwIfAborted();
                      libraryAuthority.assertCurrent();
                      selected.guard();
                    }
                  };
                  const record = await getSnippet(selected.owner, payload.snippetId);
                  readScope.guard();
                  if (!record || record.document.trashedAt)
                    throw new Error('This snippet is unavailable to the current profile.');
                  if (admission !== state.openSequence)
                    throw new Error('A newer reader navigation replaced this snippet.');
                  retireBook();
                  opened.current = { stop: operation.stop, controller };
                  retained = true;
                  readingKind.current = 'snippet';
                  setSnippet({ record, scope: readScope });
                  return { readerId: record.document.id, readerRevision: record.document.revision };
                }
                if (
                  Object.keys(payload).some(
                    (key) =>
                      ![
                        'bookId',
                        'libraryToken',
                        'libraryKeys',
                        'librarySearchToken',
                        'librarySearchHit'
                      ].includes(key)
                  )
                )
                  throw new Error('Invalid book reading request.');
                if (!Number.isSafeInteger(payload.bookId) || (payload.bookId as number) < 1)
                  throw new Error('Invalid book identity.');
                const visible = visibleLibraryEntries(
                  await readBookSummaries(await reader.database.db),
                  get(allLinkedBooks),
                  operation.profileId
                ).cards;
                if (!visible.some((book) => book.id === payload.bookId))
                  throw new Error('This book is unavailable to the current profile.');
                let identity: BookAccessIdentity | undefined;
                let passage: Awaited<ReturnType<typeof contentSearch.admitOpen>> | undefined;
                if (
                  payload.librarySearchToken !== undefined ||
                  payload.librarySearchHit !== undefined
                ) {
                  if (payload.libraryToken !== undefined || payload.libraryKeys !== undefined)
                    throw new Error('Conflicting book reading admission.');
                  passage = await contentSearch.admitOpen(
                    { token: payload.librarySearchToken, hit: payload.librarySearchHit },
                    libraryAuthority
                  );
                  if (passage.identity.bookId !== payload.bookId)
                    throw new Error('The selected passage belongs to another book.');
                  identity = passage.identity;
                } else if (
                  payload.libraryToken !== undefined ||
                  payload.libraryKeys !== undefined
                ) {
                  const admitted = await library.admitAccess(
                    { token: payload.libraryToken, keys: payload.libraryKeys, operation: 'open' },
                    libraryAuthority
                  );
                  if (admitted.length !== 1 || admitted[0].bookId !== payload.bookId)
                    throw new Error('The selected book changed.');
                  identity = admitted[0];
                } else {
                  const selected = visible.find((book) => book.id === payload.bookId)!;
                  identity = {
                    bookId: selected.id,
                    contentHash: selected.contentHash,
                    title: selected.title,
                    lastBookModified: selected.lastBookModified
                  };
                }
                libraryAuthority.assertCurrent();
                if (admission !== state.openSequence)
                  throw new Error('A newer reader navigation replaced this open request.');
                passage?.assertCurrent();
                retireBook();
                const locationToken = passage
                  ? queueLibraryLocation(identity.bookId, operation.profileId, passage.locator)
                  : undefined;
                const controller = new AbortController();
                const readAuthority = {
                  signal: AbortSignal.any([libraryAuthority.signal, controller.signal]),
                  assertCurrent() {
                    controller.signal.throwIfAborted();
                    libraryAuthority.assertCurrent();
                  }
                };
                opened.current = { stop: operation.stop, controller, locationToken };
                retained = true;
                readingKind.current = 'book';
                setLibraryLocationToken(locationToken);
                setBookAuthority(readAuthority);
                setExpectedBook(identity);
                setBookId(payload.bookId as number);
                return { bookId: payload.bookId };
              }
              case 'close': {
                const target = opened.current;
                const sequence = ++state.openSequence;
                const destination = readingKind.current === 'snippet' ? '/snippets' : '/manage';
                const allowed = screen.current ? await screen.current.requestClose() : true;
                libraryAuthority.assertCurrent();
                if (sequence !== state.openSequence || target !== opened.current)
                  return { allowed: false, destination };
                if (allowed) retireBook();
                return { allowed, destination };
              }
              case 'settings': {
                const field = validateSetting(payload.key, payload.value);
                operation.assertCurrent();
                settingSubject(field.key).next(payload.value);
                return snapshot();
              }
              case 'import.begin':
                state.transfer.begin(
                  scope(),
                  payload.transferId as string,
                  payload.name as string,
                  payload.size as number
                );
                return null;
              case 'import.chunk': {
                if (
                  typeof payload.data !== 'string' ||
                  !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.data)
                )
                  throw new Error('Malformed import chunk.');
                const decoded = atob(payload.data);
                const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
                return state.transfer.chunk(
                  scope(),
                  payload.transferId as string,
                  payload.sequence as number,
                  bytes
                );
              }
              case 'import.cancel':
                state.transfer.cancel();
                return null;
              case 'import.commit': {
                const transfer = state.transfer.commit(scope(), payload.transferId as string);
                const file = new File(
                  transfer.chunks.map((chunk) => chunk.buffer as ArrayBuffer),
                  transfer.name
                );
                const handler = getStorageHandler(window, StorageKey.BROWSER);
                const error = await importData(document, handler, [file], operation.signal);
                operation.assertCurrent();
                if (error) throw new Error(error);
                return snapshot();
              }
              case 'delete': {
                if (
                  !Array.isArray(payload.ids) ||
                  !payload.ids.length ||
                  payload.ids.length > 1000 ||
                  payload.ids.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
                  typeof payload.keepStatistics !== 'boolean'
                )
                  throw new Error('Invalid selected book identities.');
                const visible = visibleLibraryEntries(
                  await readBookSummaries(await reader.database.db),
                  get(allLinkedBooks),
                  operation.profileId
                ).cards;
                const allowed = new Set(visible.map((book) => book.id));
                if (payload.ids.some((id) => !allowed.has(id)))
                  throw new Error('One of the selected books is no longer available.');
                if (payload.libraryToken === undefined || !Array.isArray(payload.libraryKeys))
                  throw new Error('Refresh the Library before deleting selected books.');
                const identities = await library.admitAccess(
                  { token: payload.libraryToken, keys: payload.libraryKeys, operation: 'delete' },
                  libraryAuthority
                );
                const expected = new Map(identities.map((identity) => [identity.bookId, identity]));
                if (
                  expected.size !== payload.ids.length ||
                  payload.ids.some((id) => !expected.has(id))
                )
                  throw new Error('The deletion selection changed.');
                libraryAuthority.assertCurrent();
                const result = await reader.database.deleteData(
                  payload.ids,
                  new Map(),
                  libraryAuthority.signal,
                  payload.keepStatistics,
                  operation.profileId,
                  libraryAuthority.assertCurrent,
                  expected
                );
                if (result.error) throw new Error(result.error);
                return snapshot();
              }
              case 'account.refresh':
                await refreshAccount(true);
                return snapshot();
              case 'account.logout':
                await signOut();
                return snapshot();
            }
          } finally {
            if (!retained) operation.stop();
          }
        },
        state.lifetime.signal,
        state.transfer
      ),
    []
  );
  useDOMImperativeHandle(
    ref ?? null,
    () => ({
      execute: (input: unknown) => {
        void authority
          .request(input)
          .then(async (reply) => {
            await onReply(reply);
            const request = input as BridgeRequest;
            if (
              reply.ok &&
              !reply.stale &&
              [
                'open',
                'close',
                'settings',
                'import.commit',
                'delete',
                'account.refresh',
                'account.logout'
              ].includes(request.method)
            )
              void snapshot()
                .then((value) => {
                  if (state.mounted && !state.lifetime.signal.aborted) return onSnapshot(value);
                  return undefined;
                })
                .catch(() => {});
          })
          .catch((error) =>
            console.warn(
              'Reader command rejected before admission',
              error instanceof Error ? error.message : 'Invalid command'
            )
          );
      }
    }),
    [authority, onReply]
  );
  useEffect(() => {
    document.documentElement.dataset.manabiReaderHost = 'android';
    state.mounted = true;
    let alive = true;
    let profile: string | null | undefined;
    const emit = () => {
      void snapshot()
        .then((value) => {
          if (alive) return onSnapshot(value);
          return undefined;
        })
        .catch(() => {});
    };
    let authenticationGeneration = accountGeneration();
    const observeOwnership = () => {
      const next = localProfileUser()?.id ?? null;
      const generation = accountGeneration();
      if (profile !== undefined && (profile !== next || authenticationGeneration !== generation)) {
        state.epoch++;
        state.openSequence++;
        state.accountLifetime.abort();
        state.accountLifetime = new AbortController();
        state.transfer.cancel();
        retireBook();
        contentSearch.dispose();
        library.dispose();
        snippets.dispose();
      }
      profile = next;
      authenticationGeneration = generation;
      emit();
    };
    const stop = localUser.subscribe(observeOwnership);
    const changed = reader.database.dataListChanged$.subscribe(emit);
    const bookmarks = reader.database.bookmarksChanged$.subscribe(emit);
    const accountStop = account.subscribe(observeOwnership);
    const navigate = (path: string) => {
      const nativePath = nativeNavigationPath(path, base);
      if (!nativePath) return;
      void (async () => {
        if (opened.current && nativePath !== '/b') {
          const reply = await authority.request({
            version: BRIDGE_VERSION,
            ...scope(),
            id: crypto.randomUUID(),
            method: 'close',
            payload: {}
          });
          if (
            !reply.ok ||
            reply.stale ||
            !reply.value ||
            typeof reply.value !== 'object' ||
            !('allowed' in reply.value) ||
            !reply.value.allowed
          )
            return;
        }
        await onNavigate(nativePath);
      })().catch(() => {});
    };
    const stopRouter = installRouter({ push: navigate, replace: navigate });
    return () => {
      alive = false;
      stop();
      changed.unsubscribe();
      bookmarks.unsubscribe();
      accountStop();
      stopRouter();
      state.mounted = false;
      queueMicrotask(() => {
        if (!state.mounted) {
          state.openSequence++;
          state.lifetime.abort();
          state.accountLifetime.abort();
          state.transfer.cancel();
          contentSearch.dispose();
          library.dispose();
          snippets.dispose();
          if (opened.current?.locationToken) clearLibraryLocation(opened.current.locationToken);
          opened.current?.controller.abort();
          opened.current?.stop();
        }
      });
    };
  }, []);
  return (
    <>
      <BrowserRuntime embedded />
      {snippet && (
        <EmbeddedSnippetReader
          key={snippet.record.document.id + snippet.record.document.revision}
          record={snippet.record}
          scope={snippet.scope}
          registerHandle={registerScreen}
          onExit={() => {
            retireBook();
            void onNavigate('/snippets');
          }}
        />
      )}
      {bookId !== undefined && (
        <ReaderScreen
          key={`${state.epoch}:${bookId}`}
          bookId={bookId}
          expectedBook={expectedBook}
          libraryLocationToken={libraryLocationToken}
          bookAuthority={bookAuthority}
          registerHandle={registerScreen}
          onExit={() => {
            retireBook();
            void onNavigate('/manage');
          }}
        />
      )}
    </>
  );
}
