/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  createContext,
  createElement,
  forwardRef,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type KeyboardEvent,
  type RefObject
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { buttonVariants } from '../snippets-react/button-styles';
import { cn } from '$lib/utils';
import { goto } from '$app/navigation';
import { focusModalStart } from '$lib/hooks/focus-modal-start';
import { cycleModalTab } from '$lib/hooks/cycle-modal-tab';
type AnyProps = Record<string, any> & {
  children?: ReactNode;
  className?: string;
};
export const Button = forwardRef<HTMLElement, AnyProps>(function Button(
  {
    href,
    variant = 'default',
    size = 'default',
    shape = 'auto',
    disabled,
    tabIndex,
    tabindex,
    className = '',
    children,
    onClick,
    ...props
  },
  ref
) {
  const classes = cn('library-button', buttonVariants({ variant, size, shape }), className);
  const click = (event: MouseEvent) => {
    if (disabled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
    if (
      href &&
      !event.defaultPrevented &&
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey &&
      !props.target &&
      (props.download === undefined || props.download === false) &&
      !props.rel?.split(/\s+/).includes('external') &&
      new URL(href, location.href).origin === location.origin
    ) {
      event.preventDefault();
      void goto(href);
    }
  };
  return createElement(
    href ? 'a' : 'button',
    {
      ...props,
      ...(!href && { type: props.type ?? 'button' }),
      href: disabled ? undefined : href,
      disabled: href ? undefined : disabled,
      'aria-disabled': href ? disabled || props['aria-disabled'] : props['aria-disabled'],
      role: href && disabled ? 'link' : props.role,
      tabIndex: href && disabled ? -1 : (tabIndex ?? tabindex ?? 0),
      'data-slot': 'button',
      'data-variant': variant,
      'data-size': size,
      'data-shape': shape,
      ref,
      className: classes,
      onClick: click
    },
    children
  );
});
export const CloseButton = forwardRef<HTMLElement, AnyProps>(function CloseButton(props, ref) {
  return (
    <Button
      {...props}
      ref={ref}
      variant="secondary"
      size="icon-lg"
      shape="circle"
      data-modal-dismiss=""
      className={`size-[44px] min-h-[44px] min-w-[44px] text-muted-foreground hover:text-foreground pointer-coarse:min-h-[44px] pointer-coarse:min-w-[44px] ${props.className ?? ''}`}
      aria-label={props['aria-label'] ?? 'Close'}
    >
      <X className="size-[18px]" strokeWidth={3} aria-hidden="true" />
    </Button>
  );
});
export function Icon({ className = '', weight: _weight, ...props }: AnyProps) {
  return (
    <svg
      {...props}
      className={`size-5 ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <path d="M4 5h6l2 2 2-2h6v15h-6l-2 2-2-2H4zM12 7v15" />
    </svg>
  );
}
type ActionResult = {
  update?(options: any): void;
  destroy?(): void;
} | void;
/** Reuse the framework-independent DOM interaction algorithms through React refs. */
export const Action = forwardRef<
  HTMLElement,
  AnyProps & {
    as: string;
    action: (node: any, options: any) => ActionResult;
    options?: any;
  }
>(function Action({ as, action, options, ...props }, forwarded) {
  const element = useRef<HTMLElement>(null),
    result = useRef<ActionResult>(undefined),
    current = useRef(options);
  current.current = options;
  useLayoutEffect(() => {
    if (element.current) result.current = action(element.current, current.current);
    return () => {
      result.current?.destroy?.();
    };
  }, [action]);
  useLayoutEffect(() => {
    result.current?.update?.(options);
  }, [options]);
  return createElement(as, {
    ...props,
    ref: (node: HTMLElement) => {
      element.current = node;
      if (typeof forwarded === 'function') forwarded(node);
      else if (forwarded) forwarded.current = node;
    }
  });
});
type DialogState = {
  open: boolean;
  change(open: boolean): void;
  title: string;
  description: string;
};
const DialogContext = createContext<DialogState | null>(null);
function DialogRoot({ open, onOpenChange = () => {}, children }: AnyProps) {
  const id = useId();
  return (
    <DialogContext.Provider
      value={{ open, change: onOpenChange, title: id + '-title', description: id + '-description' }}
    >
      {children}
    </DialogContext.Provider>
  );
}
function DialogContent({
  children,
  className = '',
  closeDisabled = false,
  showCloseButton = true,
  onOpenAutoFocus,
  onCloseAutoFocus,
  side,
  contentSlot = 'dialog-content',
  ...props
}: AnyProps) {
  const context = useContext(DialogContext)!;
  const ref = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLElement | null>(null);
  const latest = useRef({ onOpenAutoFocus, onCloseAutoFocus });
  latest.current = { onOpenAutoFocus, onCloseAutoFocus };
  useLayoutEffect(() => {
    if (!context.open) return;
    const dialog = ref.current;
    if (!dialog) return;
    trigger.current = document.activeElement as HTMLElement;
    dialog.showModal();
    let prevented = false;
    latest.current.onOpenAutoFocus?.({
      preventDefault() {
        prevented = true;
      }
    });
    if (!prevented) focusModalStart(new Event('openAutoFocus', { cancelable: true }), dialog);
    return () => {
      dialog.close();
      let prevented = false;
      latest.current.onCloseAutoFocus?.({
        preventDefault() {
          prevented = true;
        }
      });
      if (!prevented && trigger.current?.isConnected)
        trigger.current.focus({ preventScroll: true });
    };
  }, [context.open]);
  if (!context.open) return null;
  return createPortal(
    <dialog
      {...props}
      ref={ref}
      aria-labelledby={context.title}
      aria-describedby={context.description}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      data-modal-close-button={showCloseButton ? '' : undefined}
      data-slot={contentSlot}
      data-side={side ?? props['data-side']}
      className={cn(
        'library-react-dialog m-auto grid max-h-[calc(100dvh-32px)] w-full max-w-[calc(100vw-32px)] grid-cols-[minmax(0,1fr)] gap-[24px] overflow-y-auto overscroll-contain rounded-[24px] border border-border bg-popover p-[24px] text-sm text-popover-foreground shadow-xl backdrop:bg-black/40 sm:max-w-md',
        side === 'bottom' && 'fixed inset-x-0 top-auto bottom-0 mb-0 w-full rounded-b-none',
        contentSlot === 'sheet-content' && 'flex max-w-full flex-col gap-0',
        className
      )}
      onScroll={(event) => {
        event.currentTarget.style.setProperty(
          '--dialog-close-scroll-offset',
          `${event.currentTarget.scrollTop}px`
        );
        props.onScroll?.(event);
      }}
      onKeyDown={(event) => {
        props.onKeyDown?.(event);
        if (!event.defaultPrevented) cycleModalTab(event.nativeEvent, event.currentTarget);
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!closeDisabled) context.change(false);
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || closeDisabled) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          context.change(false);
      }}
    >
      {children}
      {showCloseButton && (
        <CloseButton
          className="absolute top-[16px] right-[16px]"
          style={{ transform: 'translateY(var(--dialog-close-scroll-offset, 0px))' }}
          data-slot="dialog-close"
          disabled={closeDisabled}
          onClick={() => context.change(false)}
        />
      )}
    </dialog>,
    document.body
  );
}
const block = (tag: string, slot: string, defaults = '') =>
  function Block({ children, className = '', ...props }: AnyProps) {
    return createElement(
      tag,
      { ...props, 'data-slot': slot, className: cn(defaults, className) },
      children
    );
  };
function DialogTitle({ titleSlot = 'dialog-title', ...props }: AnyProps) {
  const context = useContext(DialogContext)!;
  return (
    <h2
      {...props}
      id={context.title}
      data-slot={titleSlot}
      className={cn('text-lg leading-snug font-semibold', props.className)}
    />
  );
}
function DialogDescription({ descriptionSlot = 'dialog-description', ...props }: AnyProps) {
  const context = useContext(DialogContext)!;
  return (
    <p
      {...props}
      id={context.description}
      data-slot={descriptionSlot}
      className={cn('text-sm text-muted-foreground', props.className)}
    />
  );
}
export const Dialog = {
  Root: DialogRoot,
  Content: DialogContent,
  Header: block('header', 'dialog-header', 'flex flex-col gap-1.5'),
  Footer: block('footer', 'dialog-footer', 'mt-5 flex flex-wrap justify-end gap-2'),
  Title: DialogTitle,
  Description: DialogDescription
};
export const Sheet = {
  ...Dialog,
  Content: (props: AnyProps) => <DialogContent {...props} contentSlot="sheet-content" />,
  Header: block('header', 'sheet-header', 'flex flex-col gap-1.5'),
  Description: (props: AnyProps) => (
    <DialogDescription {...props} descriptionSlot="sheet-description" />
  ),
  Title: (props: AnyProps) => <DialogTitle {...props} titleSlot="sheet-title" />
};
type MenuState = {
  open: boolean;
  setOpen(open: boolean): void;
  trigger: RefObject<HTMLElement | null>;
  rootTrigger: RefObject<HTMLElement | null>;
  submenu: boolean;
  activeSubmenu: string | null;
  setActiveSubmenu(id: string | null): void;
  root: string;
  closeTree(): void;
};
const MenuContext = createContext<MenuState | null>(null);
function MenuRoot({ children }: AnyProps) {
  const parent = useContext(MenuContext);
  const id = useId();
  const [ownOpen, setOwnOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const open = parent ? parent.activeSubmenu === id : ownOpen;
  const setOpen = (next: boolean) => {
    if (parent) {
      if (next || parent.activeSubmenu === id) parent.setActiveSubmenu(next ? id : null);
    } else setOwnOpen(next);
    if (!next) setActiveSubmenu(null);
  };
  const trigger = useRef<HTMLElement>(null);
  return (
    <MenuContext.Provider
      value={{
        open,
        setOpen,
        trigger,
        rootTrigger: parent?.rootTrigger ?? trigger,
        submenu: !!parent,
        activeSubmenu,
        setActiveSubmenu,
        root: parent?.root ?? id,
        closeTree() {
          setOpen(false);
          parent?.closeTree();
        }
      }}
    >
      {children}
    </MenuContext.Provider>
  );
}
function MenuTrigger({ child, children, ...rest }: AnyProps) {
  const context = useContext(MenuContext)!;
  const props = {
    ...rest,
    'aria-haspopup': 'menu' as const,
    'aria-expanded': context.open,
    'data-slot': 'dropdown-menu-trigger',
    ref: (element: HTMLElement) => {
      context.trigger.current = element;
    },
    // Hover may already have opened a submenu before the pointer's click.
    // Activation opens that destination; only the root trigger is a toggle.
    onClick: () => context.setOpen(context.submenu || !context.open),
    onKeyDown: (e: KeyboardEvent) => {
      rest.onKeyDown?.(e);
      if (e.defaultPrevented) return;
      if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        context.setOpen(true);
      }
    }
  };
  return child ? child({ props }) : <Button {...props}>{children}</Button>;
}
function MenuContent({
  children,
  className = '',
  align = 'end',
  side = 'bottom',
  collisionPadding: _collisionPadding,
  ...props
}: AnyProps) {
  const context = useContext(MenuContext)!;
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!context.open) return;
    const trigger = context.trigger.current,
      menu = ref.current;
    if (!trigger || !menu) return;
    const position = () => {
      const r = trigger.getBoundingClientRect();
      const height = menu.getBoundingClientRect().height;
      const width = menu.offsetWidth;
      const inline = side === 'right' || side === 'left';
      let left = inline
        ? side === 'right'
          ? r.right + 4
          : r.left - width - 4
        : align === 'end'
          ? r.right - width
          : r.left;
      if (inline && left + width > window.innerWidth - 8) left = r.left - width - 4;
      if (inline && left < 8) left = r.right + 4;
      setStyle({
        position: 'fixed',
        zIndex: 70,
        // CSS viewport bounds stay current during touch viewport resizes, before
        // the resize event refreshes the trigger's measured coordinates.
        '--library-menu-top': `${inline ? r.top : r.bottom + 4}px`,
        '--library-menu-left': `${left}px`,
        top: `clamp(8px, var(--library-menu-top), calc(100dvh - ${height}px - 8px))`,
        left: `clamp(8px, var(--library-menu-left), calc(100vw - ${width}px - 8px))`,
        maxWidth: 'calc(100vw - 16px)',
        maxHeight: '80dvh',
        overflowY: 'auto'
      } as CSSProperties);
    };
    position();
    (menu.querySelector('[role^=menuitem]:not([disabled])') as HTMLElement | null)?.focus({
      preventScroll: true
    });
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (
        !menu.contains(target) &&
        !trigger.contains(target) &&
        (!(target instanceof Element) ||
          target.closest('[data-menu-root]')?.getAttribute('data-menu-root') !== context.root)
      )
        context.setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [context.open, align, side]);
  if (!context.open) return null;
  return createPortal(
    <div
      {...props}
      ref={ref}
      role="menu"
      data-menu-root={context.root}
      data-slot={context.submenu ? 'dropdown-menu-sub-content' : 'dropdown-menu-content'}
      className={`library-menu rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg ${className}`}
      style={style}
      onKeyDown={(event) => {
        const items = [
          ...event.currentTarget.querySelectorAll<HTMLElement>('[role^=menuitem]:not([disabled])')
        ];
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        } else if (event.key === 'Escape' || (context.submenu && event.key === 'ArrowLeft')) {
          event.preventDefault();
          event.stopPropagation();
          context.setOpen(false);
          context.trigger.current?.focus();
        } else if (event.key === 'Tab') {
          event.stopPropagation();
          context.closeTree();
        }
      }}
    >
      {children}
    </div>,
    document.body
  );
}
function MenuItem({ children, onSelect, variant, disabled, ...props }: AnyProps) {
  const context = useContext(MenuContext)!;
  return (
    <button
      {...props}
      type="button"
      role="menuitem"
      disabled={disabled}
      className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left hover:bg-muted focus:bg-muted ${variant === 'destructive' ? 'text-destructive' : ''} ${props.className ?? ''}`}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') context.setActiveSubmenu(null);
        props.onPointerEnter?.(event);
      }}
      onClick={(event) => {
        context.closeTree();
        context.rootTrigger.current?.focus();
        onSelect?.(event);
      }}
    >
      {children}
    </button>
  );
}
export const Menu = {
  RadioGroup,
  RadioItem,
  Sub: MenuRoot,
  SubTrigger: SubTrigger,
  SubContent: MenuContent,
  Root: MenuRoot,
  Trigger: MenuTrigger,
  Content: MenuContent,
  Item: MenuItem,
  Separator: () => <hr role="separator" className="my-1 border-border" />,
  Label: block('div', 'dropdown-menu-label', 'px-3 py-2 text-xs text-muted-foreground')
};
const RadioContext = createContext<{
  value: string;
  change(value: string): void;
}>({ value: '', change() {} });
function RadioGroup({ value, onValueChange, children }: AnyProps) {
  return (
    <RadioContext.Provider value={{ value, change: onValueChange }}>
      <div role="group">{children}</div>
    </RadioContext.Provider>
  );
}
function RadioItem({ value, children, disabled }: AnyProps) {
  const radio = useContext(RadioContext),
    menu = useContext(MenuContext)!;
  return (
    <button
      role="menuitemradio"
      aria-checked={radio.value === value}
      disabled={disabled}
      className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left hover:bg-muted focus:bg-muted"
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') menu.setActiveSubmenu(null);
      }}
      onClick={() => {
        radio.change(value);
        menu.closeTree();
        menu.rootTrigger.current?.focus();
      }}
    >
      <span aria-hidden="true">{radio.value === value ? '✓' : ''}</span>
      {children}
    </button>
  );
}
function SubTrigger({ children, ...props }: AnyProps) {
  const context = useContext(MenuContext)!;
  return (
    <MenuTrigger
      {...props}
      onPointerEnter={(event: PointerEvent) => {
        if (event.pointerType === 'mouse' && !props.disabled) context.setOpen(true);
        props.onPointerEnter?.(event);
      }}
      onKeyDown={(event: KeyboardEvent) => {
        props.onKeyDown?.(event);
        if (event.key === 'ArrowRight' && !event.defaultPrevented && !props.disabled) {
          event.preventDefault();
          event.stopPropagation();
          context.setOpen(true);
        }
      }}
      child={({ props }: { props: AnyProps }) => (
        <Button {...props} role="menuitem" variant="ghost" className="w-full justify-start">
          {children}
          <span aria-hidden="true" className="ms-auto">
            ›
          </span>
        </Button>
      )}
    />
  );
}
