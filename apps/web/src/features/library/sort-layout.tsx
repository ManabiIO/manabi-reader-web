/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { View } from 'react-native';
import { ChoiceButtons } from '../../shared-ui/ChoiceButtons';
import { UiText } from '../../shared-ui/Typography';
import type { LibrarySortLayout } from './LibrarySortControls';

export const sortLayout: LibrarySortLayout = {
  Choices: ({ label, value, options, moreOptions, disabled, onChange }) => (
    <View style={{ minWidth: 0, gap: 8 }}>
      <UiText accessibilityRole="header" style={{ fontWeight: '600' }}>
        {label}
      </UiText>
      <ChoiceButtons
        label={label}
        value={value}
        options={moreOptions ? [...options, ...moreOptions] : options}
        disabled={disabled}
        onValueChange={onChange}
      />
    </View>
  ),
  Separator: () => null
};
