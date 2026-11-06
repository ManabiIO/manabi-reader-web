/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { build } from 'esbuild';
const { outputFiles } = await build({
  entryPoints: ['apps/web/src/features/settings/dimension-editor.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node'
});
const { createDimensionEditor } = await import(
  'data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64')
);
const options = {
  value: 137,
  vertical: false,
  first: true,
  width: 900,
  height: 600,
  disabled: false
};
test('dimension gestures preview and commit exact current-axis pixels once without accepting the save for the owner', () => {
  const editor = createDimensionEditor(options);
  assert.equal(editor.getSnapshot().currentValue, '137 px per side');
  editor.preview(50);
  assert.equal(editor.getSnapshot().pixels, 150);
  assert.equal(editor.getSnapshot().value, 137);
  assert.equal(editor.commit(), 150);
  assert.equal(editor.commit(), null);
  assert.equal(editor.getSnapshot().value, 137);
  assert.equal(editor.getSnapshot().percentage, 45);
  editor.configure({ ...options, value: 150 });
  assert.equal(editor.getSnapshot().percentage, 50);
});
test('dimension cancellation and every context change reject the old gesture including an ABA return', () => {
  for (const change of [
    { width: 700 },
    { height: 800 },
    { vertical: true },
    { first: false },
    { value: 200 },
    { disabled: true }
  ]) {
    const editor = createDimensionEditor(options);
    editor.preview(25);
    editor.configure({ ...options, ...change });
    editor.configure(options);
    editor.preview(50);
    assert.equal(editor.commit(), null, JSON.stringify(change));
    editor.preview(25);
    assert.equal(editor.commit(), 75, 'a new gesture after the retired finish is admitted');
    editor.preview(50);
    editor.cancel();
    assert.equal(editor.commit(), null);
  }
});
test('automatic maximum and percentage choices remain explicit and unavailable dimensions never save a fallback', () => {
  const editor = createDimensionEditor({ ...options, first: false, value: 0 });
  assert.equal(editor.getSnapshot().currentValue, 'Automatic');
  assert.equal(editor.getSnapshot().percentage, 95);
  assert.equal(editor.automatic(), 0);
  assert.equal(editor.choose(50), 450);
  editor.configure({ ...options, first: false, value: 0, width: 0 });
  assert.equal(editor.choose(50), null);
  assert.equal(editor.automatic(), 0, 'automatic does not require viewport measurement');
  for (const percentage of [NaN, Infinity, 0, 51, 100]) {
    editor.preview(percentage);
    assert.equal(editor.commit(), null);
  }
  editor.configure({ ...options, first: false, value: 0, disabled: true });
  assert.equal(editor.automatic(), null);
  assert.equal(editor.choose(50), null);
  editor.configure(options);
  assert.equal(editor.automatic(), null, 'margins have no automatic sentinel');
});
test('dimension snapshots remain stable until a real change and subscriptions retire', () => {
  const editor = createDimensionEditor(options);
  const initial = editor.getSnapshot();
  let updates = 0;
  const unsubscribe = editor.subscribe(() => updates++);
  editor.configure({ ...options });
  assert.equal(editor.getSnapshot(), initial);
  assert.equal(updates, 0);
  editor.preview(25);
  assert.equal(updates, 1);
  unsubscribe();
  editor.preview(50);
  assert.equal(updates, 1);
});
