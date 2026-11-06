/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ReactNode } from 'react';
import { useReaderController } from '../reader-react/controller';
import { useReaderBindings, type ReaderViewProps } from './primitives';
import {
  createSettingsDimensionContent,
  type SettingsDimensionContentProps
} from './settings-dimension-content-controller';
import { SettingsDimensionEditor } from '../features/settings/SettingsDimensionEditor';

export function SettingsDimensionContent(
  props: Partial<SettingsDimensionContentProps> &
    ReaderViewProps & { children?: ReactNode; onClose?: () => void; slot?: string }
) {
  const c = useReaderController(() => createSettingsDimensionContent(props), props);
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <div className="react-settings-settings-dimension-content" style={{ display: 'contents' }}>
      <SettingsDimensionEditor
        value={c.dimensionValue}
        vertical={c.isVertical}
        first={c.isFirstDimension}
        onValueChange={(value) => {
          c.dimensionValue = value;
        }}
      />
    </div>
  );
}
