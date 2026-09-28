/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

// Run the entire production handler with controlled scheduling and candidates.
// The production candidate helper and native focus are covered by the browser suite.
const source = await readFile(
  new URL('../../apps/web/src/lib/hooks/focus-trap-fallback.ts', import.meta.url),
  'utf8'
);
const script = stripTypeScriptTypes(source)
  .replace(/import \{ modalTabCandidates \} from '.\/modal-tab-candidates';/, '')
  .replace('export function containModalTab', 'function containModalTab');

function harness() {
  const frames = new Map();
  const pointers = new Set();
  let next = 0;
  const document = {
    activeElement: null,
    hasFocus: () => true,
    modals: [],
    querySelectorAll() {
      return this.modals;
    },
    addEventListener(type, handler) {
      if (type === 'pointerdown') pointers.add(handler);
    },
    removeEventListener(type, handler) {
      if (type === 'pointerdown') pointers.delete(handler);
    },
    defaultView: {
      requestAnimationFrame(callback) {
        const id = next++;
        frames.set(id, callback);
        return id;
      },
      cancelAnimationFrame(id) {
        frames.delete(id);
      },
      getComputedStyle: (node) => ({ visibility: node.visible ? 'visible' : 'hidden' })
    }
  };
  class Element {
    constructor(parent = null, modal = false) {
      this.parent = parent;
      this.modal = modal;
      this.visible = true;
      this.isConnected = true;
      this.ownerDocument = document;
      this.candidates = [];
    }
    contains(node) {
      return node === this || Boolean(node?.parent && this.contains(node.parent));
    }
    closest(selector) {
      if (selector.startsWith('[role=')) return this.modal ? this : this.parent?.closest(selector);
      return this.hidden ? this : this.parent?.closest(selector);
    }
    matches() {
      return Boolean(this.closed);
    }
    getClientRects() {
      return this.visible ? [{}] : [];
    }
    focus() {
      if (!this.unfocusable) document.activeElement = this;
    }
  }
  const context = { Element, HTMLElement: Element, modalTabCandidates: (node) => node.candidates };
  runInNewContext(script + '\nglobalThis.run = containModalTab;', context);
  const modal = new Element(null, true);
  const first = new Element(modal);
  const last = new Element(modal);
  modal.candidates = [first, last];
  const outside = new Element();
  document.modals = [modal];
  document.activeElement = outside;
  const event = {
    currentTarget: modal,
    target: first,
    key: 'Tab',
    shiftKey: false,
    defaultPrevented: false
  };
  return {
    document,
    Element,
    modal,
    first,
    last,
    outside,
    event,
    frames,
    pointers,
    run: (changes = {}) => context.run(Object.assign(event, changes)),
    flush() {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback();
    }
  };
}

test('forward and reverse fallback focus the proper candidates and clean up', () => {
  for (const shiftKey of [false, true]) {
    const h = harness();
    h.run({ shiftKey });
    h.flush();
    assert.equal(h.document.activeElement, shiftKey ? h.last : h.first);
    assert.equal(h.pointers.size, 0);
  }
});

test('late bubble prevention and browser modifier shortcuts are respected', () => {
  const h = harness();
  h.run();
  h.event.defaultPrevented = true;
  h.flush();
  assert.equal(h.document.activeElement, h.outside);
  for (const key of ['ctrlKey', 'metaKey', 'altKey']) {
    const next = harness();
    next.run({ [key]: true });
    assert.equal(next.frames.size, 0);
  }
});

test('a later pointer gesture cancels pending Tab recovery including frame zero', () => {
  const h = harness();
  h.run();
  for (const cancel of [...h.pointers]) cancel();
  h.flush();
  assert.equal(h.document.activeElement, h.outside);
  assert.equal(h.pointers.size, 0);
});

test('focus inside the dialog is left to the primitive', () => {
  const h = harness();
  h.run();
  h.last.focus();
  h.flush();
  assert.equal(h.document.activeElement, h.last);
});

test('a newer sibling dialog owns focus even before its autofocus runs', () => {
  for (const focused of [false, true]) {
    const h = harness();
    h.run();
    const child = new h.Element(null, true);
    h.document.modals.push(child);
    if (focused) child.focus();
    h.flush();
    assert.equal(h.document.activeElement, focused ? child : h.outside);
  }
});

test('capture from an outer modal cannot also recover Tab from a nested modal', () => {
  const h = harness();
  const child = new h.Element(h.modal, true);
  h.run({ target: new h.Element(child) });
  assert.equal(h.frames.size, 0);
});

test('closed, disconnected, hidden and browser-inactive contexts cannot recover focus', () => {
  for (const state of ['closed', 'isConnected', 'hidden', 'visible', 'inactive']) {
    const h = harness();
    h.run();
    if (state === 'inactive') h.document.hasFocus = () => false;
    else h.modal[state] = !['isConnected', 'visible'].includes(state);
    h.flush();
    assert.equal(h.document.activeElement, h.outside, state);
    assert.equal(h.pointers.size, 0);
  }
});

test('unfocusable candidates do not prevent trying the next candidate or container', () => {
  const h = harness();
  h.first.unfocusable = true;
  h.run();
  h.flush();
  assert.equal(h.document.activeElement, h.last);
  h.last.unfocusable = true;
  h.document.activeElement = h.outside;
  h.run();
  h.flush();
  assert.equal(h.document.activeElement, h.modal);
});

test('a following key cancels pending fallback without leaving a pointer listener', () => {
  const h = harness();
  h.run();
  h.run({ key: 'Escape' });
  h.flush();
  assert.equal(h.document.activeElement, h.outside);
  assert.equal(h.pointers.size, 0);
});
