import assert from 'node:assert/strict';
import test from 'node:test';
import {
  importFile,
  decodeTitle,
  bookmark,
  yatsuMetadata,
  statistics,
  audio,
  subtitles,
  goals,
  canonical,
  withoutIdentity,
  reconcileImport,
  MigrationConflict
} from '../../apps/web/src/lib/manabi/ttu-migration-format.ts';

const day = {
  title: '本',
  dateKey: '2026-09-19',
  charactersRead: 60,
  readingTime: 300,
  minReadingSpeed: 720,
  altMinReadingSpeed: 720,
  lastReadingSpeed: 720,
  maxReadingSpeed: 720,
  lastStatisticModified: 100
};
const mark = {
  dataId: 99,
  exploredCharCount: 30,
  progress: 0.1,
  scrollX: -42,
  lastBookmarkModified: 100
};

test('versioned filenames support all exported parts without interpreting credentials', () => {
  assert.deepEqual(importFile('bookdata_1_6_4382_100_200.zip'), {
    part: 'book',
    modified: 100,
    characters: 4382,
    opened: 200
  });
  assert.equal(importFile('progress_1_6_100_1e-7.json').part, 'bookmark');
  assert.equal(
    importFile('statistics_1_6_100_60_300_720_720_720_720_300_300_60_60_720_720_na.json').part,
    'statistics'
  );
  assert.equal(importFile('audioBook_1_6_100_1.5.json').part, 'audio');
  assert.equal(importFile('subtitles_1_6_100_1.json').part, 'subtitles');
  assert.equal(importFile('ttu-user-goals_1_6_100.json').part, 'goals');
  assert.equal(importFile('bookdata_1_7_4382_100_200.zip').part, 'book');
  assert.equal(importFile('bookdata_1_8_4382_100_200.zip').part, 'book');
  assert.equal(importFile('progress_1_8_100_1e-7.json').part, 'bookmark');
  assert.equal(importFile('storageSource.json'), undefined);
  for (const name of [
    'bookdata_2_6_1_1_0.zip',
    'bookdata_1_9_1_1_0.zip',
    'bookdata_1_6_1_1.zip',
    'bookdata_1_6_1_1_0.json',
    'progress_1_6_-1_0.json',
    'bookdata_1_6_9007199254740992_1_0.zip'
  ])
    assert.throws(() => importFile(name));
});

test('Yatsu v11 names and layout hints require the explicit Yatsu format', () => {
  const bookName = 'bookdata_1_11_72_1790210899712_1790210900017.zip';
  assert.throws(() => importFile(bookName), /Unsupported export version/);
  assert.deepEqual(importFile(bookName, 'yatsu'), {
    part: 'book',
    modified: 1790210899712,
    characters: 72,
    opened: 1790210900017
  });
  assert.equal(importFile('progress_1_11_1790210900197_0.json', 'yatsu').part, 'bookmark');
  assert.throws(() => importFile('bookdata_1_12_72_1_0.zip', 'yatsu'));
  const yatsuProgress = {
    ...mark,
    targetSectionIndex: 0,
    targetSectionId: 'section-1',
    sourceViewMode: 'paginated',
    sourceReaderLayoutKey: '["paginated-v1"]',
    sourceBookCharCount: 72
  };
  assert.equal(bookmark(yatsuProgress, 100, 'yatsu').progress, 0.1);
  assert.throws(() => bookmark(yatsuProgress, 100), /Unsupported fields/);
  assert.throws(() => bookmark({ ...yatsuProgress, sourceBookCharCount: -1 }, 100, 'yatsu'));
  assert.equal(
    statistics([{ ...day, dictionaryPopupOpenCount: 2 }], '本', 'yatsu')[0].charactersRead,
    60
  );
  assert.throws(() => statistics([{ ...day, dictionaryPopupOpenCount: 2 }], '本'));
  assert.equal(importFile('bookmeta_1_11_1790212588235.json', 'yatsu').part, 'metadata');
  assert.equal(importFile('bookmeta_1_11_1790212588235.json'), undefined);
  assert.deepEqual(
    yatsuMetadata({ tags: ['Portable Shelf', 'Portable Shelf'], lastBookMetaModified: 100 }, 100),
    ['Portable Shelf']
  );
  assert.throws(() => yatsuMetadata({ tags: ['Portable Shelf'], lastBookMetaModified: 101 }, 100));
  assert.throws(() => yatsuMetadata({ tags: ['\u0000bad'], lastBookMetaModified: 100 }, 100));
});

test('literal exported title markers decode without lossy path substitution', () => {
  assert.equal(decodeTitle('本%2F100%25~ttu-star~~ttu-dend~'), '本/100%*.');
  assert.equal(decodeTitle('trailing~ttu-spc~'), 'trailing ');
  for (const name of ['bad%Q1', '%00invalid', '']) assert.throws(() => decodeTitle(name));
});

