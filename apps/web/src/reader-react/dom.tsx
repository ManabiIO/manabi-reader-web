/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import './primitives.css';
import React, {
  createContext,
  createElement,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  Undo2,
  ChevronLeft,
  ChevronRight,
  List,
  Type,
  AlignLeft,
  AlignJustify,
  Search,
  Bookmark,
  Highlighter,
  NotebookPen,
  Trash2,
  Upload,
  Download,
  Check,
  CircleCheck,
  Maximize,
  Minimize,
  Settings,
  Ellipsis,
  ArrowLeftRight,
  Crosshair,
  MapPin,
  BookOpen,
  Images,
  ChartColumn,
  Info,
  Play,
  Pause,
  Repeat2,
  History,
  Save,
  CloudAlert,
  LoaderCircle,
  Headphones,
  X
} from 'lucide-react';
import { buttonVariants } from '../snippets-react/button-styles';
import { cn } from '$lib/utils';
import { HtmlReadiness } from './html-readiness';
import type { ControlledReader } from './controller';

export type ReaderEvents = Record<string, ((event: any) => void) | undefined>;
export interface ReaderViewProps {
  events?: ReaderEvents;
  bindings?: Record<string, ((value: any) => void) | undefined>;
}
export function useReaderBindings(
  c: (ControlledReader & Record<string, any>) | undefined,
  props: ReaderViewProps
) {
  const ref = useRef(props);
  ref.current = props;
  const prior = useRef<Record<string, unknown>>({});
  const owner = useRef<typeof c>(undefined);
  useLayoutEffect(() => {
    if (!c) return;
    if (owner.current !== c) {
      owner.current = c;
      prior.current = {};
      // Initial parent inputs are already applied by the controller factory.
      // Reading those defaults must not turn a mount into a persisted edit.
      for (const name of Object.keys(ref.current.bindings ?? {}))
        if (Object.hasOwn(ref.current, name))
          prior.current[name] = (ref.current as Record<string, unknown>)[name];
    }
    ref.current.bindings?.this?.(c);
    return () => {
      ref.current.bindings?.this?.(undefined);
      // Keep the same owner's publication baseline through Strict Mode replay.
      // A replacement controller receives a fresh baseline on the next setup.
    };
  }, [c]);
  useLayoutEffect(() => {
    if (!c) return;
    for (const [name, setter] of Object.entries(ref.current.bindings ?? {})) {
      if (name === 'this' || !setter || Object.is(prior.current[name], c[name])) continue;
      prior.current[name] = c[name];
      if (
        Object.hasOwn(ref.current, name) &&
        Object.is((ref.current as Record<string, unknown>)[name], c[name])
      )
        continue;
      setter(c[name]);
    }
  });
}
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

interface ControlProps {
  [key: string]: any;
  children?: React.ReactNode;
  elementRef?: (value: any) => void;
  onInteractOutside?: (event: any) => void;
  onEscapeKeydown?: (event: KeyboardEvent) => void;
  onOpenChange?: (value: boolean) => void;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onClick?: (event: any) => void;
  onChange?: (event: any) => void;
  onInput?: (event: any) => void;
  onKeyDown?: (event: any) => void;
  onKeyUp?: (event: any) => void;
  onSelect?: (event: any) => void;
  onCompositionStart?: (event: any) => void;
  onCompositionEnd?: (event: any) => void;
  child?: (value: { props: Record<string, unknown> }) => React.ReactNode;
  bindings?: Record<string, (value: any) => void>;
  events?: ReaderEvents;
}

/** DOM event/action lifetimes are attached once per element and read current
 * handlers. This also supports custom EPUB/extension events across documents. */
