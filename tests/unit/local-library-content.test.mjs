/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout } from 'node:timers';
import {
  projectSearchBook,
  findContent,
  searchDigest
} from '../../apps/web/src/lib/library/content-search.ts';
import { prepareYatsuEntries, yatsuRows } from '../../apps/web/src/lib/manabi/yatsu-import.ts';
import { parseYatsuSettings } from '../../apps/web/src/lib/manabi/yatsu-settings-format.ts';
import { importFile } from '../../apps/web/src/lib/manabi/ttu-migration-format.ts';
const key = 'content:' + 'a'.repeat(64);
const manifest = {
  version: 1,
  resources: [
    { href: 'part1.xhtml', spineIndex: 0, sectionId: 'first' },
    { href: 'part2.xhtml', spineIndex: 1, sectionId: 'second' }
  ]
};
const html =
  '<section id="first"><p>猫<ruby>本<rt>ほん</rt></ruby><b>棚</b></p><p hidden>秘密</p><p style="display:none !important">隠す</p><p>𠮟る ＡＢＣ ｶﾞ ガ ﬃ</p></section><section id="second"><p>別の章の目印。</p></section>';

test('library worker projection excludes ruby and hidden text but preserves inline text and chapter identity', () => {
  const resources = projectSearchBook(html, manifest);
  assert.equal(resources[0].text, '猫本棚\n𠮟る ＡＢＣ ｶﾞ ガ ﬃ');
  assert.equal(resources[1].resource.href, 'part2.xhtml');
  assert.throws(
    () => projectSearchBook(html, { version: 1, resources: manifest.resources.slice(0, 1) }),
    /manifest/
  );
  assert.throws(
    () =>
      projectSearchBook(html, {
        ...manifest,
        resources: [{ ...manifest.resources[0], spineIndex: 1 }, manifest.resources[1]]
      }),
    /Invalid publication/
  );
});
test('normalized matches return original code-point locations, not normalized offsets or fabricated quotes', async () => {
  const resources = projectSearchBook(html, manifest);
  for (const [query, quote] of [
    ['abc', 'ＡＢＣ'],
    ['ｶﾞ', 'ｶﾞ'],
    ['ガ', 'ｶﾞ'],
    ['𠮟', '𠮟'],
    ['f', 'ﬃ'],
    ['本棚', '本棚']
  ]) {
    const { hits } = await findContent(resources, query, { id: 7, key });
    assert.ok(hits.length, query);
    assert.equal(hits[0].locator.quote, quote, query);
    const target = hits[0].locator,
      source = resources[target.resource.spineIndex].text;
    assert.equal([...source].slice(target.start, target.end).join(''), quote);
    assert.equal(target.resourceDigest, await searchDigest(source));
  }
  assert.equal((await findContent(resources, 'ほん', { id: 7, key })).hits.length, 0);
  assert.equal(
    (await findContent(resources, '目印', { id: 7, key })).hits[0].locator.resource.spineIndex,
    1
  );
});
test('content search caps results honestly and cancellation never publishes a partial old query', async () => {
  const resources = projectSearchBook('<section><p>' + '猫'.repeat(50000) + '</p></section>');
  const limited = await findContent(resources, '猫', { id: 1, key }, () => false, 3);
  assert.equal(limited.hits.length, 3);
  assert.equal(limited.truncated, true);
  let cancelled = false;
  setTimeout(() => (cancelled = true), 0);
  assert.deepEqual(await findContent(resources, '猫', { id: 1, key }, () => cancelled), {
    hits: [],
    truncated: false
  });
  assert.equal((await findContent(resources, '猫'.repeat(513), { id: 1, key })).hits.length, 0);
});
test('Yatsu current formats recognize bookmarks, highlights, book notes and explicit settings only', () => {
  for (const [name, part] of [
    ['bookmarks', 'savedBookmarks'],
    ['highlights', 'highlights'],
    ['notes', 'notes']
  ]) {
    assert.equal(importFile(`${name}_1_11_123.json`, 'yatsu').part, part);
    assert.equal(importFile(`${name}_1_11_123.json`), undefined);
  }
  assert.equal(importFile('yatsu-local-settings.json', 'yatsu').part, 'settings');
  assert.equal(importFile('yatsu-local-settings.json'), undefined);
});
test('Yatsu book notes stay book-wide; unique highlights anchor; ambiguous originals are retained', async () => {
  const groups = [
    {
      part: 'notes',
      modified: 1000,
      rows: yatsuRows(
        [
          {
            bookTitle: '本',
            syncId: 'source-note',
            dateCreated: 1000,
            text: '本全体への感想',
            title: '感想'
          }
        ],
        'notes',
        '本'
      )
    },
    {
      part: 'highlights',
      modified: 1000,
      rows: yatsuRows(
        [{ bookTitle: '本', dateCreated: 1000, text: '本棚', note: '読みたい' }],
        'highlights',
        '本'
      )
    },
    {
      part: 'savedBookmarks',
      modified: 1000,
      rows: yatsuRows(
        [
          {
            bookTitle: '本',
            dateCreated: 1000,
            exploredCharCount: 0,
            targetSectionId: 'first',
            targetSectionIndex: 0,
            label: '最初'
          }
        ],
        'savedBookmarks',
        '本'
      )
    }
  ];
  const results = await prepareYatsuEntries(groups, '本', 'b'.repeat(64), html, manifest);
  assert.equal(results[0].record.status, 'book-note');
  assert.equal(results[0].annotation, undefined);
  assert.equal(results[0].record.body, '本全体への感想');
  assert.equal(results[1].annotation.kind, 'highlight');
  assert.equal(results[1].annotation.body, '読みたい');
  assert.equal(results[2].annotation.kind, 'bookmark');
  assert.equal(results[2].annotation.label, '最初');
  assert.deepEqual(
    (await prepareYatsuEntries(groups, '本', 'b'.repeat(64), html, manifest)).map(
      (r) => r.record.id
    ),
    results.map((r) => r.record.id)
  );
  const ambiguous = await prepareYatsuEntries(
    [groups[1]],
    '本',
    'b'.repeat(64),
    '<section><p>本棚。本棚。</p></section>'
  );
  assert.equal(ambiguous[0].record.status, 'unresolved');
  assert.equal(ambiguous[0].record.quote, '本棚');
  assert.equal(ambiguous[0].record.source.note, '読みたい');
  assert.equal(ambiguous[0].annotation, undefined);
});
test('Yatsu validation rejects wrong-book, oversized, duplicate identities and invalid dates before writes', async () => {
  assert.throws(
    () => yatsuRows([{ bookTitle: '別の本', text: 'x' }], 'notes', '本'),
    /another book/
  );
  assert.throws(() => yatsuRows([{ bookTitle: '本', text: 'x', dateCreated: -1 }], 'notes', '本'));
  assert.throws(() => yatsuRows([{ text: 'x'.repeat(65537) }], 'notes', '本'));
  const row = { bookTitle: '本', dateCreated: 1000, text: '本棚' };
  await assert.rejects(
    () =>
      prepareYatsuEntries(
        [{ part: 'highlights', modified: 1000, rows: [row, row] }],
        '本',
        'b'.repeat(64),
        html,
        manifest
      ),
    /same source identity/
  );
  const signal = AbortSignal.abort();
  await assert.rejects(() =>
    prepareYatsuEntries(
      [{ part: 'highlights', modified: 1000, rows: [row] }],
      '本',
      'b'.repeat(64),
      html,
      manifest,
      signal
    )
  );
});
test('settings whitelist ignores credentials, storage handles, automatic replication and custom CSS', () => {
  const parsed = parseYatsuSettings({
    app: 'Yatsu Reader',
    schemaVersion: 1,
    settings: {
      fontSize: 24,
      lineHeight: 1.6,
      writingMode: 'vertical-rl',
      fontWeightGroupOne: 500,
      hideFurigana: true,
      autoReplication: true,
      webdavPassword: 'secret',
      customThemes: { x: 'url(evil)' },
      storageSources: ['secret'],
      requestPersistentStorage: true
    }
  });
  assert.deepEqual(
    { ...parsed.values },
    {
      fontSize: 24,
      lineHeight: 1.6,
      writingMode: 'vertical-rl',
      fontWeight: 500,
      hideFurigana: true
    }
  );
  assert.deepEqual(
    parsed.skipped.sort(),
    [
      'autoReplication',
      'webdavPassword',
      'customThemes',
      'storageSources',
      'requestPersistentStorage'
    ].sort()
  );
  assert.throws(
    () =>
      parseYatsuSettings({ app: 'Yatsu Reader', schemaVersion: 1, settings: { fontSize: 999 } }),
    /No settings were changed/
  );
  assert.throws(() =>
    parseYatsuSettings({
      app: 'Yatsu Reader',
      schemaVersion: 1,
      settings: { fontFamilyGroupOne: 'x; background:url(evil)' }
    })
  );
  assert.throws(() => parseYatsuSettings({ app: 'Yatsu Reader', schemaVersion: 2, settings: {} }));
});

