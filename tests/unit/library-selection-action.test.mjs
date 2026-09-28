import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import * as selection from '../../apps/web/src/lib/library/selection.ts';

// Complete production action with real EventTarget dispatch. Geometry, animation
// frames and pointer capture are explicit platform doubles, not browser evidence.
const source = readFileSync(
  new URL('../../apps/web/src/lib/library/selection-action.ts', import.meta.url),
  'utf8'
);
const output = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const mod = { exports: {} };
compileFunction(output, ['require', 'module', 'exports'])(
  (name) => {
    assert.equal(name, './selection');
    return selection;
  },
  mod,
  mod.exports
);
const { librarySelection } = mod.exports;
function classes() {
  const names = new Set();
  return {
    add: (name) => names.add(name),
    remove: (name) => names.delete(name),
    toggle(name, on) {
      if (on) names.add(name);
      else names.delete(name);
    },
    contains: (name) => names.has(name)
  };
}
function harness(initial = []) {
  const descriptors = new Map();
  const replace = (name, value) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  const win = new EventTarget();
  Object.assign(win, {
    scrollX: 0,
    scrollY: 0,
    innerHeight: 600,
    scrollBy(_x, y) {
      this.scrollY += y;
    },
    getSelection: () => ({ removeAllRanges() {} })
  });
  const frames = new Map(),
    overlays = new Set(),
    captures = new Set(),
    calls = [];
  let sequence = 0;
  const node = new EventTarget();
  const buttons = ['a', 'b', 'c'].map((id, i) => ({
    dataset: { selectionKey: id, selectionIds: JSON.stringify([id]) },
    disabled: false,
    classList: classes(),
    getClientRects: () => [1],
    getBoundingClientRect: () => ({
      left: 20 + i * 100,
      right: 100 + i * 100,
      top: 100,
      bottom: 200
    }),
    focus() {},
    scrollIntoView() {}
  }));
  Object.assign(node, {
    classList: classes(),
    querySelectorAll: () => buttons,
    contains: (button) => buttons.includes(button),
    focus() {},
    getBoundingClientRect: () => ({ top: 0 }),
    setPointerCapture: (id) => captures.add(id),
    hasPointerCapture: (id) => captures.has(id),
    releasePointerCapture: (id) => captures.delete(id)
  });
  replace('window', win);
  replace('navigator', { platform: 'Linux' });
  replace('document', {
    activeElement: null,
    querySelector: () => null,
    body: { append: (el) => overlays.add(el) },
    createElement: () => {
      const el = { style: {}, setAttribute() {}, remove: () => overlays.delete(el) };
      return el;
    }
  });
  replace('requestAnimationFrame', (callback) => {
    const id = ++sequence;
    frames.set(id, callback);
    return id;
  });
  replace('cancelAnimationFrame', (id) => frames.delete(id));
  const options = {
    enabled: !!initial.length,
    busy: false,
    scope: 'books',
    selected: new Set(initial),
    change: (ids) => calls.push([...ids].sort()),
    cancel() {}
  };
  const action = librarySelection(node, options);
  const emptySpace = { closest: (selector) => (selector.includes('.shelf-grid') ? node : null) };
  function fire(type, x, y, pointerId = 1, pointerType = 'mouse') {
    const event = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries({
      clientX: x,
      clientY: y,
      pointerId,
      pointerType,
      button: 0,
      target: emptySpace
    }))
      Object.defineProperty(event, key, { value });
    (type === 'pointerdown' || type === 'lostpointercapture' ? node : win).dispatchEvent(event);
  }
  return {
    action,
    options,
    calls,
    frames,
    overlays,
    captures,
    win,
    start() {
      fire('pointerdown', 10, 90);
      fire('pointermove', 110, 210);
    },
    fire,
    frame() {
      const pending = [...frames.values()];
      frames.clear();
      for (const f of pending) f(16);
    },
    close() {
      action.destroy();
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    }
  };
}

test('release uses its final pointer position rather than the preceding move', () => {
  const h = harness();
  try {
    h.start();
    h.frame();
    h.fire('pointerup', 210, 210);
    assert.deepEqual(h.calls, [['a', 'b']]);
    assert.equal(h.frames.size, 0);
    assert.equal(h.overlays.size, 0);
    assert.equal(h.captures.size, 0);
  } finally {
    h.close();
  }
});
test('release can shrink the preview to the final pointer position', () => {
  const h = harness();
  try {
    h.start();
    h.fire('pointermove', 310, 210);
    h.frame();
    h.fire('pointerup', 110, 210);
    assert.deepEqual(h.calls, [['a']]);
  } finally {
    h.close();
  }
});
for (const type of ['pointercancel', 'lostpointercapture'])
  test(`${type} from another pointer cannot cancel this gesture`, () => {
    const h = harness();
    try {
      h.start();
      h.fire(type, 110, 210, 2, 'touch');
      h.fire('pointerup', 110, 210);
      assert.deepEqual(h.calls, [['a']]);
    } finally {
      h.close();
    }
  });
for (const type of ['pointercancel', 'lostpointercapture'])
  test(`${type} from this pointer cancels without committing the preview`, () => {
    const h = harness(['c']);
    try {
      h.start();
      h.frame();
      h.fire(type, 110, 210);
      h.fire('pointerup', 110, 210);
      assert.deepEqual(h.calls, []);
      assert.deepEqual([...h.options.selected], ['c']);
      assert.equal(h.frames.size, 0);
      assert.equal(h.overlays.size, 0);
    } finally {
      h.close();
    }
  });
test('release does not perform an extra automatic scroll', () => {
  const h = harness();
  try {
    h.start();
    h.fire('pointermove', 110, 595);
    h.frame();
    const before = h.win.scrollY;
    h.fire('pointerup', 110, 595);
    assert.equal(h.win.scrollY, before);
  } finally {
    h.close();
  }
});
test('scope replacement and disposal discard live previews and their frame callbacks', () => {
  const h = harness(['c']);
  try {
    h.start();
    h.action.update({ ...h.options, scope: 'different' });
    h.fire('pointerup', 110, 210);
    assert.deepEqual(h.calls, []);
    assert.equal(h.frames.size, 0);
    assert.equal(h.overlays.size, 0);
    h.start();
    h.action.destroy();
    h.fire('pointerup', 110, 210);
    assert.deepEqual(h.calls, []);
    assert.equal(h.frames.size, 0);
  } finally {
    h.close();
  }
});