export function Dom({
  as = 'div',
  events,
  actions,
  elementRef,
  ref: externalRef,
  bindings,
  html,
  htmlIdentity,
  onHtmlLoad,
  styleText,
  children,
  ...props
}: ControlProps) {
  const node = useRef<HTMLElement | null>(null);
  const htmlPayload = useMemo(() => ({ __html: html }), [html, htmlIdentity]);
  const live = useLatest({ events, elementRef, externalRef, bindings, onHtmlLoad, actions });
  const assigned = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (assigned.current === node.current) return;
    assigned.current = node.current;
    live.current.elementRef?.(node.current);
    live.current.bindings?.ref?.(node.current);
    const applyExternalRef = (value: HTMLElement | null) => {
      const target = live.current.externalRef;
      if (typeof target === 'function') target(value);
      else if (target && 'current' in target) target.current = value;
    };
    applyExternalRef(node.current);
    return () => {
      live.current.elementRef?.(null);
      live.current.bindings?.ref?.(null);
      applyExternalRef(null);
      assigned.current = null;
    };
  }, []);
  const names = Object.keys(events ?? {})
    .sort()
    .join('|');
  useEffect(() => {
    const el = node.current;
    if (!el) return;
    const listeners = names
      ? names.split('|').map((name) => {
          const handler = (event: Event) => live.current.events?.[name]?.(event);
          el.addEventListener(name, handler, { passive: false });
          return () => el.removeEventListener(name, handler);
        })
      : [];
    return () => listeners.forEach((stop) => stop());
  }, [names]);
  const actionLifetimes = useRef<Array<{ action: any; result: any; options: any }>>([]);
  useEffect(() => {
    const el = node.current;
    if (!el) return;
    const next = live.current.actions ?? [];
    for (let index = 0; index < Math.max(next.length, actionLifetimes.current.length); index++) {
      const [action, options] = next[index] ?? [];
      const previous = actionLifetimes.current[index];
      if (previous?.action === action) {
        previous.result?.update?.(options);
        continue;
      }
      previous?.result?.destroy?.();
      if (typeof action === 'function') {
        // Preserve multi-click timers through progress renders while allowing
        // an action callback to see the latest render's options.
        const current = (position?: number) =>
          position === undefined
            ? live.current.actions?.[index]?.[1]
            : live.current.actions?.[index]?.[1]?.[position];
        const stable =
          typeof options === 'function'
            ? (...args: any[]) => current()?.(...args)
            : Array.isArray(options) && options.every((item) => typeof item === 'function')
              ? options.map(
                  (_: unknown, position: number) =>
                    (...args: any[]) =>
                      current(position)?.(...args)
                )
              : options;
        actionLifetimes.current[index] = { action, options, result: action(el, stable) };
      }
    }
    actionLifetimes.current.length = next.length;
  });
  useEffect(
    () => () => {
      for (const lifetime of actionLifetimes.current) lifetime.result?.destroy?.();
      actionLifetimes.current = [];
    },
    []
  );
  const previousHtmlIdentity = useRef(htmlIdentity);
  useLayoutEffect(() => {
    if (html === undefined) return;
    if (!Object.is(previousHtmlIdentity.current, htmlIdentity) && node.current) {
      // Equal text in two spine resources is still a new mounted occurrence.
      // Retire ruby/spoiler mutations and rebuild its geometry owner.
      node.current.innerHTML = html;
      previousHtmlIdentity.current = htmlIdentity;
    }
    const readiness = new HtmlReadiness(
      (callback) => window.requestAnimationFrame(callback),
      (frame) => window.cancelAnimationFrame(frame),
      () => live.current.onHtmlLoad?.()
    );
    readiness.update(html, htmlIdentity);
    return () => readiness.destroy();
  }, [html, htmlIdentity]);
  useLayoutEffect(() => {
    if (styleText && node.current) node.current.style.cssText += styleText;
  }, [styleText]);
  const rawProps: any = { ...props, ref: node };
  for (const [name, setter] of Object.entries(bindings ?? {}) as [
    string,
    (value: unknown) => void
  ][]) {
    if (name === 'value' || name === 'checked') {
      rawProps[name] ??= name === 'value' ? '' : false;
      rawProps.onChange = (event: React.ChangeEvent<HTMLInputElement>) =>
        setter(
          name === 'checked'
            ? event.target.checked
            : ['number', 'range'].includes(event.target.type)
              ? event.target.value === ''
                ? undefined
                : event.target.valueAsNumber
              : event.target.value
        );
    } else if (name === 'files')
      rawProps.onChange = (event: React.ChangeEvent<HTMLInputElement>) =>
        setter(event.target.files);
  }
  if (html !== undefined) rawProps.dangerouslySetInnerHTML = htmlPayload;
  return createElement(as, rawProps, html === undefined ? children : undefined);
}

