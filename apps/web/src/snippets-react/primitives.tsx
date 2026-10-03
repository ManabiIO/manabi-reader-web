/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { goto } from '$app/navigation';
import { Dom as ReaderDom, Dialog as ReaderDialog } from '../reader-react/dom';
import { FolderOpen } from 'lucide-react';
import { cn } from '$lib/utils';
import { buttonVariants } from './button-styles';
import type { ReaderViewProps } from '../reader-react/dom';
export function Icon({ name: _name, ...props }: { name: 'FolderOpen'; [key: string]: any }) {
  return <FolderOpen {...props} aria-hidden="true" />;
}
export {
  SurfaceEvents,
  Head,
  ReaderScope,
  useLatest,
  useReaderBindings,
  type ReaderViewProps
} from '../reader-react/dom';
export { Menu } from '../library-react/primitives';
export { AppNav } from '../library-react/navigation';

/** Preserve link semantics (modified clicks, downloads, external URLs) while
 * ordinary in-app clicks pass through the draft navigation transaction guard. */
export function Button({
  href,
  onClick,
  events,
  ref,
  elementRef,
  variant = 'default',
  size = 'default',
  shape = 'auto',
  className,
  disabled,
  tabIndex,
  tabindex,
  ...props
}: ControlProps) {
  const click = (event: any) => {
    if (disabled) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    (onClick ?? events?.click)?.(event);
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
  return (
    <Dom
      as={href ? 'a' : 'button'}
      type={href ? undefined : 'button'}
      {...props}
      elementRef={(node: HTMLElement | null) => {
        elementRef?.(node);
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      href={disabled ? undefined : href}
      disabled={href ? undefined : disabled}
      aria-disabled={href ? disabled || props['aria-disabled'] : props['aria-disabled']}
      role={href && disabled ? 'link' : props.role}
      tabIndex={disabled && href ? -1 : (tabIndex ?? tabindex ?? 0)}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-shape={shape}
      className={cn(buttonVariants({ variant, size, shape }), className)}
      events={{ ...events, click }}
    />
  );
}
export function DynamicComponent({
  this: Component,
  ...props
}: {
  this?: React.ElementType;
  [key: string]: any;
}) {
  return Component ? <Component {...props} /> : null;
}

interface ControlProps extends ReaderViewProps {
  bindings?: Record<string, (value: any) => void>;
  [key: string]: any;
  children?: React.ReactNode;
  elementRef?: (value: any) => void;
  onClick?: (event: any) => void;
  onChange?: (event: any) => void;
  onInput?: (event: any) => void;
  onSubmit?: (event: any) => void;
  onKeyDown?: (event: any) => void;
  onCompositionStart?: (event: any) => void;
  onCompositionEnd?: (event: any) => void;
}
/** Native input listeners update the controller before its original input handler. */
export function Dom({
  as = 'div',
  bindings = {},
  events = {},
  elementRef,
  scopeClass,
  ...props
}: ControlProps) {
  const handlers = { ...events };
  // Source handlers use DOM event fields such as isComposing; keep those fields
  // intact instead of routing the annotation guard through synthetic events.
  for (const [prop, event] of Object.entries({
    onClick: 'click',
    onChange: 'change',
    onInput: 'input',
    onSubmit: 'submit',
    onKeyDown: 'keydown',
    onCompositionStart: 'compositionstart',
    onCompositionEnd: 'compositionend'
  })) {
    if (props[prop]) {
      handlers[event] = props[prop];
      delete props[prop];
    }
  }
  const chain = (name: string, before: (event: any) => void) => {
    const after = handlers[name];
    handlers[name] = (event: Event) => {
      before(event);
      after?.(event);
    };
  };
  if (bindings.value) {
    chain(as === 'select' ? 'change' : 'input', (event) =>
      bindings.value(event.currentTarget.value)
    );
    props.value ??= '';
    props.onChange ??= () => {};
  }
  if (bindings.checked) props.checked ??= false;
  if (as === 'input' && props.checked !== undefined) {
    // React restores controlled checkbox state during click, before the native
    // change event. Update its owner in React's change handler so native change
    // cannot read the restored old value and undo the user's choice.
    const change = handlers.change;
    delete handlers.change;
    props.onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      bindings.checked?.(event.currentTarget.checked);
      change?.(event);
    };
  }
  if (props.value !== undefined || props.checked !== undefined) props.onChange ??= () => {};
  const ref = (node: HTMLElement | null) => {
    elementRef?.(node);
    bindings.ref?.(node);
    bindings.this?.(node);
  };
  return (
    <ReaderDom
      as={as}
      {...props}
      className={cn(props.className, scopeClass)}
      events={handlers}
      elementRef={ref}
    />
  );
}
export function Input({ className = '', ...props }: ControlProps) {
  return (
    <Dom
      as="input"
      {...props}
      data-slot={props['data-slot'] ?? 'input'}
      className={cn(
        `min-h-[44px] w-full min-w-0 rounded-[10px] border border-input bg-background px-3 py-2 text-base transition-[color,box-shadow] duration-200 outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40`,
        className
      )}
    />
  );
}

/** Shared modal lifecycle with the original snippet dialog’s visual tokens. */
export const Dialog = {
  Root: ReaderDialog.Root,
  Content: ({ className, ...props }: ControlProps) => (
    <ReaderDialog.Content
      {...props}
      onScroll={(event: React.UIEvent<HTMLElement>) => {
        event.currentTarget.style.setProperty(
          '--dialog-close-scroll-offset',
          `${event.currentTarget.scrollTop}px`
        );
        props.onScroll?.(event);
      }}
      className={cn(
        'snippet-dialog grid grid-cols-[minmax(0,1fr)] gap-[24px] p-[24px] text-sm outline-none',
        className
      )}
    />
  ),
  Header: ({ className, ...props }: ControlProps) => (
    <ReaderDialog.Header
      {...props}
      data-slot="dialog-header"
      className={cn('flex flex-col gap-1.5', className)}
    />
  ),
  Title: ({ className, ...props }: ControlProps) => (
    <ReaderDialog.Title
      {...props}
      data-slot="dialog-title"
      className={cn('text-lg leading-snug font-semibold', className)}
    />
  ),
  Description: ({ className, ...props }: ControlProps) => (
    <ReaderDialog.Description
      {...props}
      data-slot="dialog-description"
      className={cn(
        'text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
        className
      )}
    />
  )
};
