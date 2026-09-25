/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import { Buffer } from 'node:buffer';
import { setTimeout } from 'node:timers';
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { findText } from '../../apps/web/src/lib/library/search/text.ts';
import { metadataMatches } from '../../apps/web/src/lib/library/search/metadata.ts';
import {
  prepareLibraryPassage,
  takeLibraryPassage,
  clearLibraryPassage
} from '../../apps/web/src/lib/library/search/handoff.ts';
import {
  studyEntries,
  locateStudy,
  studyComparable
} from '../../apps/web/src/lib/manabi/yatsu-study-format.ts';
import { previewYatsuSettings } from '../../apps/web/src/lib/manabi/yatsu-settings-format.ts';
import { importFile } from '../../apps/web/src/lib/manabi/ttu-migration-format.ts';
const compile = async (path) => {
  const result = await build({
    entryPoints: [path],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser'
  });
  return import(
    'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
  );
};
const { WebDAVClient, normalizeWebDAVRoot, resolveWebDAVPath, strongETag } = await compile(
  'apps/web/src/lib/library/webdav/client.ts'
);
const { projectStoredBook } = await compile('apps/web/src/lib/library/search/projection.ts');
const collect = async (text, query, cancelled) => Array.fromAsync(findText(text, query, cancelled));
const book = (key, title, creators = []) => ({
  key,
  title,
  canonicalTitle: title,
  creators: creators.map((name) => ({ name }))
});

test('metadata is synchronous, ranked, token-aware, and independent of content work', () => {
  const books = [
    book('1', 'The cat', ['Author One']),
    book('2', 'CAT'),
    book('3', 'Catfish'),
    book('4', 'Different', ['Neko Cat'])
  ];
  assert.deepEqual(
    metadataMatches(books, 'cat').map((b) => b.key),
    ['2', '3', '1', '4']
  );
  assert.deepEqual(
    metadataMatches(books, 'author cat').map((b) => b.key),
    ['1']
  );
  assert.deepEqual(
    metadataMatches(books, 'vol.2', { 4: ['Shelf Vol.2'] }).map((b) => b.key),
    ['4']
  );
  assert.deepEqual(
    metadataMatches([book('1', 'ＡＢＣ')], 'abc').map((b) => b.key),
    ['1']
  );
  assert.deepEqual(metadataMatches(books, 'x'.repeat(513)), []);
});

test('literal search maps Unicode normalization to original code-point coordinates', async () => {
  const cases = [
    ['prefix ＡＢＣ suffix', 'abc', 'ＡＢＣ'],
    ['前か\u3099後', 'が', 'か\u3099'],
    ['前𠮷猫後', '𠮷猫', '𠮷猫'],
    ['前㍿後', '株式会社', '㍿'],
    ['前aaa後', 'aa', 'aa'],
    ['regex a.* b', 'a.*', 'a.*']
  ];
  for (const [source, query, expected] of cases) {
    const hits = await collect(source, query);
    assert.ok(hits.length > 0, query);
    for (const hit of hits) assert.equal([...source].slice(hit.start, hit.end).join(''), hit.match);
    assert.equal(hits[0].match, expected);
  }
  assert.equal(
    (await collect('ﬃ', 'f')).length,
    1,
    'one source glyph should not be reported twice'
  );
});

test('chunk-boundary search neither loses nor duplicates a match and allows cancellation', async () => {
  const source = 'x'.repeat(32765) + 'ABC DEF' + 'z'.repeat(32768) + 'ABC DEF';
  assert.deepEqual(
    (await collect(source, 'abc def')).map((h) => h.start),
    [32765, 65540]
  );
  assert.deepEqual(await collect(source, 'abc', () => true), []);
  let canceled = false;
  const promise = collect('x'.repeat(100_000), 'none', () => canceled);
  setTimeout(() => (canceled = true), 0);
  assert.deepEqual(await promise, []);
  assert.deepEqual(await collect('abc', ''), []);
});

test('worker projection excludes ruby readings, metadata and hidden text, preserving inline text', async () => {
  const [resource] = await projectStoredBook(
    '<div id="one"><p>前<ruby>猫<rt>ねこ</rt><rp>(</rp></ruby><em>後</em></p><p hidden>hidden</p><div style="display:none!important">secret</div><p>A&amp;B<br>C</p><!--comment--><script>unsafe</script></div>'
  );
  assert.equal(resource.text, '前猫後\nA&B\nC');
  assert.equal(resource.resource.sectionId, 'one');
  assert.match(resource.digest, /^[a-f0-9]{64}$/);
  await assert.rejects(projectStoredBook('<!DOCTYPE x><div>x</div>'), /declarations/);
  await assert.rejects(
    projectStoredBook('<div>x</div>', { version: 1, resources: [] }),
    /manifest/
  );
});

