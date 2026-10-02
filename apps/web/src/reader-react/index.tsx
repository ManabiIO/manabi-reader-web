/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { page } from '../runtime/stores';
import { base } from '../runtime/paths';
import { ReaderScreen as ReaderSession } from './session';
import type {
  BookAccessAuthority,
  BookAccessIdentity
} from '$lib/data/database/books-db/book-identity';
import type { createSession } from './session-controller';
import './reader.css';
import './primitives.css';
export interface ReaderScreenHandle {
  requestClose(): Promise<boolean>;
}
export interface ReaderScreenProps {
  bookId?: number;
  expectedBook?: BookAccessIdentity;
  libraryLocationToken?: string;
  bookAuthority?: BookAccessAuthority;
  onExit?: () => void;
  registerHandle?: (handle: ReaderScreenHandle | undefined) => void;
}
/** Shared React DOM reader: rendered directly on web and in Expo's DOM
 * component on Android. Book/database identities remain stable across shells. */
export function ReaderScreen({
  bookId,
  expectedBook,
  libraryLocationToken,
  bookAuthority,
  onExit,
  registerHandle
}: ReaderScreenProps) {
  const session = useRef<ReturnType<typeof createSession> | undefined>(undefined);
  const latestExit = useRef(onExit);
  latestExit.current = onExit;
  const bindSession = useCallback((value: ReturnType<typeof createSession> | undefined) => {
    session.current = value;
    value?.setExitHandler(latestExit.current ? () => latestExit.current?.() : undefined);
  }, []);
  useEffect(() => {
    const handle: ReaderScreenHandle = {
      requestClose: () => session.current?.requestClose() ?? Promise.resolve(false)
    };
    registerHandle?.(handle);
    return () => registerHandle?.(undefined);
  }, [registerHandle]);
  const [ready, setReady] = useState<{
    bookId: number | undefined;
    expectedBook: BookAccessIdentity | undefined;
    bookAuthority: BookAccessAuthority | undefined;
  }>();
  useEffect(() => {
    const url = new URL(window.location.href);
    if (bookId !== undefined) {
      url.pathname = `${base}/b`;
      url.search = '';
      url.searchParams.set('id', String(bookId));
      if (libraryLocationToken) url.searchParams.set('library-search', libraryLocationToken);
    }
    page.set({ url, params: {}, state: history.state ?? {}, data: {} });
    setReady({ bookId, expectedBook, bookAuthority });
  }, [bookId, expectedBook, bookAuthority, libraryLocationToken]);
  useEffect(() => {
    session.current?.setExitHandler(onExit ? () => latestExit.current?.() : undefined);
  }, [onExit]);
  // A fresh admission of the same numeric book also starts a fresh session.
  // The previous controller owns its original authority and immutable identity.
  return ready &&
    ready.bookId === bookId &&
    ready.expectedBook === expectedBook &&
    ready.bookAuthority === bookAuthority ? (
    <ReaderSession
      key={bookId ?? 'url'}
      expectedBook={expectedBook}
      bookAuthority={bookAuthority}
      bindings={{ this: bindSession }}
    />
  ) : (
    <p role="status">Opening reader…</p>
  );
}
export default ReaderScreen;
export { BookReader } from './book-reader';
export type { BookReaderProps } from './book-reader-controller';
