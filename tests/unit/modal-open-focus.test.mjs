import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preserveModalFocus } from '../../apps/web/src/lib/hooks/preserve-modal-focus.ts';

function fixture() {
  const field = { kind: 'name input' };
  const outside = { kind: 'trigger' };
  const content = {
    isConnected: true,
    ownerDocument: { activeElement: outside },
    contains: (node) => node === field || node === content
  };
  const event = new Event('openautofocus', { cancelable: true });
  return { event, content, field, outside };
}

test('opening autofocus cannot interrupt input already focused inside the modal', () => {
  const { event, content, field } = fixture();
  content.ownerDocument.activeElement = field;
  preserveModalFocus(event, content);
  assert.equal(event.defaultPrevented, true);
  assert.equal(content.ownerDocument.activeElement, field);
});

test('normal keyboard opening still receives default initial focus', () => {
  const { event, content, outside } = fixture();
  preserveModalFocus(event, content);
  assert.equal(event.defaultPrevented, false);
  assert.equal(content.ownerDocument.activeElement, outside);
});

test('container focus alone does not suppress choosing its first interactive control', () => {
  const { event, content } = fixture();
  content.ownerDocument.activeElement = content;
  preserveModalFocus(event, content);
  assert.equal(event.defaultPrevented, false);
});

test('missing, disconnected and empty focus states leave the primitive in control', () => {
  for (const state of ['missing', 'disconnected', 'empty']) {
    const { event, content, field } = fixture();
    content.ownerDocument.activeElement = state === 'empty' ? null : field;
    if (state === 'disconnected') content.isConnected = false;
    preserveModalFocus(event, state === 'missing' ? null : content);
    assert.equal(event.defaultPrevented, false, state);
  }
});

test('custom callbacks run once and retain their explicit prevention', () => {
  const { event, content } = fixture();
  let calls = 0;
  preserveModalFocus(event, content, (received) => {
    assert.equal(received, event);
    calls++;
    received.preventDefault();
  });
  assert.equal(calls, 1);
  assert.equal(event.defaultPrevented, true);
});

test('custom focus decisions are observed before deciding whether to use the default', () => {
  const { event, content, field } = fixture();
  preserveModalFocus(event, content, () => {
    content.ownerDocument.activeElement = field;
  });
  assert.equal(event.defaultPrevented, true);
});

test('a callback can move focus outside and let the primitive choose the initial control', () => {
  const { event, content, field, outside } = fixture();
  content.ownerDocument.activeElement = field;
  preserveModalFocus(event, content, () => {
    content.ownerDocument.activeElement = outside;
  });
  assert.equal(event.defaultPrevented, false);
});
