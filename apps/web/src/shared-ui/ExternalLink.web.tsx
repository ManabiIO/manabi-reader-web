/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ExternalLinkProps } from './ExternalLink';
export function ExternalLink({ href, accessibilityLabel, children }: ExternalLinkProps) {
  return (
    <a
      href={href}
      aria-label={accessibilityLabel}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        minHeight: 44,
        padding: 12,
        borderRadius: 16,
        color: 'var(--foreground)',
        textDecoration: 'none',
        overflowWrap: 'anywhere'
      }}
    >
      {children}
    </a>
  );
}
