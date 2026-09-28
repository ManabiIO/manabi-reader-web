import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  adjacentChapterIndex,
  chapterCharacters,
  chapterPercentage,
  getChapterData
} from '../../apps/web/src/lib/components/book-reader/book-toc/chapter-model.ts';

const section = (reference, progress = 0, fields = {}) => ({
  reference,
  progress,
  charactersWeight: 1,
  startCharacter: 0,
  characters: 100,
  ...fields
});

test('no sections returns an explicit missing current chapter', () => {
  assert.deepEqual(getChapterData([]), [[], -1, '']);
});

test('the first unfinished child resolves to its existing main chapter', () => {
  const a = section('a', 100);
  const b = section('b', 100);
  const child = section('part', 30, { parentChapter: 'b' });
  assert.deepEqual(getChapterData([a, b, child]), [[a, b], 1, 'b']);
});

test('all finished preserves the last section main-chapter convention', () => {
  const a = section('a', 100);
  const b = section('b', 100);
  assert.deepEqual(getChapterData([a, b, section('last', 100, { parentChapter: 'b' })]), [
    [a, b],
    1,
    'b'
  ]);
});

test('orphaned progress does not silently navigate to an unrelated main chapter', () => {
  const root = section('known', 100);
  assert.deepEqual(getChapterData([root, section('part', 50, { parentChapter: 'absent' })]), [
    [root],
    -1,
    'absent'
  ]);
});

test('both visual directions respect first, last and absent current chapters', () => {
  for (const offset of [-1, 1]) {
    for (const [length, current] of [
      [0, -1],
      [3, -1],
      [3, 3],
      [3, NaN],
      [3, 1.5]
    ]) {
      assert.equal(adjacentChapterIndex(length, current, offset), -1);
    }
  }
  assert.equal(adjacentChapterIndex(3, 0, -1), -1);
  assert.equal(adjacentChapterIndex(3, 2, 1), -1);
  assert.equal(adjacentChapterIndex(3, 0, 1), 1);
  assert.equal(adjacentChapterIndex(3, 2, -1), 1);
  assert.equal(adjacentChapterIndex(3, 1, 10), -1);
});

test('weighted progress includes children but excludes unrelated chapters', () => {
  assert.equal(
    chapterPercentage(
      [
        section('a', 20, { charactersWeight: 3 }),
        section('child', 80, { parentChapter: 'a', charactersWeight: 1 }),
        section('other', 100, { charactersWeight: 1000 })
      ],
      'a'
    ),
    35
  );
});

test('missing or zero-weight progress is unknown, not NaN or fabricated zero', () => {
  assert.equal(chapterPercentage([], 'a'), undefined);
  assert.equal(chapterPercentage([section('a', 0, { charactersWeight: 0 })], 'a'), undefined);
  assert.equal(chapterPercentage([section('a', 0)], 'a'), 0);
  assert.equal(chapterPercentage([section('a', 100)], 'a'), 100);
});

test('invalid weights and progress never reach the progressbar', () => {
  for (const charactersWeight of [NaN, Infinity, -1]) {
    assert.equal(chapterPercentage([section('a', 50, { charactersWeight })], 'a'), undefined);
  }
  for (const progress of [NaN, Infinity, -1, 101]) {
    assert.equal(chapterPercentage([section('a', progress)], 'a'), undefined);
  }
});

test('character presentation bounds the viewport without modifying source records', () => {
  const chapter = Object.freeze(section('a', 20, { startCharacter: 100, characters: 50 }));
  assert.deepEqual(chapterCharacters(chapter, 20), { read: 0, total: 50 });
  assert.deepEqual(chapterCharacters(chapter, 125), { read: 25, total: 50 });
  assert.deepEqual(chapterCharacters(chapter, 900), { read: 50, total: 50 });
  assert.equal(chapter.progress, 20);
});

test('empty, missing and non-finite character counts remain distinct', () => {
  assert.equal(chapterCharacters(undefined, 0), undefined);
  assert.equal(chapterCharacters(section('a', 0, { characters: undefined }), 0), undefined);
  assert.equal(chapterCharacters(section('a', 0, { startCharacter: -1 }), 0), undefined);
  assert.equal(chapterCharacters(section('a'), Infinity), undefined);
  assert.deepEqual(chapterCharacters(section('a', 0, { characters: 0 }), 0), { read: 0, total: 0 });
});
