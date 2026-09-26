import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isReaderElementNode,
  readerElementName
} from '../../apps/web/src/lib/reader-dom.ts';

test('reader DOM helpers are independent of constructor realm', () => {
  const foreignLikeElement = { nodeType: 1, localName: 'ruby', nodeName: 'ruby' };
  assert.equal(isReaderElementNode(foreignLikeElement), true);
  assert.equal(readerElementName(foreignLikeElement), 'RUBY');
});

test('reader DOM helpers normalize XHTML lowercase names and reject text nodes', () => {
  assert.equal(readerElementName({ localName: 'rt', nodeName: 'rt' }), 'RT');
  assert.equal(readerElementName({ localName: '', nodeName: 'P' }), 'P');
  assert.equal(isReaderElementNode({ nodeType: 3 }), false);
});
