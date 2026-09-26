import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dialogueText,
  subtitleEvents,
  speakerLabel
} from '../../.cache/media-test-build/dialogue.js';
import { studySpans, seekSpan, LinePause } from '../../.cache/media-test-build/study.js';
import { serializeSubtitles, parseSubtitles } from '../../.cache/media-test-build/captions.js';
import { parseMoss, ownedCues, planWindows } from '../../.cache/media-test-build/moss-output.js';
const cue = (id, start, end, text = id, speaker = 'S01') => ({
  id,
  start,
  end,
  text,
  ...(speaker ? { speaker } : {})
});
const track = (cues) => ({
  version: 1,
  id: '11111111-1111-4111-8111-111111111111',
  mediaKey: 'content:' + 'a'.repeat(64),
  label: 'Japanese',
  language: 'ja',
  kind: 'transcription',
  origin: 'sidecar',
  complete: true,
  forced: false,
  createdAt: 1,
  cues
});

test('sequential speaker turns retain independent ranges and unmarked text', () => {
  assert.deepEqual(
    subtitleEvents([cue('a', 0, 1, 'はい。'), cue('b', 1, 2, 'ありがとう。', 'S02')]),
    [
      { start: 0, end: 1, text: 'はい。' },
      { start: 1, end: 2, text: 'ありがとう。' }
    ]
  );
});
test('two simultaneous speakers use one hyphen-minus line per speaker, not an em dash', () => {
  const cues = [cue('a', 0, 2, 'こんにちは。'), cue('b', 0, 2, 'どうも。', 'S02')];
  for (const format of ['srt', 'vtt']) {
    const out = serializeSubtitles(track(cues), format);
    assert.match(out, /-こんにちは。\n-どうも。/);
    assert.ok(!out.includes('—'));
    assert.equal(parseSubtitles(out).length, 1);
  }
});
test('partial overlap is split only at real turn boundaries without changing canonical text', () => {
  const cues = [cue('a', 0, 3, '長い発話'), cue('b', 1, 2, '返事', 'S02')],
    before = structuredClone(cues);
  assert.deepEqual(subtitleEvents(cues), [
    { start: 0, end: 1, text: '長い発話' },
    { start: 1, end: 2, text: '-長い発話\n-返事' },
    { start: 2, end: 3, text: '長い発話' }
  ]);
  assert.deepEqual(cues, before);
});
test('alternating speakers retain their turn order, including a returning speaker', () => {
  assert.equal(
    dialogueText([
      cue('a', 0, 2, 'One\nturn'),
      cue('b', 0, 2, 'Response', 'S02'),
      cue('c', 0, 2, 'continues')
    ]),
    '-One turn\n-Response\n-continues'
  );
});
test('same-speaker overlap does not fabricate another speaker', () => {
  assert.equal(dialogueText([cue('a', 0, 2, 'One'), cue('b', 0, 2, 'Two')]), 'One\nTwo');
});
test('three simultaneous speakers are preserved rather than silently dropping the third', () => {
  assert.equal(
    subtitleEvents([cue('a', 0, 2, 'A'), cue('b', 0, 2, 'B', 'S02'), cue('c', 0, 2, 'C', 'S03')])[0]
      .text,
    '-A\n-B\n-C'
  );
});
test('unlabelled authored dual dialogue and line breaks are not rewritten', () => {
  const authored = [cue('a', 0, 2, '-Hello\n-Goodbye', undefined)];
  // Explicitly remove the default argument’s label.
  delete authored[0].speaker;
  assert.equal(subtitleEvents(authored)[0].text, '-Hello\n-Goodbye');
  assert.equal(
    dialogueText([{ text: 'Author\nline' }, { text: 'Other', speaker: 'S01' }]),
    'Author\nline\nOther'
  );
});
test('a second language alone does not add speaker punctuation', () => {
  assert.equal(dialogueText([{ text: 'English translation' }]), 'English translation');
});
test('speaker labels explicitly retain MOSS window scope', () => {
  assert.equal(speakerLabel('S01'), 'Speaker 1');
  assert.equal(speakerLabel('w0/S01'), 'Speaker 1 · window 1');
  assert.equal(speakerLabel('w1/S01'), 'Speaker 1 · window 2');
  assert.equal(speakerLabel('Unknown <name>'), 'Unknown <name>');
});
test('real MOSS output grammar carries speaker IDs through window ownership into SRT', () => {
  const parsed = parseMoss('[0][S01]番号は[2026]です。[2][0.5][S02]そうです。[1.5]', 3);
  const cues = ownedCues(parsed, planWindows(3)[0]);
  assert.equal(cues[0].speaker, 'w0/S01');
  assert.equal(cues[1].speaker, 'w0/S02');
  assert.match(serializeSubtitles(track(cues)), /-番号は\[2026\]です。\n-そうです。/);
});
test('speaker changes at an end boundary are not treated as overlap', () => {
  assert.equal(subtitleEvents([cue('a', 0, 1), cue('b', 1, 2, 'b', 'S02')]).length, 2);
  assert.ok(
    subtitleEvents([cue('a', 0, 1), cue('b', 1, 2, 'b', 'S02')]).every(
      (e) => !e.text.startsWith('-')
    )
  );
});
test('millisecond export keeps tiny cues positive and escaped payload text inert', () => {
  const out = serializeSubtitles(track([cue('a', 0.0001, 0.0002, '<img> & text')]), 'srt');
  assert.match(out, /00:00:00,000 --> 00:00:00,001/);
  assert.match(out, /&lt;img&gt; &amp; text/);
});
test('oversized overlap fails instead of truncating speakers or allocating unrestricted output', () => {
  assert.throws(
    () =>
      subtitleEvents([cue('a', 0, 1, 'A'.repeat(5000)), cue('b', 0, 1, 'B'.repeat(5000), 'S02')]),
    /too large/
  );
});
test('subtitle sweep agrees with active-turn reference across deterministic overlap patterns', () => {
  for (let seed = 1; seed <= 35; seed++) {
    let state = seed;
    const random = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    const cues = Array.from({ length: 25 }, (_, i) => {
      const start = Math.floor(random() * 50) / 10;
      return cue(
        String(i),
        start,
        start + (1 + Math.floor(random() * 20)) / 10,
        String(i),
        'S0' + ((i % 3) + 1)
      );
    });
    const out = subtitleEvents(cues);
    for (let i = 0; i < out.length; i++) {
      const event = out[i],
        t = (event.start + event.end) / 2;
      const active = cues
        .map((c, index) => ({ c, index }))
        .filter(({ c }) => c.start <= t && c.end > t)
        .sort((a, b) => a.c.start - b.c.start || a.index - b.index)
        .map((x) => x.c);
      assert.equal(event.text, dialogueText(active));
      if (i) assert.ok(out[i - 1].end <= event.start);
    }
  }
});
test('listening spans join overlapping voices but not merely touching turns', () => {
  const spans = studySpans([cue('b', 0.5, 2, 'B', 'S02'), cue('a', 0, 1), cue('c', 2, 3)]);
  assert.deepEqual(
    spans.map((s) => [s.start, s.end, s.cues.map((c) => c.id)]),
    [
      [0, 2, ['a', 'b']],
      [2, 3, ['c']]
    ]
  );
});
test('listening-span offsets preserve gaps and trim negative starts', () => {
  assert.deepEqual(
    studySpans([cue('a', 0, 1), cue('b', 2, 4)], -3).map((s) => [s.start, s.end]),
    [[0, 1]]
  );
  assert.deepEqual(studySpans([cue('a', 0, 1)], NaN), []);
});
test('line navigation handles active turns, gaps, leading silence and end of track', () => {
  const spans = studySpans([cue('a', 1, 2), cue('b', 4, 5), cue('c', 7, 8)]);
  assert.equal(seekSpan(spans, 0, 1), spans[0]);
  assert.equal(seekSpan(spans, 0, 0), spans[0]);
  assert.equal(seekSpan(spans, 0, -1), undefined);
  assert.equal(seekSpan(spans, 4.5, -1), spans[0]);
  assert.equal(seekSpan(spans, 4.5, 0), spans[1]);
  assert.equal(seekSpan(spans, 6, -1), spans[1]);
  assert.equal(seekSpan(spans, 6, 1), spans[2]);
  assert.equal(seekSpan(spans, 10, 1), undefined);
  assert.equal(seekSpan([], 0, 0), undefined);
});
test('auto-pause waits for all overlapping speakers and holds the completed unit', () => {
  const spans = studySpans([cue('a', 0, 1), cue('b', 0.5, 2, 'B', 'S02'), cue('c', 3, 4)]),
    detector = new LinePause();
  assert.equal(detector.sample(0.2, true, spans), undefined);
  assert.equal(detector.sample(1.2, true, spans), undefined);
  assert.equal(detector.sample(2.1, true, spans), spans[0]);
  assert.equal(detector.held, spans[0]);
  assert.equal(detector.sample(2.1, false, spans), undefined);
  assert.equal(detector.held, spans[0]);
  assert.equal(detector.sample(2.1, true, spans), undefined);
  assert.equal(detector.held, undefined);
  assert.equal(detector.sample(3.5, true, spans), undefined);
  assert.equal(detector.sample(4.1, true, spans), spans[1]);
});
test('seeking resets the pause boundary instead of pausing a successor on an old line', () => {
  const spans = studySpans([cue('a', 0, 1), cue('b', 3, 4)]),
    detector = new LinePause();
  detector.sample(0.2, true, spans);
  detector.reset();
  assert.equal(detector.sample(3.5, true, spans), undefined);
  assert.equal(detector.sample(4.1, true, spans), spans[1]);
});
test('auto-pause can observe a complete short cue between two media frames', () => {
  const spans = studySpans([cue('a', 0.1, 0.2)]),
    detector = new LinePause();
  detector.sample(0, true, spans);
  assert.equal(detector.sample(0.3, true, spans), spans[0]);
});
test('disabled or nonfinite auto-pause samples cannot trigger a pause', () => {
  const spans = studySpans([cue('a', 0, 1)]),
    detector = new LinePause();
  assert.equal(detector.sample(2, false, spans), undefined);
  assert.equal(detector.sample(NaN, true, spans), undefined);
  assert.equal(detector.sample(0.5, true, spans), undefined);
});
