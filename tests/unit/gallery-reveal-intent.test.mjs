import assert from 'node:assert/strict';
import test from 'node:test';
import {
  gallerySpoilerObservation,
  revealGalleryPicture
} from '../../apps/web/src/lib/components/book-reader/book-reader-image-gallery/reveal-gallery-picture.ts';

const hidden = () => [
  { url: 'blob:first', unspoilered: false },
  { url: 'blob:second', unspoilered: false }
];

for (const observationBeforeReveal of [true, false]) {
  test(`explicit reveal wins with observation before reveal: ${observationBeforeReveal}`, () => {
    let pictures = hidden();
    const queued = new Map();
    const observe = () =>
      queued.set('blob:second', gallerySpoilerObservation(pictures, 'blob:second', false));
    if (observationBeforeReveal) observe();
    pictures = revealGalleryPicture(pictures, 'blob:second', (p) =>
      queued.set(p.url, p.unspoilered)
    );
    if (!observationBeforeReveal) observe();
    assert.equal(queued.get('blob:second'), true);
    assert.equal(pictures[1].revealedInGallery, true);
    assert.equal(pictures[0].unspoilered, false);
  });
}

test('repeated rebinds do not erase the reveal after the first queue drains', () => {
  const pictures = revealGalleryPicture(hidden(), 'blob:second', () => {});
  for (let rebind = 0; rebind < 20; rebind++) {
    pictures[1].unspoilered = gallerySpoilerObservation(pictures, 'blob:second', false);
    assert.equal(pictures[1].unspoilered, true);
    assert.equal(gallerySpoilerObservation(pictures, 'blob:first', false), false);
  }
});

test('ordinary visible loader defaults are not an explicit reveal', () => {
  assert.equal(
    gallerySpoilerObservation([{ url: 'blob:first', unspoilered: true }], 'blob:first', false),
    false
  );
});

test('a new snapshot resets intent even if a source happens to reuse a URL', () => {
  const previous = revealGalleryPicture(hidden(), 'blob:second', () => {});
  assert.equal(gallerySpoilerObservation(previous, 'blob:second', false), true);
  assert.equal(gallerySpoilerObservation(hidden(), 'blob:second', false), false);
  assert.equal(gallerySpoilerObservation([], 'blob:second', false), false);
});

test('intent is URL exact, not an index, prefix or previous-book choice', () => {
  const pictures = revealGalleryPicture(hidden(), 'blob:second', () => {}).reverse();
  assert.equal(gallerySpoilerObservation(pictures, 'blob:second', false), true);
  for (const url of ['blob:first', 'blob:second-extra', 'blob:secon', 'blob:other-book']) {
    assert.equal(gallerySpoilerObservation(pictures, url, false), false);
  }
});

test('a positive reader observation stays valid before image publication', () => {
  assert.equal(gallerySpoilerObservation([], 'blob:not-published-yet', true), true);
  assert.equal(gallerySpoilerObservation(hidden(), 'blob:first', true), true);
});

test('reveal copies only matching rows and never mutates frozen metadata', () => {
  const first = Object.freeze({ url: 'blob:first', unspoilered: false, order: 1 });
  const second = Object.freeze({ url: 'blob:second', unspoilered: false, order: 2 });
  const input = Object.freeze([first, second]);
  const queued = [];
  const result = revealGalleryPicture(input, 'blob:second', (p) => queued.push(p));
  assert.equal(result[0], first);
  assert.notEqual(result[1], second);
  assert.equal(result[1].order, 2);
  assert.equal(queued[0].revealedInGallery, true);
  assert.equal(second.unspoilered, false);
  assert.equal(second.revealedInGallery, undefined);
});

test('invalid reveal and failed publication do not leave hidden intent behind', () => {
  const input = hidden();
  assert.equal(
    revealGalleryPicture(input, 'blob:missing', () => assert.fail('unexpected queue')),
    input
  );
  assert.throws(
    () =>
      revealGalleryPicture(input, 'blob:second', () => {
        throw new Error('queue failed');
      }),
    /queue failed/
  );
  assert.equal(gallerySpoilerObservation(input, 'blob:second', false), false);
  assert.equal(input[1].revealedInGallery, undefined);
});
