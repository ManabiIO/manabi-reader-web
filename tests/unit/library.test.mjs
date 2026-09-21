import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calendarDay,
  validDay,
  validCompletion,
  progressFraction,
  isFinished,
  finishedDay,
  mergeCompletion
} from '../../apps/web/src/lib/library/completion.ts';
import { directoryTree, filterTree } from '../../apps/web/src/lib/library/tree.ts';
import {
  encodeSeriesMetadata,
  decodeSeriesMetadata,
  directoryName
} from '../../apps/web/src/lib/library/series-metadata.ts';
import { resolvePageDirection } from '../../apps/web/src/lib/library/direction.ts';
import { boundedBytes } from '../../apps/web/src/lib/library/bounded-response.ts';
import {
  continueBooks,
  finishedGroups,
  formatCalendarDay,
  seriesReadingTarget
} from '../../apps/web/src/lib/library/reading-state.ts';
import {
  creatorLine,
  extractCreators,
  validCreators
} from '../../apps/web/src/lib/library/book-metadata.ts';

const file = (id, parent, name = id) => ({ id, parent, name, kind: 'file' });
const folder = (id, parent, name = id) => ({ id, parent, name, kind: 'folder' });
const tree = (entries) => directoryTree(entries, '', (e) => e.id);
const shelfBook = (key, options = {}) => ({
  key,
  canonicalTitle: options.title || key,
  title: options.title || key,
  imagePath: '',
  creators: [],
  characters: 0,
  lastBookModified: 0,
  lastBookOpen: 0,
  progress: 0,
  lastBookmarkModified: 0,
  isPlaceholder: false,
  direction: 'unknown',
  ...options
});

test('bounded metadata reads enforce both declared and streamed byte limits', async () => {
  const exact = await boundedBytes(new Response(new Uint8Array([1, 2, 3])), 3);
  assert.deepEqual([...new Uint8Array(exact)], [1, 2, 3]);
  await assert.rejects(
    boundedBytes(new Response('large', { headers: { 'Content-Length': '5' } }), 4),
    /too large/
  );
  const dishonest = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3, 4]));
      controller.close();
    }
  });
  await assert.rejects(boundedBytes(new Response(dishonest), 3), /too large/);
});

