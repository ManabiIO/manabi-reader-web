/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useContext } from 'react';
import {
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowRight,
  ArrowUpNarrowWide,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Layers,
  Menu,
  Ellipsis,
  Pen,
  Repeat2,
  Save,
  Trash2,
  X
} from 'lucide-react';
import { ControlTone } from './ControlTone';
import { useUiTheme } from './theme';
import type { UiIconProps } from './UiIcon';
const icons = {
  trash: Trash2,
  edit: Pen,
  save: Save,
  close: X,
  previous: ChevronLeft,
  next: ChevronRight,
  down: ChevronDown,
  repeat: Repeat2,
  layers: Layers,
  sortAscending: ArrowUpNarrowWide,
  sortDescending: ArrowDownWideNarrow,
  menu: Menu,
  left: ArrowLeft,
  right: ArrowRight,
  more: Ellipsis
};
export function UiIcon({ name, size = 16, color }: UiIconProps) {
  const tone = useContext(ControlTone);
  const theme = useUiTheme();
  const Icon = icons[name];
  return (
    <Icon
      size={size}
      aria-hidden="true"
      focusable="false"
      color={color ?? tone ?? theme.colors.foreground}
      style={{ flexShrink: 0, verticalAlign: 'middle' }}
    />
  );
}