test('bookmark keeps fractions, anchors and signed vertical scroll but drops local IDs', () => {
  assert.deepEqual(bookmark(mark, 100), {
    exploredCharCount: 30,
    progress: 0.1,
    scrollX: -42,
    lastBookmarkModified: 100
  });
  assert.equal(bookmark({ ...mark, progress: 'paragraph:12' }, 100).progress, 'paragraph:12');
  for (const value of [
    { ...mark, progress: 1.1 },
    { ...mark, progress: Infinity },
    { ...mark, exploredCharCount: -1 },
    { ...mark, refreshToken: 'secret' },
    { ...mark, lastBookmarkModified: 101 }
  ])
    assert.throws(() => bookmark(value, 100));
});

test('day rows preserve seconds and do not fabricate or sum native analytics', () => {
  const value = statistics([day], '本')[0];
  assert.equal(value.readingTime, 300);
  assert.equal(value.charactersRead, 60);
  assert.equal(value.title, undefined);
  assert.throws(() => statistics([day, day], '本'), /Duplicate/);
  assert.throws(() => statistics([day], 'different'), /different book/);
  assert.throws(() => statistics([{ ...day, dateKey: '2026-02-30' }], '本'), /date/);
  assert.throws(() => statistics([{ ...day, readingTime: NaN }], '本'));
  assert.throws(() =>
    statistics(
      [{ ...day, completedData: { ...withoutIdentity(day), dateKey: '2026-09-18' } }],
      '本'
    )
  );
});

test('audiobook positions and subtitles are typed data, not playback URLs or handles', () => {
  assert.deepEqual(
    audio({ title: '本', playbackPosition: 12.5, lastAudioBookModified: 100 }, '本', 100),
    { playbackPosition: 12.5, lastAudioBookModified: 100 }
  );
  assert.throws(() =>
    audio(
      { title: '本', playbackPosition: 12, lastAudioBookModified: 100, url: 'https://bad.test' },
      '本',
      100
    )
  );
  const row = {
    id: 'line-1',
    originalStartSeconds: 0,
    startSeconds: 0,
    startTime: '00:00:00',
    originalEndSeconds: 2,
    endSeconds: 2,
    endTime: '00:00:02',
    originalText: '本',
    text: '本',
    subIndex: 0
  };
  const value = {
    title: '本',
    subtitleData: { name: 'book.srt', subtitles: [row] },
    lastSubtitleDataModified: 100
  };
  assert.equal(subtitles(value, '本', 100).subtitleData.subtitles[0].text, '本');
  assert.throws(
    () => subtitles({ ...value, subtitleData: { name: 'x', subtitles: [row, row] } }, '本', 100),
    /Duplicate/
  );
  assert.throws(() =>
    subtitles(
      { ...value, subtitleData: { name: 'x', subtitles: [{ ...row, endSeconds: -1 }] } },
      '本',
      100
    )
  );
});

test('separate goals have real dates, supported frequencies and no overlapping ranges', () => {
  const goal = {
    timeGoal: 600,
    characterGoal: 500,
    goalFrequency: 'daily',
    goalStartDate: '2026-09-01',
    goalEndDate: '2026-09-15',
    goalOriginalEndDate: '2026-09-15',
    lastGoalModified: 100
  };
  assert.equal(goals([goal])[0].timeGoal, 600);
  assert.throws(
    () => goals([goal, { ...goal, goalStartDate: '2026-09-15', goalEndDate: '' }]),
    /overlap/
  );
  assert.throws(() => goals([{ ...goal, goalFrequency: 'hourly' }]));
});

test('the same source record is a no-op after local reading or a local reset', () => {
  const source = withoutIdentity(mark),
    receipt = canonical(source);
  assert.equal(reconcileImport({ ...source, progress: 0.8 }, source, receipt), 'skip');
  assert.equal(reconcileImport(undefined, source, receipt), 'skip');
  assert.equal(reconcileImport(source, source, undefined), 'acknowledge');
  assert.equal(reconcileImport(undefined, source, undefined), 'write');
});

test('updated records require a choice when local data also changed, but missing new days are additive', () => {
  const old = withoutIdentity(day),
    incoming = { ...old, readingTime: 400, lastStatisticModified: 200 };
  assert.equal(reconcileImport(old, incoming, canonical(old)), 'write');
  assert.throws(
    () => reconcileImport({ ...old, readingTime: 500 }, incoming, canonical(old)),
    MigrationConflict
  );
  assert.throws(() => reconcileImport(undefined, incoming, canonical(old)), MigrationConflict);
  assert.equal(
    reconcileImport({ ...old, readingTime: 500 }, incoming, canonical(old), true),
    'write'
  );
  assert.equal(reconcileImport(undefined, incoming, undefined), 'write');
  assert.throws(
    () => reconcileImport(old, { ...old, readingTime: 400 }, canonical(old)),
    MigrationConflict
  );
});

test('an older batch cannot roll back a later imported snapshot', () => {
  const old = withoutIdentity(day),
    newer = { ...old, readingTime: 400, lastStatisticModified: 200 };
  assert.equal(reconcileImport(newer, old, canonical(newer)), 'skip');
  assert.equal(reconcileImport(newer, old, canonical(newer), true), 'write');
  assert.equal(canonical({ a: 1, b: 2 }), canonical({ b: 2, a: 1 }));
  assert.deepEqual(
    withoutIdentity({ title: 'x', dataId: 1, progress: 0.5, manabiTtuReceipt: 'x' }),
    { progress: 0.5 }
  );
});
