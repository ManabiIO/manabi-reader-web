/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareSearchText,
  foldSearch
} from '../../apps/web/src/lib/library/search-normalization.ts';

test('metadata relevance orders exact, prefix, token-boundary and interior matches', () => {
  const values = ['Copycat notes', 'A cat story', 'Cat guide', 'cat'];
  values.sort((a, b) => compareSearchText(a, b, 'cat'));
  assert.deepEqual(values, ['cat', 'Cat guide', 'A cat story', 'Copycat notes']);
});

test('metadata relevance uses the same compatibility normalization as library search', () => {
  const values = ['Z ABC', 'ＡＢＣ guide', 'ＡＢＣ'];
  values.sort((a, b) => compareSearchText(a, b, 'abc'));
  assert.deepEqual(values, ['ＡＢＣ', 'ＡＢＣ guide', 'Z ABC']);
  assert.equal(foldSearch('ＡＢＣ'), 'abc');
});

test('metadata relevance deterministically places non-matches after matches', () => {
  const values = ['zzz', 'school notes', 'school'];
  values.sort((a, b) => compareSearchText(a, b, 'school'));
  assert.deepEqual(values, ['school', 'school notes', 'zzz']);
});
