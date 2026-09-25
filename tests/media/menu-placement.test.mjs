import test from 'node:test';
import assert from 'node:assert/strict';
import { menuViewport, placeTranscriptMenu } from '../../.cache/media-test-build/menu-placement.js';

test('visible keyboard viewport takes precedence over layout dimensions', () => {
  assert.deepEqual(
    menuViewport(390, 844, { offsetLeft: 0, offsetTop: 0, width: 390, height: 310 }),
    { left: 0, top: 0, width: 390, height: 310 }
  );
});
test('pinch zoom offsets stay in layout coordinates and clip to its bounds', () => {
  assert.deepEqual(
    menuViewport(390, 844, { offsetLeft: 120, offsetTop: 150, width: 195, height: 422 }),
    { left: 120, top: 150, width: 195, height: 422 }
  );
  assert.deepEqual(
    menuViewport(390, 844, { offsetLeft: -10, offsetTop: -20, width: 400, height: 900 }),
    { left: 0, top: 0, width: 390, height: 844 }
  );
});
test('missing or invalid visual viewport values use the layout fallback', () => {
  const expected = { left: 0, top: 0, width: 320, height: 568 };
  for (const visual of [
    undefined,
    null,
    { offsetLeft: 0, offsetTop: 0, width: 0, height: 100 },
    { offsetLeft: 0, offsetTop: NaN, width: 320, height: 100 },
    { offsetLeft: 900, offsetTop: 0, width: 50, height: 100 }
  ])
    assert.deepEqual(menuViewport(320, 568, visual), expected);
});
test('a short menu prefers below its trigger and moves above near the bottom', () => {
  const viewport = menuViewport(1200, 800);
  assert.deepEqual(placeTranscriptMenu({ right: 900, top: 90, bottom: 134 }, viewport, 240), {
    width: 320,
    maxHeight: 776,
    left: 580,
    top: 142
  });
  assert.equal(placeTranscriptMenu({ right: 900, top: 690, bottom: 734 }, viewport, 240).top, 442);
});
test('a tall menu scrolls inside the visible viewport, including a short keyboard window', () => {
  const viewport = menuViewport(320, 568, {
    offsetLeft: 0,
    offsetTop: 120,
    width: 320,
    height: 94
  });
  const value = placeTranscriptMenu({ right: 308, top: 300, bottom: 344 }, viewport, 550);
  assert.deepEqual(value, { width: 296, maxHeight: 70, left: 12, top: 132 });
});
test('placement stays bounded across narrow, zoomed and subpixel viewport geometries', () => {
  for (let index = 1; index <= 600; index++) {
    const width = 40 + (index % 400) + 0.25;
    const height = 40 + ((index * 13) % 800) + 0.5;
    const viewport = { left: index % 31, top: index % 67, width, height };
    const measured = (index * 37) % 1300;
    const value = placeTranscriptMenu(
      { right: (index * 19) % 1200, top: index % 900, bottom: (index % 900) + 44 },
      viewport,
      measured
    );
    assert.ok(value.width > 0 && value.maxHeight > 0);
    assert.ok(value.left >= viewport.left && value.top >= viewport.top);
    assert.ok(value.left + value.width <= viewport.left + width + 1e-8);
    assert.ok(value.top + Math.min(measured, value.maxHeight) <= viewport.top + height + 1e-8);
  }
});
