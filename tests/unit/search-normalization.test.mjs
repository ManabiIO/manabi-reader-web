/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareSearchText,
  foldSearch,
  searchMatchRange,
  sortSearchText
} from '../../apps/web/src/lib/library/search-normalization.ts';

test('metadata relevance orders exact, prefix, token-boundary and interior matches', () => {
  const values = ['Copycat notes', 'A cat story', 'Cat guide', 'cat'];
  values.sort((a, b) => compareSearchText(a, b, 'cat'));
  assert.deepEqual(values, ['cat', 'Cat guide', 'A cat story', 'Copycat notes']);
});

test('title highlight follows the occurrence that earned the stronger boundary rank', () => {
  assert.deepEqual(searchMatchRange('Copycat cat', 'cat'), { start: 8, end: 11 });
});

test('title match ranges map normalized text back to original metadata', () => {
  assert.deepEqual(searchMatchRange('ＡＢＣ guide', 'abc'), { start: 0, end: 3 });
  assert.deepEqual(searchMatchRange('ﬁ field', 'fi'), { start: 0, end: 1 });
  assert.deepEqual(searchMatchRange('🐱cat notes', 'cat'), { start: 2, end: 5 });
  assert.equal(searchMatchRange('Dog guide', 'cat'), undefined);
});

test('metadata relevance uses the same compatibility normalization as library search', () => {
  const values = ['Z ABC', 'ＡＢＣ guide', 'ＡＢＣ'];
  values.sort((a, b) => compareSearchText(a, b, 'abc'));
  assert.deepEqual(values, ['ＡＢＣ', 'ＡＢＣ guide', 'Z ABC']);
  assert.equal(foldSearch('ＡＢＣ'), 'abc');
});

test('metadata relevance treats supplementary symbols as token boundaries', () => {
  const values = ['Copycat', '🐱cat notes'];
  values.sort((a, b) => compareSearchText(a, b, 'cat'));
  assert.deepEqual(values, ['🐱cat notes', 'Copycat']);
});

test('metadata relevance prefers a later token boundary over an earlier interior hit', () => {
  const values = ['Copycat only', 'Copycat cat', 'Before cat'];
  values.sort((a, b) => compareSearchText(a, b, 'cat'));
  assert.deepEqual(values, ['Before cat', 'Copycat cat', 'Copycat only']);
});

test('metadata relevance positions count supplementary characters as one code point', () => {
  // Both matches begin at UTF-16 index 4. In code points the emoji title's
  // boundary is earlier (3 vs 4), so its deliberately longer suffix must not
  // let the shorter BMP title win the tie.
  const values = ['abc cat', '🐱x cat trailing text'];
  values.sort((a, b) => compareSearchText(a, b, 'cat'));
  assert.deepEqual(values, ['🐱x cat trailing text', 'abc cat']);
});

test('primary title wins a same-tier match found only in secondary metadata', () => {
  const values = [
    { id: 'secondary', fields: ['Dog guide', 'cat'] },
    { id: 'primary', fields: ['cat'] }
  ];
  const sorted = sortSearchText(values, 'cat', (value) => value.fields);
  assert.deepEqual(
    sorted.map((value) => value.id),
    ['primary', 'secondary']
  );
});

test('primary metadata wins same-tier prefix and boundary matches', () => {
  const prefix = [
    { id: 'secondary', fields: ['Dog guide', 'catalog notes'] },
    { id: 'primary', fields: ['cat handbook'] }
  ];
  assert.deepEqual(
    sortSearchText(prefix, 'cat', (value) => value.fields).map((value) => value.id),
    ['primary', 'secondary']
  );

  const boundary = [
    { id: 'secondary', fields: ['Dog guide', 'A cat note'] },
    { id: 'primary', fields: ['Before cat chapter'] }
  ];
  assert.deepEqual(
    sortSearchText(boundary, 'cat', (value) => value.fields).map((value) => value.id),
    ['primary', 'secondary']
  );
});

test('bulk metadata sorting extracts each candidate text once', () => {
  const values = ['Copycat notes', 'A cat story', 'Cat guide', 'cat'];
  let reads = 0;
  const sorted = sortSearchText(values, 'cat', (value) => {
    reads++;
    return value;
  });
  assert.equal(reads, values.length);
  assert.deepEqual(sorted, ['cat', 'Cat guide', 'A cat story', 'Copycat notes']);
});

test('metadata relevance deterministically places non-matches after matches', () => {
  const values = ['zzz', 'school notes', 'school'];
  values.sort((a, b) => compareSearchText(a, b, 'school'));
  assert.deepEqual(values, ['school', 'school notes', 'zzz']);
});
