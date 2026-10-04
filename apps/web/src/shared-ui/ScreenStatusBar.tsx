/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useUiTheme, type UiTheme } from './theme';

/** Retained stack screens must relinquish system chrome when they lose focus. */
export function ScreenStatusBar({ theme }: { theme?: UiTheme }) {
  const provided = useUiTheme();
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );
  return focused ? (
    <StatusBar style={(theme ?? provided).mode === 'dark' ? 'light' : 'dark'} />
  ) : null;
}
