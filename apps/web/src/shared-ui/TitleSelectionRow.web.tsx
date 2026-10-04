/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { View } from 'react-native';
import type { TitleSelectionRowProps } from './TitleSelectionRow';

/** Put browser row padding inside Expo UI's real label so every point in the
 * row activates the same checkbox. This leaf owns presentation, never selection. */
export function TitleSelectionRow({ children, disabled, style }: TitleSelectionRowProps) {
  return (
    <>
      <style href="manabi-title-selection-row" precedence="manabi">{`
[data-ui-title-selection-row]:not([data-disabled='true']):hover,
[data-ui-title-selection-row]:focus-within { background: var(--muted); }
[data-ui-title-selection-row] [data-ui-toggle='checkbox'] label {
  box-sizing: border-box; min-height: 52px; padding: 12px; gap: 12px;
}
[data-ui-title-selection-row] [data-ui-toggle='checkbox'] input { inset-inline-start: 12px; }
[data-ui-title-selection-row][data-disabled='true'] label { cursor: default; }
`}</style>
      <View
        {...{ dataSet: { uiTitleSelectionRow: '', disabled: String(!!disabled) } }}
        style={[{ minHeight: 52, minWidth: 0, flexDirection: 'row', alignItems: 'center' }, style]}
      >
        {children}
      </View>
    </>
  );
}
