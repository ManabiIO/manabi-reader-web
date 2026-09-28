/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { findContent } from '../../apps/web/src/lib/library/content-search.ts';

const resource = { href: 'chapter.xhtml', spineIndex: 0, sectionId: 'chapter' };
const book = { id: 1, key: 'content:' + 'a'.repeat(64) };
const find = (text, query) => findContent([{ resource, text }], query, book);
const selected = (hit) => hit.excerpt.slice(hit.excerptMatch.start, hit.excerptMatch.end);

test('compatibility matches mark original ligatures and full-width text', async () => {
  const { hits } = await find('ﬁ / fi / ＦＩ', 'fi');
  assert.equal(hits.length, 3);
  assert.deepEqual(hits.map(selected), ['ﬁ', 'fi', 'ＦＩ']);
  assert.deepEqual(
    hits.map((hit) => hit.locator.quote),
    ['ﬁ', 'fi', 'ＦＩ']
  );
  assert.deepEqual(
    hits.map((hit) => hit.excerptMatch),
    [
      { start: 0, end: 1 },
      { start: 4, end: 6 },
      { start: 9, end: 11 }
    ]
  );
});

test('kana normalization and supplementary context preserve original ranges', async () => {
  const text = '𠮷'.repeat(80) + ' ｶﾞ / ガ / カ\u3099 ' + '👩‍💻'.repeat(30);
  const { hits } = await find(text, 'ガ');
  assert.deepEqual(hits.map(selected), ['ｶﾞ', 'ガ', 'カ\u3099']);
  for (const hit of hits) {
    assert.equal(selected(hit), hit.locator.quote);
    assert.equal(
      Array.from(text).slice(hit.locator.start, hit.locator.end).join(''),
      selected(hit)
    );
    assert.ok(hit.excerptMatch.start < 100);
  }
});

test('literal markup and metacharacters do not turn into a different excerpt', async () => {
  const text = '<b>[a+b].*? & 猫</b>';
  const { hits } = await find(text, '[a+b].*?');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].excerpt, text);
  assert.equal(selected(hits[0]), '[a+b].*?');
});

test('two folded positions within one ligature are one highlighted source hit', async () => {
  const { hits } = await find('ﬃ', 'f');
  assert.equal(hits.length, 1);
  assert.equal(selected(hits[0]), 'ﬃ');
  assert.deepEqual(hits[0].excerptMatch, { start: 0, end: 1 });
});
