/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
  projectReaderBridgeFiles,
  READER_BRIDGE_RECORD_LIMITS
} from '../../apps/web/src/lib/manabi/reader-bridge-projection.ts';
import { planReaderBridge } from '../../apps/web/src/lib/manabi/reader-bridge-plan.ts';

const identity = {
  binding: 'google/account/connection/root/book',
  generation: 'connection-1',
  profile: 'ttu-1-6',
  fingerprint: 'a'.repeat(64),
  revision: 'observation-1'
};
const book = { title: '本', characters: 300 };
const mark = {
  dataId: 9,
  exploredCharCount: 30,
  progress: 0.1,
  scrollX: -42,
  lastBookmarkModified: 100
};
const day = {
  title: book.title,
  dateKey: '2026-10-22',
  charactersRead: 60,
  readingTime: 300,
  minReadingSpeed: 720,
  altMinReadingSpeed: 720,
  lastReadingSpeed: 720,
  maxReadingSpeed: 720,
  lastStatisticModified: 100
};
const progress = (value = mark, version = '1_6') => ({
  name: `progress_${version}_${value.lastBookmarkModified}_${value.progress || 0}.json`,
  body: JSON.stringify(value)
});
const stats = (rows = [day], version = '1_6') => ({
  name: `statistics_${version}_100_60_300_720_720_720_720_300_300_60_60_720_720_na.json`,
  body: JSON.stringify(rows)
});
const project = (files, context = identity, metadata = book, signal) =>
  projectReaderBridgeFiles(context, metadata, files, signal);
const plan = (local, remote, base) =>
  planReaderBridge({
    local: local.snapshot,
    remote: { state: 'available', snapshot: remote.snapshot },
    direction: 'receive',
    ...(base ? { baseline: { local: base.snapshot, remote: base.snapshot } } : {})
  });

test('export clock, local row IDs, property order and file order cannot cause a sync loop', async () => {
  const first = await project([progress(), stats()]);
  const later = await project(
    [
      stats([{ ...day, lastStatisticModified: 999 }]),
      progress(
        Object.fromEntries(
          Object.entries({ ...mark, dataId: 22, lastBookmarkModified: 999 }).reverse()
        )
      )
    ],
    { ...identity, revision: 'observation-2' }
  );
  assert.deepEqual(first.snapshot.records, later.snapshot.records);
  assert.notDeepEqual(first.originals, later.originals);
  assert.equal(later.values.resume.lastBookmarkModified, 999);
  const decision = plan(first, later, first);
  assert.deepEqual(decision.pull, []);
  assert.deepEqual(decision.push, []);
  assert.equal(decision.acknowledge.length, 2);
});

test('complete daily totals feed the planner without becoming additive contributions', async () => {
  const base = await project([stats()]);
  const local = await project([stats([{ ...day, charactersRead: 70 }])]);
  const remote = await project([stats([{ ...day, charactersRead: 80 }])]);
  assert.deepEqual(plan(local, remote, base).conflicts, [
    { key: 'statistics/2026-10-22', reason: 'both-changed' }
  ]);
  assert.deepEqual(plan(base, remote, base).pull, ['statistics/2026-10-22']);
  assert.deepEqual(plan(remote, remote, remote).pull, []);
});

test('daily row ordering is irrelevant while a missing previously accepted day requires review', async () => {
  const rows = [day, { ...day, dateKey: '2026-10-21', charactersRead: 4 }];
  const before = await project([stats(rows)]);
  assert.deepEqual(
    (await project([stats(rows.toReversed())])).snapshot.records,
    before.snapshot.records
  );
  assert.deepEqual(
    plan(before, await project([]), before).conflicts.map((row) => row.reason),
    ['removed', 'removed']
  );
});

