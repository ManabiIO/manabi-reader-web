import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';

// Run the complete production component script, not a second implementation.
// Rendering and native form behavior are covered separately by the built-app suite.
function dialog(name, props = {}) {
  const path = new URL(`../../apps/web/src/lib/components/${name}-dialog.svelte`, import.meta.url);
  const source = readFileSync(path, 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  let script = stripTypeScriptTypes(source.replace(/^\s*import[\s\S]*?;\n/gm, ''));
  script = script.replace(
    /export let (\w+)\s*(?:=\s*([^;]+))?;/g,
    (_match, key, fallback) =>
      `let ${key} = props.${key} === undefined ? (${fallback ?? 'undefined'}) : props.${key};`
  );
  const destroys = [];
  const received = [];
  const dispatched = [];
  const api = new Function(
    'props',
    'onDestroy',
    'createEventDispatcher',
    script +
      `
    return { closeDialog,
      confirm: () => ${name === 'number' ? "typeof submit === 'function' ? submit() : closeDialog(target)" : 'closeDialog()'},
      setTarget: value => { ${name === 'number' ? 'target = value;' : ''} },
      getTarget: () => ${name === 'number' ? 'target' : 'undefined'},
      getError: () => ${name === 'number' ? 'error' : "''"}
    };`
  )(
    {
      dialogHeader: 'Jump to Position',
      minValue: 1,
      maxValue: 100,
      resolver: (value) => received.push(value),
      ...props
    },
    (callback) => destroys.push(callback),
    () => (event) => dispatched.push(event)
  );
  return {
    ...api,
    received,
    dispatched,
    destroy: () => destroys.forEach((callback) => callback())
  };
}

for (const value of [undefined, NaN, Infinity, 1.5, 0, 101]) {
  test(`invalid position ${String(value)} remains open without resolving`, () => {
    const h = dialog('number');
    h.setTarget(value);
    h.confirm();
    assert.deepEqual(h.received, []);
    assert.deepEqual(h.dispatched, []);
    assert.ok(h.getError());
    h.destroy();
    assert.deepEqual(h.received, [undefined]);
  });
}

test('a range beginning above one initializes to its valid first position', () => {
  const h = dialog('number', { minValue: 5 });
  assert.equal(h.getTarget(), 5);
  h.confirm();
  assert.deepEqual(h.received, [5]);
});

test('valid boundary positions resolve without changing their value', () => {
  for (const position of [1, 100]) {
    const h = dialog('number');
    h.setTarget(position);
    h.confirm();
    h.destroy();
    assert.deepEqual(h.received, [position]);
    assert.deepEqual(h.dispatched, ['close']);
  }
});

test('invalid range cannot publish a fabricated or fractional position', () => {
  for (const limits of [{ minValue: 2, maxValue: 1 }, { minValue: 0.5 }, { maxValue: Infinity }]) {
    const h = dialog('number', limits);
    h.setTarget(1);
    h.confirm();
    assert.deepEqual(h.received, []);
    assert.ok(h.getError());
  }
});

test('position confirmation and cancellation can settle only once', () => {
  const h = dialog('number');
  h.setTarget(30);
  h.confirm();
  h.closeDialog();
  h.confirm();
  h.destroy();
  assert.deepEqual(h.received, [30]);
  assert.deepEqual(h.dispatched, ['close']);
});

test('confirmation preserves the existing true-means-cancelled callback contract', () => {
  for (const cancelled of [true, false]) {
    const h = dialog('confirm');
    h.closeDialog(cancelled);
    h.destroy();
    assert.deepEqual(h.received, [cancelled]);
    assert.deepEqual(h.dispatched, ['close']);
  }
});

test('a second confirmation cannot resolve or dispatch a second close', () => {
  const h = dialog('confirm');
  h.confirm();
  h.closeDialog(true);
  h.confirm();
  h.destroy();
  assert.deepEqual(h.received, [false]);
  assert.deepEqual(h.dispatched, ['close']);
});

test('destroyed unresolved dialogs cancel once even if cleanup is repeated', () => {
  for (const [name, cancellation] of [
    ['number', undefined],
    ['confirm', true]
  ]) {
    const h = dialog(name);
    h.destroy();
    h.destroy();
    assert.deepEqual(h.received, [cancellation]);
    assert.deepEqual(h.dispatched, []);
  }
});
