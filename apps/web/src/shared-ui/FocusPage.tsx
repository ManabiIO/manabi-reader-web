/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { AccessibilityInfo, View } from 'react-native';
export interface FocusPageProps {
  page: number;
  children: ReactNode;
}
export function FocusPage({ page, children }: FocusPageProps) {
  const previous = useRef(page);
  useEffect(() => {
    if (previous.current !== page) AccessibilityInfo.announceForAccessibility(`Page ${page}`);
    previous.current = page;
  }, [page]);
  return <View>{children}</View>;
}
