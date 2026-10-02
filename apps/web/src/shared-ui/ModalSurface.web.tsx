/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { UiIcon } from './UiIcon';
import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { ModalSurfaceProps } from './ModalSurface';
import { ActionButton, Heading } from './ActionButton';
import { UiPresentation } from './Presentation';
const focusableSelector =
  'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';
const focusable = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (el) => el.getAttribute('aria-disabled') !== 'true' && !el.closest('[hidden]')
  );
let modalCount = 0;
let previousBodyOverflow = '';
export function ModalSurface({
  visible,
  onClose,
  title,
  accessibilityLabel,
  children,
  description,
  descriptionHidden,
  testID,
  maxWidth = 640,
  showClose = true,
  closeLabel = 'Close',
  closeDisabled = false,
  panelClassName,
  stickyChrome = false,
  footer,
  kind
}: ModalSurfaceProps & { kind: 'sheet' | 'dialog' }) {
  const ref = useRef<HTMLDialogElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const [chrome, setChrome] = useState({ sticky: false, header: 0, footer: 0 });
  const latest = useRef({ onClose, closeDisabled });
  latest.current = { onClose, closeDisabled };
  const titleId = useId();
  const descriptionId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!visible || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (modalCount++ === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    (dialog.querySelector<HTMLElement>('[autofocus]') ?? focusable(dialog)[0] ?? dialog).focus();
    const guardFocus = (event: FocusEvent) => {
      // A nested confirmation owns focus until it closes.
      const openDialogs = document.querySelectorAll('dialog[data-ui-modal][open]');
      if (openDialogs.item(openDialogs.length - 1) !== dialog) return;
      if (event.target instanceof Node && !dialog.contains(event.target))
        (focusable(dialog)[0] ?? dialog).focus();
    };
    document.addEventListener('focusin', guardFocus);
    return () => {
      document.removeEventListener('focusin', guardFocus);
      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
      if (--modalCount === 0) document.body.style.overflow = previousBodyOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [visible]);
  useLayoutEffect(() => {
    if (!visible || !stickyChrome) return;
    const measure = () => {
      const header = headerRef.current?.getBoundingClientRect().height ?? 0;
      const footerHeight = footerRef.current?.getBoundingClientRect().height ?? 0;
      const height = ref.current?.clientHeight || window.innerHeight;
      const sticky = header + footerHeight < height / 2 && height - header - footerHeight >= 44;
      setChrome((old) =>
        old.sticky === sticky && old.header === header && old.footer === footerHeight
          ? old
          : { sticky, header, footer: footerHeight }
      );
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (headerRef.current) observer?.observe(headerRef.current);
    if (footerRef.current) observer?.observe(footerRef.current);
    if (ref.current) observer?.observe(ref.current);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [visible, stickyChrome, footer]);
  if (!visible || typeof document === 'undefined') return null;
  const dismiss = () => {
    if (!latest.current.closeDisabled) latest.current.onClose();
  };
  const geometry: CSSProperties =
    kind === 'sheet'
      ? {
          inset: '0 0 0 auto',
          margin: 0,
          width: '100vw',
          height: '100dvh',
          maxHeight: '100dvh',
          borderRadius: 0
        }
      : {
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          margin: 0,
          width: 'calc(100vw - 32px)',
          maxHeight: 'calc(100dvh - 32px)',
          borderRadius: 16
        };
  return createPortal(
    <>
      <UiPresentation />
      <dialog
        ref={ref}
        tabIndex={-1}
        aria-modal="true"
        aria-label={accessibilityLabel}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        data-ui-modal={kind}
        data-slot={`${kind}-content`}
        data-testid={testID}
        onCancel={(event) => {
          event.preventDefault();
          dismiss();
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            dismiss();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            dismiss();
          }
          if (event.key === 'Tab') {
            const elements = focusable(event.currentTarget);
            const first = elements[0],
              last = elements[elements.length - 1];
            if (!first) {
              event.preventDefault();
              event.currentTarget.focus();
            } else if (
              event.shiftKey &&
              (document.activeElement === first || document.activeElement === event.currentTarget)
            ) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
        style={{
          position: 'fixed',
          boxSizing: 'border-box',
          padding: 0,
          scrollPaddingTop: chrome.sticky ? chrome.header + 12 : 20,
          scrollPaddingBottom: chrome.sticky ? chrome.footer + 12 : 20,
          border: '1px solid var(--border)',
          background: 'var(--popover)',
          color: 'var(--foreground)',
          overflow: 'auto',
          maxWidth: `min(${maxWidth}px, 100vw)`,
          ...geometry
        }}
      >
        <div
          className={panelClassName}
          data-sticky-chrome={stickyChrome ? String(chrome.sticky) : undefined}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            minWidth: 0,
            padding: 20,
            paddingBottom: 'max(20px, env(safe-area-inset-bottom))'
          }}
        >
          <div
            ref={headerRef}
            data-slot={`${kind}-header`}
            data-sticky-header={stickyChrome ? '' : undefined}
            style={{
              display: 'flex',
              position: chrome.sticky ? 'sticky' : 'static',
              top: 0,
              zIndex: 2,
              background: 'var(--popover)',
              margin: '-20px -20px 0',
              padding: '20px 20px 12px',
              borderBottom: stickyChrome ? '1px solid var(--border)' : undefined,
              flexDirection: 'row',
              flexWrap: 'wrap-reverse',
              alignItems: 'flex-start',
              gap: 12
            }}
          >
            <Heading
              id={titleId}
              style={{
                flexGrow: 1,
                flexBasis: 160,
                minWidth: 'min-content' as unknown as number,
                alignSelf: 'center'
              }}
            >
              {title}
            </Heading>
            {showClose ? (
              <ActionButton
                size="icon-lg"
                shape="circle"
                variant="ghost"
                accessibilityLabel={closeLabel}
                disabled={closeDisabled}
                onPress={dismiss}
                dataSet={{ modalDismiss: '' }}
                style={{ marginLeft: 'auto' }}
              >
                <UiIcon name="close" size={18} />
              </ActionButton>
            ) : null}
          </div>
          {description ? (
            <p
              id={descriptionId}
              style={
                descriptionHidden
                  ? {
                      position: 'absolute',
                      width: 1,
                      height: 1,
                      overflow: 'hidden',
                      clipPath: 'inset(50%)'
                    }
                  : { margin: 0, color: 'var(--muted-foreground)', fontSize: '0.875rem' }
              }
            >
              {description}
            </p>
          ) : null}
          {children}
          {footer ? (
            <div
              ref={footerRef}
              data-sticky-footer={stickyChrome ? '' : undefined}
              style={{
                position: chrome.sticky ? 'sticky' : 'static',
                bottom: 0,
                zIndex: 2,
                background: 'var(--popover)',
                margin: '0 -20px -20px',
                padding: '12px 20px max(20px, env(safe-area-inset-bottom))',
                borderTop: '1px solid var(--border)'
              }}
            >
              {footer}
            </div>
          ) : null}
        </div>
      </dialog>
    </>,
    document.body
  );
}
export function Sheet(props: ModalSurfaceProps) {
  return <ModalSurface {...props} kind="sheet" />;
}
export function Dialog(props: ModalSurfaceProps) {
  return <ModalSurface {...props} kind="dialog" />;
}
