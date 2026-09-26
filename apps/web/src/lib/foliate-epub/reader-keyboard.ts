/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { readerUIOwnsEvent } from '../functions/reader-ui-events.ts';

/** Route framed book keys through the application's existing configured shortcuts. */
export function relayReaderKeydown(event: KeyboardEvent, host: Window): void {
  if (event.isComposing || readerUIOwnsEvent(event)) return;
  const source = (event.target as Node | null)?.ownerDocument;
  if (!source || source === host.document) return;
  const frame = source.defaultView?.frameElement;
  if (!frame?.isConnected) return;
  const Keyboard = (host as Window & typeof globalThis).KeyboardEvent;
  const forwarded = new Keyboard('keydown', {
    key: event.key,
    code: event.code,
    location: event.location,
    repeat: event.repeat,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    bubbles: true,
    cancelable: true
  });
  const focused = host.document.activeElement === frame;
  host.dispatchEvent(forwarded);
  if (!forwarded.defaultPrevented) return;
  event.preventDefault();
  // The legacy top-level shortcut handler blurs controls. Do not leave the
  // reading iframe unfocused, but never steal focus from a newly opened dialog.
  if (
    focused &&
    frame.isConnected &&
    host.document.activeElement === host.document.body &&
    !readerUIOwnsEvent()
  )
    source.defaultView?.focus();
}
