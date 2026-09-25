import test from 'node:test';
import assert from 'node:assert/strict';
import { TrackCatalog } from '../../.cache/media-test-build/track-catalog.js';

const track = (id = 'main') => ({
  id,
  label: id,
  language: id === 'main' ? 'ja' : 'en',
  complete: true,
  forced: false,
  cues: [{ id: 'one', start: 0, end: 2, text: '本を読んでいます。', speaker: 'S1' }]
});

test('fresh storage objects reuse unchanged cue timelines', () => {
  const catalog = new TrackCatalog();
  const a = track();
  assert.equal(catalog.replace([a]), true);
  const timeline = catalog.timeline(a.id);
  assert.equal(catalog.replace([structuredClone(a)]), false);
  assert.equal(catalog.timeline(a.id), timeline);
});

test('translation discovery and display edits do not replace the main listening timeline', () => {
  const catalog = new TrackCatalog();
  const a = track();
  catalog.replace([a]);
  const timeline = catalog.timeline(a.id);
  assert.equal(catalog.replace([a, track('translation')]), true);
  assert.equal(catalog.timeline(a.id), timeline);
  assert.equal(catalog.replace([{ ...a, label: 'Renamed' }, track('translation')]), true);
  assert.equal(catalog.timeline(a.id), timeline);
});

test('timing, text, speaker and cue identity changes invalidate only that timeline', () => {
  for (const [field, value] of [
    ['start', 0.1],
    ['end', 3],
    ['text', 'Changed'],
    ['speaker', 'S2'],
    ['id', 'other']
  ]) {
    const catalog = new TrackCatalog();
    const a = track(),
      b = track('translation');
    catalog.replace([a, b]);
    const before = catalog.timeline(a.id),
      other = catalog.timeline(b.id);
    a.cues[0][field] = value;
    assert.equal(catalog.replace([a, b]), true);
    assert.notEqual(catalog.timeline(a.id), before);
    assert.equal(catalog.timeline(b.id), other);
  }
});

test('caller mutations cannot change an existing listening unit', () => {
  const catalog = new TrackCatalog(),
    a = track();
  catalog.replace([a]);
  a.cues[0].text = 'Mutated';
  assert.equal(catalog.timeline(a.id).cues[0].text, '本を読んでいます。');
});

test('equal-start A/B/A turns retain order; reordered turns invalidate the timeline', () => {
  const catalog = new TrackCatalog(),
    a = track();
  a.cues = ['A', 'B', 'A'].map((speaker, i) => ({
    id: String(i),
    start: 0,
    end: 2,
    text: String(i),
    speaker
  }));
  catalog.replace([a]);
  assert.deepEqual(catalog.timeline(a.id).cues.map((cue) => cue.speaker), ['A', 'B', 'A']);
  assert.equal(catalog.replace([{ ...a, cues: [a.cues[1], a.cues[0], a.cues[2]] }]), true);
});

test('removal prunes timelines and duplicate identities fail atomically', () => {
  const catalog = new TrackCatalog(),
    a = track(),
    b = track('translation');
  catalog.replace([a, b]);
  const timeline = catalog.timeline(a.id);
  assert.throws(() => catalog.replace([a, a]), /Duplicate/);
  assert.equal(catalog.timeline(a.id), timeline);
  assert.ok(catalog.timeline(b.id));
  assert.equal(catalog.replace([a]), true);
  assert.equal(catalog.timeline(b.id), undefined);
  assert.equal(catalog.timeline(a.id), timeline);
});