test('library passage handoffs are one-use and account/book scoped', () => {
  clearLibraryPassage();
  const locator = { bookKey: 'local:one' };
  prepareLibraryPassage(1, 'a', locator);
  assert.equal(takeLibraryPassage(1, 'b'), undefined);
  assert.equal(takeLibraryPassage(1, 'a'), undefined);
  prepareLibraryPassage(1, null, locator);
  assert.equal(takeLibraryPassage(1, null), locator);
  assert.equal(takeLibraryPassage(1, null), undefined);
  prepareLibraryPassage(1, null, locator);
  clearLibraryPassage();
  assert.equal(takeLibraryPassage(1, null), undefined);
});

test('WebDAV URL containment rejects downgrade, credential-bearing URLs and traversal', () => {
  const root = normalizeWebDAVRoot('https://dav.example/library');
  assert.equal(root, 'https://dav.example/library/');
  assert.equal(resolveWebDAVPath(root, 'book%20one.epub'), root + 'book%20one.epub');
  assert.equal(resolveWebDAVPath(root, 'https://dav.example/%6cibrary/a.epub'), root + 'a.epub');
  for (const value of [
    'http://dav.example/library',
    'https://u:p@dav.example/library',
    'https://dav.example/library?token=x',
    'https://dav.example/library/../private',
    'https://dav.example/library/%2e%2e/private',
    'https://dav.example/library/%2fprivate'
  ])
    assert.throws(() => normalizeWebDAVRoot(value));
  for (const href of [
    'https://other.example/library/a',
    '/library-evil/book.epub',
    '../outside.epub',
    '%2e%2e/other.epub',
    'file:///etc/passwd',
    '/library/a%5cb',
    '/library/a?token=x'
  ])
    assert.throws(() => resolveWebDAVPath(root, href));
  assert.equal(strongETag('"tag"'), true);
  assert.equal(strongETag('W/"tag"'), false);
});

test('WebDAV upload is a direct, create-only conditional write; conflict never retries', async () => {
  const calls = [];
  const client = new WebDAVClient(
    'https://dav.example/library/',
    'user',
    'secret',
    async (url, options) => {
      calls.push({ url, options });
      return new Response(null, { status: 412 });
    }
  );
  await assert.rejects(client.upload(new File(['book'], 'book.txt')), /already exists/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'PUT');
  assert.equal(calls[0].options.headers['If-None-Match'], '*');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.credentials, 'omit');
  client.close();
  await assert.rejects(client.upload(new File(['x'], 'book.txt')));
  assert.equal(calls.length, 1);
});

test('WebDAV accepts UTF-8 credentials but not username header ambiguity', async () => {
  let authorization;
  const client = new WebDAVClient('https://dav.example/', '日本', '鍵', async (_url, options) => {
    authorization = options.headers.Authorization;
    return new Response('text');
  });
  assert.equal(
    await (
      await client.read({ id: 'https://dav.example/book.txt', name: 'book.txt', kind: 'file' })
    ).text(),
    'text'
  );
  assert.equal(Buffer.from(authorization.slice(6), 'base64').toString('utf8'), '日本:鍵');
  assert.throws(() => new WebDAVClient('https://dav.example/', 'evil:part', 'password'));
  client.close();
});

test('Yatsu study parts are gated on the observed wire version', () => {
  for (const [prefix, part] of [
    ['bookmarks', 'savedBookmarks'],
    ['highlights', 'highlights'],
    ['notes', 'notes']
  ]) {
    assert.equal(importFile(`${prefix}_1_11_100.json`, 'yatsu').part, part);
    assert.equal(importFile(`${prefix}_1_11_100.json`), undefined);
    assert.throws(() => importFile(`${prefix}_1_12_100.json`, 'yatsu'));
  }
});
const source = {
  bookTitle: '本',
  text: '猫𠮷',
  startOffset: 1,
  endOffset: 4,
  color: 'blue',
  dateCreated: 100,
  prefixContext: '前',
  suffixContext: '後'
};
const projected = (text) => ({
  text,
  resource: { href: 'a.xhtml', sectionId: 'a', spineIndex: 0 },
  runs: []
});

