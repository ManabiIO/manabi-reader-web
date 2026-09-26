import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import {
  availableThemes,
  customThemeValues,
  portableThemeName,
  initialAppearance,
  parseColor,
  parseCustomThemes,
  readerTheme,
  themeForMode,
  themeProperties
} from '../../apps/web/src/lib/data/theme-option.ts';
import {
  imageDimensions,
  maxBackgroundPixels
} from '../../apps/web/src/lib/appearance/image-format.ts';

function luminance(color) {
  return color
    .slice(0, 3)
    .map((v) => v / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(a, b) {
  const values = [luminance(parseColor(a)), luminance(parseColor(b))].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
const custom = {
  personal: { ...availableThemes.get('gray-theme'), backgroundColor: 'rgba(24, 20, 32, 1)' }
};

test('new installs use System; released preset and custom appearances are preserved', () => {
  assert.equal(initialAppearance(null, null), 'system');
  for (const id of availableThemes.keys()) {
    assert.equal(
      initialAppearance(null, id),
      id === 'manabi-theme'
        ? 'system'
        : ['gray-theme', 'dark-theme', 'black-theme'].includes(id)
          ? 'dark'
          : 'light'
    );
    for (const mode of ['system', 'light', 'dark']) assert.equal(initialAppearance(mode, id), mode);
  }
  assert.equal(initialAppearance(null, 'personal', custom), 'dark');
  assert.equal(initialAppearance(null, 'system-theme'), 'system');
});

test('all 14 preset variants have readable UI surfaces and independent reading palettes', () => {
  for (const id of availableThemes.keys())
    for (const mode of ['light', 'dark']) {
      const p = themeProperties(id, mode);
      for (const surface of ['background', 'muted', 'card', 'accent']) {
        assert.ok(contrast(p['foreground'], p[surface]) >= 4.5, `${id}/${mode} text on ${surface}`);
        assert.ok(
          contrast(p['muted-foreground'], p[surface]) >= 4.5,
          `${id}/${mode} muted on ${surface}`
        );
      }
      assert.ok(
        contrast(
          p['primary'] === 'var(--manabi-red)' ? '#a33539' : p['primary'],
          p['background']
        ) >= 4.5
      );
      assert.ok(Object.values(themeForMode(id, mode)).every(parseColor));
    }
  assert.equal(themeForMode('manabi-theme', 'light').backgroundColor, 'rgba(255, 255, 255, 1)');
  assert.equal(themeForMode('manabi-theme', 'dark').backgroundColor, 'rgba(0, 0, 0, 1)');
  assert.equal(themeProperties('manabi-theme', 'light').secondary, '#e5e5ea');
  assert.equal(themeProperties('manabi-theme', 'dark').secondary, '#2c2c2e');
  for (const mode of ['light', 'dark']) {
    const colors = themeProperties('manabi-theme', mode);
    assert.ok(contrast(colors['secondary-foreground'], colors.secondary) >= 4.5);
  }
});

test('custom themes retain all authored fields and never save the synthesized counterpart', () => {
  const before = JSON.stringify(custom);
  assert.deepEqual(themeForMode('personal', 'dark', custom), custom.personal);
  assert.notEqual(
    themeForMode('personal', 'light', custom).backgroundColor,
    custom.personal.backgroundColor
  );
  assert.equal(JSON.stringify(custom), before);
  assert.deepEqual(themeForMode('missing', 'dark'), themeForMode('manabi-theme', 'dark'));
  const broken = { personal: { ...custom.personal, fontColor: 'url(https://invalid.test/)' } };
  assert.deepEqual(themeForMode('personal', 'dark', broken), themeForMode('manabi-theme', 'dark'));
  assert.ok(Object.values(readerTheme).every((value) => /^var\(--reader-[a-z-]+\)$/.test(value)));
});

test('first-paint bootstrap agrees with runtime migration without reading any remote resource', () => {
  const script = readFileSync(
    new URL('../../apps/web/static/appearance-init.js', import.meta.url),
    'utf8'
  );
  for (const theme of [null, ...availableThemes.keys(), 'system-theme', 'personal'])
    for (const appearance of [null, 'system', 'light', 'dark']) {
      const values = { theme, appearance, customThemes: JSON.stringify(custom) };
      const root = { dataset: {}, style: { setProperty() {} } };
      runInNewContext(script, {
        document: { documentElement: root, querySelector: () => null },
        localStorage: { getItem: (key) => values[key] ?? null }
      });
      assert.equal(
        root.dataset.appearance,
        initialAppearance(appearance, theme, custom),
        `${theme}/${appearance}`
      );
    }
  const root = { dataset: {}, style: { setProperty() {} } };
  runInNewContext(script, {
    document: { documentElement: root, querySelector: () => null },
    localStorage: {
      getItem() {
        throw new Error('blocked');
      }
    }
  });
  assert.equal(root.dataset.appearance, 'system');
});

test('image headers reject unsupported, truncated and oversized rasters before decode', () => {
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.write('IHDR', 12);
  png.writeUInt32BE(1200, 16);
  png.writeUInt32BE(800, 20);
  assert.deepEqual(imageDimensions(png, 'image/png'), [1200, 800]);
  png.writeUInt32BE(8193, 16);
  assert.throws(() => imageDimensions(png, 'image/png'), /8192/);
  png.writeUInt32BE(8000, 16);
  png.writeUInt32BE(8000, 20);
  assert.ok(8000 * 8000 > maxBackgroundPixels);
  assert.throws(() => imageDimensions(png, 'image/png'), /24 megapixels/);
  for (const type of ['image/jpeg', 'image/webp', 'image/svg+xml'])
    assert.throws(() => imageDimensions(png, type));
  assert.throws(() => imageDimensions(png.subarray(0, 20), 'image/png'));
});

test('JPEG and WebP dimension admission and motion restrictions', () => {
  const jpeg = Buffer.from([255, 216, 255, 192, 0, 8, 8, 0, 60, 0, 80, 0]);
  assert.deepEqual(imageDimensions(jpeg, 'image/jpeg'), [80, 60]);
  const webp = Buffer.alloc(30);
  webp.write('RIFF');
  webp.write('WEBP', 8);
  webp.write('VP8X', 12);
  webp[24] = 79;
  webp[27] = 59;
  assert.deepEqual(imageDimensions(webp, 'image/webp'), [80, 60]);
  webp[20] = 2;
  assert.throws(() => imageDimensions(webp, 'image/webp'), /still image/);
});

test('selection and meaningful control borders have actual composited contrast', () => {
  function over(foreground, background) {
    const a = parseColor(foreground),
      b = parseColor(background);
    return `rgba(${a
      .slice(0, 3)
      .map((v, i) => v * a[3] + b[i] * (1 - a[3]))
      .join(', ')}, 1)`;
  }
  for (const id of availableThemes.keys())
    for (const mode of ['light', 'dark']) {
      const p = themeProperties(id, mode);
      const selection = over(p['reader-selection-background-color'], p['background']);
      const selectedText = over(p['reader-selection-font-color'], selection);
      assert.ok(contrast(selectedText, selection) >= 4.5, `${id}/${mode} selected text`);
      for (const surface of ['background', 'muted', 'card', 'accent'])
        assert.ok(contrast(p['input'], p[surface]) >= 3, `${id}/${mode} control on ${surface}`);
    }
});

test('custom reading colors do not make application chrome unreadable', () => {
  for (const shade of [0, 32, 96, 112, 127, 128, 144, 192, 255])
    for (const alpha of [0, 0.2, 1]) {
      const palette = {
        ...custom.personal,
        backgroundColor: `rgba(${shade}, ${shade}, ${shade}, ${alpha})`
      };
      const saved = { personal: palette };
      for (const mode of ['light', 'dark']) {
        const p = themeProperties('personal', mode, saved);
        for (const surface of ['background', 'muted', 'card', 'accent']) {
          assert.ok(contrast(p['foreground'], p[surface]) >= 4.5);
          assert.ok(contrast(p['muted-foreground'], p[surface]) >= 4.5);
          assert.ok(contrast(p['input'], p[surface]) >= 3);
        }
      }
      assert.deepEqual(themeForMode('personal', shade < 128 ? 'dark' : 'light', saved), palette);
    }
});

test('bootstrap handles damaged optional JSON, hex colors, transparency and explicit overrides', () => {
  const script = readFileSync(
    new URL('../../apps/web/static/appearance-init.js', import.meta.url),
    'utf8'
  );
  const palettes = [
    '{broken',
    'null',
    '[]',
    '42',
    ...['#112233', '#888888', 'rgba(20, 30, 40, 0.2)', 'rgba(.., 0, 0, 1)'].map((backgroundColor) =>
      JSON.stringify({ personal: { ...custom.personal, backgroundColor } })
    )
  ];
  for (const raw of palettes)
    for (const appearance of [null, 'system', 'light', 'dark']) {
      const styles = {};
      const root = { dataset: {}, style: { setProperty: (key, value) => (styles[key] = value) } };
      const values = { theme: 'personal', appearance, customThemes: raw };
      let nativeScheme;
      runInNewContext(script, {
        document: {
          documentElement: root,
          querySelector: () => ({ setAttribute: (_key, value) => (nativeScheme = value) })
        },
        localStorage: { getItem: (key) => values[key] ?? null }
      });
      const parsed = parseCustomThemes(raw);
      const expected = initialAppearance(appearance, 'personal', parsed);
      assert.equal(root.dataset.appearance, expected, `${raw}/${appearance}`);
      assert.equal(nativeScheme, expected === 'system' ? 'light dark' : expected);
      for (const mode of ['light', 'dark'])
        if (styles[`--${mode}-background`])
          assert.equal(
            styles[`--${mode}-background`],
            themeProperties('personal', mode, parsed).background
          );
    }
});

test('custom editor reads hex/rgb/rgba, preserves zero alpha and exposes only known fields', () => {
  const authored = {
    ...availableThemes.get('gray-theme'),
    fontColor: '#ffeecc',
    backgroundColor: 'rgba(12, 24, 36, 0)',
    selectionFontColor: 'rgb(255, 255, 255)',
    extra: { oldMetadata: true }
  };
  const values = customThemeValues(authored);
  assert.equal(values.fontColor.hexExpression, '#ffeecc');
  assert.equal(values.backgroundColor.hexExpression, '#0c1824');
  assert.equal(values.backgroundColor.alphaValue, 0);
  assert.equal(values.backgroundColor.rgbaExpression, authored.backgroundColor);
  assert.equal(values.selectionFontColor.alphaValue, 1);
  assert.equal(Object.keys(values).length, 7);
  assert.equal(customThemeValues({ fontColor: 12 }).fontColor.hexExpression, '#ffffff');
  assert.equal(themeProperties('notes', 'dark', { notes: authored })['reader-extra'], undefined);
});

test('only portable preset names cross the account boundary', () => {
  for (const id of availableThemes.keys()) assert.equal(portableThemeName(id), id);
  assert.equal(portableThemeName('system-theme'), 'manabi-theme');
  for (const id of ['My personal notes', 'personal', '', null, 'constructor', 42])
    assert.equal(portableThemeName(id), undefined);
});

test('custom names that match Object.prototype retain both mode variants', () => {
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const palettes = Object.fromEntries([[name, custom.personal]]);
    const saved = JSON.stringify(palettes);
    const decoded = parseCustomThemes(saved);
    assert.ok(Object.hasOwn(decoded, name));
    for (const mode of ['light', 'dark']) {
      assert.ok(Object.values(themeForMode(name, mode, decoded)).every(parseColor));
      assert.ok(parseColor(themeProperties(name, mode, decoded).background));
    }
    assert.equal(JSON.stringify(decoded), saved);
  }
});
