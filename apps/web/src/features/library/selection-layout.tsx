/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Action } from '../../screens/NativeScreens';
import { ActionButton } from '../../shared-ui/ActionButton';
import { Menu } from '../../shared-ui/Menu';
import { UiText } from '../../shared-ui/Typography';
import { UiIcon } from '../../shared-ui/UiIcon';
import { useUiTheme } from '../../shared-ui/theme';
import type { LibrarySelectionLayout } from './LibrarySelectionToolbar';

const SelectionMenu: LibrarySelectionLayout['Menu'] = ({ disabled, children }) => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  return (
    <>
      <ActionButton
        variant="outline"
        accessibilityLabel="Selected book actions"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onPress={() => setOpen(true)}
      >
        Actions
      </ActionButton>
      <Menu
        visible={open && !disabled}
        label="Selected book actions"
        onClose={() => setOpen(false)}
      >
        {children(() => setOpen(false))}
      </Menu>
    </>
  );
};
export const selectionLayout: LibrarySelectionLayout = {
  Frame: ({ children }) => {
    const { colors } = useUiTheme();
    return (
      <View
        accessibilityRole="toolbar"
        accessibilityLabel="Book selection"
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          paddingVertical: 8,
          borderTopWidth: 1,
          borderTopColor: colors.border
        }}
      >
        {children}
      </View>
    );
  },
  Button: ({ kind, compact, label, disabled, onActivate }) => {
    const theme = useUiTheme();
    return kind === 'cancel' && compact ? (
      <ActionButton
        variant="ghost"
        size="icon-lg"
        accessibilityLabel={label}
        disabled={disabled}
        onPress={onActivate}
      >
        <UiIcon name="close" size={24} />
      </ActionButton>
    ) : (
      <Action
        label={label}
        disabled={disabled}
        onPress={onActivate}
        theme={theme}
        variant={kind === 'cancel' ? 'text' : 'outlined'}
      />
    );
  },
  Status: ({ compact, children }) => (
    <UiText
      accessibilityRole="status"
      accessibilityLiveRegion="polite"
      style={{ flexShrink: 1, flexGrow: 1, ...(compact ? { flexBasis: '70%' } : {}) }}
    >
      {children}
    </UiText>
  ),
  Menu: SelectionMenu,
  Item: ({ label, disabled, destructive, onActivate }) => (
    <ActionButton
      role="menuitem"
      variant={destructive ? 'destructive' : 'ghost'}
      disabled={disabled}
      onPress={onActivate}
      style={{ justifyContent: 'flex-start' }}
    >
      {label}
    </ActionButton>
  ),
  Separator: () => {
    const { colors } = useUiTheme();
    return <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />;
  },
  Notice: ({ children }) => <UiText style={{ width: '100%' }}>{children}</UiText>
};
