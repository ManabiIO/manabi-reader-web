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
    'bookdata_1_9_1_1_1.zip',
    'bookdata_1_6_1_1_1.json'
  ]) {
    assert.throws(
      () => selectTtuFile([{ name }], 'bookdata_'),
      /Unsupported Ttu Ebook Reader file format/
    );
  }
  assert.throws(
    () => selectTtuFile([{ name: 'bookdata_1_6_9007199254740992_1_1.zip' }], 'bookdata_'),
    /Invalid numeric/
  );
  assert.throws(() => selectTtuFile([{ name: 'bookdata_1_6_1_1.zip' }], 'bookdata_'), /Malformed/);
  for (const version of [7, 8]) {
    const name = `bookdata_1_${version}_1_1_1.zip`;
    assert.equal(selectTtuFile([{ name }], 'bookdata_')?.name, name);
  }
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

test('shared publication choices group duplicate titles without merging local identities', async () => {
  const { sharedPublishChoices } = await import(
    '../../apps/web/src/lib/manabi/shared-title-selection.ts'
  );
  const rows = [
    { id: 1, title: 'Same title', elementHtml: '<p>First</p>' },
    { id: 2, title: 'Same title', elementHtml: '<p>Second</p>' },
    { id: 3, title: '__proto__', elementHtml: '<p>Third</p>' },
    { id: 4, title: 'Placeholder', elementHtml: '' },
    { id: 5, title: 'Same title', elementHtml: '' }
  ];
  const original = globalThis.structuredClone(rows);
  assert.deepEqual(sharedPublishChoices(rows), [
    { title: 'Same title', copies: 3, hasContent: true },
    { title: '__proto__', copies: 1, hasContent: true }
  ]);
  assert.deepEqual(rows, original);
});

test('both sharing directions reject ambiguous title lookup instead of selecting its first row', async () => {
  const { uniqueSharedCopy } = await import(
    '../../apps/web/src/lib/manabi/shared-title-selection.ts'
  );
  const first = { id: 1, storageSource: 'Shared fixture' };
  const second = { id: 2, storageSource: 'Another source' };
  assert.throws(() => uniqueSharedCopy('Same title', [first, second]), /multiple local copies/);
  assert.throws(() => uniqueSharedCopy('Same title', [second, first]), /multiple local copies/);
  assert.equal(uniqueSharedCopy('Same title', [first]), first);
  assert.equal(uniqueSharedCopy('Absent', []), undefined);
});