test('singleton directories flatten recursively, without turning a multi-book directory into a flat shelf', () => {
  const entries = [
    folder('wrapper', ''),
    folder('series', 'wrapper'),
    folder('single', 'series'),
    folder('deep', 'single'),
    file('first', 'deep'),
    file('second', 'series'),
    folder('empty', ''),
    file('standalone', '')
  ];
  const nodes = tree(entries);
  assert.deepEqual(
    nodes.map((n) => [n.kind, n.id]),
    [
      ['series', 'series'],
      ['book', 'standalone']
    ]
  );
  assert.deepEqual(nodes[0].books, ['first', 'second']);
  assert.deepEqual(entries[4], file('first', 'deep')); // projection never moves files
});
test('subseries stay above books even when their natural name sorts last', () => {
  const nodes = tree([
    folder('series', ''),
    file('a', 'series'),
    folder('z', 'series'),
    file('v10', 'z', '10.epub'),
    file('v2', 'z', '2.epub')
  ]);
  assert.deepEqual(
    nodes[0].children.map((n) => n.id),
    ['z', 'a']
  );
  assert.deepEqual(nodes[0].children[0].books, ['v2', 'v10']);
});
test('filtering never changes series identity or flattens a now-single visible member', () => {
  const nodes = tree([folder('series', ''), file('a', 'series'), file('b', 'series')]);
  const filtered = filterTree(nodes, (b) => b === 'a');
  assert.equal(filtered[0].kind, 'series');
  assert.equal(filtered[0].id, 'series');
  assert.deepEqual(filtered[0].books, ['a']);
  assert.deepEqual(nodes[0].books, ['a', 'b']);
  assert.deepEqual(
    filterTree(nodes, () => false),
    []
  );
});
test('provider IDs are opaque, names do not define hierarchy, and the source root is never a series', () => {
  const nodes = directoryTree(
    [file('opaque/id:a', 'ROOT'), file('second', 'ROOT')],
    'ROOT',
    (e) => e.name,
    { ROOT: 'Never used' }
  );
  assert.ok(nodes.every((n) => n.kind === 'book'));
  assert.throws(() => tree([file('duplicate', ''), file('duplicate', '')]));
  assert.throws(() => tree([folder('', '')]));
});
test('bounded deep traversal and 10,000-wide directories do not overflow function arguments', () => {
  const entries = Array.from({ length: 70 }, (_, i) => folder(String(i), i ? String(i - 1) : ''));
  assert.throws(() => tree(entries), /deeply/);
  assert.equal(tree(Array.from({ length: 10000 }, (_, i) => file(String(i), ''))).length, 10000);
});
test('name-only YAML round trips Japanese, apostrophes, YAML-looking punctuation and comments safely', () => {
  for (const name of [
    '夏目漱石',
    'A: B # C',
    '"quoted"',
    "Author's books",
    '*not-an-alias',
    '[not, a, list]'
  ])
    assert.equal(decodeSeriesMetadata(encodeSeriesMetadata(name)), name);
  assert.equal(
    decodeSeriesMetadata("---\n# note\nname: 'It''s good' # comment\n...\n"),
    "It's good"
  );
  assert.equal(decodeSeriesMetadata('name: Summer books # note'), 'Summer books');
});
test('metadata never silently destroys an unknown schema, aliases, duplicate fields, or oversized content', () => {
  for (const value of [
    'name: a\nname: b',
    'name: a\nauthor: b',
    'name: *alias',
    'name: !!str a',
    'name: |\n  title',
    'name: "unterminated',
    'name: ' + 'a'.repeat(4096),
    'name: "\\u0000"'
  ])
    assert.throws(() => decodeSeriesMetadata(value));
  for (const name of ['../x', '.hidden', 'a/b', 'a\\b', 'CON', 'a: b', 'a.', ''])
    assert.throws(() => directoryName(name));
  assert.equal(directoryName(' 日本の本 '), '日本の本');
});
test('progress recognizes numeric fractions and percentages, never arbitrary numeric bookmark anchors', () => {
  assert.equal(progressFraction(0.19), 0.19);
  assert.equal(progressFraction('19%'), 0.19);
  for (const value of ['19', '100', 'section-100', NaN, Infinity, undefined, -1])
    assert.equal(progressFraction(value), 0);
  assert.equal(progressFraction(1.01), 1);
  assert.equal(isFinished({ progress: 0.9999 }), false);
  assert.equal(isFinished({ progress: 1 }), true);
});
test('marking still reading overrides 100% without changing any reading position or statistics', () => {
  const completion = { state: 'reading', modifiedAt: 100 };
  const old = { progress: 1, completion, lastBookmarkModified: 100 };
  const saved = {
    progress: 1,
    exploredCharCount: 500,
    scrollX: 42,
    scrollY: 9,
    lastBookmarkModified: 90
  };
  const result = mergeCompletion(old, saved);
  assert.equal(isFinished(result), false);
  assert.deepEqual(result, { ...saved, completion, lastBookmarkModified: 100 });
  assert.equal(saved.lastBookmarkModified, 90);
});
test('manual finish and edited date survive delayed autosave and stale completion snapshots', () => {
  const old = {
    progress: 0.25,
    completion: { state: 'finished', finishedOn: '2026-09-01', modifiedAt: 200 }
  };
  const result = mergeCompletion(old, {
    progress: 0.3,
    lastBookmarkModified: 300,
    completion: { state: 'reading', modifiedAt: 150 }
  });
  assert.equal(result.progress, 0.3);
  assert.equal(result.lastBookmarkModified, 300);
  assert.equal(finishedDay(result), '2026-09-01');
  assert.equal(isFinished(result), true);
  assert.equal(
    isFinished(
      mergeCompletion(old, { progress: 0.3, completion: { state: 'reading', modifiedAt: 201 } })
    ),
    false
  );
});
test('first actual 100% save records a stable calendar date and historical unknown dates remain unknown', () => {
  const time = new Date(2026, 8, 20, 14).getTime();
  const first = mergeCompletion(undefined, { progress: 1, lastBookmarkModified: time });
  assert.equal(finishedDay(first), calendarDay(time));
  assert.equal(
    finishedDay(mergeCompletion(first, { progress: 1, lastBookmarkModified: time + 86400000 })),
    calendarDay(time)
  );
  assert.equal(finishedDay({ progress: 1, lastBookmarkModified: time }), undefined);
});
test('completion wire shape is strict and calendar validation rejects impossible dates', () => {
  assert.equal(validDay('2024-02-29'), true);
  for (const day of ['2025-02-29', '2026-09-31', '2026-9-1', '2026-09-20T00:00:00Z', 'x'])
    assert.equal(validDay(day), false);
  assert.equal(
    validCompletion({ state: 'finished', finishedOn: '2026-09-20', modifiedAt: 1 }),
    true
  );
  for (const value of [
    null,
    [],
    { state: 'finished', modifiedAt: 1 },
    { state: 'reading', finishedOn: '2026-01-01', modifiedAt: 1 },
    { state: 'reading', modifiedAt: Infinity },
    { state: 'reading', modifiedAt: 1, unexpected: 1 }
  ])
    assert.equal(validCompletion(value), false);
});
test('authored spine direction takes priority over language-independent sampled CSS flow', () => {
  const vertical = [{ writingMode: 'vertical-rl', direction: 'ltr', characters: 100 }];
  assert.deepEqual(resolvePageDirection('ltr', vertical), { value: 'ltr', source: 'spine' });
  assert.deepEqual(resolvePageDirection('rtl', []), { value: 'rtl', source: 'spine' });
  assert.deepEqual(resolvePageDirection('default', vertical), { value: 'rtl', source: 'content' });
  assert.equal(
    resolvePageDirection(undefined, [
      { writingMode: 'horizontal-tb', direction: 'ltr', characters: 100 }
    ]).value,
    'ltr'
  );
  assert.equal(
    resolvePageDirection(undefined, [
      { writingMode: 'horizontal-tb', direction: 'rtl', characters: 100 }
    ]).value,
    'rtl'
  );
  assert.equal(
    resolvePageDirection(undefined, [
      { writingMode: 'vertical-lr', direction: 'rtl', characters: 100 }
    ]).value,
    'ltr'
  );
});
test('ambiguous, missing and mixed direction remains unknown rather than guessed from Japanese', () => {
  assert.equal(resolvePageDirection(undefined).value, 'unknown');
  assert.equal(resolvePageDirection('ja').value, 'unknown');
  assert.equal(
    resolvePageDirection(undefined, [
      { writingMode: 'vertical-rl', direction: 'ltr', characters: 50 },
      { writingMode: 'horizontal-tb', direction: 'ltr', characters: 50 }
    ]).value,
    'unknown'
  );
});

