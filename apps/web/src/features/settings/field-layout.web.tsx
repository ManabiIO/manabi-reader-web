/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ReactNode } from 'react';
import type { FieldSurfaceProps, FieldTitleProps, FieldDescriptionProps } from './field-layout';

/** Browser-only section/heading semantics retain the released card selectors and responsive design. */
export function FieldSurface({
  settingId,
  category,
  visible,
  labelledBy,
  wide,
  children
}: FieldSurfaceProps) {
  return (
    <section
      data-setting={settingId}
      data-category={category}
      hidden={!visible}
      aria-labelledby={labelledBy}
      className={[
        wide && 'wide',
        'settings-field rounded-2xl bg-card p-[16px] text-card-foreground ring-1 ring-border/60 sm:p-[20px]'
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div data-slot="field" className="flex min-w-0 flex-col gap-3">
        {children}
      </div>
    </section>
  );
}
export function FieldHeader({ children }: { children?: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-2">{children}</div>;
}
export function FieldTitle({ id, emphasized, children }: FieldTitleProps) {
  return (
    <h2 id={id} className={['text-sm', emphasized && 'font-semibold'].filter(Boolean).join(' ')}>
      {children}
    </h2>
  );
}
export function FieldDescription({ children }: FieldDescriptionProps) {
  return (
    <p data-slot="field-description" className="text-sm whitespace-pre-line text-muted-foreground">
      {children}
    </p>
  );
}
export function FieldContent({ children }: { children?: ReactNode }) {
  return <div className="min-w-0">{children}</div>;
}
