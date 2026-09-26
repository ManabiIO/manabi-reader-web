/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  foliateArchiveEntryIndex,
  openFoliateEpub
} from '../../apps/web/src/lib/foliate-epub/open-foliate-epub.ts';

import { LimitedArchive } from '../../apps/web/src/lib/functions/file-loaders/utils/limited-archive.ts';
import { EPUB } from '../../apps/web/src/lib/foliate-epub/epub.js';

test('Foliate archive aliases resolve decoded EPUB resource names', () => {
  const index = foliateArchiveEntryIndex(
    new Map([
      ['OPS/%E7%B5%B5.png', {}],
      ['OPS/chapter.xhtml', {}]
    ])
  );
  assert.equal(index.get('OPS/%E7%B5%B5.png'), 'OPS/%E7%B5%B5.png');
  assert.equal(index.get('OPS/絵.png'), 'OPS/%E7%B5%B5.png');
});

test('Foliate archive aliases reject ambiguous decoded resource names', () => {
  assert.throws(
    () =>
      foliateArchiveEntryIndex(
        new Map([
          ['OPS/%E7%B5%B5.png', {}],
          ['OPS/絵.png', {}]
        ])
      ),
    /Ambiguous EPUB resource path/
  );
});

test('opening an EPUB closes its archive when resource aliases are ambiguous', async () => {
  const originalOpen = LimitedArchive.open;
  let closes = 0;
  LimitedArchive.open = async () => ({
    entries: new Map([
      ['OPS/%E7%B5%B5.png', {}],
      ['OPS/絵.png', {}]
    ]),
    close: async () => {
      closes += 1;
    }
  });
  try {
    await assert.rejects(openFoliateEpub(new Blob()), /Ambiguous EPUB resource path/);
    assert.equal(closes, 1);
  } finally {
    LimitedArchive.open = originalOpen;
  }
});

test('EPUB initialization failure and repeated publication close release archive ownership', async () => {
  const originalOpen = LimitedArchive.open;
  const originalInit = EPUB.prototype.init;
  const parserDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
  let closes = 0;
  let destroys = 0;
  // This test exercises adapter ownership, not browser XML parsing.
  Object.defineProperty(globalThis, 'DOMParser', { configurable: true, value: class {} });
  LimitedArchive.open = async () => ({
    entries: new Map([['OPS/%E7%B5%B5.png', { uncompressedSize: 5 }]]),
    readText: async (name) => name,
    readBlob: async (name) => new Blob([name]),
    close: async () => {
      closes += 1;
    }
  });
  try {
    const failure = new Error('invalid package');
    EPUB.prototype.init = async () => {
      throw failure;
    };
    await assert.rejects(openFoliateEpub(new Blob()), (error) => error === failure);
    assert.equal(closes, 1);
    EPUB.prototype.init = async function () {
      assert.equal(await this.loadText('OPS/絵.png'), 'OPS/%E7%B5%B5.png');
      assert.equal(await this.loadText('missing'), null);
      assert.equal(await this.loadBlob('missing'), null);
      assert.equal(this.getSize('OPS/絵.png'), 5);
      return {
        destroy() {
          destroys += 1;
        }
      };
    };
    const publication = await openFoliateEpub(new Blob());
    assert.equal(closes, 1);
    await publication.close();
    await publication.close();
    assert.equal(closes, 2);
    assert.equal(destroys, 1);
  } finally {
    LimitedArchive.open = originalOpen;
    EPUB.prototype.init = originalInit;
    if (parserDescriptor) Object.defineProperty(globalThis, 'DOMParser', parserDescriptor);
    else Reflect.deleteProperty(globalThis, 'DOMParser');
  }
});