export function SurfaceEvents({
  target,
  events = {},
  bindings = {}
}: {
  target: 'window' | 'document' | 'body';
  events?: ReaderEvents;
  bindings?: Record<string, (value: any) => void>;
}) {
  const latest = useLatest({ events, bindings });
  const names = Object.keys(events).sort().join('|');
  useEffect(() => {
    const surface = target === 'window' ? window : target === 'body' ? document.body : document;
    const stops = names
      ? names.split('|').map((name) => {
          const fn = (event: Event) => latest.current.events[name]?.(event);
          surface.addEventListener(name, fn, { passive: false });
          return () => surface.removeEventListener(name, fn);
        })
      : [];
    const update = () => {
      for (const [name, setter] of Object.entries(latest.current.bindings))
        setter((surface as any)[name]);
    };
    update();
    for (const event of ['resize', 'visibilitychange', 'scroll']) {
      surface.addEventListener(event, update);
      stops.push(() => surface.removeEventListener(event, update));
    }
    return () => stops.forEach((stop) => stop());
  }, [target, names]);
  return null;
}

export function Head({ children }: { children?: React.ReactNode }) {
  return createPortal(children, document.head);
}
export function StyleSheetRenderer({ styleSheet }: { styleSheet?: string }) {
  return <style>{styleSheet}</style>;
}

export function Button({
  className = '',
  variant = 'default',
  size = 'default',
  shape = 'auto',
  href,
  disabled,
  tabIndex,
  tabindex,
  onClick,
  events,
  bindings,
  children,
  ...props
}: ControlProps) {
  const click = (event: MouseEvent) => {
    if (disabled) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    (onClick ?? events?.click)?.(event);
  };
  return (
    <Dom
      as={href ? 'a' : 'button'}
      type={href ? undefined : 'button'}
      {...props}
      href={disabled ? undefined : href}
      disabled={href ? undefined : disabled}
      aria-disabled={href ? disabled || props['aria-disabled'] : props['aria-disabled']}
      role={href && disabled ? 'link' : props.role}
      tabIndex={href && disabled ? -1 : (tabIndex ?? tabindex ?? 0)}
      events={{ ...events, click }}
      bindings={bindings}
      className={cn(
        'reader-button',
        `reader-button-${variant}`,
        buttonVariants({ variant, size, shape }),
        className
      )}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-shape={shape}
    >
      {children}
    </Dom>
  );
}
export function CloseButton({ className = '', ...props }: ControlProps) {
  return (
    <Button
      aria-label="Close"
      {...props}
      variant="secondary"
      size="icon-lg"
      shape="circle"
      data-modal-dismiss=""
      className={`size-[44px] min-h-[44px] min-w-[44px] text-muted-foreground hover:text-foreground pointer-coarse:min-h-[44px] pointer-coarse:min-w-[44px] ${className}`}
    >
      <X className="size-[18px]" strokeWidth={3} aria-hidden="true" />
    </Button>
  );
}

const icons: Record<string, React.ComponentType<any>> = {
  X,
  XIcon: X,
  ArrowLeft,
  ArrowUUpLeft: Undo2,
  CaretLeft: ChevronLeft,
  CaretRight: ChevronRight,
  ChevronLeft,
  ChevronRight,
  List,
  TextAa: Type,
  TextAlignLeft: AlignLeft,
  TextAlignJustify: AlignJustify,
  MagnifyingGlass: Search,
  Bookmark,
  BookmarkSimple: Bookmark,
  Highlighter,
  NotePencil: NotebookPen,
  Trash: Trash2,
  UploadSimple: Upload,
  DownloadSimple: Download,
  Check,
  CheckCircle: CircleCheck,
  ArrowsOut: Maximize,
  ArrowsIn: Minimize,
  Gear: Settings,
  DotsThree: Ellipsis,
  ArrowsLeftRight: ArrowLeftRight,
  Crosshair,
  MapPin,
  BookOpen,
  Images,
  ChartBar: ChartColumn,
  Info,
  faPlay: Play,
  faPause: Pause,
  faBookmark: Bookmark,
  faChevronLeft: ChevronLeft,
  faChevronRight: ChevronRight,
  faRepeat: Repeat2,
  faClockRotateLeft: History,
  faFloppyDisk: Save,
  faTrash: Trash2,
  faCloudBolt: CloudAlert,
  faSpinner: LoaderCircle,
  Headphones
};
export function Icon({ name, className = '', ...props }: any) {
  const Glyph = icons[name] ?? Info;
  return <Glyph {...props} aria-hidden="true" className={`reader-icon ${className}`} />;
}
export function AppIcon({ icon, spin, className, ...props }: any) {
  return (
    <Icon {...props} name={icon} className={`${className ?? ''} ${spin ? 'animate-spin' : ''}`} />
  );
}

