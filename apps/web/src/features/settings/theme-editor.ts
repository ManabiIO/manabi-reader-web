/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  availableThemes,
  customThemeValues,
  parseColor,
  themeForMode,
  type ThemeOption
} from '../../lib/data/theme-option';

export const themeEditorFields = [
  { key: 'fontColor', label: 'Font' },
  { key: 'backgroundColor', label: 'Background' },
  { key: 'selectionFontColor', label: 'Selected text' },
  { key: 'selectionBackgroundColor', label: 'Selection background' },
  { key: 'hintFuriganaFontColor', label: 'Furigana Partial Hide Font' },
  { key: 'hintFuriganaShadowColor', label: 'Furigana Partial/Full Hide Shadow' },
  { key: 'tooltipTextFontColor', label: 'Footer Font' }
] as const;

export interface ThemeCopyOption {
  id: string;
  label: string;
  colors: ThemeOption;
}

/** Copy the appearance the reader is using, including derived counterparts.
 * Custom palettes keep authored expressions in their authored mode; derivation
 * never changes the stored palette. Editing seeds use the original separately. */
export function themeCopyOptions(
  options: readonly { id: string; label?: string }[],
  mode: 'light' | 'dark',
  custom: Record<string, ThemeOption>
): ThemeCopyOption[] {
  return options.map(({ id, label }) => ({
    id,
    label: label ?? id,
    colors: themeForMode(id, mode, custom)
  }));
}

export function themeDraftPalette(value: ThemeOption): ThemeOption {
  return Object.fromEntries(
    Object.entries(customThemeValues(value)).map(([key, entry]) => [key, entry.rgbaExpression])
  ) as unknown as ThemeOption;
}

export function themeNameError(
  name: string,
  previousName: string,
  existingNames: readonly string[]
) {
  if (!name) return 'Enter a theme name.';
  if (availableThemes.has(name) || name === 'system-theme')
    return 'This name is reserved for a built-in theme.';
  if (name !== previousName && existingNames.includes(name))
    return 'A theme with this name already exists. Choose another name.';
  return '';
}

/** Browser color/opacity leaves share conversion with native draft validation.
 * Only the edited expression is replaced; untouched values round-trip exactly. */
export function colorWithAlpha(value: string, alpha: number): string {
  const parsed = parseColor(value);
  if (!parsed) return value;
  const [r, g, b] = parsed;
  const safeAlpha = Number.isFinite(alpha) && alpha >= 0 && alpha <= 1 ? alpha : 1;
  return `rgba(${r},${g},${b},${safeAlpha})`;
}

export function themePaletteError(palette: ThemeOption): string {
  const field = themeEditorFields.find(({ key }) => !parseColor(palette[key]));
  return field ? `Use a valid hex, rgb, or rgba color for ${field.label}.` : '';
}