test('real public Yatsu v11 backup projects supported data and retains exact extra fields for recovery', async () => {
  const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
  const { ZipReader, Uint8ArrayReader, TextWriter } = await import(
    require.resolve('@zip.js/zip.js')
  );
  const bytes = await readFile(
    new URL('../fixtures/yatsu/complete-local-backup-v11.zip', import.meta.url)
  );
  const zip = new ZipReader(new Uint8ArrayReader(new Uint8Array(bytes)), { useWebWorkers: false });
  let files;
  try {
    files = await Promise.all(
      (await zip.getEntries())
        .filter((entry) => /\/(progress|statistics)_/.test(entry.filename))
        .map(async (entry) => ({
          name: entry.filename.split('/').at(-1),
          body: await entry.getData(new TextWriter())
        }))
    );
  } finally {
    await zip.close();
  }
  const result = await project(
    files,
    { ...identity, profile: 'yatsu-1-11' },
    { title: 'Manabi Yatsu Portability Fixture', characters: 72 }
  );
  assert.deepEqual(Object.keys(result.snapshot.records), ['resume', 'statistics/2026-09-23']);
  assert.equal(result.values.resume.exploredCharCount, 0);
  assert.equal(result.values.resume.targetSectionId, 'section-1');
  assert.equal(result.values.resume.targetSectionIndex, 0);
  assert.equal(result.values.resume.sourceViewMode, 'paginated');
  assert.equal(
    result.values['statistics/2026-09-23'].dictionaryPopupOpenCount,
    JSON.parse(files.find((file) => file.name.startsWith('statistics_')).body)[0]
      .dictionaryPopupOpenCount
  );
  assert.deepEqual(result.originals, files);
  const replay = plan(result, result, result);
  assert.equal(replay.state, 'ready');
  assert.deepEqual(replay.pull, []);
  assert.deepEqual(replay.push, []);
  assert.deepEqual(replay.acknowledge, ['resume', 'statistics/2026-09-23']);
  assert.match(
    result.originals.find((file) => file.name.startsWith('progress_')).body,
    /sourceReaderLayoutKey/
  );
  assert.match(
    result.originals.find((file) => file.name.startsWith('statistics_')).body,
    /dictionaryPopupOpenCount/
  );
});

test('Yatsu section, layout and dictionary changes cannot be acknowledged as unchanged', async () => {
  const context = { ...identity, profile: 'yatsu-1-11' };
  const position = {
    ...mark,
    targetSectionIndex: 0,
    targetSectionId: 'chapter-1',
    sourceViewMode: 'paginated',
    sourceReaderLayoutKey: 'layout-1',
    sourceBookCharCount: book.characters
  };
  const base = await project(
    [progress(position, '1_11'), stats([{ ...day, dictionaryPopupOpenCount: 2 }], '1_11')],
    context
  );
  for (const changed of [
    { targetSectionIndex: 1 },
    { targetSectionId: 'chapter-2' },
    { sourceViewMode: 'scroll' },
    { sourceReaderLayoutKey: 'layout-2' }
  ]) {
    const remote = await project([progress({ ...position, ...changed }, '1_11')], context);
    assert.notEqual(base.snapshot.records.resume, remote.snapshot.records.resume);
    assert.deepEqual(plan(base, remote).conflicts, [
      { key: 'resume', reason: 'initial-difference' }
    ]);
  }
  const changedCount = await project(
    [stats([{ ...day, dictionaryPopupOpenCount: 3 }], '1_11')],
    context
  );
  assert.notEqual(
    base.snapshot.records['statistics/2026-10-22'],
    changedCount.snapshot.records['statistics/2026-10-22']
  );
  await assert.rejects(
    project([progress({ ...position, targetSectionIndex: 0.5 }, '1_11')], context),
    /section index/
  );
});

test('clock-only completion rewrites compare equal, but completion dates and history remain meaningful', async () => {
  const completedData = { ...day };
  delete completedData.title;
  const first = await project([
    progress({
      ...mark,
      completion: { state: 'finished', finishedOn: '2026-10-22', modifiedAt: 1 }
    }),
    stats([{ ...day, completedData }])
  ]);
  const later = await project([
    progress({
      ...mark,
      completion: { state: 'finished', finishedOn: '2026-10-22', modifiedAt: 2 }
    }),
    stats([
      {
        ...day,
        completedData: {
          ...completedData,
          lastStatisticModified: 999,
          exporterVersion: 1,
          dbVersion: 8
        }
      }
    ])
  ]);
  assert.deepEqual(first.snapshot.records, later.snapshot.records);
  const changed = await project([
    progress({
      ...mark,
      completion: { state: 'finished', finishedOn: '2026-10-21', modifiedAt: 2 }
    }),
    stats([{ ...day, completedData: { ...completedData, charactersRead: 61 } }])
  ]);
  assert.notEqual(first.snapshot.records.resume, changed.snapshot.records.resume);
  assert.notEqual(
    first.snapshot.records['statistics/2026-10-22'],
    changed.snapshot.records['statistics/2026-10-22']
  );
});

test('legacy pixel-only locations are not treated as identical and zero is a valid bookmark', async () => {
  const a = await project([progress({ scrollX: 0, lastBookmarkModified: 100 })]);
  const b = await project([progress({ scrollX: -42, lastBookmarkModified: 100 })]);
  assert.notEqual(a.snapshot.records.resume, b.snapshot.records.resume);
  assert.equal(
    (await project([progress({ ...mark, exploredCharCount: 0, progress: 0 })])).values.resume
      .progress,
    0
  );
});