const ScopeContext = createContext<string[]>([]);
export function ReaderScope({ name, children }: { name: string; children?: React.ReactNode }) {
  const parent = useContext(ScopeContext);
  return (
    <ScopeContext.Provider value={[...parent, name]}>
      <div className={name} style={{ display: 'contents' }}>
        {children}
      </div>
    </ScopeContext.Provider>
  );
}

const activeModalElements: HTMLElement[] = [];
const ModalContext = createContext<{
  open: boolean;
  close(): void;
  titleId: string;
  descriptionId: string;
}>({ open: false, close() {}, titleId: '', descriptionId: '' });
function ModalRoot({ open, onOpenChange, bindings, children }: ControlProps) {
  const id = useId();
  return (
    <ModalContext.Provider
      value={{
        open: !!open,
        titleId: id + '-title',
        descriptionId: id + '-description',
        close: () => {
          onOpenChange?.(false);
          bindings?.open?.(false);
        }
      }}
    >
      {children}
    </ModalContext.Provider>
  );
}
function ModalContent({
  children,
  className = '',
  side = 'center',
  overlayProps,
  showCloseButton = true,
  closeDisabled,
  onCloseAutoFocus,
  onOpenAutoFocus,
  onEscapeKeydown,
  onInteractOutside,
  elementRef,
  bindings,
  ...props
}: ControlProps) {
  const modal = useContext(ModalContext);
  const scopes = useContext(ScopeContext);
  const node = useRef<HTMLElement | null>(null);
  const live = useLatest({
    modal,
    closeDisabled,
    onCloseAutoFocus,
    onOpenAutoFocus,
    onEscapeKeydown,
    onInteractOutside,
    elementRef,
    bindings
  });
  useEffect(() => {
    if (!modal.open) return;
    const previous = document.activeElement as HTMLElement | null;
    const ownedElement = node.current;
    if (ownedElement) activeModalElements.push(ownedElement);
    const event = new Event('openAutoFocus', { cancelable: true });
    live.current.onOpenAutoFocus?.(event);
    if (!event.defaultPrevented)
      node.current
        ?.querySelector<HTMLElement>('input,button,textarea,select,[tabindex="0"]')
        ?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (activeModalElements.at(-1) !== ownedElement || document.querySelector('dialog[open]'))
        return;
      if (event.key === 'Escape') {
        live.current.onEscapeKeydown?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        if (!live.current.closeDisabled) live.current.modal.close();
      }
      if (event.key === 'Tab') {
        const stops = Array.from(
          node.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]'
          ) ?? []
        ).filter((el) => el.getClientRects().length);
        const first = stops[0],
          last = stops.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      const wasTop = activeModalElements.at(-1) === ownedElement;
      const index = ownedElement ? activeModalElements.lastIndexOf(ownedElement) : -1;
      if (index >= 0) activeModalElements.splice(index, 1);
      if (!wasTop) return;
      const event = new Event('closeAutoFocus', { cancelable: true });
      live.current.onCloseAutoFocus?.(event);
      if (!event.defaultPrevented && previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [modal.open]);
  if (!modal.open) return null;
  return createPortal(
    <div
      className={[
        'reader-modal-backdrop',
        ...scopes,
        overlayProps?.className ?? overlayProps?.class ?? ''
      ].join(' ')}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !closeDisabled) {
          live.current.onInteractOutside?.(event);
          if (!event.defaultPrevented) modal.close();
        }
      }}
    >
      <Dom
        {...props}
        role="dialog"
        aria-labelledby={modal.titleId}
        aria-describedby={modal.descriptionId}
        data-slot={side === 'center' ? 'dialog-content' : 'sheet-content'}
        aria-modal="true"
        tabIndex={-1}
        data-side={side}
        className={`reader-modal reader-modal-${side} ${className}`}
        elementRef={(el: HTMLElement) => {
          node.current = el;
          live.current.elementRef?.(el);
          live.current.bindings?.ref?.(el);
        }}
      >
        {showCloseButton && (
          <CloseButton
            disabled={closeDisabled}
            className="absolute top-4 right-4"
            onClick={() => {
              if (!live.current.closeDisabled) modal.close();
            }}
          />
        )}
        {children}
      </Dom>
    </div>,
    document.body
  );
}
const div = ({ children, ...props }: ControlProps) => <Dom {...props}>{children}</Dom>;
const title = ({ children, className = '', ...props }: ControlProps) => {
  const modal = useContext(ModalContext);
  return (
    <Dom as="h2" id={modal.titleId} {...props} className={`text-lg font-semibold ${className}`}>
      {children}
    </Dom>
  );
};
const description = ({ children, className = '', ...props }: ControlProps) => {
  const modal = useContext(ModalContext);
  return (
    <Dom
      as="p"
      id={modal.descriptionId}
      {...props}
      className={`text-sm text-muted-foreground ${className}`}
    >
      {children}
    </Dom>
  );
};
export const Sheet = {
  Root: ModalRoot,
  Content: (props: ControlProps) => <ModalContent side="right" {...props} />,
  Header: div,
  Title: title,
  Description: description,
  Footer: div
};
export const Dialog = { ...Sheet, Content: ModalContent };

