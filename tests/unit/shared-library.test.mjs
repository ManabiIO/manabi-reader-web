import assert from 'node:assert/strict';
import test from 'node:test';
import { assertExternalBookSource } from '../../apps/web/src/lib/manabi/external-book-source.ts';
import { selectTtuFile } from '../../apps/web/src/lib/manabi/ttu-folder-contract.ts';

test('a title match cannot bind an unrelated browser book to an external source', () => {
  const local = { storageSource: 'other-library' };
  assert.throws(() => assertExternalBookSource(local, 'selected-library'), /different local copy/);
  assert.equal(local.storageSource, 'other-library');
  assert.throws(() => assertExternalBookSource({}, 'selected-library'), /different local copy/);
  assert.doesNotThrow(() => assertExternalBookSource(undefined, 'selected-library'));
  assert.doesNotThrow(() =>
    assertExternalBookSource({ storageSource: 'selected-library' }, 'selected-library')
  );
});

test('logical TTU revisions are unambiguous, version-qualified and left intact', () => {
  const first = { name: 'progress_1_6_100_0.1.json', id: 'first' };
  const second = { name: 'progress_1_6_200_0.2.json', id: 'second' };
  const files = [first, second];
  assert.throws(() => selectTtuFile(files, 'progress_'), /Conflicting progress_/);
  assert.deepEqual(files, [first, second]);
  assert.equal(selectTtuFile([first], 'progress_'), first);
  assert.equal(selectTtuFile([first], 'bookdata_'), undefined);
  for (const name of [
    'bookdata_2_6_1_1_1.zip',
    'bookdata_1_7_1_1_1.zip',
    'bookdata_1_6_1_1_1.json'
  ]) {
    assert.throws(() => selectTtuFile([{ name }], 'bookdata_'), /Unsupported TTU file format/);
  }
  assert.throws(
    () => selectTtuFile([{ name: 'bookdata_1_6_9007199254740992_1_1.zip' }], 'bookdata_'),
    /Invalid numeric/
  );
  assert.throws(() => selectTtuFile([{ name: 'bookdata_1_6_1_1.zip' }], 'bookdata_'), /Malformed/);
});

test('native statistics, exponential progress and textual anchors keep the TTU wire contract', () => {
  const names = [
    ['bookdata_', 'bookdata_1_6_4382_1789837311622_1789837311905.zip'],
    ['progress_', 'progress_1_6_1789837322544_1.23e-7.json'],
    ['progress_', 'progress_1_6_1789837322544_text-anchor.json'],
    [
      'statistics_',
      'statistics_1_6_1789837322544_60_300_720_720_720_720_300_300_60_60_720_720_na.json'
    ]
  ];
  for (const [prefix, name] of names) {
    assert.equal(selectTtuFile([{ name }], prefix)?.name, name);
  }
});
