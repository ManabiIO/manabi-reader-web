/** @license BSD-3-Clause; Copyright (c) 2026, ッツ Reader Authors */
import React, { Children, Fragment, createContext, isValidElement, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, CircleHelp, CloudUpload, Download, Ellipsis, Info, LoaderCircle, MoveVertical, Pencil, Plus, RefreshCw, Save, SlidersHorizontal, SquarePen, Table, Trash2, TriangleAlert, Upload, X } from 'lucide-react';
const Lucide = { ChevronLeft, ChevronRight, CircleHelp, CloudUpload, Download, Ellipsis, Info, LoaderCircle, MoveVertical, Pencil, Plus, RefreshCw, Save, SlidersHorizontal, SquarePen, Table, Trash2, TriangleAlert, Upload, X };
import { goto } from '$app/navigation';
import { cn } from '$lib/utils';
import { buttonVariants } from '../snippets-react/button-styles';
import type { VariantProps } from 'tailwind-variants';
import { Dom as ReaderDom } from '../reader-react/dom';
import { Menu } from '../library-react/primitives';
import { AppNav, ActionMenu } from '../library-react/navigation';
import { CLOSE_POPOVER } from '$lib/data/events';
export { SurfaceEvents, Head, useLatest, useReaderBindings, type ReaderViewProps } from '../reader-react/dom';
export { Menu, AppNav, ActionMenu };
type Props = Record<string, any> & { children?: ReactNode };

/** Native form bindings keep the value update ahead of the original handler,
 * including checkbox groups and numeric selects used by migration target IDs. */
export function Dom({ as = 'div', bindings = {}, events = {}, group, elementRef, children, ...props }: Props) {
  const handlers = { ...events };
  const chain = (name: string, before: (event: any) => void) => {
    const after = handlers[name];
    handlers[name] = (event: Event) => { before(event); after?.(event); };
  };
  const setValue = (event: any) => {
    const input = event.currentTarget;
    bindings.value?.(input.multiple ? [...input.selectedOptions].map((option: HTMLOptionElement) => option.value)
      : ['number', 'range'].includes(input.type) ? input.value === '' ? undefined : input.valueAsNumber
      : as === 'select' && typeof props.value === 'number' ? Number(input.value) : input.value);
  };
  if (bindings.value) {
    chain(as === 'select' ? 'change' : 'input', setValue);
    if (props.type !== 'file') props.value ??= '';
    props.onChange ??= () => {};
  }
  if (bindings.checked) { chain('change', event => bindings.checked(event.currentTarget.checked)); props.checked ??= false; props.onChange ??= () => {}; }
  if (bindings.files) chain('change', event => bindings.files(event.currentTarget.files));
  if (bindings.group) {
    props.checked = props.type === 'radio' ? Object.is(group, props.value) : (group ?? []).includes(props.value);
    chain('change', event => bindings.group(props.type === 'radio' ? props.value : event.currentTarget.checked ? [...(group ?? []), props.value] : (group ?? []).filter((item: unknown) => item !== props.value)));
    props.onChange ??= () => {};
  }
  if (props.type === 'file') delete props.value;
  const ref = (node: HTMLElement | null) => { elementRef?.(node); bindings.ref?.(node); bindings.this?.(node); };
  return <ReaderDom as={as} {...props} events={handlers} elementRef={ref}>{children}</ReaderDom>;
}
export function Button({ href, variant = 'default', size = 'default', shape = 'auto', className = '', disabled = false, tabIndex, tabindex, onClick, events = {}, children, ...props }: Props & VariantProps<typeof buttonVariants>) {
  const click = onClick ?? events.click;
  const handle = (event: MouseEvent) => {
    if (disabled) { event.preventDefault(); event.stopPropagation(); return; }
    click?.(event);
    if (href && !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && !props.target && (props.download === undefined || props.download === false) && !String(props.rel ?? '').split(/\s+/).includes('external') && new URL(href, location.href).origin === location.origin) { event.preventDefault(); void goto(href); }
  };
  return <Dom as={href ? 'a' : 'button'} type={href ? undefined : 'button'} {...props} href={disabled ? undefined : href} disabled={href ? undefined : disabled} aria-disabled={href ? disabled || props['aria-disabled'] : undefined} role={href && disabled ? 'link' : props.role} tabIndex={disabled && href ? -1 : tabIndex ?? tabindex ?? 0} data-slot="button" data-variant={variant} data-size={size} data-shape={shape} className={cn('settings-button', buttonVariants({ variant, size, shape }), className)} events={{ ...events, click: handle }}>{children}</Dom>;
}
export function Input({ className = '', ...props }: Props) { return <Dom as="input" {...props} data-slot="input" className={`bg-background border-input focus-visible:border-ring focus-visible:ring-ring/30 min-h-[44px] rounded-[10px] border px-3 py-2 text-base focus-visible:ring-3 md:text-sm w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 ${className}`}/>; }
export function Switch({ checked, onCheckedChange, className = '', ...props }: Props & { checked?: boolean; onCheckedChange?: (checked: boolean) => void }) { return <button {...props} type="button" role="switch" aria-checked={!!checked} data-state={checked ? 'checked' : 'unchecked'} className={`settings-switch ${className}`} onClick={() => onCheckedChange?.(!checked)}><span/></button>; }
export const Field = {
  Field: ({ children, ...props }: Props) => <div {...props} data-slot="field" className={`flex min-w-0 flex-col gap-3 ${props.className ?? ''}`}>{children}</div>,
  Description: ({ children, ...props }: Props) => <p {...props} data-slot="field-description" className={`text-sm text-muted-foreground ${props.className ?? ''}`}>{children}</p>
};

