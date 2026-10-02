/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { page } from '../runtime/stores';
import { ReaderScreen as ReaderSession } from './session';
import type { createSession } from './session-controller';
import './reader.css';
import './primitives.css';
export interface ReaderScreenHandle {
  requestClose(): Promise<boolean>;
}
export interface ReaderScreenProps {
  bookId?: number;
  onExit?: () => void;
  registerHandle?: (handle: ReaderScreenHandle | undefined) => void;
}
/** Shared React DOM reader: rendered directly on web and in Expo's DOM
 * component on Android. Book/database identities remain stable across shells. */
export function ReaderScreen({ bookId, onExit, registerHandle }: ReaderScreenProps) {
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
  const [ready, setReady] = useState<{ bookId: number | undefined }>();
  useEffect(() => {
    const url = new URL(window.location.href);
    if (bookId !== undefined) url.searchParams.set('id', String(bookId));
    page.set({ url, params: {}, state: history.state ?? {}, data: {} });
    setReady({ bookId });
  }, [bookId]);
  useEffect(() => {
    session.current?.setExitHandler(onExit ? () => latestExit.current?.() : undefined);
  }, [onExit]);
  return ready && ready.bookId === bookId ? (
    <ReaderSession key={bookId ?? 'url'} bindings={{ this: bindSession }} />
  ) : (
    <p role="status">Opening reader…</p>
  );
}
export default ReaderScreen;
export { BookReader } from './book-reader';
export type { BookReaderProps } from './book-reader-controller';
