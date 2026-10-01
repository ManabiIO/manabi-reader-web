/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bookTitleRows,
  snippetTitleRows,
  scopedSnippetTitleRows,
  videoTitleRows,
  sortTitleRows,
  bookContentRows,
  snippetContentRows,
  videoContentRows
} from '../../apps/web/src/lib/search/result-rows.ts';

const book = (title, extra = {}) => ({
  key: 'book:' + title,
  title,
  canonicalTitle: title,
  ...extra
});
const videoKey = 'content:' + 'a'.repeat(64);

test('metadata reasons highlight the matched value, and keep stable actions and original book data', () => {
  const item = Object.freeze(book('Dog guide', { creators: [{ name: 'Author Name' }] }));
  const [row] = bookTitleRows([item], {}, 'author');
  assert.equal(row.label, 'Read Dog guide');
  assert.equal(row.detail, 'Author · Author Name');
  assert.deepEqual(row.detailMatch, { start: 9, end: 15 });
  assert.equal(row.titleMatch, undefined);
  assert.equal(row.target.book, item);
  assert.deepEqual(row.searchText, { primary: ['Dog guide'], secondary: ['Author Name'] });
});

test('literal title highlights preserve compatibility source offsets', () => {
  const item = book('ﬁ guide');
  const [row] = bookTitleRows([item], {}, 'fi');
  assert.deepEqual(row.titleMatch, { start: 0, end: 1 });
  assert.equal(row.title, 'ﬁ guide');
  assert.equal(row.target.book, item);
});

test('snippet title rows use Kana folding and preserve original source offsets', () => {
  const snippet = {
    key: 'snippet:kana',
    id: 'kana',
    title: '𠮟るトウキョウ散歩'
  };
  const [row] = snippetTitleRows([snippet], 'とうきょう');
  assert.equal(row.title, snippet.title);
  assert.deepEqual(row.titleMatch, { start: 3, end: 8 });
  assert.equal(row.title.slice(row.titleMatch.start, row.titleMatch.end), 'トウキョウ');
  assert.deepEqual(row.searchText, {
    primary: ['𠮟るトウキョウ散歩', '𠮟るとうきょう散歩']
  });

  const unrelated = {
    ...row,
    id: 'snippet:unrelated',
    title: 'Unrelated',
    searchText: 'Unrelated'
  };
  assert.equal(sortTitleRows([unrelated, row], 'とうきょう')[0], row);

  const [dakuten] = snippetTitleRows(
    [{ key: 'snippet:dakuten', id: 'dakuten', title: 'ガイド' }],
    'が'
  );
  assert.deepEqual(dakuten.titleMatch, { start: 0, end: 1 });

  const [hiragana] = snippetTitleRows(
    [{ key: 'snippet:hiragana', id: 'hiragana', title: 'とうきょう散歩' }],
    'トウキョウ'
  );
  assert.deepEqual(hiragana.titleMatch, { start: 0, end: 5 });
  assert.deepEqual(hiragana.searchText, { primary: ['とうきょう散歩', 'トウキョウ散歩'] });
  const unmatched = {
    ...hiragana,
    id: 'snippet:unmatched',
    title: 'Unrelated',
    searchText: { primary: ['Unrelated'] }
  };
  assert.equal(sortTitleRows([unmatched, hiragana], 'トウキョウ')[0], hiragana);
});

test('snippet title rows disappear when their captured scope expires', () => {
  const snippets = [
    { key: 'snippet:one', id: 'one', title: '猫のノート' },
    { key: 'snippet:two', id: 'two', title: '犬のノート' }
  ];
  let active = true;
  const guard = () => {
    if (!active) throw new Error('scope expired');
  };
  assert.deepEqual(
    scopedSnippetTitleRows(snippets, '猫', guard).rows.map((row) => row.title),
    ['猫のノート']
  );
  active = false;
  assert.deepEqual(scopedSnippetTitleRows(snippets, '猫', guard), { rows: [], failed: 1 });
});

test('titles rank across source types with metadata-only results after literal title matches', () => {
  const books = bookTitleRows(
    [book('Dog guide', { creators: [{ name: 'cat' }] }), book('Copycat'), book('Cat guide')],
    {},
    'cat'
  );
  const snippets = snippetTitleRows(
    [
      { key: 'snippet:one', id: 'one', title: 'A cat snippet' },
      { key: 'snippet:two', id: 'two', title: 'Unrelated' }
    ],
    'cat'
  );
  const videos = videoTitleRows(
    [{ key: videoKey, title: 'cat', duration: 120, addedAt: 1 }],
    'cat'
  );
  assert.deepEqual(
    sortTitleRows([...books, ...snippets, ...videos], 'cat').map((row) => row.title),
    ['cat', 'Cat guide', 'A cat snippet', 'Copycat', 'Dog guide']
  );
  assert.equal(videos[0].detail, '2:00');
  assert.deepEqual(videos[0].target, { kind: 'video', key: videoKey });
});

test('book passages keep canonical locators and source offsets while using current metadata', () => {
  const item = book('Renamed title', { bookId: 7 });
  const locator = {
    version: 1,
    resource: { spineIndex: 2, href: 'chapter.xhtml', sectionId: 'chapter' },
    start: 4,
    end: 7,
    quote: '猫の本'
  };
  const match = { start: 2, end: 5 };
  const hit = { bookId: 7, locator, excerpt: '前に猫の本があります。', excerptMatch: match };
  const rows = bookContentRows([hit, { ...hit, bookId: 99 }], new Map([[7, item]]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, 'Open passage in Renamed title: 猫の本');
  assert.equal(rows[0].detail, 'Section 3');
  assert.equal(rows[0].match, match);
  assert.equal(rows[0].target.locator, locator);
  assert.equal(rows[0].target.book, item);
});

test('snippet furigana matches retain their source hit and locator', () => {
  const snippet = { key: 'snippet:one', id: 'one', title: 'Snippet title' };
  const hit = {
    locator: { blockId: 'block:one', offset: 2, quote: '猫' },
    excerpt: '猫',
    excerptMatch: { start: 0, end: 1 },
    reading: true
  };
  const [row] = snippetContentRows(new Map([['one', [hit]]]), [snippet]);
  assert.equal(row.detail, 'Furigana match');
  assert.equal(row.target.snippet, snippet);
  assert.equal(row.target.hit, hit);
  assert.equal(row.match, hit.excerptMatch);
});

test('video passages retain precise delayed timestamps, track identities and source highlights', () => {
  const hit = {
    key: videoKey,
    title: 'Video title',
    trackId: 'track:one',
    cueId: 'cue:one',
    time: 3.25,
    end: 4.5,
    trackLabel: '',
    language: 'ja',
    text: '前に猫の本',
    match: { start: 2, end: 5 }
  };
  const [row] = videoContentRows([hit]);
  assert.equal(row.detail, '0:03 · ja');
  assert.deepEqual(row.target, { kind: 'video', key: videoKey, time: 3.25, track: 'track:one' });
  assert.equal(row.match, hit.match);
  assert.equal(row.excerpt, hit.text);
});
