import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dialogComponent } from './react-component-harness.mjs';

test('confirmation titles scroll with content so enlarged wrapped headings cannot displace the footer', () => {
  const component = dialogComponent('ConfirmDialog', {
    dialogHeader: 'Complete Book',
    dialogMessage: 'Would you like to complete this Book?',
    resolver() {}
  });
  const scroll = component.find((node) => Object.hasOwn(node.props, 'data-dialog-scroll'));
  assert.ok(scroll);
  assert.ok(component.find((node) => node.type === 'h2', scroll));
  assert.equal(
    component.find((node) => node.type === 'footer', scroll),
    undefined
  );
  const footer = component.find((node) => node.type === 'footer');
  assert.ok(footer.props.className.includes('shrink-0'));
  assert.match(component.text(footer), /CancelConfirm/);
});

function dialog(name, props = {}) {
  const received = [],
    dispatched = [];
  const component = dialogComponent(
    { number: 'NumberDialog', confirm: 'ConfirmDialog', 'external-read': 'ExternalReadDialog' }[
      name
    ],
    {
      dialogHeader: 'Jump to Position',
      dialogMessage: 'Continue?',
      minValue: 1,
      maxValue: 100,
      resolver: (value) => received.push(value),
      onClose: () => dispatched.push('close'),
      ...props
    }
  );
  const closeDialog = (value) => {
    const label =
      name === 'confirm'
        ? value
          ? 'Cancel'
          : 'Confirm'
        : name === 'external-read'
          ? value === 'export'
            ? 'Open Export'
            : value === ''
              ? 'Continue'
              : 'Cancel'
          : 'Cancel';
    component.button(label).props.onClick();
  };
  return {
    received,
    dispatched,
    closeDialog,
    confirm: () => (name === 'number' ? component.submit() : closeDialog(false)),
    setTarget: (value) =>
      component.change(value === undefined || Number.isNaN(value) ? '' : String(value)),
    getTarget: () => Number(component.input().props.value),
    getError: () => component.text(component.find((node) => node.props.role === 'alert')),
    destroy: () => component.dispose(),
    strictReplay: () => component.strictReplay(),
    flush: () => component.flush()
  };
}

for (const value of [undefined, NaN, Infinity, 1.5, 0, 101]) {
  test(`invalid position ${String(value)} remains open without resolving`, async () => {
    const h = dialog('number');
    h.setTarget(value);
    h.confirm();
    assert.deepEqual(h.received, []);
    assert.deepEqual(h.dispatched, []);
    assert.ok(h.getError());
    await h.destroy();
    assert.deepEqual(h.received, [undefined]);
  });
}

test('a range beginning above one initializes to its valid first position', async () => {
  const h = dialog('number', { minValue: 5 });
  assert.equal(h.getTarget(), 5);
  h.confirm();
  assert.deepEqual(h.received, [5]);
});

test('valid boundary positions resolve without changing their value', async () => {
  for (const position of [1, 100]) {
    const h = dialog('number');
    h.setTarget(position);
    h.confirm();
    await h.destroy();
    assert.deepEqual(h.received, [position]);
    assert.deepEqual(h.dispatched, ['close']);
  }
});

test('invalid range cannot publish a fabricated or fractional position', async () => {
  for (const limits of [{ minValue: 2, maxValue: 1 }, { minValue: 0.5 }, { maxValue: Infinity }]) {
    const h = dialog('number', limits);
    h.setTarget(1);
    h.confirm();
    assert.deepEqual(h.received, []);
    assert.ok(h.getError());
  }
});

test('position confirmation and cancellation can settle only once', async () => {
  const h = dialog('number');
  h.setTarget(30);
  h.confirm();
  h.closeDialog();
  h.confirm();
  await h.destroy();
  assert.deepEqual(h.received, [30]);
  assert.deepEqual(h.dispatched, ['close']);
});

test('confirmation preserves the existing true-means-cancelled callback contract', async () => {
  for (const cancelled of [true, false]) {
    const h = dialog('confirm');
    h.closeDialog(cancelled);
    await h.destroy();
    assert.deepEqual(h.received, [cancelled]);
    assert.deepEqual(h.dispatched, ['close']);
  }
});

test('a second confirmation cannot resolve or dispatch a second close', async () => {
  const h = dialog('confirm');
  h.confirm();
  h.closeDialog(true);
  h.confirm();
  await h.destroy();
  assert.deepEqual(h.received, [false]);
  assert.deepEqual(h.dispatched, ['close']);
});

test('destroyed unresolved dialogs cancel once even if cleanup is repeated', async () => {
  for (const [name, cancellation] of [
    ['number', undefined],
    ['confirm', true]
  ]) {
    const h = dialog(name);
    await h.destroy();
    await h.destroy();
    assert.deepEqual(h.received, [cancellation]);
    assert.deepEqual(h.dispatched, []);
  }
});

test('external-read dismissal cancels an unresolved choice exactly once', async () => {
  const h = dialog('external-read');
  await h.destroy();
  await h.destroy();
  assert.deepEqual(h.received, ['cancel']);
  assert.deepEqual(h.dispatched, []);
});

test('external-read explicit choices own settlement before destruction', async () => {
  for (const result of ['cancel', 'export', '']) {
    const h = dialog('external-read');
    h.closeDialog(result);
    h.closeDialog('cancel');
    await h.destroy();
    assert.deepEqual(h.received, [result]);
    assert.deepEqual(h.dispatched, ['close']);
  }
});

test('Strict Mode effect replay cannot cancel or settle a live confirmation', async () => {
  const h = dialog('confirm');
  h.strictReplay();
  await h.flush();
  assert.deepEqual(h.received, []);
  h.confirm();
  await h.destroy();
  assert.deepEqual(h.received, [false]);
  assert.deepEqual(h.dispatched, ['close']);
});
