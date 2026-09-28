/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { readerUIOwnsEvent } from './functions/reader-ui-events.ts';

export type ReaderChromeActivity = 'pointer' | 'pin' | 'toggle';
interface ReaderChromeInteractions {
  activity(kind: ReaderChromeActivity): void;
  navigationRevision(): number;
  selection(): string;
  /** Framed keys already use the reader's existing keyboard relay. */
  keys?: boolean;
}

/** One lifetime per live reading document. Framed events do not bubble to the app window. */
export function bindReaderChromeInteractions(
  target: Window | Document,
  options: ReaderChromeInteractions
): () => void {
  let disposed = false;
  let pointer:
    | {
        id: number;
        x: number;
        y: number;
        time: number;
        moved: boolean;
        selected: boolean;
        navigation: number;
      }
    | undefined;
  let lastMouse: { x: number; y: number } | undefined;
  const element = (event: Event) => {
    const node = event.target as Node | null;
    return node?.nodeType === 1 ? (node as Element) : node?.parentElement;
  };
  const activity = (kind: ReaderChromeActivity) => {
    if (!disposed) options.activity(kind);
  };
  const move = ((event: PointerEvent) => {
    if (
      pointer &&
      event.pointerId === pointer.id &&
      Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 12
    )
      pointer.moved = true;
    if (event.pointerType !== 'mouse' || event.buttons || readerUIOwnsEvent(event)) return;
    if (lastMouse && Math.hypot(event.clientX - lastMouse.x, event.clientY - lastMouse.y) < 4)
      return;
    lastMouse = { x: event.clientX, y: event.clientY };
    activity('pointer');
  }) as EventListener;
  const down = ((event: PointerEvent) => {
    pointer = undefined;
    const el = element(event);
    // This button has its own explicit Show/Hide action. Pinning first would invert that action.
    if (el?.closest('.reader-controls')) return;
    if (el?.closest('[data-reader-chrome]')) {
      activity('pin');
      return;
    }
    if (!event.isPrimary || event.button !== 0 || readerUIOwnsEvent(event)) return;
    pointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp,
      moved: false,
      selected: !!options.selection(),
      navigation: options.navigationRevision()
    };
  }) as EventListener;
  const click = ((event: MouseEvent) => {
    const prior = pointer;
    pointer = undefined;
    if (
      !prior ||
      prior.moved ||
      prior.navigation !== options.navigationRevision() ||
      event.timeStamp - prior.time > 500 ||
      event.timeStamp < prior.time ||
      Math.hypot(event.clientX - prior.x, event.clientY - prior.y) > 12 ||
      event.defaultPrevented ||
      prior.selected ||
      event.detail !== 1 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      readerUIOwnsEvent(event) ||
      options.selection() ||
      element(event)?.closest(
        '[data-reader-chrome], ruby, rt, img, svg, m-m, m-s, m-t, .m-m, .m-sentence, [data-ttu-spoiler-img]'
      )
    )
      return;
    activity('toggle');
  }) as EventListener;
  const cancel = () => {
    pointer = undefined;
  };
  const touch = ((event: TouchEvent) => {
    if (event.touches.length > 1) cancel();
  }) as EventListener;
  const key = ((event: KeyboardEvent) => {
    if (event.isComposing || event.defaultPrevented) return;
    if (event.key === 'Tab' || (event.key === 'Escape' && !readerUIOwnsEvent(event)))
      activity('pin');
  }) as EventListener;
  target.addEventListener('pointermove', move, { passive: true });
  target.addEventListener('pointerdown', down, true);
  target.addEventListener('pointercancel', cancel);
  target.addEventListener('touchstart', touch, { passive: true });
  target.addEventListener('blur', cancel);
  target.addEventListener('click', click);
  if (options.keys !== false) target.addEventListener('keydown', key, true);
  return () => {
    disposed = true;
    cancel();
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerdown', down, true);
    target.removeEventListener('pointercancel', cancel);
    target.removeEventListener('touchstart', touch);
    target.removeEventListener('blur', cancel);
    target.removeEventListener('click', click);
    target.removeEventListener('keydown', key, true);
  };
}
