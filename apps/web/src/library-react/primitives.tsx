/** @license BSD-3-Clause; Copyright (c) 2026, ッツ Reader Authors */
import { createContext, createElement, forwardRef, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties, type MouseEvent, type KeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { goto } from '$app/navigation';
type AnyProps = Record<string, any> & {
    children?: ReactNode;
    className?: string;
};
export const Button = forwardRef<HTMLElement, AnyProps>(function Button({ href, variant = 'default', size, className = '', children, onClick, ...props }, ref) {
    const classes = `library-button inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50 ${variant === 'default' ? 'bg-primary text-primary-foreground' : variant === 'outline' ? 'border border-input bg-background' : variant === 'secondary' ? 'bg-secondary text-secondary-foreground' : 'hover:bg-muted'} ${size === 'icon' ? 'min-w-11 px-2' : ''} ${className}`;
    const click = (event: MouseEvent) => { onClick?.(event); if (href && !event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !props.target && new URL(href, location.href).origin === location.origin) {
        event.preventDefault();
        void goto(href);
    } };
    return createElement(href ? 'a' : 'button', { ...props, ...(!href && { type: props.type ?? 'button' }), href, ref, className: classes, onClick: click }, children);
});
export const CloseButton = forwardRef<HTMLElement, AnyProps>(function CloseButton(props, ref) { return <Button {...props} ref={ref} variant="ghost" size="icon" aria-label={props['aria-label'] ?? 'Close'}>×</Button>; });
export function Icon({ className = '', weight: _weight, ...props }: AnyProps) { return <svg {...props} className={`size-5 ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 5h6l2 2 2-2h6v15h-6l-2 2-2-2H4zM12 7v15"/></svg>; }
type ActionResult = {
    update?(options: any): void;
    destroy?(): void;
} | void;
/** Reuse the framework-independent DOM interaction algorithms through React refs. */
export const Action = forwardRef<HTMLElement, AnyProps & {
    as: string;
    action: (node: any, options: any) => ActionResult;
    options?: any;
}>(function Action({ as, action, options, ...props }, forwarded) {
    const element = useRef<HTMLElement>(null), result = useRef<ActionResult>(undefined), current = useRef(options);
    current.current = options;
    useLayoutEffect(() => { if (element.current)
        result.current = action(element.current, current.current); return () => { result.current?.destroy?.(); }; }, [action]);
    useLayoutEffect(() => { result.current?.update?.(options); }, [options]);
    return createElement(as, { ...props, ref: (node: HTMLElement) => { element.current = node; if (typeof forwarded === 'function')
            forwarded(node);
        else if (forwarded)
            forwarded.current = node; } });
});
type DialogState = {
    open: boolean;
    change(open: boolean): void;
    title: string;
    description: string;
};
const DialogContext = createContext<DialogState | null>(null);
function DialogRoot({ open, onOpenChange = () => { }, children }: AnyProps) { const id = useId(); return <DialogContext.Provider value={{ open, change: onOpenChange, title: id + '-title', description: id + '-description' }}>{children}</DialogContext.Provider>; }
function DialogContent({ children, className = '', closeDisabled = false, showCloseButton = true, onOpenAutoFocus, onCloseAutoFocus, side: _side, ...props }: AnyProps) {
    const context = useContext(DialogContext)!;
    const ref = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLElement | null>(null);
    const latest = useRef({ onOpenAutoFocus, onCloseAutoFocus });
    latest.current = { onOpenAutoFocus, onCloseAutoFocus };
    useLayoutEffect(() => {
        if (!context.open)
            return;
        const dialog = ref.current;
        if (!dialog)
            return;
        trigger.current = document.activeElement as HTMLElement;
        dialog.showModal();
        let prevented = false;
        latest.current.onOpenAutoFocus?.({ preventDefault() { prevented = true; } });
        if (!prevented)
            (dialog.querySelector('[autofocus],input:not([type=checkbox]),button,[href]') as HTMLElement | null)?.focus({ preventScroll: true });
        return () => {
            dialog.close();
            let prevented = false;
            latest.current.onCloseAutoFocus?.({ preventDefault() { prevented = true; } });
            if (!prevented && trigger.current?.isConnected)
                trigger.current.focus({ preventScroll: true });
        };
    }, [context.open]);
    if (!context.open)
        return null;
    return createPortal(<dialog {...props} ref={ref} aria-labelledby={context.title} aria-describedby={context.description} data-slot="dialog-content" className={`library-react-dialog m-auto max-h-[90dvh] w-[min(96vw,36rem)] overflow-y-auto rounded-2xl border border-border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/40 ${className}`} onCancel={event => { event.preventDefault(); if (!closeDisabled)
        context.change(false); }} onClick={event => { if (event.target !== event.currentTarget || closeDisabled)
        return; const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)
        context.change(false); }}>{showCloseButton && <CloseButton className="absolute right-3 top-3" data-slot="dialog-close" disabled={closeDisabled} onClick={() => context.change(false)}/>} {children}</dialog>, document.body);
}
const block = (tag: string, slot: string, defaults = '') => function Block({ children, className = '', ...props }: AnyProps) { return createElement(tag, { ...props, 'data-slot': slot, className: `${defaults} ${className}` }, children); };
function DialogTitle(props: AnyProps) { const context = useContext(DialogContext)!; return <h2 {...props} id={context.title} data-slot="dialog-title" className={`pr-8 text-xl font-semibold ${props.className ?? ''}`}/>; }
function DialogDescription(props: AnyProps) { const context = useContext(DialogContext)!; return <p {...props} id={context.description} data-slot="dialog-description" className={`mt-2 text-sm text-muted-foreground ${props.className ?? ''}`}/>; }
export const Dialog = { Root: DialogRoot, Content: DialogContent, Header: block('header', 'dialog-header', 'mb-5'), Footer: block('footer', 'dialog-footer', 'mt-5 flex flex-wrap justify-end gap-2'), Title: DialogTitle, Description: DialogDescription };
export const Sheet = { ...Dialog };
type MenuState = {
    open: boolean;
    setOpen(open: boolean): void;
    trigger: RefObject<HTMLElement | null>;
    root: string;
    closeTree(): void;
};
const MenuContext = createContext<MenuState | null>(null);
function MenuRoot({ children }: AnyProps) { const parent = useContext(MenuContext); const id = useId(); const [open, setOpen] = useState(false); const trigger = useRef<HTMLElement>(null); return <MenuContext.Provider value={{ open, setOpen, trigger, root: parent?.root ?? id, closeTree() { setOpen(false); parent?.closeTree(); } }}>{children}</MenuContext.Provider>; }
function MenuTrigger({ child, children, ...rest }: AnyProps) { const context = useContext(MenuContext)!; const props = { ...rest, 'aria-haspopup': 'menu' as const, 'aria-expanded': context.open, 'data-slot': 'dropdown-menu-trigger', ref: (element: HTMLElement) => { context.trigger.current = element; }, onClick: () => context.setOpen(!context.open), onKeyDown: (e: KeyboardEvent) => { if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        context.setOpen(true);
    } } }; return child ? child({ props }) : <Button {...props}>{children}</Button>; }
function MenuContent({ children, className = '', align = 'end', side: _side, collisionPadding: _collisionPadding, ...props }: AnyProps) {
    const context = useContext(MenuContext)!;
    const ref = useRef<HTMLDivElement>(null);
    const [style, setStyle] = useState<CSSProperties>({});
    useLayoutEffect(() => {
        if (!context.open)
            return;
        const trigger = context.trigger.current, menu = ref.current;
        if (!trigger || !menu)
            return;
        const position = () => { const r = trigger.getBoundingClientRect(); const height = menu.getBoundingClientRect().height; setStyle({ position: 'fixed', zIndex: 70, top: Math.max(8, Math.min(r.bottom + 4, window.innerHeight - height - 8)), left: Math.max(8, Math.min(align === 'end' ? r.right - menu.offsetWidth : r.left, window.innerWidth - menu.offsetWidth - 8)), maxHeight: '80dvh', overflowY: 'auto' }); };
        position();
        (menu.querySelector('[role^=menuitem]:not([disabled])') as HTMLElement | null)?.focus();
        const outside = (event: Event) => { const target = event.target as Node; if (!menu.contains(target) && !trigger.contains(target) && (!(target instanceof Element) || target.closest('[data-menu-root]')?.getAttribute('data-menu-root') !== context.root))
            context.setOpen(false); };
        document.addEventListener('pointerdown', outside);
        window.addEventListener('resize', position);
        window.addEventListener('scroll', position, true);
        return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
    }, [context.open]);
    if (!context.open)
        return null;
    return createPortal(<div {...props} ref={ref} role="menu" data-menu-root={context.root} data-slot="dropdown-menu-content" className={`library-menu rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg ${className}`} style={style} onKeyDown={event => {
            const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role^=menuitem]:not([disabled])')];
            const index = items.indexOf(document.activeElement as HTMLElement);
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                items[next]?.focus();
            }
            else if (event.key === 'Escape' || event.key === 'Tab') {
                context.setOpen(false);
                if (event.key === 'Escape') {
                    event.preventDefault();
                    context.trigger.current?.focus();
                }
            }
        }}>{children}</div>, document.body);
}
function MenuItem({ children, onSelect, variant, disabled, ...props }: AnyProps) { const context = useContext(MenuContext)!; return <button {...props} type="button" role="menuitem" disabled={disabled} className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left hover:bg-muted focus:bg-muted ${variant === 'destructive' ? 'text-destructive' : ''} ${props.className ?? ''}`} onClick={event => { context.closeTree(); context.trigger.current?.focus(); onSelect?.(event); }}>{children}</button>; }
export const Menu = { RadioGroup, RadioItem, Sub: MenuRoot, SubTrigger: SubTrigger, SubContent: MenuContent, Root: MenuRoot, Trigger: MenuTrigger, Content: MenuContent, Item: MenuItem, Separator: () => <hr role="separator" className="my-1 border-border"/>, Label: block('div', 'dropdown-menu-label', 'px-3 py-2 text-xs text-muted-foreground') };
const RadioContext = createContext<{
    value: string;
    change(value: string): void;
}>({ value: '', change() { } });
function RadioGroup({ value, onValueChange, children }: AnyProps) { return <RadioContext.Provider value={{ value, change: onValueChange }}><div role="group">{children}</div></RadioContext.Provider>; }
function RadioItem({ value, children, disabled }: AnyProps) { const radio = useContext(RadioContext), menu = useContext(MenuContext)!; return <button role="menuitemradio" aria-checked={radio.value === value} disabled={disabled} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left hover:bg-muted focus:bg-muted" onClick={() => { radio.change(value); menu.closeTree(); menu.trigger.current?.focus(); }}><span aria-hidden="true">{radio.value === value ? '✓' : ''}</span>{children}</button>; }
function SubTrigger({ children, ...props }: AnyProps) { return <MenuTrigger {...props} child={({ props }: {
    props: AnyProps;
}) => <Button {...props} role="menuitem" variant="ghost" className="w-full justify-start">{children}<span aria-hidden="true" className="ms-auto">›</span></Button>}/>; }

