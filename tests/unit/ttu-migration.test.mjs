import assert from 'node:assert/strict';
import test from 'node:test';
import {
  importFile, decodeTitle, bookmark, statistics, audio, subtitles, goals,
  canonical, withoutIdentity, reconcileImport, MigrationConflict
} from '../../apps/web/src/lib/manabi/ttu-migration-format.ts';

const day = {
  title: '本', dateKey: '2026-09-19', charactersRead: 60, readingTime: 300,
  minReadingSpeed: 720, altMinReadingSpeed: 720, lastReadingSpeed: 720,
  maxReadingSpeed: 720, lastStatisticModified: 100
};
const mark = {dataId: 99, exploredCharCount: 30, progress: .1, scrollX: -42, lastBookmarkModified: 100};

test('versioned filenames support all exported parts without interpreting credentials', () => {
  assert.deepEqual(importFile('bookdata_1_6_4382_100_200.zip'), {part:'book', modified:100, characters:4382, opened:200});
  assert.equal(importFile('progress_1_6_100_1e-7.json').part, 'bookmark');
  assert.equal(importFile('statistics_1_6_100_60_300_720_720_720_720_300_300_60_60_720_720_na.json').part, 'statistics');
  assert.equal(importFile('audioBook_1_6_100_1.5.json').part, 'audio');
  assert.equal(importFile('subtitles_1_6_100_1.json').part, 'subtitles');
  assert.equal(importFile('ttu-user-goals_1_6_100.json').part, 'goals');
  assert.equal(importFile('storageSource.json'), undefined);
  for (const name of ['bookdata_2_6_1_1_0.zip', 'bookdata_1_7_1_1_0.zip', 'bookdata_1_6_1_1.zip', 'bookdata_1_6_1_1_0.json', 'progress_1_6_-1_0.json', 'bookdata_1_6_9007199254740992_1_0.zip']) assert.throws(()=>importFile(name));
});

test('literal exported title markers decode without lossy path substitution', () => {
  assert.equal(decodeTitle('本%2F100%25~ttu-star~~ttu-dend~'), '本/100%*.');
  assert.equal(decodeTitle('trailing~ttu-spc~'), 'trailing ');
  for(const name of ['bad%Q1', '%00invalid', '']) assert.throws(()=>decodeTitle(name));
});

test('bookmark keeps fractions, anchors and signed vertical scroll but drops local IDs', () => {
  assert.deepEqual(bookmark(mark, 100), {exploredCharCount:30,progress:.1,scrollX:-42,lastBookmarkModified:100});
  assert.equal(bookmark({...mark,progress:'paragraph:12'}, 100).progress,'paragraph:12');
  for(const value of [{...mark,progress:1.1},{...mark,progress:Infinity},{...mark,exploredCharCount:-1},{...mark,refreshToken:'secret'},{...mark,lastBookmarkModified:101}]) assert.throws(()=>bookmark(value,100));
});

test('day rows preserve seconds and do not fabricate or sum native analytics', () => {
  const value=statistics([day], '本')[0];
  assert.equal(value.readingTime,300);
  assert.equal(value.charactersRead,60);
  assert.equal(value.title,undefined);
  assert.throws(()=>statistics([day,day], '本'), /Duplicate/);
  assert.throws(()=>statistics([day], 'different'), /different book/);
  assert.throws(()=>statistics([{...day,dateKey:'2026-02-30'}],'本'),/date/);
  assert.throws(()=>statistics([{...day,readingTime:NaN}],'本'));
  assert.throws(()=>statistics([{...day,completedData:{...withoutIdentity(day),dateKey:'2026-09-18'}}],'本'));
});

test('audiobook positions and subtitles are typed data, not playback URLs or handles', () => {
  assert.deepEqual(audio({title:'本',playbackPosition:12.5,lastAudioBookModified:100},'本',100),{playbackPosition:12.5,lastAudioBookModified:100});
  assert.throws(()=>audio({title:'本',playbackPosition:12,lastAudioBookModified:100,url:'https://bad.test'},'本',100));
  const row={id:'line-1',originalStartSeconds:0,startSeconds:0,startTime:'00:00:00',originalEndSeconds:2,endSeconds:2,endTime:'00:00:02',originalText:'本',text:'本',subIndex:0};
  const value={title:'本',subtitleData:{name:'book.srt',subtitles:[row]},lastSubtitleDataModified:100};
  assert.equal(subtitles(value,'本',100).subtitleData.subtitles[0].text,'本');
  assert.throws(()=>subtitles({...value,subtitleData:{name:'x',subtitles:[row,row]}},'本',100),/Duplicate/);
  assert.throws(()=>subtitles({...value,subtitleData:{name:'x',subtitles:[{...row,endSeconds:-1}]}},'本',100));
});

test('separate goals have real dates, supported frequencies and no overlapping ranges', () => {
  const goal={timeGoal:600,characterGoal:500,goalFrequency:'daily',goalStartDate:'2026-09-01',goalEndDate:'2026-09-15',goalOriginalEndDate:'2026-09-15',lastGoalModified:100};
  assert.equal(goals([goal])[0].timeGoal,600);
  assert.throws(()=>goals([goal,{...goal,goalStartDate:'2026-09-15',goalEndDate:''}]),/overlap/);
  assert.throws(()=>goals([{...goal,goalFrequency:'hourly'}]));
});

test('the same source record is a no-op after local reading or a local reset', () => {
  const source=withoutIdentity(mark), receipt=canonical(source);
  assert.equal(reconcileImport({...source,progress:.8},source,receipt),'skip');
  assert.equal(reconcileImport(undefined,source,receipt),'skip');
  assert.equal(reconcileImport(source,source,undefined),'acknowledge');
  assert.equal(reconcileImport(undefined,source,undefined),'write');
});

test('updated records require a choice when local data also changed, but missing new days are additive', () => {
  const old=withoutIdentity(day), incoming={...old,readingTime:400,lastStatisticModified:200};
  assert.equal(reconcileImport(old,incoming,canonical(old)),'write');
  assert.throws(()=>reconcileImport({...old,readingTime:500},incoming,canonical(old)),MigrationConflict);
  assert.throws(()=>reconcileImport(undefined,incoming,canonical(old)),MigrationConflict);
  assert.equal(reconcileImport({...old,readingTime:500},incoming,canonical(old),true),'write');
  assert.equal(reconcileImport(undefined,incoming,undefined),'write');
  assert.throws(()=>reconcileImport(old,{...old,readingTime:400},canonical(old)),MigrationConflict);
});

test('an older batch cannot roll back a later imported snapshot', () => {
  const old=withoutIdentity(day), newer={...old,readingTime:400,lastStatisticModified:200};
  assert.equal(reconcileImport(newer,old,canonical(newer)),'skip');
  assert.equal(reconcileImport(newer,old,canonical(newer),true),'write');
  assert.equal(canonical({a:1,b:2}),canonical({b:2,a:1}));
  assert.deepEqual(withoutIdentity({title:'x',dataId:1,progress:.5,manabiTtuReceipt:'x'}),{progress:.5});
});