test('Yatsu records preserve source data and maintain stable identities across label/note edits', async () => {
  const [first] = await studyEntries([source], 'highlights', '本', 100);
  const [updated] = await studyEntries(
    [{ ...source, note: 'new comment', color: 'green' }],
    'highlights',
    '本',
    200
  );
  assert.equal(first.id, updated.id);
  assert.deepEqual(first.source, source);
  assert.notEqual(studyComparable(first), studyComparable(updated));
  const located = await locateStudy(first, [projected('前猫𠮷後')]);
  assert.equal(located.locator.quote, '猫𠮷');
  assert.equal(located.locator.start, 1);
  assert.equal(located.locator.end, 3);
  assert.equal(
    studyComparable(located),
    studyComparable(first),
    'derived locator is not part of source reconciliation'
  );
});

test('Yatsu repeated text and book-level notes do not acquire fabricated passage locations', async () => {
  const [entry] = await studyEntries(
    [{ ...source, prefixContext: '', suffixContext: '' }],
    'highlights',
    '本',
    100
  );
  const ambiguous = await locateStudy(entry, [projected('猫𠮷猫𠮷')]);
  assert.equal(ambiguous.locator, undefined);
  assert.match(ambiguous.unresolved, /more than once/);
  const [note] = await studyEntries(
    [
      {
        bookTitle: '本',
        text: 'Book note',
        title: 'Title',
        dateCreated: 100,
        dateModified: 200,
        syncId: 'note1'
      }
    ],
    'notes',
    '本',
    200
  );
  assert.equal((await locateStudy(note, [projected('Book note')])).locator, undefined);
});

test('Yatsu bookmark at the known opening is mapped; pixel positions and contradictory sections are not', async () => {
  const [first] = await studyEntries(
    [
      {
        bookTitle: '本',
        dateCreated: 100,
        exploredCharCount: 0,
        progress: 0,
        targetSectionId: 'a',
        targetSectionIndex: 0
      }
    ],
    'savedBookmarks',
    '本',
    100
  );
  assert.equal((await locateStudy(first, [projected('opening')])).locator.start, 0);
  const [pixel] = await studyEntries(
    [{ bookTitle: '本', dateCreated: 200, scrollY: 1000, progress: 0.4 }],
    'savedBookmarks',
    '本',
    200
  );
  assert.equal((await locateStudy(pixel, [projected('opening')])).locator, undefined);
  assert.equal(
    (
      await locateStudy({ ...first, source: { ...first.source, targetSectionIndex: 2 } }, [
        projected('opening')
      ])
    ).locator,
    undefined
  );
});

test('invalid, cross-book, duplicate and hostile Yatsu records fail rather than partially import', async () => {
  await assert.rejects(studyEntries([source], 'highlights', 'other', 100), /another book/);
  await assert.rejects(studyEntries([source, source], 'highlights', '本', 100), /duplicate/);
  await assert.rejects(studyEntries([{ ...source, endOffset: -1 }], 'highlights', '本', 100));
  await assert.rejects(
    studyEntries([{ ...source, text: 'x'.repeat(65537) }], 'highlights', '本', 100)
  );
  await assert.rejects(
    studyEntries([JSON.parse('{"bookTitle":"本","__proto__":{}}')], 'notes', '本', 100)
  );
});

test('Yatsu settings are explicit, validated, allowlisted, and never carry connection credentials', () => {
  const envelope = {
    app: 'Yatsu Reader',
    schemaVersion: 1,
    settings: {
      fontSize: 24,
      writingMode: 'vertical-rl',
      hideFurigana: true,
      viewMode: 'paginated',
      followSystemTheme: true,
      theme: 'dark-theme',
      fontWeightGroupOne: 400,
      fontWeightGroupTwo: 400,
      webdavPassword: 'secret',
      customThemes: { script: 'bad' },
      syncTarget: 'cloud'
    }
  };
  const preview = previewYatsuSettings(envelope);
  assert.equal(preview.values.font_size, 24);
  assert.equal(preview.values.writing_mode, 'vertical');
  assert.equal(preview.values.furigana, false);
  assert.equal(preview.values.theme, 'system');
  assert.deepEqual(preview.skipped, ['customThemes', 'syncTarget', 'webdavPassword']);
  assert.ok(!JSON.stringify(preview.values).includes('secret'));
  assert.throws(() => previewYatsuSettings({ ...envelope, schemaVersion: 2 }));
  assert.throws(() => previewYatsuSettings({ ...envelope, settings: { fontSize: Infinity } }));
});
