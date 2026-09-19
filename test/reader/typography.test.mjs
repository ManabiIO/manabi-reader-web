import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  japaneseFontStack,
  resolveReaderFont,
  SYSTEM_JAPANESE,
  SYSTEM_SANS,
  SYSTEM_SANS_STACK
} from '../../apps/web/src/lib/data/reader-typography.ts';
import { observeReaderFontLayout } from '../../apps/web/src/lib/functions/reader-font-layout.ts';

const { Event, EventTarget } = globalThis;

test('Yoko face leads horizontal text and non-Yoko leads vertical text', () => {
  assert.ok(japaneseFontStack(false).startsWith('"YuKyokasho Yoko", YuKyokasho'));
  assert.ok(japaneseFontStack(true).startsWith('YuKyokasho, "YuKyokasho Yoko"'));
});
test('local Japanese choices precede self-hosted Google-font fallback', () => {
  for (const vertical of [false, true]) {
    const stack = japaneseFontStack(vertical);
    assert.ok(stack.indexOf('"Yu Mincho"') < stack.indexOf('"Klee One"'));
    assert.ok(stack.endsWith('"Klee One", serif'));
  }
});
test('automatic and explicit selections resolve without rewriting stored names', () => {
  assert.equal(resolveReaderFont(SYSTEM_JAPANESE, true), japaneseFontStack(true));
  assert.equal(resolveReaderFont(SYSTEM_SANS, true), SYSTEM_SANS_STACK);
  assert.equal(resolveReaderFont('', true, true), SYSTEM_SANS_STACK);
  for (const font of ['Noto Serif JP', 'My Custom Font', '"A, B", serif', 'Klee One SemiBold'])
    assert.ok(resolveReaderFont(font, false).startsWith(font + ', '));
});
test('malformed or unbounded preference values fall back safely', () => {
  for (const value of [null, undefined, {}, 42, '', '   ', 'x'.repeat(1025)])
    assert.equal(resolveReaderFont(value, true), japaneseFontStack(true));
});

// A small standards-shaped fake document controls timing only; browser coverage
// separately uses actual CSS fonts, frames, HTTP and service workers.
function layoutHarness() {
  const fonts = new EventTarget();
  let resolve;
  fonts.ready = new Promise((r) => {
    resolve = r;
  });
  const frames = new Map();
  let id = 0;
  const view = {
    requestAnimationFrame: (fn) => {
      frames.set(++id, fn);
      return id;
    },
    cancelAnimationFrame: (n) => frames.delete(n)
  };
  let layouts = 0,
    notifications = 0;
  const element = {
    ownerDocument: { fonts, defaultView: view },
    isConnected: true,
    getBoundingClientRect: () => {
      ++layouts;
      return {};
    }
  };
  return {
    fonts,
    element,
    resolve: () => resolve(),
    get layouts() {
      return layouts;
    },
    get notifications() {
      return notifications;
    },
    notify: () => {
      ++notifications;
    },
    flush: () => {
      const f = [...frames.values()];
      frames.clear();
      f.forEach((fn) => fn());
    }
  };
}
test('layout flush precedes ready and success notifications are coalesced', async () => {
  const h = layoutHarness();
  const stop = observeReaderFontLayout(h.element, h.notify);
  assert.equal(h.layouts, 1);
  h.fonts.dispatchEvent(new Event('loadingdone'));
  h.resolve();
  await Promise.resolve();
  h.flush();
  assert.equal(h.notifications, 1);
  stop();
});
test('teardown cancels timers, pending readiness and late font events', async () => {
  const h = layoutHarness();
  const stop = observeReaderFontLayout(h.element, h.notify, 5);
  stop();
  h.resolve();
  await new Promise((r) => setTimeout(r, 12));
  h.fonts.dispatchEvent(new Event('loadingdone'));
  h.flush();
  assert.equal(h.notifications, 0);
});
test('slow fonts do not indefinitely block the book, later completion can remeasure', async () => {
  const h = layoutHarness();
  const stop = observeReaderFontLayout(h.element, h.notify, 5);
  await new Promise((r) => setTimeout(r, 12));
  h.flush();
  assert.equal(h.notifications, 1);
  h.fonts.dispatchEvent(new Event('loadingdone'));
  h.flush();
  assert.equal(h.notifications, 2);
  stop();
});
test('load errors let native fallback render, disconnected elements cannot notify', () => {
  const h = layoutHarness();
  const stop = observeReaderFontLayout(h.element, h.notify);
  h.fonts.dispatchEvent(new Event('loadingerror'));
  h.flush();
  assert.equal(h.notifications, 1);
  h.element.isConnected = false;
  h.fonts.dispatchEvent(new Event('loadingdone'));
  h.flush();
  assert.equal(h.notifications, 1);
  stop();
});
test('replacing a render observer invalidates the old readiness callback', async () => {
  const h = layoutHarness();
  const first = observeReaderFontLayout(h.element, () => assert.fail('stale observer'));
  first();
  const second = observeReaderFontLayout(h.element, h.notify);
  h.resolve();
  await Promise.resolve();
  h.flush();
  assert.equal(h.notifications, 1);
  second();
});
