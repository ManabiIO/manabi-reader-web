/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readerSourceFormat } from '../../apps/web/src/lib/reader-source-format.ts';

const book = (sourceFormat, hrefs) => ({
  sourceFormat,
  publicationManifest: hrefs
    ? {
        version: 1,
        resources: hrefs.map((href, spineIndex) => ({
          href,
          spineIndex,
          sectionId: `s-${spineIndex}`
        }))
      }
    : undefined
});

test('new source markers route only EPUB books to the Foliate path', () => {
  assert.equal(readerSourceFormat(book('epub', ['htmlz:body'])), 'epub');
  assert.equal(readerSourceFormat(book('htmlz', ['OPS/chapter.xhtml'])), 'htmlz');
  assert.equal(readerSourceFormat(book('txt', ['OPS/chapter.xhtml'])), 'txt');
});

test('legacy publication manifests distinguish EPUB, HTMLZ and text imports', () => {
  assert.equal(
    readerSourceFormat(book(undefined, ['OPS/chapter.xhtml', 'OPS/chapter-2.xhtml'])),
    'epub'
  );
  assert.equal(readerSourceFormat(book(undefined, ['htmlz:body'])), 'htmlz');
  assert.equal(
    readerSourceFormat(book(undefined, ['legacy-section-0', 'legacy-section-1'])),
    'txt'
  );
  assert.equal(readerSourceFormat(book(undefined, undefined)), 'unknown');
});
