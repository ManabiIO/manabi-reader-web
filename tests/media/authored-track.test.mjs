import test from 'node:test';
import assert from 'node:assert/strict';
import { temporaryTrackReplacements } from '../../.cache/media-test-build/authored-track.js';
const key = 'content:' + 'a'.repeat(64),
  otherKey = 'content:' + 'b'.repeat(64);
const temporary = () => ({
  version: 1,
  id: '11111111-1111-4111-8111-111111111111',
  mediaKey: 'content:' + '0'.repeat(64),
  label: 'New.ja.srt',
  language: 'ja',
  origin: 'sidecar',
  kind: 'transcription',
  complete: true,
  forced: false,
  createdAt: 1,
  cues: [{ id: 'cue-0', start: 0, end: 2, text: '字幕', speaker: 'S01' }]
});
const saved = (t) => ({
  ...t,
  id: '22222222-2222-4222-8222-222222222222',
  mediaKey: key,
  label: 'Original.ja.srt'
});
for (const [name, change] of [
  ['language', (t) => ({ ...t, language: 'en' })],
  ['forced', (t) => ({ ...t, forced: true })],
  ['kind', (t) => ({ ...t, kind: 'translation' })],
  ['origin', (t) => ({ ...t, origin: 'embedded' })],
  ['completion', (t) => ({ ...t, complete: false })],
  ['media', (t) => ({ ...t, mediaKey: otherKey })],
  ['text', (t) => ({ ...t, cues: [{ ...t.cues[0], text: 'different' }] })],
  ['time', (t) => ({ ...t, cues: [{ ...t.cues[0], end: 2.1 }] })],
  ['speaker', (t) => ({ ...t, cues: [{ ...t.cues[0], speaker: 'S02' }] })],
  ['cue ID', (t) => ({ ...t, cues: [{ ...t.cues[0], id: 'other-cue' }] })]
])
  test(`Authored handoff preserves ${name} distinctions`, () => {
    const t = temporary();
    assert.equal(temporaryTrackReplacements([t], [change(saved(t))], key).size, 0);
  });
test('Display-label changes preserve an otherwise exact authored identity', () => {
  const t = temporary(),
    p = saved(t);
  assert.equal(temporaryTrackReplacements([t], [p], key).get(t.id), p.id);
});
test('Unverified media cannot transfer temporary selection into a portable identity', () => {
  const t = temporary();
  assert.equal(temporaryTrackReplacements([t], [saved(t)]).size, 0);
});
test('Ambiguous saved duplicates do not select a first result', () => {
  const t = temporary(),
    a = saved(t),
    b = { ...a, id: '33333333-3333-4333-8333-333333333333' };
  assert.equal(temporaryTrackReplacements([t], [a, b], key).size, 0);
});
test('An exact already-published identity survives other equivalent saved versions', () => {
  const t = temporary(),
    a = saved(t);
  assert.equal(temporaryTrackReplacements([t], [a, { ...t, mediaKey: key }], key).get(t.id), t.id);
});
test('Generated tracks cannot impersonate an authored handoff', () => {
  const t = { ...temporary(), origin: 'generated' };
  assert.equal(temporaryTrackReplacements([t], [saved(t)], key).size, 0);
});
