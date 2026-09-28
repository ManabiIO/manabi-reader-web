import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractBookMetadata,
  validBookMetadata,
  validBookSeries
} from '../../apps/web/src/lib/library/book-presentation.ts';
import {
  isPortablePresentation,
  portableOrganization,
  applyPortableOrganization
} from '../../apps/web/src/lib/library/organization-portability.ts';
const key = `content:${'a'.repeat(64)}`;
test('EPUB Dublin Core fields preserve authors, publisher, date, tags and plain-text description', () => {
  assert.deepEqual(
    extractBookMetadata({
      'dc:creator': ['Author'],
      'dc:language': 'ja',
      'dc:publisher': { '#text': 'Publisher' },
      'dc:date': 2024,
      'dc:subject': ['Japanese', 'Learning'],
      'dc:description': '<b>Text</b>\nNext line'
    }),
    {
      creators: [{ name: 'Author' }],
      language: 'ja',
      publisher: 'Publisher',
      published: '2024',
      subjects: ['Japanese', 'Learning'],
      description: '<b>Text</b>\nNext line'
    }
  );
});
test('metadata allows deliberate empty values without resurrecting imported authors or tags', () => {
  assert.equal(
    validBookMetadata({ creators: [], subjects: [], publisher: '', description: '' }),
    true
  );
  assert.equal(
    isPortablePresentation({
      modifiedAt: 1,
      coverBlur: false,
      series: null,
      metadata: { creators: [] }
    }),
    true
  );
});
test('metadata rejects malformed fields, unbounded values, non-text authors and invalid Unicode', () => {
  for (const value of [
    null,
    [],
    { unknown: 'x' },
    { creators: [{ name: 'bad\u0000' }] },
    { creators: [{ name: ' x ' }] },
    { publisher: '𠮷'.repeat(257) },
    { language: 'bad\nname' },
    { description: '\ud800' },
    { subjects: Array(65).fill('a') }
  ])
    assert.equal(validBookMetadata(value), false, JSON.stringify(value));
});
test('bounded import never splits an astral character or treats HTML as executable metadata', () => {
  const metadata = extractBookMetadata({
    'dc:publisher': 'a'.repeat(511) + '𠮷',
    'dc:description': '<script>alert(1)</script>'
  });
  assert.equal(metadata.publisher.length, 511);
  assert.equal(validBookMetadata(metadata), true);
});
test('series names and fractional volume numbers are bounded; explicit removal is valid', () => {
  assert.equal(validBookSeries({ name: 'Series', index: 2.5 }), true);
  assert.equal(validBookSeries({ name: 'My   Series' }), false);
  assert.equal(validBookSeries({ name: ' My Series' }), false);
  assert.equal(validBookSeries(null), true);
  for (const value of [
    { name: '' },
    { name: '   ' },
    { name: 'Series', index: NaN },
    { name: 'Series', index: -1 },
    { name: 'Series', index: true },
    { name: 'Series', url: 'https://example.test' }
  ])
    assert.equal(validBookSeries(value), false);
});
test('portable round trip retains metadata, blur and personal series with stable content identity', () => {
  const presentation = {
    modifiedAt: 1,
    coverBlur: true,
    series: { name: 'My series', index: 2 },
    metadata: { creators: [{ name: '日本語', sortAs: 'にほんご' }], description: 'one\ntwo' }
  };
  const state = {
    version: 1,
    collections: [],
    books: { [key]: presentation, 'book:4': { modifiedAt: 1, title: 'Device only' } }
  };
  const exported = portableOrganization(state);
  assert.deepEqual(exported.books, { [key]: presentation });
  assert.deepEqual(
    applyPortableOrganization({ version: 1, collections: [], books: {} }, exported),
    exported
  );
});
test('cover blur must be a boolean, not a truthy string', () => {
  assert.equal(isPortablePresentation({ modifiedAt: 1, coverBlur: 'false' }), false);
});
