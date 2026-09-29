import assert from 'node:assert/strict';
import test from 'node:test';
import { bindReaderChromeInteractions } from '../../apps/web/src/lib/reader-chrome-events.ts';

// EventTarget dispatch is real; DOM ownership/selection/geometry are explicit unit doubles.
function harness() {
  let selected = '',
    navigation = 0,
    modal = false;
  const target = new EventTarget(),
    calls = [];
  const previous = globalThis.document;
  globalThis.document = { querySelector: () => (modal ? {} : null) };
  const stop = bindReaderChromeInteractions(target, {
    activity: (kind) => calls.push(kind),
    selection: () => selected,
    navigationRevision: () => navigation
  });
  function fire(type, props = {}, marker = '') {
    const node = {
      nodeType: 1,
      closest: (selector) =>
        marker &&
        selector
          .split(',')
          .map((x) => x.trim())
          .includes(marker)
          ? node
          : null
    };
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(
      event,
      Object.fromEntries(
        Object.entries({
          target: node,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          clientX: 50,
          clientY: 50,
          buttons: type === 'pointerdown' ? 1 : 0,
          button: 0,
          detail: 1,
          timeStamp: type === 'pointerdown' ? 100 : 200,
          ...props
        }).map(([key, value]) => [key, { value, configurable: true }])
      )
    );
    target.dispatchEvent(event);
  }
  return {
    calls,
    fire,
    stop,
    select(value) {
      selected = value;
    },
    navigate() {
      navigation++;
    },
    modal(value) {
      modal = value;
    },
    close() {
      stop();
      globalThis.document = previous;
    }
  };
}

test('blank click commits only on click, while mouse hover has separate activity', () => {
  const h = harness();
  try {
    h.fire('pointerdown');
    assert.deepEqual(h.calls, []);
    h.fire('click');
    assert.deepEqual(h.calls, ['toggle']);
    h.fire('pointermove');
    h.fire('pointermove', { clientX: 51 });
    assert.deepEqual(h.calls, ['toggle', 'pointer']);
  } finally {
    h.close();
  }
});
test('swipes, long press, modified clicks, selection and superseded navigation never toggle', () => {
  const h = harness();
  try {
    for (const variant of [
      'move',
      'long',
      'modifier',
      'selection',
      'previous-selection',
      'navigation',
      'cancel'
    ]) {
      h.select(variant === 'previous-selection' ? 'selected' : '');
      h.fire('pointerdown');
      if (variant === 'move') h.fire('pointermove', { clientX: 80, buttons: 1 });
      if (variant === 'selection') h.select('selected');
      if (variant === 'navigation') h.navigate();
      if (variant === 'cancel') h.fire('pointercancel');
      h.fire(
        'click',
        variant === 'long' ? { timeStamp: 800 } : variant === 'modifier' ? { shiftKey: true } : {}
      );
    }
    assert.deepEqual(h.calls, []);
  } finally {
    h.close();
  }
});
test('ruby, dictionary annotation, images, links and form controls own their clicks', () => {
  const h = harness();
  try {
    for (const marker of [
      'ruby',
      'rt',
      'm-m',
      'm-s',
      'm-t',
      '.m-m',
      '.m-sentence',
      'img',
      'svg',
      'button',
      'a',
      'input',
      '[data-ttu-spoiler-img]'
    ]) {
      h.fire('pointerdown', {}, marker);
      h.fire('click', {}, marker);
    }
    assert.deepEqual(h.calls, []);
    h.modal(true);
    h.fire('pointerdown');
    h.fire('click');
    assert.deepEqual(h.calls, []);
  } finally {
    h.close();
  }
});
test('chrome interaction pins without changing the explicit Show/Hide button action', () => {
  const h = harness();
  try {
    h.fire('pointerdown', {}, '[data-reader-chrome]');
    h.fire('click', {}, '[data-reader-chrome]');
    h.fire('pointerdown', {}, '.reader-controls');
    h.fire('click', {}, '.reader-controls');
    assert.deepEqual(h.calls, ['pin']);
  } finally {
    h.close();
  }
});
test('Tab inside a modal leaves reader chrome collapsed', () => {
  const h = harness();
  try {
    h.modal(true);
    h.fire('keydown', { key: 'Tab' });
    h.fire('keydown', { key: 'Escape' });
    assert.deepEqual(h.calls, []);
    h.modal(false);
    h.fire('keydown', { key: 'Tab' });
    assert.deepEqual(h.calls, ['pin']);
  } finally {
    h.close();
  }
});
test('touch motion does not become mouse reveal and disposal releases every listener', () => {
  const h = harness();
  try {
    h.fire('pointermove', { pointerType: 'touch' });
    assert.deepEqual(h.calls, []);
    h.fire('pointerdown', { pointerType: 'touch' });
    h.fire('click');
    assert.deepEqual(h.calls, ['toggle']);
    h.stop();
    h.fire('pointermove');
    h.fire('pointerdown');
    h.fire('click');
    h.fire('keydown', { key: 'Tab' });
    assert.deepEqual(h.calls, ['toggle']);
  } finally {
    h.close();
  }
});