test('mixed profiles, duplicate files and wrong file roles never return a partial snapshot', async () => {
  for (const files of [
    [progress(), progress()],
    [stats(), stats()],
    [progress(mark, '1_8')],
    [progress(mark, '1_11')],
    [{ ...progress(), name: 'bookdata_1_6_300_100_0.zip' }],
    [{ ...progress(), name: 'subfolder/' + progress().name }],
    [progress(), stats(), stats()]
  ])
    await assert.rejects(project(files));
  await assert.rejects(project([progress()], { ...identity, profile: 'ttu-1-9' }));
  await assert.rejects(project([progress()], { ...identity, fingerprint: 'title-only' }));
});

test('unsafe or mismatched bookmarks fail closed before reconciliation', async () => {
  for (const file of [
    { ...progress(), name: 'progress_1_6_100_0.2.json' },
    { ...progress(), name: 'progress_1_6_101_0.1.json' },
    progress({ ...mark, exploredCharCount: 301 }),
    progress({ ...mark, futureLocation: { value: 1 } }),
    { ...progress(), body: '[1,2]' },
    { ...progress(), body: '{"broken":' }
  ])
    await assert.rejects(project([file]));
  await assert.rejects(
    project([progress({ ...mark, sourceBookCharCount: 299 }, '1_11')], {
      ...identity,
      profile: 'yatsu-1-11'
    }),
    /different book content/
  );
});

test('statistics reject other books, duplicate or impossible dates, future fields and malformed metadata', async () => {
  for (const rows of [
    [{ ...day, title: 'Other book' }],
    [day, day],
    [{ ...day, dateKey: '2026-02-30' }],
    [{ ...day, charactersRead: -1 }],
    [{ ...day, charactersRead: Infinity }],
    [{ ...day, unmappedTotal: 30 }]
  ])
    await assert.rejects(project([stats(rows)]));
  await assert.rejects(
    project([{ ...stats(), name: stats().name.replace('_60_', '_garbled_') }]),
    /filename metadata/
  );
  await assert.rejects(
    project([{ ...stats(), name: stats().name.replace('_na.json', '_2026-02-30.json') }]),
    /reading date/
  );
});

test('bounds count UTF-8 bytes before JSON parsing', async () => {
  const body = '本'.repeat(Math.ceil(READER_BRIDGE_RECORD_LIMITS.resumeBytes / 3));
  assert.ok(body.length < READER_BRIDGE_RECORD_LIMITS.resumeBytes);
  await assert.rejects(project([{ ...progress(), body }]), /supported size/);
  await assert.rejects(
    project([{ ...stats(), body: ' '.repeat(READER_BRIDGE_RECORD_LIMITS.statisticsBytes + 1) }]),
    /supported size/
  );
});

test('capture inputs before asynchronous hashing and freeze the accepted evidence', async () => {
  const mutableIdentity = { ...identity },
    files = [progress(), stats()];
  const pending = project(files, mutableIdentity);
  mutableIdentity.binding = 'another-account';
  files[0].body = '{}';
  files[0].name = 'replaced.json';
  const result = await pending;
  assert.equal(result.snapshot.binding, identity.binding);
  assert.equal(result.values.resume.progress, 0.1);
  assert.equal(result.originals[0].name, progress().name);
  assert.throws(() => {
    result.snapshot.records.resume = 'corrupted';
  }, TypeError);
  assert.throws(() => {
    result.values.resume.progress = 0.9;
  }, TypeError);
  assert.throws(() => {
    result.originals[0].body = 'corrupted';
  }, TypeError);
});

test('cancellation during digesting returns no partial projection', async () => {
  const controller = new AbortController();
  const pending = project([progress(), stats()], identity, book, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(project([], identity, book, controller.signal), { name: 'AbortError' });
});

test('daily record ceiling fails before hashing an oversized history', async () => {
  const start = Date.parse('1970-01-01');
  const rows = Array.from({ length: 20000 }, (_, index) => ({
    ...day,
    dateKey: new Date(start + index * 86400000).toISOString().slice(0, 10)
  }));
  assert.ok(stats(rows).body.length < READER_BRIDGE_RECORD_LIMITS.statisticsBytes);
  await assert.rejects(project([stats(rows)]), /Too many reading days/);
});

test('each qualified TTU export version is explicit and keeps the same data meaning', async () => {
  const expected = await project([progress(), stats()]);
  for (const version of ['6', '7', '8']) {
    const result = await project([progress(mark, `1_${version}`), stats([day], `1_${version}`)], {
      ...identity,
      profile: `ttu-1-${version}`
    });
    assert.deepEqual(result.snapshot.records, expected.snapshot.records);
    assert.equal(result.snapshot.profile, `ttu-1-${version}`);
  }
});
