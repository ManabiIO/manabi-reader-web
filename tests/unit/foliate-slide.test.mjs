/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  slideGeometry,
  wheelPageDistance
} from '../../apps/web/src/lib/foliate-epub/slide-geometry.ts';
import { createStoredFoliateBook } from '../../apps/web/src/lib/foliate-epub/stored-foliate-book.ts';

for (const reading of ['ltr', 'rtl']) {
  const sign = reading === 'rtl' ? 1 : -1;
  test(`${reading}: forward sheet uncovers the dimmed, 15% displaced next page`, () => {
    assert.deepEqual(slideGeometry(0.5, 1, reading, 400), {
      progress: 0.5,
      currentX: sign * 200,
      neighborX: sign * -30,
      currentShade: 0,
      neighborShade: 0.12
    });
    const end = slideGeometry(1, 1, reading, 400);
    assert.equal(end.currentX, sign * 400);
    assert.equal(Math.abs(end.neighborX), 0);
    assert.equal(end.neighborShade, 0);
  });
  test(`${reading}: previous sheet covers the current page on a backward turn`, () => {
    assert.deepEqual(slideGeometry(0.5, -1, reading, 400), {
      progress: 0.5,
      currentX: sign * -30,
      neighborX: sign * 200,
      currentShade: 0.12,
      neighborShade: 0
    });
    const end = slideGeometry(1, -1, reading, 400);
    assert.equal(end.currentX, sign * -60);
    assert.equal(Math.abs(end.neighborX), 0);
    assert.equal(end.currentShade, 0.24);
  });
  test(`${reading}: reversing distance retraces the exact poses at any viewport width`, () => {
    for (const width of [320, 390, 768, 1440]) {
      for (const turn of [-1, 1]) {
        const frames = [0, 0.25, 0.5, 0.75, 1].map((p) => slideGeometry(p, turn, reading, width));
        const reverse = [1, 0.75, 0.5, 0.25, 0].map((p) => slideGeometry(p, turn, reading, width));
        assert.deepEqual(reverse, frames.toReversed());
        assert.equal(
          Math.abs(slideGeometry(0.5, turn, reading, width).currentX),
          width * (turn === 1 ? 0.5 : 0.075)
        );
      }
    }
  });
}

test('invalid and overscrolled progress never escapes the two sheet bounds', () => {
  for (const [input, expected] of [
    [-3, 0],
    [4, 1],
    [NaN, 0],
    [Infinity, 0]
  ])
    assert.equal(slideGeometry(input, 1, 'ltr', 400).progress, expected);
  assert.equal(Math.abs(slideGeometry(0.7, -1, 'rtl', NaN).currentX), 0);
});

test('wheel distance respects pixel, line, page, and reading directions', () => {
  assert.equal(wheelPageDistance(80, 0, 0, 400, 'ltr'), 80);
  assert.equal(wheelPageDistance(80, 0, 0, 400, 'rtl'), -80);
  assert.equal(wheelPageDistance(0, 3, 1, 400, 'rtl'), 48);
  assert.equal(wheelPageDistance(0, -1, 2, 400, 'ltr'), -400);
});

function storedBook() {
  const document = {
    createElement: () => ({ children: [{ outerHTML: '<section>Text</section>' }] })
  };
  const manifest = { resources: [{ href: 'one.xhtml', sectionId: 'one', spineIndex: 0 }] };
  return createStoredFoliateBook('', '', manifest, document).book;
}

test('cancelled prepared views release only their own reference to a resource', async () => {
  const book = storedBook();
  const section = book.sections[0];
  const first = await section.load();
  assert.equal(await section.load(), first);
  section.unload();
  assert.match(await (await globalThis.fetch(first)).text(), /Text/);
  section.unload();
  await assert.rejects(globalThis.fetch(first));
  const next = await section.load();
  assert.notEqual(first, next);
  book.destroy();
  await assert.rejects(globalThis.fetch(next));
  await assert.rejects(section.load(), /closed/);
});

test('destroy revokes retained prepared resources exactly once and is idempotent', async () => {
  const book = storedBook();
  const url = await book.sections[0].load();
  await book.sections[0].load();
  book.destroy();
  book.destroy();
  await assert.rejects(globalThis.fetch(url));
});
