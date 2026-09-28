/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  galleryShortcutAllowed,
  galleryWheelStep
} from '../../apps/web/src/lib/components/book-reader/book-reader-image-gallery/gallery-input.ts';

// Structural platform doubles test input decisions. Native DOM/app cases run
// separately in the Appearance workflow; these are not browser-layout tests.
function fixture(t) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  class Element {
    constructor(parent = null) {
      this.parent = parent;
      this.isConnected = true;
      this.clientWidth = this.scrollWidth = 300;
      this.clientHeight = this.scrollHeight = 300;
      this.style = { overflowX: 'auto', overflowY: 'auto' };
      this.ownerDocument = document;
    }
    contains(other) {
      return other === this || Boolean(other?.parent && this.contains(other.parent));
    }
    closest(selector) {
      if (selector.startsWith('[role="dialog"]')) return this.modal ?? gallery;
      if (selector === 'input, textarea, select') return this.field ? this : null;
      return this.control ? this : null;
    }
  }
  const document = { defaultView: { getComputedStyle: (node) => node.style } };
  globalThis.HTMLElement = Element;
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'HTMLElement', descriptor);
    else delete globalThis.HTMLElement;
  });
  const gallery = new Element();
  const viewer = new Element(gallery);
  const image = new Element(viewer);
  document.activeElement = viewer;
  const wheel = (extra = {}) => ({
    deltaY: 100,
    deltaX: 0,
    composedPath: () => [image, viewer, gallery],
    ...extra
  });
  const key = (extra = {}) => ({ key: 'ArrowRight', target: viewer, ...extra });
  return { gallery, viewer, image, document, wheel, key };
}

test('focused roomy viewer retains ordinary vertical wheel paging', (t) => {
  const h = fixture(t);
  assert.equal(galleryWheelStep(h.wheel(), h.viewer), 1);
  assert.equal(galleryWheelStep(h.wheel({ deltaY: -1 }), h.viewer), -1);
});

test('zoom, modifiers, horizontal motion and canceled gestures remain native', (t) => {
  const h = fixture(t);
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'defaultPrevented']) {
    assert.equal(galleryWheelStep(h.wheel({ [modifier]: true }), h.viewer), 0, modifier);
  }
  assert.equal(galleryWheelStep(h.wheel({ deltaX: NaN }), h.viewer), 0);
  for (const deltaY of [0, NaN, Infinity])
    assert.equal(galleryWheelStep(h.wheel({ deltaY }), h.viewer), 0);
  assert.equal(galleryWheelStep(h.wheel({ deltaX: 110 }), h.viewer), 0);
});

test('a wheel over the header or another pane cannot change the selected image', (t) => {
  const h = fixture(t);
  assert.equal(galleryWheelStep(h.wheel({ composedPath: () => [h.gallery] }), h.viewer), 0);
  h.document.activeElement = h.gallery;
  assert.equal(galleryWheelStep(h.wheel(), h.viewer), 0);
  h.viewer.isConnected = false;
  assert.equal(galleryWheelStep(h.wheel(), h.viewer), 0);
  assert.equal(galleryWheelStep(h.wheel(), null), 0);
});

test('viewer and nested image scrolling take priority even at a scroll boundary', (t) => {
  const h = fixture(t);
  h.viewer.scrollHeight = 500;
  assert.equal(galleryWheelStep(h.wheel(), h.viewer), 0);
  h.viewer.scrollHeight = h.viewer.clientHeight;
  h.image.scrollWidth = 500;
  assert.equal(galleryWheelStep(h.wheel(), h.viewer), 0);
  h.image.style.overflowX = 'hidden';
  assert.equal(galleryWheelStep(h.wheel(), h.viewer), 1);
});

test('ordinary gallery shortcuts remain available in the active dialog', (t) => {
  const h = fixture(t);
  assert.equal(galleryShortcutAllowed(h.key(), h.gallery), true);
  assert.equal(galleryShortcutAllowed(h.key({ key: ' ' }), h.gallery), true);
});

test('native button activation cannot be consumed by a custom gallery binding', (t) => {
  const h = fixture(t);
  h.image.control = true;
  for (const key of ['Enter', ' '])
    assert.equal(galleryShortcutAllowed(h.key({ key, target: h.image }), h.gallery), false);
  assert.equal(galleryShortcutAllowed(h.key({ target: h.image }), h.gallery), true);
});

test('IME, editing, modifiers and dialog-owned Tab/Escape bypass gallery bindings', (t) => {
  const h = fixture(t);
  for (const modifier of [
    'isComposing',
    'ctrlKey',
    'metaKey',
    'altKey',
    'shiftKey',
    'defaultPrevented'
  ]) {
    assert.equal(galleryShortcutAllowed(h.key({ [modifier]: true }), h.gallery), false);
  }
  for (const key of ['Tab', 'Escape'])
    assert.equal(galleryShortcutAllowed(h.key({ key }), h.gallery), false);
  h.image.field = true;
  assert.equal(galleryShortcutAllowed(h.key({ target: h.image }), h.gallery), false);
  h.image.field = false;
  h.image.isContentEditable = true;
  assert.equal(galleryShortcutAllowed(h.key({ target: h.image }), h.gallery), false);
});

test('underlying and detached galleries cannot handle input from a newer context', (t) => {
  const h = fixture(t);
  h.image.modal = h.image;
  assert.equal(galleryShortcutAllowed(h.key({ target: h.image }), h.gallery), false);
  assert.equal(galleryShortcutAllowed(h.key({ target: {} }), h.gallery), false);
  h.gallery.isConnected = false;
  assert.equal(galleryShortcutAllowed(h.key(), h.gallery), false);
});
