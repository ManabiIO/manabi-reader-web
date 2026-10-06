/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Platform, useColorScheme } from 'react-native';
import {
  themeProperties,
  type AppearanceMode,
  type ColorMode,
  type ThemeOption
} from '../lib/data/theme-option';

const colorNames = {
  background: 'background',
  foreground: 'foreground',
  mutedForeground: 'muted-foreground',
  muted: 'muted',
  card: 'card',
  popover: 'popover',
  border: 'border',
  input: 'input',
  primary: 'primary',
  primaryForeground: 'primary-foreground',
  secondary: 'secondary',
  secondaryForeground: 'secondary-foreground',
  accent: 'accent',
  destructive: 'destructive',
  ring: 'ring',
  heatmapEmpty: 'heatmap-empty',
  heatmapOutside: 'heatmap-outside',
  chart1: 'chart-1',
  chart2: 'chart-2',
  chart3: 'chart-3',
  chart4: 'chart-4',
  chart5: 'chart-5'
} as const;
export interface UiTheme {
  mode: ColorMode;
  colors: Record<
    | keyof typeof colorNames
    | 'heatmapToday'
    | 'heatmapSelected'
    | 'destructiveBackground'
    | 'destructiveHover',
    string
  >;
  /** A literal seed for native controls; browser controls inherit semantic CSS variables. */
  seedColor: string;
  spacing: { xs: number; sm: number; md: number; lg: number; xl: number };
  radius: { sm: number; field: number; card: number; capsule: number };
}
export interface UiThemeProviderProps {
  children: ReactNode;
  themeId?: string;
  appearance?: AppearanceMode;
  customThemes?: Record<string, ThemeOption>;
}
const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20 };
const radius = { sm: 6, field: 10, card: 12, capsule: 999 };
export function createUiTheme(
  themeId: string,
  mode: ColorMode,
  customThemes?: Record<string, ThemeOption>
): UiTheme {
  const properties = themeProperties(themeId, mode, customThemes);
  const literal = (value: string) => (value === 'var(--manabi-red)' ? '#a33539' : value);
  const destructive = literal(properties.destructive);
  const destructiveTint = (opacity: number) => {
    if (Platform.OS === 'web')
      return `color-mix(in srgb, var(--destructive) ${opacity * 100}%, transparent)`;
    if (/^#[\da-f]{6}$/i.test(destructive))
      return `rgba(${parseInt(destructive.slice(1, 3), 16)}, ${parseInt(destructive.slice(3, 5), 16)}, ${parseInt(destructive.slice(5, 7), 16)}, ${opacity})`;
    const rgb = destructive
      .match(/^rgba?\(([^)]+)\)$/)?.[1]
      .split(',')
      .slice(0, 3)
      .join(',');
    return rgb ? `rgba(${rgb}, ${opacity})` : destructive;
  };
  return {
    mode,
    spacing,
    radius,
    seedColor: literal(properties.primary),
    colors: {
      // Preserve the original calendar's distinct today/selected state palette.
      destructiveBackground: destructiveTint(mode === 'dark' ? 0.2 : 0.1),
      destructiveHover: destructiveTint(mode === 'dark' ? 0.3 : 0.2),
      heatmapToday: '#ef4444',
      heatmapSelected: '#f59e0b',
      ...(Object.fromEntries(
        Object.entries(colorNames).map(([key, property]) => [
          key,
          Platform.OS === 'web' ? `var(--${property})` : literal(properties[property])
        ])
      ) as Record<keyof typeof colorNames, string>)
    }
  };
}
const ThemeContext = createContext<UiTheme | null>(null);
export function UiThemeProvider({
  children,
  themeId = 'manabi-theme',
  appearance = 'system',
  customThemes
}: UiThemeProviderProps) {
  const system = useColorScheme();
  const mode = appearance === 'system' ? (system === 'dark' ? 'dark' : 'light') : appearance;
  const value = useMemo(
    () => createUiTheme(themeId, mode, customThemes),
    [themeId, mode, customThemes]
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
export function useUiTheme(): UiTheme {
  const provided = useContext(ThemeContext);
  const system = useColorScheme();
  const fallback = useMemo(
    () => createUiTheme('manabi-theme', system === 'dark' ? 'dark' : 'light'),
    [system]
  );
  return provided ?? fallback;
}
