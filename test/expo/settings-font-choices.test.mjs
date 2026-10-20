/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Buffer } from 'node:buffer';
const { outputFiles } = await build({
  stdin: {
    contents: `export * from './apps/web/src/features/settings/font-choices'; export * from './apps/web/src/lib/data/fonts';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node'
});
const { fontChoices, availablePrimaryFonts, primaryPackagedFonts, secondaryPackagedFonts } =
  await import(
    'data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64')
  );

test('the common font catalog exposes a local face only after positive availability', () => {
  for (const availability of [undefined, false])
    assert.deepEqual(availablePrimaryFonts(availability), primaryPackagedFonts);
  assert.deepEqual(availablePrimaryFonts(true), ['YuKyokasho', ...primaryPackagedFonts]);
  const copy = availablePrimaryFonts(false);
  copy.splice(0);
  assert.ok(availablePrimaryFonts(false).includes('Klee One'));
  assert.deepEqual(secondaryPackagedFonts, [
    'System Sans',
    'Noto Sans JP',
    'KZ UDGothic',
    'Sans-Serif'
  ]);
});
test('effective fallback selection never normalizes the saved font without an explicit choice', () => {
  const choices = fontChoices(availablePrimaryFonts(false), 'YuKyokasho', 'Klee One');
  assert.equal(choices.value, 'Klee One');
  assert.equal(
    choices.choose('Klee One'),
    'Klee One',
    'explicit fallback choice remains meaningful'
  );
  assert.equal(choices.choose('Klee One', true), null);
  assert.equal(choices.choose('YuKyokasho'), null, 'unavailable stale choices cannot be saved');
  assert.equal(fontChoices(['Klee One'], 'Klee One').choose('Klee One'), null);
});
test('unknown and explicit CSS font families remain visible without becoming catalog choices', () => {
  for (const saved of ['', 'Imported Face', '"Local Face", serif', '  Custom  ']) {
    const choices = fontChoices(['Klee One', 'Klee One'], saved);
    assert.equal(choices.value, saved);
    assert.equal(choices.options.length, 2);
    assert.equal(choices.options[0].value, saved);
    assert.equal(choices.choose(saved), null);
    assert.equal(choices.choose('not-in-catalog'), null);
    assert.equal(choices.choose('Klee One'), 'Klee One');
  }
});
