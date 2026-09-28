/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  adjacentSelection,
  LibrarySelection,
  marqueeSelection,
  type SelectionItem
} from './selection';

interface Options {
  enabled: boolean;
  busy: boolean;
  scope: string;
  selected: ReadonlySet<string>;
  change(ids: Set<string>): void;
  cancel(): void;
}

/** Capture only shelf selection gestures; leave buttons/menus, text editing and touch scrolling alone. */
export function librarySelection(node: HTMLElement, initial: Options) {
  let options = initial;
  const model = new LibrarySelection<string>();
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const toggle = (event: MouseEvent | KeyboardEvent) => (mac ? event.metaKey : event.ctrlKey);
  const buttons = () =>
    [...node.querySelectorAll<HTMLButtonElement>('[data-selection-key]')].filter(
      (button) => !button.disabled && button.getClientRects().length > 0
    );
  const items = (): SelectionItem<string>[] =>
    buttons()
      .map((button) => ({
        key: button.dataset.selectionKey!,
        ids: JSON.parse(button.dataset.selectionIds || '[]') as string[]
      }))
      .filter((item) => item.ids.length > 0);
  const rects = () =>
    buttons()
      .filter((button) => button.dataset.selectionIds !== '[]')
      .map((button) => ({
        key: button.dataset.selectionKey!,
        ...rectOf(button)
      }));
  function rectOf(element: HTMLElement) {
    const { left, top, right, bottom } = element.getBoundingClientRect();
    return { left, top, right, bottom };
  }
  function publish(ids: ReadonlySet<string>) {
    model.selected = new Set(ids);
    options.change(new Set(ids));
  }
  let focusFrame = 0;
  let focusRevision = 0;
  let suppressClick = false;
  let clickTimer: ReturnType<typeof setTimeout> | undefined;
  function click(event: MouseEvent) {
    if (suppressClick) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.button !== 0 || (mac && event.ctrlKey)) return;
    const target = (event.target as Element)?.closest<HTMLButtonElement>('[data-selection-key]');
    if (!target || !node.contains(target)) return;
    if (options.busy) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!options.enabled && !event.shiftKey && !toggle(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const available = items();
    model.sync(options.selected, available);
    publish(
      model.choose(target.dataset.selectionKey!, available, {
        shift: event.shiftKey,
        toggle: toggle(event)
      })
    );
    target.focus({ preventScroll: true });
  }
  function keydown(event: KeyboardEvent) {
    if (!options.enabled || options.busy || event.isComposing || event.altKey) return;
    const target = event.target as HTMLElement;
    if (
      target.closest(
        'input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"]'
      )
    )
      return;
    const button = target.closest<HTMLElement>('[data-selection-key]');
    if (!button && target !== node) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelDrag(true);
      options.cancel();
      return;
    }
    const available = items();
    model.sync(options.selected, available);
    if (toggle(event) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      publish(model.all(available));
      return;
    }
    if (event.key === ' ' && button) {
      event.preventDefault();
      publish(
        model.choose(button.dataset.selectionKey!, available, {
          toggle: true,
          shift: event.shiftKey
        })
      );
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
      return;
    event.preventDefault();
    const key = adjacentSelection(rects(), button?.dataset.selectionKey ?? model.focus, event.key);
    if (!key) return;
    model.focus = key;
    if (!toggle(event) || event.shiftKey)
      publish(model.choose(key, available, { shift: event.shiftKey }));
    const next = buttons().find((item) => item.dataset.selectionKey === key);
    next?.focus({ preventScroll: true });
    next?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  type Drag = {
    pointer: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    baseline: Set<string>;
    active: boolean;
    shift: boolean;
    toggle: boolean;
    items: SelectionItem<string>[];
    pending: Set<string>;
  };
  let drag: Drag | undefined,
    overlay: HTMLDivElement | undefined,
    frame = 0;
  function down(event: PointerEvent) {
    if (
      options.busy ||
      event.button !== 0 ||
      event.pointerType !== 'mouse' ||
      (mac && event.ctrlKey)
    )
      return;
    const target = event.target as Element;
    // Starting on a book must remain an ordinary click, not a text-selection or file drag.
    if (
      target.closest(
        'button, a, input, textarea, select, summary, [role="dialog"], [data-selection-ignore]'
      )
    )
      return;
    if (!target.closest('.shelf-grid, .shelf-list, .library-workspace')) return;
    const available = items();
    if (!available.length) return;
    drag = {
      pointer: event.pointerId,
      startX: event.clientX + window.scrollX,
      startY: event.clientY + window.scrollY,
      x: event.clientX,
      y: event.clientY,
      baseline: new Set(options.selected),
      active: false,
      shift: event.shiftKey,
      toggle: toggle(event),
      items: available,
      pending: new Set(options.selected)
    };
  }
  function move(event: PointerEvent) {
    if (!drag || drag.pointer !== event.pointerId) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (
      !drag.active &&
      Math.hypot(drag.x + window.scrollX - drag.startX, drag.y + window.scrollY - drag.startY) < 6
    )
      return;
    if (!drag.active) {
      drag.active = true;
      node.setPointerCapture(event.pointerId);
      node.classList.add('is-drag-selecting');
      window.getSelection()?.removeAllRanges();
      overlay = document.createElement('div');
      overlay.className = 'library-selection-marquee';
      overlay.setAttribute('aria-hidden', 'true');
      document.body.append(overlay);
      frame = requestAnimationFrame(draw);
    }
    event.preventDefault();
  }
  function draw() {
    if (!drag?.active || !overlay) return;
    const edge = 48;
    const top = Math.max(0, node.getBoundingClientRect().top);
    const delta =
      drag.y > window.innerHeight - edge
        ? Math.min(18, (drag.y - window.innerHeight + edge) / 2)
        : drag.y < top + edge
          ? -Math.min(18, (top + edge - drag.y) / 2)
          : 0;
    if (delta) window.scrollBy(0, delta);
    const startX = drag.startX - window.scrollX,
      startY = drag.startY - window.scrollY;
    const left = Math.min(startX, drag.x),
      right = Math.max(startX, drag.x);
    const y = Math.min(startY, drag.y),
      bottom = Math.max(startY, drag.y);
    Object.assign(overlay.style, {
      left: `${left}px`,
      top: `${y}px`,
      width: `${right - left}px`,
      height: `${bottom - y}px`
    });
    const hits = new Set(
      rects()
        .filter(
          (rect) => rect.right > left && rect.left < right && rect.bottom > y && rect.top < bottom
        )
        .map((rect) => rect.key)
    );
    const result = marqueeSelection(drag.items, hits, drag.baseline, drag);
    drag.pending = result;
    for (const button of buttons()) {
      const ids: string[] = JSON.parse(button.dataset.selectionIds || '[]');
      button.classList.toggle(
        'drag-selected',
        ids.some((id) => result.has(id))
      );
    }
    frame = requestAnimationFrame(draw);
  }
  function cancelDrag(restore = false) {
    const previous = drag;
    drag = undefined;
    cancelAnimationFrame(frame);
    overlay?.remove();
    overlay = undefined;
    node.classList.remove('is-drag-selecting');
    for (const button of buttons()) button.classList.remove('drag-selected');
    if (previous && node.hasPointerCapture(previous.pointer))
      node.releasePointerCapture(previous.pointer);
    if (restore && previous?.active) {
      model.selected = new Set(previous.baseline);
    }
  }
  function up(event: PointerEvent) {
    if (!drag || drag.pointer !== event.pointerId) return;
    if (drag.active) {
      cancelAnimationFrame(frame);
      draw();
      if (drag.pending.size || options.enabled) publish(drag.pending);
      suppressClick = true;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        suppressClick = false;
      }, 0);
      node.focus({ preventScroll: true });
      model.anchor = items().find((item) => item.ids.some((id) => model.selected.has(id)))?.key;
    } else if (options.enabled && !drag.shift && !drag.toggle) {
      publish(new Set());
    }
    cancelDrag();
  }
  const cancelled = () => cancelDrag(true);
  const escapeDrag = (event: KeyboardEvent) => {
    if (!drag?.active || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancelDrag(true);
  };
  window.addEventListener('keydown', escapeDrag, true);
  node.addEventListener('click', click, true);
  node.addEventListener('keydown', keydown);
  node.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancelled);
  node.addEventListener('lostpointercapture', cancelled);
  window.addEventListener('blur', cancelled);
  return {
    update(next: Options) {
      const entering = next.enabled && !options.enabled;
      if (next.scope !== options.scope || (options.enabled && !next.enabled) || next.busy) {
        cancelDrag();
        model.reset();
      }
      options = next;
      if (entering) {
        const revision = ++focusRevision;
        cancelAnimationFrame(focusFrame);
        // Let the menu finish its focus-return handoff before entering the shelf.
        focusFrame = requestAnimationFrame(() => {
          focusFrame = requestAnimationFrame(() => {
            if (
              revision !== focusRevision ||
              !options.enabled ||
              options.busy ||
              document.querySelector('[role="dialog"], [role="menu"]') ||
              node.contains(document.activeElement)
            )
              return;
            const selected = buttons().find((button) => {
              const ids: string[] = JSON.parse(button.dataset.selectionIds || '[]');
              return ids.some((id) => options.selected.has(id));
            });
            (
              selected ??
              buttons().find((button) => button.dataset.selectionIds !== '[]') ??
              node
            ).focus({ preventScroll: true });
          });
        });
      }
    },
    destroy() {
      focusRevision++;
      cancelAnimationFrame(focusFrame);
      cancelDrag();
      clearTimeout(clickTimer);
      window.removeEventListener('keydown', escapeDrag, true);
      node.removeEventListener('click', click, true);
      node.removeEventListener('keydown', keydown);
      node.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancelled);
      node.removeEventListener('lostpointercapture', cancelled);
      window.removeEventListener('blur', cancelled);
    }
  };
}
