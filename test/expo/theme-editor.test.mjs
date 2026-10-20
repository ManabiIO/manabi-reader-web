/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const { outputFiles } = await build({
  entryPoints: ['apps/web/src/features/settings/theme-editor.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node'
});
const editor = await import(
  'data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64')
);
const palette = {
  fontColor: '#112233',
  backgroundColor: 'rgba(240, 245, 255, 0)',
  selectionFontColor: '#ffffff',
  selectionBackgroundColor: '#24506c',
  hintFuriganaFontColor: 'rgba(1, 2, 3, 0.2)',
  hintFuriganaShadowColor: '#000000',
  tooltipTextFontColor: '#112233'
};
test('theme copy resolves adaptive presets for each appearance and preserves custom expressions', () => {
  const custom = { constructor: palette };
  const choices = [{ id: 'water-theme' }, { id: 'manabi-theme' }, { id: 'constructor' }];
  const light = editor.themeCopyOptions(choices, 'light', custom);
  const dark = editor.themeCopyOptions(choices, 'dark', custom);
  assert.notDeepEqual(light[1].colors, dark[1].colors);
  assert.deepEqual(light[2].colors, palette);
  assert.notDeepEqual(
    dark[2].colors,
    palette,
    'opposite appearance copies the derived counterpart'
  );
  assert.deepEqual(custom.constructor, palette, 'derivation never rewrites the stored palette');
  assert.deepEqual(editor.themeDraftPalette(palette), palette);
});
test('theme color updates retain alpha including zero and reject invalid native draft expressions', () => {
  assert.equal(editor.colorWithAlpha('#112233', 0), 'rgba(17,34,51,0)');
  assert.equal(editor.colorWithAlpha('rgba(17,34,51,0)', 0.4), 'rgba(17,34,51,0.4)');
  for (const alpha of [NaN, -1, 2])
    assert.equal(editor.colorWithAlpha('#112233', alpha), 'rgba(17,34,51,1)');
  assert.equal(editor.themePaletteError(palette), '');
  assert.match(editor.themePaletteError({ ...palette, backgroundColor: '#invalid' }), /Background/);
  assert.equal(editor.colorWithAlpha('#invalid', 0.5), '#invalid');
});
test('shared theme validation preserves web names without weakening the native owner boundary', () => {
  assert.match(editor.themeNameError('', '', []), /Enter/);
  assert.match(editor.themeNameError('manabi-theme', '', []), /reserved/);
  assert.match(editor.themeNameError('system-theme', '', []), /reserved/);
  assert.match(editor.themeNameError('Other', 'Original', ['Original', 'Other']), /already exists/);
  assert.equal(editor.themeNameError('Original', 'Original', ['Original']), '');
  for (const name of ['constructor', 'prototype', '__proto__'])
    assert.equal(editor.themeNameError(name, '', []), '');
});
