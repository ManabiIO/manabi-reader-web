/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { UiIcon } from './UiIcon';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ActionButton, Heading } from './ActionButton';
import { useUiTheme } from './theme';
import type { AnchoredPopoverProps } from './AnchoredPopover';
export type { AnchoredPopoverProps } from './AnchoredPopover';
/** Bounded nonmodal focus/position leaf: outside pointers retain the new
 * destination; keyboard dismissal restores the still-connected trigger. */
export function AnchoredPopover({
  visible,
  onClose,
  title,
  label,
  closeLabel,
  anchor,
  maxWidth = 320,
  maxHeight,
  padding = 16,
  showHeading = true,
  showClose = true,
  focusSelected = false,
  bodyScroll = true,
  children
}: AnchoredPopoverProps) {
  const { colors } = useUiTheme();
  const popup = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const restore = useRef(true);
  const visibleAnchor = useRef(anchor);
  if (visible) visibleAnchor.current = anchor;
  const [position, setPosition] = useState({ left: 16, top: 16 });
  useLayoutEffect(() => {
    if (!visible) return;
    const element = anchor as unknown as HTMLElement | null;
    const update = () => {
      const box = element?.getBoundingClientRect();
      const surface = popup.current?.getBoundingClientRect();
      if (!box || !surface) return;
      const left = Math.max(8, Math.min(innerWidth - surface.width - 8, box.left));
      const top =
        box.bottom + surface.height + 8 <= innerHeight
          ? box.bottom + 5
          : Math.max(8, box.top - surface.height - 5);
      setPosition((previous) =>
        previous.left === left && previous.top === top ? previous : { left, top }
      );
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [visible, anchor, title]);
  useEffect(() => {
    if (!visible) return;
    const element = anchor as unknown as HTMLElement | null;
    restore.current = true;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popup.current?.contains(target) || element?.contains(target)) return;
      restore.current = false;
      if (document.activeElement === element) element?.blur();
      close.current();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close.current();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key, true);
      if (
        restore.current &&
        element === (visibleAnchor.current as unknown as HTMLElement) &&
        element?.isConnected
      )
        element.focus({ preventScroll: true });
    };
  }, [visible, anchor]);
  useEffect(() => {
    if (!visible || !focusSelected) return;
    const frame = requestAnimationFrame(() => {
      const selected =
        popup.current?.querySelector<HTMLElement>('[aria-pressed="true"]') ??
        popup.current?.querySelector<HTMLElement>('button');
      selected?.focus();
      selected?.scrollIntoView?.({ block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, focusSelected]);
  if (!visible) return null;
  return createPortal(
    <div
      ref={popup}
      role="dialog"
      aria-label={label}
      className="heatmap-details"
      style={{
        position: 'fixed',
        zIndex: 80,
        ...position,
        boxSizing: 'border-box',
        width: `min(${maxWidth}px, calc(90vw - 2px))`,
        maxHeight: maxHeight ? `min(${maxHeight}px, calc(100dvh - 16px))` : 'calc(100dvh - 16px)',
        overflowY: bodyScroll ? 'auto' : 'hidden',
        overflowWrap: 'anywhere',
        padding,
        borderRadius: 12,
        border: `1px solid ${colors.border}`,
        boxShadow: '0 8px 30px rgba(0,0,0,.2)',
        background: colors.popover,
        color: colors.foreground
      }}
    >
      {(showHeading || showClose) && (
        <div
          className="heatmap-details-header"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 44px',
            alignItems: 'start',
            gap: 12,
            marginBottom: 12
          }}
        >
          {showHeading && (
            <Heading
              level={2}
              style={{
                fontSize: '1rem' as unknown as number,
                lineHeight: '1.5rem' as unknown as number,
                alignSelf: 'center',
                margin: 0
              }}
            >
              {title}
            </Heading>
          )}
          {showClose && (
            <ActionButton
              variant="ghost"
              size="icon-lg"
              shape="circle"
              accessibilityLabel={closeLabel}
              dataSet={{ modalDismiss: '' }}
              onPress={onClose}
            >
              <UiIcon name="close" size={18} />
            </ActionButton>
          )}
        </div>
      )}
      {children}
    </div>,
    document.body
  );
}
