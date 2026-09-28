import assert from 'node:assert/strict';
import test from 'node:test';
import {
  latestBookPresentation,
  preferenceWireSnapshot,
  retainMissingPreferenceExtensions,
  retainMissingBookExtensions,
  hasPresentationExtensions
} from '../../apps/web/src/lib/library/presentation-compatibility.ts';
import { parsePreferenceReply } from '../../apps/web/src/lib/manabi/auth-contract.ts';
const key = `content:${'a'.repeat(64)}`;
const other = `content:${'b'.repeat(64)}`;
const library = (books) => ({
  version: 1,
  collections: [{ id: 'study', name: 'Study', members: [key] }],
  books
});
const fields = {
  metadata: { creators: [{ name: '日本語', sortAs: 'にほんご' }] },
  series: { name: 'Series', index: 2.5 },
  coverBlur: true
};

test('legacy projection keeps ordinary preferences and collections but never sends unsupported fields', () => {
  const source = {
    theme: 'dark',
    library_organization: library({
      [key]: { title: 'Title', modifiedAt: 5, ...fields },
      [other]: { coverBlur: true, modifiedAt: 6 }
    })
  };
  const before = globalThis.structuredClone(source);
  assert.deepEqual(preferenceWireSnapshot(source, false), {
    theme: 'dark',
    library_organization: library({ [key]: { title: 'Title', modifiedAt: 5 } })
  });
  assert.deepEqual(source, before);
  assert.deepEqual(preferenceWireSnapshot(source, true), source);
});
test('legacy omission cannot erase local fields, even when an older client removes a whole presentation', () => {
  const before = { [key]: { title: 'Old', modifiedAt: 10, ...fields } };
  assert.deepEqual(retainMissingBookExtensions(before, {}), {
    [key]: { modifiedAt: 10, ...fields }
  });
  assert.deepEqual(
    retainMissingBookExtensions(before, { [key]: { title: 'New', modifiedAt: 11 } }),
    { [key]: { title: 'New', modifiedAt: 11, ...fields } }
  );
});
test('explicit false, null and empty metadata are resets, not missing values', () => {
  const after = { [key]: { coverBlur: false, series: null, metadata: {}, modifiedAt: 11 } };
  assert.deepEqual(
    retainMissingBookExtensions({ [key]: { modifiedAt: 10, ...fields } }, after),
    after
  );
});
test('retained extension snapshots do not alias callers or resurrect deleted legacy title/cover fields', () => {
  const before = {
    library_organization: library({
      [key]: { title: 'Do not resurrect', modifiedAt: 10, ...fields }
    })
  };
  const result = retainMissingPreferenceExtensions(before, { theme: 'light' });
  assert.equal(result.library_organization.books[key].title, undefined);
  result.library_organization.books[key].metadata.creators[0].name = 'Changed';
  assert.equal(before.library_organization.books[key].metadata.creators[0].name, '日本語');
  assert.deepEqual(result.library_organization.collections, []);
});
test('unadvertised extension intent remains local until a supporting server can acknowledge it', () => {
  const local = { library_organization: library({ [key]: { modifiedAt: 5, ...fields } }) };
  const accepted = preferenceWireSnapshot(local, false);
  assert.equal(hasPresentationExtensions(accepted), false);
  const restored = retainMissingPreferenceExtensions(local, accepted);
  assert.deepEqual(restored, local);
  assert.equal(hasPresentationExtensions(preferenceWireSnapshot(restored, true)), true);
});
test('capability negotiation is account/schema bound and strictly typed', () => {
  const base = { user_id: '42', schema_version: 1, revision: 3, settings: {} };
  assert.deepEqual(parsePreferenceReply(base, '42'), base);
  assert.equal(
    parsePreferenceReply({ ...base, book_presentation_version: 1 }, '42').book_presentation_version,
    1
  );
  for (const version of [true, '1', 2, null])
    assert.equal(parsePreferenceReply({ ...base, book_presentation_version: version }, '42'), null);
  assert.equal(parsePreferenceReply({ ...base, book_presentation_version: 1 }, '43'), null);
});

test('newer legacy aliases and relocation cannot drop older blur/metadata/series fields', () => {
  const before = { modifiedAt: 10, ...fields };
  const legacy = { modifiedAt: 20, title: 'Renamed' };
  assert.deepEqual(latestBookPresentation([before, legacy]), { ...before, ...legacy });
  const reset = { modifiedAt: 30, coverBlur: false, metadata: {}, series: null };
  assert.deepEqual(latestBookPresentation([before, legacy, reset]), reset);
  assert.equal(latestBookPresentation([]), undefined);
});
