/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowRight,
  ArrowUpNarrowWide,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
  Layers,
  LoaderCircle,
  Pen,
  Repeat2,
  Save,
  Trash2,
  X
} from 'lucide-react';
import { Dom, Input, slotContent } from '../settings-react/primitives';
import { popovers } from '$lib/components/popover/popover';
import { CLOSE_POPOVER } from '$lib/data/events';
export { Dom, Input };
export {
  SurfaceEvents,
  Head,
  Button,
  CloseButton,
  Sheet,
  Dialog,
  swipe,
  StyleSheetRenderer,
  useLatest,
  useReaderBindings,
  ReaderScope,
  type ReaderViewProps
} from '../reader-react/dom';
export { Menu } from '../library-react/primitives';
export { AppNav } from '../library-react/navigation';
import { Menu } from '../library-react/primitives';
import { Button } from '../reader-react/dom';
export function ActionMenu({
  label,
  title = '',
  disabled,
  variant = 'outline',
  iconOnly,
  children
}: Props) {
  return (
    <Menu.Root>
      <Menu.Trigger
        child={({ props }: { props: Record<string, any> }) => (
          <Button
            {...props}
            disabled={disabled}
            variant={variant}
            className={iconOnly ? 'size-[44px] min-h-[44px] rounded-full p-0' : 'min-h-9'}
            aria-label={title || label}
            title={title || label}
          >
            {!iconOnly && label}
            <ChevronDown aria-hidden="true" className={iconOnly ? 'size-[24px]' : 'size-3.5'} />
          </Button>
        )}
      />
      <Menu.Content className="max-h-[min(75dvh,36rem)] w-64 max-w-[calc(100vw-1rem)] overflow-y-auto">
        {children}
      </Menu.Content>
    </Menu.Root>
  );
}
type Props = Record<string, any> & { children?: React.ReactNode };
const glyphs: Record<string, React.ComponentType<any>> = {
  faSpinner: LoaderCircle,
  faLeftLong: ArrowLeft,
  faRightLong: ArrowRight,
  faChevronLeft: ChevronLeft,
  faChevronRight: ChevronRight,
  faClose: X,
  faXmark: X,
  faFloppyDisk: Save,
  faPen: Pen,
  faTrash: Trash2,
  faLayerGroup: Layers,
  faRepeat: Repeat2,
  faArrowDownWideShort: ArrowDownWideNarrow,
  faArrowUpShortWide: ArrowUpNarrowWide,
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowRight,
  ArrowUpNarrowWide,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
  Layers,
  LoaderCircle,
  Pen,
  Repeat2,
  Save,
  Trash2,
  X
};
export function Icon({ name, ...props }: Props) {
  const Glyph = glyphs[name] ?? Info;
  return <Glyph aria-hidden="true" {...props} />;
}
export function AppIcon({ icon, spin, className = '', ...props }: Props) {
  return <Icon {...props} name={icon} className={`${className} ${spin ? 'animate-spin' : ''}`} />;
}

/** React equivalent of the original externally anchored popover. The imperative
 * handle is stable; all callbacks read the latest props to avoid stale closures. */
