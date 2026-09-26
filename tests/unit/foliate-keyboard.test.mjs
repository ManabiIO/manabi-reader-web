/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { relayReaderKeydown } from '../../apps/web/src/lib/foliate-epub/reader-keyboard.ts';

function fixture() {
  const frame = { isConnected: true };
  const body = {};
  const document = { body, activeElement: frame, querySelector: () => null };
  const host = new EventTarget();
  Object.assign(host, {
    document,
    KeyboardEvent: class extends Event {
      constructor(type, init) {
        super(type, init);
        for (const [name, value] of Object.entries(init)) {
          if (name !== 'bubbles' && name !== 'cancelable') this[name] = value;
        }
      }
    }
  });
  let focuses = 0;
  const source = {
    hasFocus: () => true,
    defaultView: {
      frameElement: frame,
      focus: () => {
        focuses++;
        document.activeElement = frame;
      }
    }
  };
  const target = { nodeType: 1, ownerDocument: source, closest: () => null };
  const key = (code = 'KeyB', value = 'b') => {
    const event = new Event('keydown', { cancelable: true });
    Object.defineProperty(event, 'target', { value: target });
    return Object.assign(event, { code, key: value, repeat: false, isComposing: false });
  };
  return { document, source, frame, target, host, key, focuses: () => focuses };
}
async function environment(run) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const state = fixture();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: state.document });
  try {
    await run(state);
  } finally {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else Reflect.deleteProperty(globalThis, 'document');
  }
}

test('frame keys reach configured shortcuts exactly once and keep focus', async () => {
  await environment(({ host, document, key, focuses }) => {
    let calls = 0;
    host.addEventListener('keydown', (event) => {
      calls++;
      assert.equal(event.code, 'KeyB');
      assert.equal(event.key, 'b');
      document.activeElement = document.body;
      event.preventDefault();
    });
    const event = key();
    relayReaderKeydown(event, host);
    assert.equal(calls, 1);
    assert.equal(event.defaultPrevented, true);
    assert.equal(focuses(), 1);
  });
});

test('an unhandled key is left available to the renderer and native document', async () => {
  await environment(({ host, key, focuses }) => {
    const event = key('ArrowRight', 'ArrowRight');
    relayReaderKeydown(event, host);
    assert.equal(event.defaultPrevented, false);
    assert.equal(focuses(), 0);
  });
});

test('composition, controls and app dialogs do not become reading shortcuts', async () => {
  await environment(({ host, document, key, target }) => {
    let calls = 0;
    host.addEventListener('keydown', () => {
      calls++;
    });
    const composing = key();
    composing.isComposing = true;
    relayReaderKeydown(composing, host);
    const prevented = key();
    prevented.preventDefault();
    relayReaderKeydown(prevented, host);
    target.closest = () => ({});
    relayReaderKeydown(key(), host);
    target.closest = () => null;
    document.querySelector = () => ({});
    relayReaderKeydown(key(), host);
    assert.equal(calls, 0);
  });
});

test('a shortcut opening UI does not have its new focus stolen by the iframe', async () => {
  await environment(({ host, document, key, focuses }) => {
    const input = {};
    host.addEventListener('keydown', (event) => {
      document.activeElement = input;
      event.preventDefault();
    });
    relayReaderKeydown(key(), host);
    assert.equal(document.activeElement, input);
    assert.equal(focuses(), 0);
  });
});

test('forwarding retains modifiers/repeat but refuses detached frames', async () => {
  await environment(({ host, frame, key }) => {
    let calls = 0;
    host.addEventListener('keydown', (event) => {
      calls++;
      assert.equal(event.ctrlKey, true);
      assert.equal(event.repeat, true);
    });
    const event = key();
    event.ctrlKey = true;
    event.repeat = true;
    relayReaderKeydown(event, host);
    frame.isConnected = false;
    relayReaderKeydown(key(), host);
    assert.equal(calls, 1);
  });
});

test('shadow-root frame focus survives the top-level shortcut blur', async () => {
  await environment(({ host, document, key, focuses }) => {
    document.activeElement = { localName: 'foliate-paginator' };
    host.addEventListener('keydown', (event) => {
      document.activeElement = document.body;
      event.preventDefault();
    });
    relayReaderKeydown(key(), host);
    assert.equal(focuses(), 1);
  });
});
