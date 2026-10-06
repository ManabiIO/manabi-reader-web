/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ReactNode } from 'react';
import { Linking } from 'react-native';
import { ActionButton } from './ActionButton';
export interface ExternalLinkProps {
  href: string;
  accessibilityLabel: string;
  children: ReactNode;
}
/** Native callers supply only an explicitly available absolute destination. */
export function ExternalLink({ href, accessibilityLabel, children }: ExternalLinkProps) {
  return (
    <ActionButton
      variant="ghost"
      role="link"
      accessibilityLabel={accessibilityLabel}
      onPress={() => {
        void Linking.openURL(href);
      }}
    >
      {children}
    </ActionButton>
  );
}
