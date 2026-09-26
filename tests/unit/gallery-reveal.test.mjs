import assert from 'node:assert/strict';
import { test } from 'node:test';
import { revealGalleryPicture } from '../../apps/web/src/lib/components/book-reader/book-reader-image-gallery/reveal-gallery-picture.ts';

test('newer explicit reveal supersedes a queued hidden observation', () => {
  const pictures = [
    { url: 'blob:first', unspoilered: false },
    { url: 'blob:second', unspoilered: false }
  ];
  const queued = new Map([['blob:second', false]]);
  const visible = revealGalleryPicture(pictures, 'blob:second', (picture) =>
    queued.set(picture.url, picture.unspoilered)
  );
  assert.equal(visible[1].unspoilered, true);
  // Apply the same delayed, last-observation-per-URL reduction as the route.
  const afterDebounce = visible.map((picture) => ({
    ...picture,
    unspoilered: queued.get(picture.url) ?? picture.unspoilered
  }));
  assert.equal(afterDebounce[1].unspoilered, true);
  assert.equal(afterDebounce[0].unspoilered, false);
  assert.equal(pictures[1].unspoilered, false);
});

test('already visible pictures still supersede pending hidden updates', () => {
  const queued = new Map([['blob:visible', false]]);
  revealGalleryPicture([{ url: 'blob:visible', unspoilered: true }], 'blob:visible', (picture) =>
    queued.set(picture.url, picture.unspoilered)
  );
  assert.equal(queued.get('blob:visible'), true);
});

test('unknown or stale URLs cannot enqueue changes to another book', () => {
  const pictures = [{ url: 'blob:current', unspoilered: false }];
  assert.equal(
    revealGalleryPicture(pictures, 'blob:old', () => assert.fail('unexpected update')),
    pictures
  );
});

test('all matching references reveal without mutating the original metadata', () => {
  const pictures = [
    { url: 'blob:shared', unspoilered: false, title: 'a' },
    { url: 'blob:other', unspoilered: false, title: 'b' },
    { url: 'blob:shared', unspoilered: false, title: 'c' }
  ];
  const queued = [];
  const visible = revealGalleryPicture(pictures, 'blob:shared', (picture) => queued.push(picture));
  assert.equal(queued.length, 1);
  assert.deepEqual(
    visible.map((picture) => picture.unspoilered),
    [true, false, true]
  );
  assert.equal(visible[1], pictures[1]);
  assert.deepEqual(
    visible.map((picture) => picture.title),
    ['a', 'b', 'c']
  );
  assert.ok(pictures.every((picture) => !picture.unspoilered));
});