export function Slot({ children }: { name?: string; children?: ReactNode }) { return <>{children}</>; }
export function slotContent(children: ReactNode, name?: string): ReactNode {
  const values: ReactNode[] = [];
  Children.forEach(children, child => {
    if (isValidElement<Props>(child) && child.type === Fragment) { values.push(slotContent(child.props.children, name)); return; }
    const slot = isValidElement<Props>(child) ? child.type === Slot ? child.props.name : child.props.slot : undefined;
    if (slot === name) values.push(child);
  });
  return values;
}
export function DialogTemplate({ children }: Props) {
  return <section className="ui-panel writing-horizontal-tb min-w-0 rounded-3xl bg-popover p-5 text-popover-foreground sm:p-6"><h2 className="mb-5 min-w-0 break-words text-lg font-semibold">{slotContent(children, 'header')}</h2>{slotContent(children, 'content')}<footer className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">{slotContent(children, 'footer')}</footer></section>;
}
const glyphs: Record<string, keyof typeof Lucide> = {faCircleQuestion: 'CircleHelp', faCloudArrowUp: 'CloudUpload', faPenToSquare: 'SquarePen', faPlus: 'Plus', faSpinner: 'LoaderCircle', faTableList: 'Table', faTrash: 'Trash2', faTriangleExclamation: 'TriangleAlert', faCancel: 'X', faChevronLeft: 'ChevronLeft', faChevronRight: 'ChevronRight', faEdit: 'Pencil', faRotate: 'RefreshCw', faSave: 'Save', faArrowsUpDown: 'MoveVertical', SlidersHorizontal: 'SlidersHorizontal', CaretLeftIcon: 'ChevronLeft', faDownload: 'Download', faUpload: 'Upload', faXmark: 'X', faEllipsis: 'Ellipsis'};
export function Icon({ name, className = '', size = 20, ...props }: Props) { const Glyph = (Lucide as any)[glyphs[name] ?? name] ?? Lucide.Info; return <Glyph {...props} aria-hidden="true" size={size} className={className}/>; }
export function AppIcon({ icon, spin, ...props }: Props) { return <Icon {...props} name={icon} className={`${props.className ?? ''} ${spin ? 'animate-spin' : ''}`}/>; }

/** Click/hover popover with bounded positioning, keyboard dismissal and focus
 * restoration. Content remains in the originating settings CSS scope. */
export function Popover({ children, label, contentText = '', dialog = false, eventType = 'click', containerStyles, innerContainerStyles, contentStyles, events, bindings, isOpen, ...props }: Props) {
  const [open, setOpen] = useState(!!isOpen); const anchor = useRef<HTMLButtonElement | null>(null); const panel = useRef<HTMLDivElement | null>(null); const [position, setPosition] = useState<React.CSSProperties>({});
  const change = (value: boolean) => { setOpen(value); bindings?.isOpen?.(value); if (value) events?.open?.({ detail: undefined }); };
  useEffect(() => { if (isOpen !== undefined) setOpen(!!isOpen); }, [isOpen]);
  useLayoutEffect(() => {
    if (!open) return;
    const root = anchor.current, content = panel.current; if (!root || !content) return;
    const place = () => { const r = root.getBoundingClientRect(); setPosition({ position: 'fixed', zIndex: 70, left: Math.max(8, Math.min(r.left, window.innerWidth - content.offsetWidth - 8)), top: Math.max(8, Math.min(r.bottom + 10, window.innerHeight - content.offsetHeight - 8)) }); };
    place();
    const outside = (event: Event) => { if (!root.contains(event.target as Node) && !content.contains(event.target as Node)) change(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); change(false); root.focus(); } };
    const close = () => { change(false); root.focus(); };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key); content.addEventListener(CLOSE_POPOVER, close); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); content.removeEventListener(CLOSE_POPOVER, close); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  const icons = slotContent(children, 'icon') as ReactNode[];
  return <><div data-popover className="flex items-center">{icons.length > 0 && slotContent(children)}<button ref={anchor} type="button" aria-label={label || contentText || 'More information'} aria-expanded={open} aria-haspopup={dialog ? 'dialog' : undefined} className="inline-flex min-h-8 items-center justify-center rounded-xl px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => change(!open)} onMouseEnter={eventType !== 'click' ? () => change(true) : undefined}>{icons.length ? icons : slotContent(children)}</button></div>{open && createPortal(<div ref={panel} data-popover data-ui-overlay="open" role={dialog ? 'dialog' : undefined} aria-label={label || undefined} style={position} className="settings-popover max-h-[75dvh] max-w-[min(32rem,90vw)] overflow-auto rounded-2xl border border-border bg-popover p-2 text-sm text-popover-foreground shadow-lg outline-none">{contentText ? <p className="whitespace-pre-wrap p-2">{contentText}</p> : slotContent(children, 'content')}</div>, document.body)}</>;
}
