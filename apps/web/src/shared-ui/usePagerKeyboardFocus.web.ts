/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useLayoutEffect, useRef } from 'react';
import type { PagerControls } from './usePagerKeyboardFocus';

/** Retain keyboard ownership across a committed page read, including disabled
 * boundary buttons. A newer focus destination and an unmounted owner always win. */
export function usePagerKeyboardFocus(page: number, busy: boolean, controls: PagerControls) {
  const pending = useRef<
    | {
        page: number;
        source: HTMLElement;
        preferred?: keyof PagerControls;
        lost: boolean;
        stop(): void;
      }
    | undefined
  >(undefined);
  const latest = useRef(controls);
  latest.current = controls;
  useLayoutEffect(
    () => () => {
      pending.current?.stop();
      pending.current = undefined;
    },
    []
  );
  useLayoutEffect(() => {
    const request = pending.current;
    if (!request || busy || page === request.page) return;
    pending.current = undefined;
    request.stop();
    if (request.lost) return;
    const doc = request.source.ownerDocument;
    const candidates = request.preferred
      ? [latest.current[request.preferred].current]
      : [
          request.source,
          latest.current.previous.current,
          latest.current.next.current,
          latest.current.choose.current
        ];
    const target = candidates.find(
      (node): node is HTMLElement =>
        node instanceof HTMLElement &&
        node.ownerDocument === doc &&
        node.isConnected &&
        !node.matches(':disabled,[aria-disabled="true"]')
    );
    if (
      !target ||
      (doc.activeElement !== request.source &&
        doc.activeElement !== doc.body &&
        doc.activeElement !== target)
    )
      return;
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [page, busy]);
  return (source: unknown, preferred?: keyof PagerControls) => {
    pending.current?.stop();
    pending.current = undefined;
    if (!(source instanceof HTMLElement) || source.ownerDocument.activeElement !== source) return;
    const doc = source.ownerDocument;
    const request = {
      page,
      source,
      preferred,
      lost: false,
      stop: () => doc.removeEventListener('focusin', changed)
    };
    const changed = (event: FocusEvent) => {
      if (
        event.target !== source &&
        event.target !== doc.body &&
        (!preferred || event.target !== latest.current[preferred].current)
      )
        request.lost = true;
    };
    pending.current = request;
    doc.addEventListener('focusin', changed);
  };
}
