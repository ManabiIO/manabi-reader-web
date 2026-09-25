import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  availableThemes,
  parseColor,
  themeProperties
} from '../../apps/web/src/lib/data/theme-option.ts';

function luminance(color) {
  return parseColor(color)
    .slice(0, 3)
    .map((value) => value / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}

function assertCloseContrast(colors, label) {
  const fill = luminance(colors.secondary);
  const tint = luminance(colors['muted-foreground']);
  assert.ok(
    (Math.max(fill, tint) + 0.05) / (Math.min(fill, tint) + 0.05) >= 3,
    `${label}: close icon must contrast with its neutral fill`
  );
}

test('close tint contrasts with its secondary fill in every preset appearance', () => {
  for (const name of availableThemes.keys()) {
    for (const mode of ['light', 'dark']) {
      assertCloseContrast(themeProperties(name, mode), `${name}/${mode}`);
    }
  }
});

test('custom reading backgrounds cannot erase modal dismissal controls', () => {
  for (const shade of [0, 32, 96, 127, 128, 192, 255]) {
    for (const alpha of [0, 0.2, 1]) {
      const custom = {
        personal: {
          ...availableThemes.get('gray-theme'),
          backgroundColor: `rgba(${shade}, ${shade}, ${shade}, ${alpha})`
        }
      };
      for (const mode of ['light', 'dark']) {
        assertCloseContrast(
          themeProperties('personal', mode, custom),
          `custom ${shade}/${alpha}/${mode}`
        );
      }
    }
  }
});
