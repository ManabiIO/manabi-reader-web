/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { Paginator, PreparedPageTurn } from './paginator.js';
import { wheelPageDistance, type TurnDirection } from './slide-geometry';

/**
 * Keep the actual iframe hit-testable. Touch drags claim a horizontal gesture
 * only after its direction is clear; mouse text drags, long presses, pinch,
 * links, and existing selections remain owned by the document/dictionary.
 */
export class PageTurnController {
  private lifetime = new AbortController();
  private documentEvents?: AbortController;
  private prepared?: PreparedPageTurn;
  private pending?: Promise<PreparedPageTurn | null>;
  private direction: TurnDirection = 1;
  private progress = 0;
  private generation = 0;
  private settling = false;
  private ownCancellation = false;
  private frame = 0;
  private wheelTimer?: ReturnType<typeof setTimeout>;
  private pointer?: {
    id: number;
    x: number;
    y: number;
    time: number;
    claimed: boolean;
    target: Element;
  };
  private suppressClickUntil = 0;

  constructor(private paginator: Paginator) {
    paginator.setAttribute('layered', '');
    this.bind(paginator, this.lifetime.signal);
    paginator.addEventListener('load', () => this.bindDocument(), { signal: this.lifetime.signal });
    paginator.addEventListener(
      'pageturncancel',
      () => {
        if (!this.ownCancellation) this.cancel();
      },
      { signal: this.lifetime.signal }
    );
    window.addEventListener('blur', () => this.cancel(), { signal: this.lifetime.signal });
    window.addEventListener('resize', () => this.cancel(), { signal: this.lifetime.signal });
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) this.cancel();
      },
      { signal: this.lifetime.signal }
    );
    this.bindDocument();
  }

  private bindDocument() {
    this.documentEvents?.abort();
    this.documentEvents = new AbortController();
    const doc = this.paginator.getContents()[0]?.doc;
    if (doc) {
      // A vertical browser pan remains available for direction arbitration.
      // Pinch zoom and long-press text selection stay native.
      doc.documentElement.style.touchAction = 'pan-y pinch-zoom';
      this.bind(doc, this.documentEvents.signal);
      doc.addEventListener(
        'keydown',
        (event) => {
          if (
            event.defaultPrevented ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            this.interactive(event.target) ||
            this.selected()
          )
            return;
          const rtl = this.paginator.pageTurnDirection === 'rtl';
          const turn =
            event.key === 'ArrowRight'
              ? rtl
                ? -1
                : 1
              : event.key === 'ArrowLeft'
                ? rtl
                  ? 1
                  : -1
                : event.key === 'PageDown'
                  ? 1
                  : event.key === 'PageUp'
                    ? -1
                    : 0;
          if (turn) {
            event.preventDefault();
            void this.turn(turn);
          } else if (event.key === 'Escape') this.cancel();
        },
        { signal: this.documentEvents.signal }
      );
    }
  }

  private selected() {
    return !!this.paginator.getContents()[0]?.doc.getSelection()?.toString();
  }

  private interactive(target: EventTarget | null) {
    return !!(target as Element)?.closest?.(
      'a, button, input, textarea, select, [contenteditable], ruby, img, video, audio, [data-ttu-spoiler-img]'
    );
  }

  private inputControl(target: EventTarget | null) {
    return !!(target as Element)?.closest?.(
      'button, input, textarea, select, [contenteditable], video, audio'
    );
  }

  private bind(target: HTMLElement | Document, signal: AbortSignal) {
    target.addEventListener(
      'pointerdown',
      ((event: PointerEvent) => {
        if (
          !event.isPrimary ||
          event.button !== 0 ||
          this.settling ||
          this.inputControl(event.target) ||
          this.selected() ||
          (window.visualViewport?.scale ?? 1) > 1
        )
          return;
        // Mouse drags on the page text select text; use its margins or wheel to turn.
        if (event.pointerType === 'mouse' && target.nodeType === 9) return;
        const el = event.target as Element;
        this.pointer = {
          id: event.pointerId,
          x: this.point(event).x,
          y: this.point(event).y,
          time: event.timeStamp,
          claimed: false,
          target: el
        };
      }) as EventListener,
      { signal }
    );
    target.addEventListener(
      'pointermove',
      ((event: PointerEvent) => {
        const p = this.pointer;
        if (!p || p.id !== event.pointerId) return;
        const dx = this.point(event).x - p.x;
        const dy = this.point(event).y - p.y;
        if (!p.claimed) {
          if (Math.hypot(dx, dy) < 8) return;
          if (event.timeStamp - p.time > 350 || Math.abs(dy) > Math.abs(dx) || this.selected()) {
            this.pointer = undefined;
            return;
          }
          p.claimed = true;
          p.target.setPointerCapture?.(event.pointerId);
        }
        event.preventDefault();
        const sign = this.paginator.pageTurnDirection === 'rtl' ? 1 : -1;
        this.move((sign * dx) / this.width());
      }) as EventListener,
      { signal, passive: false }
    );
    target.addEventListener(
      'pointerup',
      ((event: PointerEvent) => {
        const p = this.pointer;
        if (!p || p.id !== event.pointerId) return;
        this.pointer = undefined;
        if (p.claimed) {
          this.suppressClickUntil = performance.now() + 500;
          void this.finish(this.progress >= 0.5);
        }
      }) as EventListener,
      { signal }
    );
    target.addEventListener('pointercancel', () => this.cancel(), { signal });
    // Safari sends touch events to the document even when the pointer is captured.
    target.addEventListener(
      'touchstart',
      ((event: TouchEvent) => {
        if (event.touches.length > 1) this.cancel();
      }) as EventListener,
      { signal, passive: true }
    );
    target.addEventListener(
      'click',
      ((event: MouseEvent) => {
        if (performance.now() < this.suppressClickUntil) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }) as EventListener,
      { signal, capture: true }
    );
    target.addEventListener(
      'wheel',
      ((event: WheelEvent) => {
        if (
          event.ctrlKey ||
          event.metaKey ||
          event.defaultPrevented ||
          this.inputControl(event.target) ||
          this.selected() ||
          this.pointer ||
          (window.visualViewport?.scale ?? 1) > 1
        )
          return;
        event.preventDefault();
        if (this.settling) return;
        const delta = wheelPageDistance(
          event.deltaX,
          event.deltaY,
          event.deltaMode,
          this.width(),
          this.paginator.pageTurnDirection
        );
        this.move(this.direction * this.progress + delta / this.width());
        clearTimeout(this.wheelTimer);
        this.wheelTimer = setTimeout(() => void this.finish(this.progress >= 0.5), 180);
      }) as EventListener,
      { signal, passive: false }
    );
  }

  private point(event: PointerEvent) {
    // screenX/Y can be zero for trusted touch events inside an iframe. Add
    // its live viewport offset so dragging a transformed sheet stays stable.
    const frame = (event.target as Element).ownerDocument.defaultView?.frameElement;
    const rect = frame?.getBoundingClientRect();
    return { x: event.clientX + (rect?.left ?? 0), y: event.clientY + (rect?.top ?? 0) };
  }

  private width() {
    return Math.max(1, this.paginator.getBoundingClientRect().width);
  }

  private move(signed: number) {
    const direction: TurnDirection = signed < 0 ? -1 : 1;
    if (direction !== this.direction) this.resetTurn();
    this.direction = direction;
    this.progress = Math.min(1, Math.abs(signed));
    if (!this.pending && !this.prepared) {
      const generation = this.generation;
      this.ownCancellation = true;
      const pending = this.paginator.preparePageTurn(direction);
      this.ownCancellation = false;
      this.pending = pending
        .then((turn) => {
          if (generation !== this.generation) {
            turn?.cancel();
            return null;
          }
          this.prepared = turn ?? undefined;
          turn?.update(this.progress);
          return turn;
        })
        .catch((error) => {
          if (generation === this.generation) {
            this.cancel();
            this.paginator.dispatchEvent(new CustomEvent('pageturnerror', { detail: error }));
          }
          return null;
        });
    }
    this.prepared?.update(this.progress);
  }

  async turn(direction: TurnDirection) {
    if (this.settling || this.selected()) return;
    this.cancel();
    this.move(direction * 0.001);
    await this.finish(true);
  }

  private async finish(commit: boolean) {
    if (this.settling) return;
    this.settling = true;
    clearTimeout(this.wheelTimer);
    const generation = this.generation;
    const prepared = this.prepared ?? (await this.pending);
    if (generation !== this.generation) return;
    if (!prepared) {
      this.cancel();
      return;
    }
    const start = this.progress;
    const end = commit ? 1 : 0;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const started = performance.now();
    const step = (now: number) => {
      if (generation !== this.generation) return;
      const t = reduced ? 1 : Math.min(1, (now - started) / 220);
      prepared.update(start + (end - start) * (1 - (1 - t) ** 3));
      if (t < 1) this.frame = requestAnimationFrame(step);
      else {
        this.ownCancellation = true;
        if (commit) prepared.commit();
        else prepared.cancel();
        this.ownCancellation = false;
        this.resetTurn();
      }
    };
    this.frame = requestAnimationFrame(step);
  }

  private resetTurn() {
    this.generation += 1;
    cancelAnimationFrame(this.frame);
    clearTimeout(this.wheelTimer);
    this.ownCancellation = true;
    this.paginator.cancelPageTurn();
    this.ownCancellation = false;
    this.prepared = undefined;
    this.pending = undefined;
    this.progress = 0;
    this.settling = false;
  }

  cancel() {
    this.pointer = undefined;
    this.resetTurn();
  }

  destroy() {
    this.cancel();
    this.lifetime.abort();
    this.documentEvents?.abort();
    this.paginator.removeAttribute('layered');
  }
}
