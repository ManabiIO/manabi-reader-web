import test from 'node:test';
import assert from 'node:assert/strict';
import {
  trackLanguage,
  translationCandidate
} from '../../.cache/media-test-build/track-selection.js';
const track = (id, language, text = 'Some text') => ({
  id,
  language,
  complete: true,
  forced: false,
  cues: [{ id: 'c', start: 0, end: 2, text }]
});
const ja = track('ja', 'ja', 'こんにちは。今日はよい天気ですね。');
const en = track('en', 'en'),
  fr = track('fr', 'fr');
test('subtitle metadata takes precedence over conservative script hints', () => {
  assert.equal(trackLanguage(track('x', 'jpn')), 'ja');
  assert.equal(trackLanguage(track('x', 'en', ja.cues[0].text)), 'en');
});
test('untagged Japanese and Korean can be recognized without guessing from Han or Latin', () => {
  assert.equal(trackLanguage(track('x', 'und', ja.cues[0].text)), 'ja');
  assert.equal(trackLanguage(track('x', 'und', '안녕하세요 오늘은 좋은 날입니다')), 'ko');
  for (const text of ['一二三四日本中国', 'Bonjour hello hola', 'あい', '1234'])
    assert.equal(trackLanguage(track('x', 'und', text)), 'und');
});
test('translation selection prefers a unique existing system-language track', () => {
  assert.equal(translationCandidate(ja, [ja, fr, en], ['en-CA', 'fr']), en);
  assert.equal(translationCandidate(ja, [ja, fr, en], ['ja', 'fr']), fr);
});
test('unrelated different-language tracks are not arbitrary translation fallbacks', () => {
  assert.equal(translationCandidate(ja, [ja, fr], ['en']), undefined);
  assert.equal(translationCandidate(en, [en, fr], ['en']), undefined);
});
test('unknown primary language leaves translation to the viewer', () => {
  assert.equal(translationCandidate(track('x', 'und'), [en, fr], ['en']), undefined);
});
test('two matching authored translations stay ambiguous', () => {
  assert.equal(translationCandidate(ja, [en, track('e2', 'en'), fr], ['en', 'fr']), undefined);
});
test('exact regional match precedes a language-family match', () => {
  const ca = track('ca', 'en-CA'),
    us = track('us', 'en-US');
  assert.equal(translationCandidate(ja, [en, ca, us], ['en-CA']), ca);
});
test('explicit source-track derivation can resolve otherwise ambiguous translations', () => {
  const linked = { ...track('linked', 'en'), derivedFrom: { trackId: ja.id } };
  assert.equal(translationCandidate(ja, [en, linked], ['en']), linked);
});
test('incomplete, empty, forced and same-language captions are not default translations', () => {
  assert.equal(
    translationCandidate(
      ja,
      [
        { ...en, forced: true },
        { ...en, id: 'unfinished', complete: false },
        { ...en, id: 'empty', cues: [] },
        track('j', 'ja')
      ],
      ['en', 'ja']
    ),
    undefined
  );
});
test('language inference never mutates imported cues or metadata', () => {
  const input = track('x', 'und', ja.cues[0].text),
    before = structuredClone(input);
  trackLanguage(input);
  translationCandidate(input, [en], ['en']);
  assert.deepEqual(input, before);
});
