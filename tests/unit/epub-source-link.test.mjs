import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeEpubNumericEntity,
  isSafeEpubInternalHref,
  legacyFlattenedEpubHref
} from '../../apps/web/src/lib/functions/file-loaders/epub/epub-source-link.ts';

test('EPUB numeric entity decoding preserves supplementary-plane code points', () => {
  assert.equal(decodeEpubNumericEntity('20000', 16), String.fromCodePoint(0x20000));
  assert.equal(decodeEpubNumericEntity('131072', 10), String.fromCodePoint(0x20000));
  assert.equal(decodeEpubNumericEntity('D800', 16), '\uFFFD');
  assert.equal(decodeEpubNumericEntity('110000', 16), '\uFFFD');
});

test('EPUB source links keep internal resource identity but reject external and rooted URLs', () => {
  for (const value of [
    '#note',
    'chapter-2.xhtml#note',
    '../notes/chapter.xhtml#note',
    'chapter.xhtml?mode=print#note'
  ]) {
    assert.equal(isSafeEpubInternalHref(value), true, value);
  }
  for (const value of [
    'https://example.com/chapter.xhtml#note',
    'javascript:alert(1)',
    '/absolute/chapter.xhtml',
    '\\server\\share',
    ' chapter.xhtml#note'
  ]) {
    assert.equal(isSafeEpubInternalHref(value), false, value);
  }
});

test('legacy flattened href remains available without losing the separately stored source href', () => {
  assert.equal(legacyFlattenedEpubHref('chapter-2.xhtml#note'), '#note');
  assert.equal(legacyFlattenedEpubHref('#local'), '#local');
});
