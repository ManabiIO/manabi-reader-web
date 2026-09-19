/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export interface ColorObject {
  r: number;
  g: number;
  b: number;
  a?: number;
}

export interface ThemeOption {
  fontColor: string;
  backgroundColor: string;
  selectionFontColor: string;
  selectionBackgroundColor: string;
  hintFuriganaShadowColor: string;
  hintFuriganaFontColor: string;
  tooltipTextFontColor: string;
}

export interface CustomThemeValue {
  hexExpression: string;
  alphaValue: number;
  rgbaExpression: string;
}

function updateHintFuriganaFontColor(theme: Record<keyof ThemeOption, ColorObject>) {
  return {
    ...theme,
    hintFuriganaFontColor: {
      ...theme.fontColor,
      a: theme.fontColor.a ? theme.fontColor.a * 0.38 : 0.38
    }
  };
}

const lightTheme = updateHintFuriganaFontColor({
  fontColor: {
    r: 0x00,
    g: 0x00,
    b: 0x00,
    a: 0.87
  },
  backgroundColor: {
    r: 0xff,
    g: 0xff,
    b: 0xff
  },
  selectionFontColor: {
    r: 0xf5,
    g: 0xf5,
    b: 0xf5
  },
  selectionBackgroundColor: {
    r: 0x97,
    g: 0x97,
    b: 0x97
  },
  hintFuriganaFontColor: {
    r: 0x00,
    g: 0x00,
    b: 0x00
  },
  hintFuriganaShadowColor: {
    r: 34,
    g: 34,
    b: 49,
    a: 0.3
  },
  tooltipTextFontColor: {
    r: 0x00,
    g: 0x00,
    b: 0x00,
    a: 0.6
  }
});

const darkTheme = updateHintFuriganaFontColor({
  fontColor: {
    r: 0xff,
    g: 0xff,
    b: 0xff,
    a: 0.87
  },
  backgroundColor: {
    r: 0x23,
    g: 0x27,
    b: 0x2a
  },
  selectionFontColor: {
    r: 85,
    g: 90,
    b: 92,
    a: 0.6
  },
  selectionBackgroundColor: {
    r: 212,
    g: 217,
    b: 220,
    a: 0.8
  },
  hintFuriganaFontColor: {
    r: 0x00,
    g: 0x00,
    b: 0x00
  },
  hintFuriganaShadowColor: {
    r: 240,
    g: 240,
    b: 241,
    a: 0.3
  },
  tooltipTextFontColor: {
    r: 0xff,
    g: 0xff,
    b: 0xff,
    a: 0.6
  }
});

function themeObjValueToStringValue<T extends string>(objValue: Record<T, ColorObject>) {
  return Object.entries(objValue).reduce<Record<T, string>>((acc, [key, value]) => {
    const obj = value as ColorObject;
    acc[key as T] = `rgba(${obj.r}, ${obj.g}, ${obj.b}, ${obj.a ?? 1})`;
    return acc;
  }, {} as any);
}

const availableThemesCamelCase = {
  manabiTheme: lightTheme,
  lightTheme,
  ecruTheme: {
    ...lightTheme,
    backgroundColor: {
      r: 0xf7,
      g: 0xf6,
      b: 0xeb
    }
  },
  waterTheme: {
    ...lightTheme,
    backgroundColor: {
      r: 0xdf,
      g: 0xec,
      b: 0xf4
    }
  },
  /**
   * Called gray theme for legacy reasons
   */
  grayTheme: darkTheme,
  /**
   * Called dark theme for legacy reasons
   */
  darkTheme: {
    ...darkTheme,
    fontColor: {
      r: 0xff,
      g: 0xff,
      b: 0xff,
      a: 0.6
    },
    backgroundColor: {
      r: 0x12,
      g: 0x12,
      b: 0x12
    }
  },
  blackTheme: {
    ...darkTheme,
    backgroundColor: {
      r: 0x00,
      g: 0x00,
      b: 0x00
    }
  }
};