test('Continue requires reading evidence, excludes finished books, and has stable recency order', () => {
  const untouched = shelfBook('untouched');
  const opened = shelfBook('opened', { lastBookOpen: 40 });
  const migrated = shelfBook('migrated', { progress: 0.2, lastBookmarkModified: 50 });
  const finished = shelfBook('finished', {
    lastBookOpen: 60,
    completion: { state: 'finished', finishedOn: '2026-09-20', modifiedAt: 60 }
  });
  assert.deepEqual(
    continueBooks([untouched, opened, finished, migrated]).map((book) => book.key),
    ['migrated', 'opened']
  );
});

test('series reading target prefers recent evidence then deterministic natural volume order', () => {
  const ten = shelfBook('ten', {
    file: { id: '10.epub', name: '10.epub', parent: '', kind: 'file' }
  });
  const two = shelfBook('two', {
    file: { id: '2.epub', name: '2.epub', parent: '', kind: 'file' }
  });
  const one = shelfBook('one', {
    file: { id: '1.epub', name: '1.epub', parent: '', kind: 'file' }
  });
  assert.equal(seriesReadingTarget([ten, two, one]).key, 'one');
  assert.equal(seriesReadingTarget([ten, two, one], [two, ten, one]).key, 'two');
  two.lastBookOpen = 25;
  assert.equal(seriesReadingTarget([ten, two, one]).key, 'two');
  two.completion = { state: 'finished', finishedOn: '2026-09-20', modifiedAt: 30 };
  assert.equal(seriesReadingTarget([ten, two, one]).key, 'one');
});

test('Finished groups date-only values newest first and leaves missing dates last', () => {
  const groups = finishedGroups([
    shelfBook('unknown', { progress: 1 }),
    shelfBook('older', {
      completion: { state: 'finished', finishedOn: '2024-02-29', modifiedAt: 1 }
    }),
    shelfBook('newer', {
      completion: { state: 'finished', finishedOn: '2026-09-20', modifiedAt: 2 }
    })
  ]);
  assert.deepEqual(
    groups.map((group) => group.day),
    ['2026-09-20', '2024-02-29', undefined]
  );
  assert.deepEqual(
    finishedGroups(
      groups.flatMap((group) => group.books),
      'asc'
    ).map((group) => group.day),
    ['2024-02-29', '2026-09-20', undefined]
  );
  assert.match(formatCalendarDay('2024-02-29'), /2024/);
  assert.match(formatCalendarDay('2024-02-29'), /29/);
});

test('creator metadata honors roles and EPUB refinements while remaining bounded', () => {
  const creators = extractCreators({
    'dc:creator': [
      { '#text': '  夏目   漱石  ', '@_id': 'creator-1' },
      { '#text': 'Editor', '@_role': 'edt' },
      { '#text': 'Ignored unroled when an author exists' }
    ],
    meta: [
      { '@_refines': '#creator-1', '@_property': 'role', '#text': 'aut' },
      { '@_refines': '#creator-1', '@_property': 'file-as', '#text': 'Natsume, Soseki' }
    ]
  });
  assert.deepEqual(creators, [{ name: '夏目 漱石', sortAs: 'Natsume, Soseki' }]);
  assert.equal(creatorLine(creators), '夏目 漱石');
  assert.equal(validCreators(creators), true);
  assert.equal(validCreators([{ name: '' }]), false);
  assert.equal(validCreators(Array.from({ length: 33 }, () => ({ name: 'Author' }))), false);
});
