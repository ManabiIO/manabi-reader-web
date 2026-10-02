/** @license BSD-3-Clause; Copyright (c) 2026, ッツ Reader Authors. All rights reserved. */
import type { ComponentProps } from 'react';
import { Button } from '../reader-react/dom';
import { Input as SnippetInput } from '../snippets-react/primitives';
import { cn } from '$lib/utils';
export { Input } from '../snippets-react/primitives';
export function InputGroupButton({
  size = 'xs',
  variant = 'ghost',
  className,
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      {...props}
      size={size}
      variant={variant}
      shape="rounded"
      className={cn(
        'gap-2 text-sm flex items-center shadow-none',
        size === 'xs'
          ? "h-7 gap-1 rounded-[6px] px-1.5 [&>svg:not([class*='size-'])]:size-3.5"
          : size === 'icon-xs'
            ? 'size-7 rounded-[6px] p-0 has-[>svg]:p-0'
            : size === 'icon-sm'
              ? 'size-8 p-0 has-[>svg]:p-0'
              : '',
        className
      )}
    />
  );
}
export function InputGroupInput({ className, ...props }: ComponentProps<typeof SnippetInput>) {
  return (
    <SnippetInput
      {...props}
      data-slot="input-group-control"
      className={cn(
        'h-full min-h-0 py-1 rounded-none border-0 bg-transparent shadow-none ring-0 focus-visible:ring-0 aria-invalid:ring-0 dark:bg-transparent flex-1',
        className
      )}
    />
  );
}
