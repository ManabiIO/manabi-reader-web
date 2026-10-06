/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useLayoutEffect, useRef } from 'react';
import type { MenuProps } from './Menu';
export function Menu({ visible, onClose, label, children }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!visible || !menu) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    menu.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.contains(event.target)) close.current();
    };
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      if (
        previous?.isConnected &&
        (document.activeElement === document.body || menu.contains(document.activeElement))
      )
        previous.focus();
    };
  }, [visible]);
  if (!visible) return null;
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      style={{
        position: 'absolute',
        top: '100%',
        right: 0,
        zIndex: 30,
        minWidth: 220,
        maxWidth: 'min(360px, calc(100vw - 24px))',
        padding: 8,
        borderRadius: 12,
        border: '1px solid var(--border)',
        background: 'var(--popover)',
        color: 'var(--foreground)',
        boxShadow: '0 8px 24px rgb(0 0 0 / 18%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close.current();
        }
        if (event.key === ' ' && document.activeElement?.getAttribute('role') === 'menuitem') {
          event.preventDefault();
          (document.activeElement as HTMLElement).click();
        }
        if (event.key === 'Tab') {
          close.current();
          return;
        }
        const items = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            '[role="menuitem"]:not([aria-disabled="true"])'
          )
        );
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next =
          event.key === 'ArrowDown'
            ? (index + 1) % items.length
            : event.key === 'ArrowUp'
              ? (index + items.length - 1) % items.length
              : event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? items.length - 1
                  : -1;
        if (next >= 0 && items[next]) {
          event.preventDefault();
          items[next].focus();
        }
      }}
    >
      {children}
    </div>
  );
}
