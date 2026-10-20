/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ReactNode } from 'react';

export function FontList({ children }: { children: ReactNode }) {
  return (
    <ul
      aria-label="Stored custom fonts"
      style={{ listStyle: 'none', margin: 0, padding: 0, minWidth: 0 }}
    >
      {children}
    </ul>
  );
}
export function FontListItem({ children }: { children: ReactNode }) {
  return <li style={{ minWidth: 0 }}>{children}</li>;
}