test('Yatsu cross-paragraph UTF-16 witnesses become canonical original-text locators', async () => {
  const raw = '<section id="first"><p>𠮟る猫</p><p>見つけた。</p></section>';
  const [entry] = await prepareYatsuEntries(
    [
      {
        part: 'highlights',
        modified: 1000,
        rows: [
          {
            bookTitle: '本',
            dateCreated: 1000,
            text: '猫見つけた',
            prefixContext: '𠮟る',
            suffixContext: '。'
          }
        ]
      }
    ],
    '本',
    'c'.repeat(64),
    raw
  );
  assert.equal(entry.record.status, 'anchored');
  assert.equal(entry.annotation.targets[0].quote, '猫\n見つけた');
  assert.equal(entry.annotation.targets[0].start, 2);
});
test('Yatsu quote-free bookmarks require a matching whole-book counter witness', async () => {
  const raw =
    '<section id="one"><p>猫。本</p></section><section id="two"><p>犬の目印</p></section>';
  const rows = [
    {
      bookTitle: '本',
      dateCreated: 1000,
      exploredCharCount: 3,
      sourceBookCharCount: 6,
      targetSectionId: 'two',
      targetSectionIndex: 1
    }
  ];
  const [entry] = await prepareYatsuEntries(
    [{ part: 'savedBookmarks', modified: 1000, rows }],
    '本',
    'c'.repeat(64),
    raw
  );
  assert.equal(entry.record.status, 'anchored');
  assert.equal(entry.annotation.targets[0].resource.sectionId, 'two');
  assert.equal(entry.annotation.targets[0].start, 1);
  const [bad] = await prepareYatsuEntries(
    [{ part: 'savedBookmarks', modified: 1000, rows: [{ ...rows[0], sourceBookCharCount: 99 }] }],
    '本',
    'c'.repeat(64),
    raw
  );
  assert.equal(bad.record.status, 'unresolved');
});

test('metadata/query and grapheme-based passage folding agree for sigma and normalization expansions', async () => {
  const { foldSearch } = await import('../../apps/web/src/lib/library/search-normalization.ts');
  const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
  for (const value of ['ΟΣ', 'ος', 'οσ', 'ＡＢＣ', 'ｶﾞ', 'ガ', 'ﬃ', 'İ', '𠮟']) {
    assert.equal(
      [...segmenter.segment(value)].map(({ segment }) => foldSearch(segment)).join(''),
      foldSearch(value)
    );
    const { hits } = await findContent(
      projectSearchBook(`<section><p>${value}</p></section>`),
      value,
      { id: 1, key }
    );
    assert.equal(hits.length, 1, value);
    assert.equal(hits[0].locator.quote, value);
  }
  assert.equal(foldSearch('ΟΣ'), foldSearch('οσ'));
  assert.equal(foldSearch('ΟΣ'), foldSearch('ος'));
});
