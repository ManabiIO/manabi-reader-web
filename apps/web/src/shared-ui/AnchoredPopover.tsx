/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ReactNode } from 'react';
import type { View } from 'react-native';
import { Dialog } from './ModalSurface';
export interface AnchoredPopoverProps {
  visible: boolean;
  onClose(): void;
  title: string;
  label: string;
  closeLabel: string;
  anchor?: View | null;
  children: ReactNode;
  maxWidth?: number;
  maxHeight?: number;
  padding?: number;
  showHeading?: boolean;
  showClose?: boolean;
  focusSelected?: boolean;
  bodyScroll?: boolean;
}
/** Android gives a small day-details surface a native Back-dismissable dialog. */
export function AnchoredPopover({
  visible,
  onClose,
  title,
  label,
  closeLabel,
  maxWidth = 320,
  showClose,
  bodyScroll,
  children
}: AnchoredPopoverProps) {
  return (
    <Dialog
      visible={visible}
      onClose={onClose}
      title={title}
      accessibilityLabel={label}
      closeLabel={closeLabel}
      maxWidth={Math.max(320, maxWidth)}
      bodyScroll={bodyScroll}
      showClose={showClose}
    >
      {children}
    </Dialog>
  );
}