export interface PopoverHandle {
  openAt(reference: HTMLElement): void;
  close(restoreFocus?: boolean): void;
  toggleOpen(reference?: HTMLElement | Event): void;
}
type PopoverProps = Props & {
  bindings?: {
    this?: (value: PopoverHandle | undefined) => void;
    isOpen?: (value: boolean) => void;
  };
  events?: { open?: (event: { detail: undefined }) => void };
};
export function Popover(props: PopoverProps) {
  const live = useRef(props);
  live.current = props;
  const id = useRef(Symbol('statistics-popover')).current;
  const alive = useRef(false),
    openRef = useRef(false);
  const anchor = useRef<HTMLElement | null>(null),
    trigger = useRef<HTMLButtonElement | null>(null),
    panel = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false),
    [position, setPosition] = useState<React.CSSProperties>({});
  const api = useMemo(() => {
    const change = (next: boolean, restoreFocus = true) => {
      if (!alive.current) return;
      const previous = openRef.current;
      openRef.current = next;
      setOpen(next);
      live.current.bindings?.isOpen?.(next);
      if (next) {
        if (live.current.singlePopover !== false) popovers.replace(id);
        else popovers.add(id);
        if (!previous)
          queueMicrotask(() => {
            if (alive.current && openRef.current)
              live.current.events?.open?.({ detail: undefined });
          });
      } else {
        popovers.remove(id);
        if (previous && restoreFocus && (live.current.restoreAnchorFocus || !anchor.current))
          (anchor.current ?? trigger.current)?.focus({ preventScroll: true });
      }
    };
    return {
      openAt(reference: HTMLElement) {
        anchor.current = reference;
        change(true);
      },
      close(restoreFocus = true) {
        change(false, restoreFocus);
      },
      toggleOpen(reference?: HTMLElement | Event) {
        if (reference instanceof HTMLElement) anchor.current = reference;
        change(!openRef.current);
      }
    };
  }, [id]);
  useLayoutEffect(() => {
    alive.current = true;
    live.current.bindings?.this?.(api);
    return () => {
      alive.current = false;
      openRef.current = false;
      popovers.remove(id);
      live.current.bindings?.this?.(undefined);
    };
  }, [api, id]);
  useEffect(
    () =>
      popovers.subscribe((ids) => {
        if (live.current.singlePopover !== false && openRef.current && !ids.includes(id)) {
          openRef.current = false;
          setOpen(false);
          live.current.bindings?.isOpen?.(false);
        }
      }),
    [id]
  );
  useEffect(() => {
    if (props.isOpen !== undefined && !!props.isOpen !== openRef.current) {
      if (props.isOpen) api.openAt(anchor.current ?? trigger.current!);
      else api.close(false);
    }
  }, [props.isOpen, api]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const reference = anchor.current ?? trigger.current,
        content = panel.current;
      if (!reference || !content) return;
      const rect = reference.getBoundingClientRect(),
        p = live.current;
      const side = (p.placement ?? 'top').split('-')[0],
        align = (p.placement ?? 'top').split('-')[1];
      const gap = p.yOffset ?? 10;
      let left =
        align === 'start'
          ? rect.left
          : align === 'end'
            ? rect.right - content.offsetWidth
            : rect.left + (rect.width - content.offsetWidth) / 2;
      let top = side === 'bottom' ? rect.bottom + gap : rect.top - content.offsetHeight - gap;
      if (side === 'left' || side === 'right') {
        left = side === 'left' ? rect.left - content.offsetWidth - gap : rect.right + gap;
        top = rect.top;
      }
      if (top < 8 && (p.fallbackPlacements?.length ?? 1)) top = rect.bottom + gap;
      setPosition({
        position: 'fixed',
        zIndex: 70,
        left: Math.max(
          8,
          Math.min(left + (p.xOffset ?? 0), window.innerWidth - content.offsetWidth - 8)
        ),
        top: Math.max(8, Math.min(top, window.innerHeight - content.offsetHeight - 8))
      });
    };
    place();
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (
        !panel.current?.contains(target) &&
        !(anchor.current ?? trigger.current)?.contains(target)
      )
        api.close(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        api.close(true);
      }
    };
    const close = () => api.close(true);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key, true);
    panel.current?.addEventListener(CLOSE_POPOVER, close);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    if (panel.current) observer?.observe(panel.current);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key, true);
      panel.current?.removeEventListener(CLOSE_POPOVER, close);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      observer?.disconnect();
    };
  }, [open, api, props.children]);
  const icons = slotContent(props.children, 'icon') as React.ReactNode[],
    defaults = slotContent(props.children) as React.ReactNode[];
  return (
    <>
      <Dom as="div" data-popover className="flex items-center" styleText={props.containerStyles}>
        {icons.length > 0 && (
          <Dom as="div" styleText={props.innerContainerStyles}>
            {defaults}
          </Dom>
        )}
        {(icons.length > 0 || defaults.length > 0) && (
          <Dom
            as="button"
            elementRef={(value: HTMLButtonElement | null) => {
              trigger.current = value;
            }}
            type="button"
            aria-label={props.label || props.contentText || undefined}
            aria-expanded={open}
            aria-haspopup={props.dialog ? 'dialog' : undefined}
            className="inline-flex min-h-8 items-center gap-2 rounded-xl px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            styleText={props.innerContainerStyles}
            onClick={() => api.toggleOpen()}
            onMouseEnter={
              props.eventType && props.eventType !== 'click'
                ? () => api.openAt(trigger.current!)
                : undefined
            }
          >
            {icons.length ? icons : defaults}
          </Dom>
        )}
      </Dom>
      {open &&
        createPortal(
          <div className="react-statistics-statistics-heatmap react-statistics-statistics-summary react-statistics-statistics-summary-header">
            <Dom
              as="div"
              elementRef={(value: HTMLDivElement | null) => {
                panel.current = value;
              }}
              data-popover
              data-ui-overlay="open"
              role={props.dialog ? 'dialog' : undefined}
              aria-label={props.label || undefined}
              style={position}
              styleText={props.contentStyles}
              className="z-[70] max-h-[75dvh] max-w-[min(32rem,90vw)] overflow-auto rounded-2xl border border-border bg-popover p-2 text-sm text-popover-foreground shadow-lg outline-none"
            >
              {props.contentText ? (
                <p className="p-2 whitespace-pre-wrap">{props.contentText}</p>
              ) : (
                slotContent(props.children, 'content')
              )}
            </Dom>
          </div>,
          document.body
        )}
    </>
  );
}
