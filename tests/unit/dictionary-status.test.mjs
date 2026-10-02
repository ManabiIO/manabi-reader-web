/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dictionaryCountLabel,
  dictionaryStorageLabel
} from '../../apps/web/src/lib/search/dictionary-status.ts';

test('dictionary count labels expose useful installed data without zero noise', () => {
  assert.equal(
    dictionaryCountLabel({ terms: 3, kanji: 1, termMeta: 2, kanjiMeta: 0, media: 4 }),
    '3 terms · 1 kanji · 2 term metadata · 4 media items'
  );
  assert.equal(dictionaryCountLabel({ terms: 1 }), '1 term');
  assert.equal(dictionaryCountLabel({ terms: 0, media: 0 }), '');
  assert.equal(dictionaryCountLabel(undefined), '');
});

test('dictionary storage label distinguishes persistent and evictable origin storage', () => {
  assert.equal(
    dictionaryStorageLabel({ persisted: true }),
    'Dictionary storage: persistent for this Reader origin.'
  );
  assert.equal(
    dictionaryStorageLabel({ persisted: false }),
    'Dictionary storage: browser eviction is possible under storage pressure.'
  );
  assert.equal(dictionaryStorageLabel(undefined), '');
});
