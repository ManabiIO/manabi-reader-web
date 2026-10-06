/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { beforeNavigate } from '../runtime/navigation';
import { ReaderScreen, type ReaderScreenHandle } from './index';
import { WebReaderDeparture } from './web-reader-departure';

export interface WebReaderLifetimeProps {
  routeUrl: string;
  focused: boolean;
  ownerEpoch: number;
  isCurrentOwner(): boolean;
}

/** A retained Expo wrapper is not a retained reader. A fresh focus admits a
 * fresh controller only after the preceding visit's save/cleanup barrier. */
export function WebReaderLifetime(props: WebReaderLifetimeProps) {
  const prior = useRef({ focused: false, routeUrl: props.routeUrl, ownerEpoch: props.ownerEpoch });
  const serial = useRef(0);
  const [visit, setVisit] = useState<{
    id: number;
    routeUrl: string;
    ownerEpoch: number;
  }>();
  useEffect(() => {
    if (
      props.focused &&
      (!prior.current.focused ||
        prior.current.routeUrl !== props.routeUrl ||
        prior.current.ownerEpoch !== props.ownerEpoch)
    )
      setVisit({ id: ++serial.current, routeUrl: props.routeUrl, ownerEpoch: props.ownerEpoch });
    prior.current = {
      focused: props.focused,
      routeUrl: props.routeUrl,
      ownerEpoch: props.ownerEpoch
    };
  }, [props.focused, props.routeUrl, props.ownerEpoch]);
  return visit && visit.ownerEpoch === props.ownerEpoch ? (
    <ReaderVisit key={visit.id} {...props} routeUrl={visit.routeUrl} />
  ) : null;
}

function ReaderVisit(props: WebReaderLifetimeProps) {
  const live = useRef(props);
  live.current = props;
  const [mounted, setMounted] = useState(true);
  const [error, setError] = useState('');
  const shown = useRef(true);
  const handle = useRef<ReaderScreenHandle | undefined>(undefined);
  const retirement = useRef<(() => void) | undefined>(undefined);
  const restoration = useRef<(() => void) | undefined>(undefined);
  const admittedUrl = props.routeUrl;
  const epoch = props.ownerEpoch;
  useEffect(() => {
    let disposed = false;
    const current = () =>
      !disposed &&
      live.current.focused &&
      live.current.routeUrl === admittedUrl &&
      live.current.ownerEpoch === epoch &&
      live.current.isCurrentOwner();
    const departure = new WebReaderDeparture({
      isCurrent: current,
      suspend: () => handle.current?.requestSuspend?.() ?? Promise.resolve(false),
      resume: () => handle.current?.resumeAfterCanceledSuspend?.(),
      retire: () =>
        new Promise<void>((resolve) => {
          retirement.current = resolve;
          shown.current = false;
          setMounted(false);
        }),
      restore: () =>
        new Promise<void>((resolve) => {
          if (!current()) return resolve();
          restoration.current = resolve;
          shown.current = true;
          setMounted(true);
        }),
      failed: (reason) => setError(reason instanceof Error ? reason.message : String(reason))
    });
    const stop = beforeNavigate(departure.beforeNavigate);
    return () => {
      disposed = true;
      stop();
      departure.dispose();
      retirement.current?.();
      retirement.current = undefined;
      restoration.current?.();
      restoration.current = undefined;
    };
  }, [admittedUrl, epoch]);
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {mounted && (
        <CleanupWitness
          mounted={() => {
            restoration.current?.();
            restoration.current = undefined;
          }}
          unmounted={() => {
            if (shown.current) return;
            retirement.current?.();
            retirement.current = undefined;
          }}
        >
          <ReaderScreen
            routeUrl={admittedUrl}
            registerHandle={(value) => (handle.current = value)}
          />
        </CleanupWitness>
      )}
    </>
  );
}

function CleanupWitness({
  children,
  mounted,
  unmounted
}: {
  children: ReactNode;
  mounted(): void;
  unmounted(): void;
}) {
  const latest = useRef({ mounted, unmounted });
  latest.current = { mounted, unmounted };
  useEffect(() => {
    latest.current.mounted();
    // React runs descendant passive cleanups in this turn. The microtask is
    // after controller disposal, DOM removal and synchronous lease revocation.
    return () => queueMicrotask(() => latest.current.unmounted());
  }, []);
  return children;
}
