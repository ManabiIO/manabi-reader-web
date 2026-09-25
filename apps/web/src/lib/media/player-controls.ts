/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};
export function button(label: string, action: () => void): HTMLButtonElement {
  const node = element('button', label);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

const paths = {
  theater: ['M2 6h20v12H2z'],
  transcript: ['M4 4h16v16H4z', 'M8 8h8M8 12h8M8 16h5'],
  more: ['M5 12h.01M12 12h.01M19 12h.01']
} as const;
export function iconButton(
  label: string,
  icon: keyof typeof paths,
  action: () => void
): HTMLButtonElement {
  const node = button('', action);
  node.className = 'media-icon-button';
  node.setAttribute('aria-label', label);
  node.title = label;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({
    viewBox: '0 0 24 24',
    width: '22',
    height: '22',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': icon === 'more' ? '3.5' : '1.6',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true'
  }))
    svg.setAttribute(key, value);
  for (const d of paths[icon]) {
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  node.append(svg);
  return node;
}

/** Native light-dismiss popover. This contains form controls, so it is a non-modal
 * dialog, not an ARIA menu with invalid nested comboboxes. No document-wide shortcuts.
 */
let menuSequence = 0;
export class TranscriptMenu {
  readonly panel = element('div');
  readonly trigger = iconButton('Transcript options', 'more', () => this.toggle());
  private open = false;
  private native = typeof this.panel.showPopover === 'function';
  private alive = new AbortController();
  private observer = new ResizeObserver(() => this.position());
  constructor() {
    this.panel.className = 'transcript-options';
    this.panel.id = `transcript-options-${++menuSequence}`;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'Transcript options');
    this.trigger.setAttribute('aria-haspopup', 'dialog');
    this.trigger.setAttribute('aria-controls', this.panel.id);
    this.trigger.setAttribute('aria-expanded', 'false');
    if (this.native) this.panel.setAttribute('popover', 'auto');
    else this.panel.hidden = true;
    this.observer.observe(this.panel);
    const signal = this.alive.signal;
    this.panel.addEventListener(
      'toggle',
      () => {
        if (this.native) this.open = this.panel.matches(':popover-open');
        this.trigger.setAttribute('aria-expanded', String(this.open));
      },
      { signal }
    );
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (
          this.open &&
          !event.composedPath().includes(this.panel) &&
          !event.composedPath().includes(this.trigger)
        )
          this.close(false);
      },
      { signal }
    );
    this.panel.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          this.close();
        }
      },
      { signal }
    );
    this.panel.addEventListener(
      'focusout',
      (event) => {
        if (
          event.relatedTarget instanceof Node &&
          !this.panel.contains(event.relatedTarget) &&
          event.relatedTarget !== this.trigger
        )
          this.close(false);
      },
      { signal }
    );
    window.addEventListener('resize', () => this.position(), { signal });
    window.addEventListener('scroll', () => this.position(), { signal, capture: true });
  }
  private position() {
    if (!this.open) return;
    const rect = this.trigger.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
    this.panel.style.width = `${width}px`;
    this.panel.style.maxHeight = `${Math.max(120, window.innerHeight - 24)}px`;
    const height = this.panel.getBoundingClientRect().height;
    this.panel.style.left = `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`;
    this.panel.style.top = `${Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - height - 12))}px`;
  }
  toggle() {
    if (this.open) return this.close();
    this.open = true;
    if (this.native) this.panel.showPopover();
    else this.panel.hidden = false;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.position();
    this.panel
      .querySelector<HTMLElement>(
        'button:not(:disabled), select:not(:disabled), input:not(:disabled)'
      )
      ?.focus({ preventScroll: true });
  }
  close(restoreFocus = true) {
    if (!this.open) return;
    this.open = false;
    if (this.native) {
      if (this.panel.matches(':popover-open')) this.panel.hidePopover();
    } else this.panel.hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus && this.trigger.isConnected) this.trigger.focus({ preventScroll: true });
  }
  dispose() {
    this.close(false);
    this.alive.abort();
    this.observer.disconnect();
    this.panel.remove();
  }
}
