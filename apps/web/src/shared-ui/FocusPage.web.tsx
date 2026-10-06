/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useLayoutEffect, useRef } from 'react';
import type { FocusPageProps } from './FocusPage';
export function FocusPage({ page, children }: FocusPageProps) {
  const root = useRef<HTMLDivElement>(null);
  const previous = useRef(page);
  useLayoutEffect(() => {
    if (previous.current !== page) {
      const first = root.current?.querySelector<HTMLElement>(
        'input:not(:disabled),button:not(:disabled),[tabindex="0"]'
      );
      first?.focus();
      first?.scrollIntoView?.({ block: 'nearest' });
    }
    previous.current = page;
  }, [page]);
  return <div ref={root}>{children}</div>;
}
