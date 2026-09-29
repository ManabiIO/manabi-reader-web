import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS } from '../../.cache/media-test-build/contracts.js';
import { serializeSubtitles, parseSubtitles } from '../../.cache/media-test-build/captions.js';

const track = (count, text) => ({
  cues: Array.from({ length: count }, (_, i) => ({
    id: String(i),
    start: i,
    end: i + 0.5,
    text
  }))
});
const bytes = (text) => new TextEncoder().encode(text).length;

for (const format of ['srt', 'vtt']) {
  test(`${format} admits the exact byte budget and rejects one extra byte`, () => {
    const value = track(700, 'x');
    let remaining = LIMITS.subtitleBytes - bytes(serializeSubtitles(value, format));
    for (const cue of value.cues) {
      const extra = Math.min(remaining, LIMITS.cueText - 1);
      cue.text += 'x'.repeat(extra);
      remaining -= extra;
    }
    assert.equal(remaining, 0);
    const serialized = serializeSubtitles(value, format);
    assert.equal(bytes(serialized), LIMITS.subtitleBytes);
    assert.equal(parseSubtitles(serialized).length, value.cues.length);
    value.cues[value.cues.length - 1].text += 'x';
    assert.throws(() => serializeSubtitles(value, format), /exceeds 5 MiB/);
  });
}

test('export counts UTF-8 bytes, not Japanese string length', () => {
  const value = track(900, '日'.repeat(2000));
  assert.ok(value.cues.length * value.cues[0].text.length < LIMITS.subtitleBytes);
  assert.throws(() => serializeSubtitles(value), /exceeds 5 MiB/);
});

test('export includes entity expansion in its bounded byte budget', () => {
  const value = track(550, '&'.repeat(2000));
  assert.ok(value.cues.length * value.cues[0].text.length < LIMITS.subtitleBytes);
  assert.throws(() => serializeSubtitles(value), /exceeds 5 MiB/);
  const small = track(2, '<日本語> & text');
  assert.deepEqual(
    parseSubtitles(serializeSubtitles(small)).map((cue) => cue.text),
    ['<日本語> & text', '<日本語> & text']
  );
});