const MenuContext = createContext<{ open: boolean; setOpen(value: boolean): void }>({
  open: false,
  setOpen() {}
});
function MenuRoot({ open, defaultOpen = false, bindings, onOpenChange, children }: ControlProps) {
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  return (
    <MenuContext.Provider
      value={{
        open: open === undefined ? localOpen : !!open,
        setOpen: (value) => {
          setLocalOpen(value);
          bindings?.open?.(value);
          onOpenChange?.(value);
        }
      }}
    >
      {children}
    </MenuContext.Provider>
  );
}
function MenuTrigger({ child, children, ...props }: ControlProps) {
  const menu = useContext(MenuContext);
  const trigger = {
    ...props,
    'aria-haspopup': 'menu',
    'aria-expanded': menu.open,
    onClick: () => menu.setOpen(!menu.open)
  };
  return child ? child({ props: trigger }) : <Button {...trigger}>{children}</Button>;
}
function MenuContent({ children, className = '', onCloseAutoFocus, ...props }: ControlProps) {
  const menu = useContext(MenuContext);
  const ref = useRef<HTMLElement | undefined>(undefined);
  const latest = useLatest({ menu, onCloseAutoFocus });
  useEffect(() => {
    if (!menu.open) return;
    const trigger = document.activeElement as HTMLElement | null;
    const items = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []
      );
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        if (event.key === 'Escape') event.preventDefault();
        latest.current.menu.setOpen(false);
      }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const list = items();
        const index = list.indexOf(document.activeElement as HTMLElement);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? list.length - 1
              : (index + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
        list[next]?.focus();
      }
    };
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node) && !trigger?.contains(event.target as Node))
        latest.current.menu.setOpen(false);
    };
    document.addEventListener('keydown', handle);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      document.removeEventListener('keydown', handle);
      document.removeEventListener('pointerdown', outside, true);
      const event = new Event('closeAutoFocus', { cancelable: true });
      latest.current.onCloseAutoFocus?.(event);
      if (!event.defaultPrevented && trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [menu.open]);
  return menu.open ? (
    <Dom
      {...props}
      role="menu"
      data-slot="dropdown-menu-content"
      className={`reader-tools-menu ${className}`}
      elementRef={(el: HTMLElement) => {
        ref.current = el;
      }}
    >
      {children}
    </Dom>
  ) : null;
}
function MenuItem({ onSelect, children, ...props }: ControlProps) {
  const menu = useContext(MenuContext);
  return (
    <Button
      {...props}
      role="menuitem"
      onClick={(event: Event) => {
        onSelect?.(event);
        menu.setOpen(false);
      }}
    >
      {children}
    </Button>
  );
}
export const Menu = {
  Root: MenuRoot,
  Trigger: MenuTrigger,
  Content: MenuContent,
  Item: MenuItem,
  Separator: () => <hr />,
  Label: div
};

/** Pointer swipe ownership equivalent to the DOM reader's existing thresholds. */
export function swipe(
  el: HTMLElement,
  options: { minSwipeDistance?: number; timeframe?: number; touchAction?: string }
) {
  let start: { x: number; y: number; time: number } | undefined;
  const down = (event: PointerEvent) => {
    if (event.pointerType === 'touch')
      start = { x: event.clientX, y: event.clientY, time: performance.now() };
  };
  const up = (event: PointerEvent) => {
    if (!start) return;
    const prior = start;
    start = undefined;
    const dx = event.clientX - prior.x,
      dy = event.clientY - prior.y;
    if (
      performance.now() - prior.time > (options.timeframe ?? 500) ||
      Math.abs(dx) < (options.minSwipeDistance ?? 50) ||
      Math.abs(dx) <= Math.abs(dy)
    )
      return;
    el.dispatchEvent(
      new CustomEvent('swipe', { detail: { direction: dx < 0 ? 'left' : 'right' } })
    );
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  return {
    destroy() {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
    }
  };
}