function camelCaseToKebabCase(s: string) {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

export const availableThemes = new Map(
  Object.entries(availableThemesCamelCase).map(([key, value]) => [
    camelCaseToKebabCase(key),
    themeObjValueToStringValue(value)
  ])
);

/** Theme identity and appearance are intentionally independent. */
export type AppearanceMode = 'system' | 'light' | 'dark';
export type ColorMode = Exclude<AppearanceMode, 'system'>;
export const themeNames: Record<string, string> = {
  'manabi-theme': 'Manabi',
  'light-theme': 'Paper',
  'ecru-theme': 'Ecru',
  'water-theme': 'Water',
  'gray-theme': 'Slate',
  'dark-theme': 'Charcoal',
  'black-theme': 'Monochrome'
};
const darkPresets = new Set(['gray-theme', 'dark-theme', 'black-theme']);
const counterparts: Record<string, string> = {
  'manabi-theme': '#000000',
  'light-theme': '#17191c',
  'ecru-theme': '#222019',
  'water-theme': '#15232d',
  'gray-theme': '#edf0f2',
  'dark-theme': '#f5f5f5',
  'black-theme': '#ffffff'
};

/** Only serialized colors accepted by the existing custom-theme editor, never CSS URLs. */
export function parseColor(value: unknown): [number, number, number, number] | undefined {
  if (typeof value !== 'string' || value.length > 100) return undefined;
  const hex = /^#([\da-f]{6})$/i.exec(value);
  if (hex)
    return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as [
      number,
      number,
      number,
      number
    ];
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(
    value
  );
  if (!rgba) return undefined;
  const channels = [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4] ?? 1)];
  return channels.every((n, i) => Number.isFinite(n) && n >= 0 && n <= (i === 3 ? 1 : 255))
    ? (channels as [number, number, number, number])
    : undefined;
}
const rgba = (c: readonly number[]) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3] ?? 1})`;
const mix = (a: readonly number[], b: readonly number[], amount: number) =>
  a.slice(0, 3).map((n, i) => Math.round(n * (1 - amount) + b[i] * amount));
export function isDarkColor(value: unknown): boolean {
  const c = parseColor(value);
  return !!c && 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] < 128;
}
export function initialAppearance(
  stored: unknown,
  theme: unknown,
  custom: Record<string, ThemeOption> = {}
): AppearanceMode {
  if (stored === 'system' || stored === 'light' || stored === 'dark') return stored;
  // Do not turn an existing reader's night theme white on upgrade. Fresh installs
  // get Manabi + System. Explicit old light themes likewise remain light.
  if (!theme || theme === 'manabi-theme' || theme === 'system-theme') return 'system';
  return typeof theme === 'string' &&
    (darkPresets.has(theme) || isDarkColor(custom[theme]?.backgroundColor))
    ? 'dark'
    : 'light';
}

function neutralTheme(background: string, mode: ColorMode): ThemeOption {
  return {
    ...availableThemes.get(mode === 'dark' ? 'gray-theme' : 'light-theme')!,
    backgroundColor: rgba(parseColor(background)!),
    selectionBackgroundColor: mode === 'dark' ? 'rgba(217, 177, 65, 1)' : 'rgba(163, 53, 57, 1)',
    selectionFontColor: mode === 'dark' ? 'rgba(11, 11, 11, 1)' : 'rgba(255, 255, 255, 1)'
  };
}

export function themeForMode(
  id: string,
  mode: ColorMode,
  custom: Record<string, ThemeOption> = {}
): ThemeOption {
  const original = availableThemes.get(id) ?? custom[id];
  if (
    !original ||
    !Object.keys(availableThemes.get('light-theme')!).every((key) =>
      parseColor(original[key as keyof ThemeOption])
    )
  ) {
    return neutralTheme(mode === 'light' ? '#ffffff' : '#000000', mode);
  }
  if (id === 'manabi-theme') return neutralTheme(mode === 'light' ? '#ffffff' : '#000000', mode);
  const originalMode = isDarkColor(original.backgroundColor) ? 'dark' : 'light';
  if (originalMode === mode) return { ...original };
  if (counterparts[id]) return neutralTheme(counterparts[id], mode);
  // Keep custom themes byte-for-byte in storage and in their authored mode;
  // derive, never save, a gently tinted counterpart for the opposite mode.
  const target = mode === 'dark' ? [0, 0, 0] : [255, 255, 255];
  return neutralTheme(rgba(mix(parseColor(original.backgroundColor)!, target, 0.9)), mode);
}

export const cssName = (key: string) => key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
// Reader components use CSS variables rather than snapshots of literal colors.
// A system appearance change therefore needs neither remounting nor pagination.
export const readerTheme = Object.fromEntries(
  Object.keys(availableThemes.get('light-theme')!).map((key) => [
    key,
    `var(--reader-${cssName(key)})`
  ])
) as unknown as ThemeOption;

export function themeProperties(
  id: string,
  mode: ColorMode,
  custom: Record<string, ThemeOption> = {}
): Record<string, string> {
  const reading = themeForMode(id, mode, custom);
  const canvas = mode === 'dark' ? [0, 0, 0] : [255, 255, 255];
  const ink = mode === 'dark' ? [238, 238, 238] : [33, 31, 28];
  const bg = parseColor(reading.backgroundColor)!;
  const opaqueBackground = mix(canvas, bg, bg[3]);
  const accent =
    id === 'manabi-theme'
      ? mode === 'dark'
        ? '#d9b141'
        : 'var(--manabi-red)'
      : mode === 'dark'
        ? '#a5c9e1'
        : '#24506c';
  return {
    ...Object.fromEntries(
      Object.entries(reading).map(([key, value]) => [`reader-${cssName(key)}`, value])
    ),
    canvas: rgba(opaqueBackground),
    ink: rgba(ink),
    muted: rgba(mix(ink, opaqueBackground, 0.28)),
    surface: rgba(mix(opaqueBackground, ink, 0.025)),
    'surface-raised': rgba(mix(opaqueBackground, ink, 0.065)),
    'surface-hover': rgba(mix(opaqueBackground, ink, 0.12)),
    line: rgba(mix(opaqueBackground, ink, 0.28)),
    accent: accent,
    'on-accent': mode === 'dark' ? '#0b0b0b' : '#ffffff',
    'accent-soft': rgba(
      mix(opaqueBackground, mode === 'dark' ? [217, 177, 65] : [163, 53, 57], 0.13)
    ),
    danger: mode === 'dark' ? '#ffb4b1' : '#a11a1d',
    'heatmap-empty': rgba(mix(opaqueBackground, ink, 0.15)),
    'heatmap-outside': rgba(mix(opaqueBackground, ink, 0.07))
  };
}
