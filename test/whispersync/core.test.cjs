/** @license MIT — native Whispersync integration tests. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const compiled = process.env.WHISPERSYNC_COMPILED;
if (!compiled) throw new Error('Run node test/whispersync/run.mjs');
const { parseTimestamp, parseSubtitles, cueText, CueTimeline, MAX_SUBTITLE_BYTES } = require(
  join(compiled, 'subtitles.js')
);
const { matchCues, normalizeText } = require(join(compiled, 'matcher.js'));
const { getSimilarity, getTimeParts, toTimeString } = require(join(compiled, 'upstream.js'));
const { LocalAudioPlayer, audioIdentity } = require(join(compiled, 'player.js'));
const { emptySession, validateSession, sessionKey, AudiobookSessionStore } = require(
  join(compiled, 'persistence.js')
);
const cue = (text, start = 0, end = start + 2, id = 0) => ({ text, start, end, id });

test('SRT time, VTT time, long audiobook time and subsecond precision', () => {
  assert.equal(parseTimestamp('01:02:03,456'), 3723.456);
  assert.equal(parseTimestamp('02:03.456'), 123.456);
  assert.equal(parseTimestamp('123:45:56.789'), 445556.789);
});
test('malformed and out-of-range timestamps are rejected', () => {
  for (const invalid of [
    '-00:00:01.000',
    '00:60:00.000',
    '01:02:60.000',
    '00:01.1',
    'NaN',
    'Infinity',
    '1:2:3',
    '00:01.000junk'
  ]) {
    assert.throws(() => parseTimestamp(invalid), /Invalid subtitle timestamp/);
  }
});
test('BOM, CRLF, out-of-order cues and duplicate external IDs', () => {
  const result = parseSubtitles(
    '\uFEFF1\r\n00:00:04,000 --> 00:00:06,000\r\nSecond\r\n\r\n1\r\n00:00:01,000 --> 00:00:03,000\r\nFirst\r\n'
  );
  assert.deepEqual(
    result.map((item) => [item.text, item.start, item.id]),
    [
      ['First', 1, 1],
      ['Second', 4, 0]
    ]
  );
});
test('VTT metadata, comments, cue identifiers and cue settings', () => {
  const result = parseSubtitles(
    'WEBVTT example\nKind: captions\n\nNOTE note\nignored\n\nSTYLE\n::cue {color: red}\n\nREGION\nid:foo\n\nintro\n00:01.000 --> 00:03.000 position:20%\n<v John><b>Hello</b> &amp; goodbye</v>'
  );
  assert.deepEqual(result, [cue('Hello & goodbye', 1, 3)]);
});
test('multiline subtitles remain multiline plain text', () => {
  assert.equal(parseSubtitles('00:00:01,000 --> 00:00:03,000\nOne\nTwo')[0].text, 'One\nTwo');
});
test('empty, incomplete, reversed, zero-duration and partly malformed files fail atomically', () => {
  for (const invalid of [
    '',
    'WEBVTT\n',
    '1\nNo time',
    '00:00:02.000 --> 00:00:01.000\nBad',
    '00:00:01.000 --> 00:00:01.000\nBad',
    '00:00:01.000 --> 00:00:02.000\n',
    '00:00:01.000 --> 00:00:02.000\nGood\n\ninvalid'
  ])
    assert.throws(() => parseSubtitles(invalid));
});
test('subtitle byte and cue-text limits are enforced', () => {
  assert.throws(() => parseSubtitles('a'.repeat(MAX_SUBTITLE_BYTES + 1)), /5 MiB/);
  assert.throws(() => parseSubtitles('あ'.repeat(Math.ceil(MAX_SUBTITLE_BYTES / 3))), /5 MiB/);
  assert.throws(() => cueText('a'.repeat(8193)), /too long/);
});
test('ruby readings and VTT timestamps are stripped without interpreting unknown HTML', () => {
  assert.equal(cueText('<ruby>漢字<rt>かんじ</rt></ruby><00:01.000>です'), '漢字です');
  assert.equal(cueText('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>');
  assert.equal(cueText('&lt;script&gt;test&lt;/script&gt;'), '<script>test</script>');
});
test('entities decode once, non-BMP entities work, invalid scalar values are replaced', () => {
  assert.equal(cueText('&amp;lt; &#x20bb7; &#xD800; &#1114112;'), '&lt; 𠮷 � �');
});
test('time decomposition carries rounded milliseconds correctly', () => {
  assert.deepEqual(getTimeParts(59.9996), [0, 1, 0, 0]);
  assert.deepEqual(getTimeParts(-10), [0, 0, 0, 0]);
  assert.equal(toTimeString(NaN), '00:00:00');
  assert.equal(toTimeString(360001), '100:00:01');
});
test('similarity is Unicode aware, symmetric and handles repeated n-grams', () => {
  assert.equal(getSimilarity('Ａ 𠮷', 'ａ𠮷'), 1);
  assert.equal(getSimilarity('', 'a'), 0);
  assert.equal(getSimilarity('aaaaaa', 'aaaaab'), 0.8);
  assert.equal(getSimilarity('abcd', 'abcde'), getSimilarity('abcde', 'abcd'));
});
test('normalization handles punctuation, widths, decomposed marks and supplementary text', () => {
  assert.equal(normalizeText('「ＡＢＣ」 ﾊﾟ カ\u3099 𠮷'), 'abcパガ𠮷');
});
test('cue timeline handles boundaries, real gaps and nested overlaps', () => {
  const timeline = new CueTimeline([
    cue('outer', 0, 20, 0),
    cue('inner', 2, 3, 1),
    cue('later', 22, 25, 2)
  ]);
  assert.equal(timeline.at(2.5), 1);
  assert.equal(timeline.at(3), 0);
  assert.equal(timeline.at(20), -1);
  assert.equal(timeline.at(22), 2);
  assert.equal(timeline.at(25), -1);
});
test('offset semantics are audioTime = subtitleTime + delay', () => {
  const timeline = new CueTimeline([cue('a', 2, 4)]);
  assert.equal(timeline.at(3, 2), -1);
  assert.equal(timeline.at(4, 2), 0);
  assert.equal(timeline.at(1, -1), 0);
  assert.equal(timeline.at(NaN), -1);
});
test('previous/next cue works before, after and between timed cues', () => {
  const timeline = new CueTimeline([cue('a', 2, 4), cue('b', 8, 10, 1)]);
  assert.equal(timeline.adjacent(0, 1), 0);
  assert.equal(timeline.adjacent(3, 1), 1);
  assert.equal(timeline.adjacent(5, -1), 0);
  assert.equal(timeline.adjacent(5, 1), 1);
  assert.equal(timeline.adjacent(20, -1), 1);
  assert.equal(new CueTimeline([]).adjacent(1, 1), -1);
});
test('exact matching is forward-only across multiple cues', async () => {
  const result = await matchCues(normalizeText('前書き。これは最初。これは次です。'), [
    cue('これは最初'),
    cue('これは次です')
  ]);
  assert.deepEqual(result, [
    { start: 3, end: 8, score: 1 },
    { start: 8, end: 14, score: 1 }
  ]);
});
test('unmatched cues do not move the cursor past a later match', async () => {
  const result = await matchCues('beginningafterwards', [
    cue('not present'),
    cue('beginning'),
    cue('afterwards')
  ]);
  assert.equal(result[0], undefined);
  assert.equal(result[1].start, 0);
  assert.equal(result[2].start, 9);
});
test('short ambiguous captions cannot anchor to random distant text', async () => {
  assert.equal((await matchCues('xはいx', [cue('はい')]))[0], undefined);
  assert.equal((await matchCues('はいxはい', [cue('はい')], { start: 0 }))[0], undefined);
  assert.deepEqual((await matchCues('はいx', [cue('はい')], { start: 0 }))[0], {
    start: 0,
    end: 2,
    score: 1
  });
});
test('bounded search requires a start hint beyond the forward-search limit', async () => {
  const text = 'x'.repeat(25_000) + 'startofchapter';
  assert.equal((await matchCues(text, [cue('startofchapter')]))[0], undefined);
  assert.equal(
    (await matchCues(text, [cue('startofchapter')], { start: 25_000 }))[0].start,
    25_000
  );
});
test('approximate matching is opt-in and labels a successful guess', async () => {
  const target = 'abcdefghijklmnopqrstuvwxy';
  const text = 'abcdefghijklmnopqrstuvwxz';
  assert.equal((await matchCues(text, [cue(target)]))[0], undefined);
  const match = (await matchCues(text, [cue(target)], { approximate: true }))[0];
  assert.ok(match && match.score > 0.9 && match.score < 1);
});
test('aborted work does not publish final progress or return results', async () => {
  const controller = new AbortController();
  controller.abort();
  let progress = false;
  await assert.rejects(
    matchCues('hello', [cue('hello')], {
      signal: controller.signal,
      onProgress: () => {
        progress = true;
      }
    }),
    { name: 'AbortError' }
  );
  assert.equal(progress, false);
});
test('matching yields and supports cancellation partway through a long cue list', async () => {
  const controller = new AbortController();
  const promise = matchCues(
    'abcdef'.repeat(500),
    Array.from({ length: 500 }, () => cue('abcdef')),
    { signal: controller.signal, onProgress: () => controller.abort() }
  );
  await assert.rejects(promise, { name: 'AbortError' });
});
test('session validation rejects corrupt, non-finite and oversized persisted values', () => {
  for (const value of [
    {},
    { ...emptySession(), rate: NaN },
    { ...emptySession(), delay: Infinity },
    { ...emptySession(), rate: 20 },
    { ...emptySession(), audio: { name: 'a', size: -1, lastModified: 0 } }
  ])
    assert.throws(() => validateSession(value));
});
test('session validation copies nested data and does not retain extra fields', () => {
  const original = {
    ...emptySession(),
    audio: { name: 'a', size: 100, lastModified: 1 },
    bogus: 'not persisted'
  };
  const copy = validateSession(original);
  original.audio.name = 'changed';
  assert.equal(copy.audio.name, 'a');
  assert.equal(copy.bogus, undefined);
});
test('book identity separates equal titles and JSON escape collisions', () => {
  assert.notEqual(sessionKey(1, 'same'), sessionKey(2, 'same'));
  assert.notEqual(sessionKey(1, '2,a'), sessionKey(12, 'a'));
});
test('storage unavailable is reported without an unhandled rejected queue', async () => {
  const store = new AudiobookSessionStore(undefined);
  await assert.rejects(store.load('book'), /unavailable/);
  await assert.rejects(store.save('book', emptySession()), /unavailable/);
  await assert.rejects(store.remove('book'), /unavailable/);
  await store.close();
  await assert.rejects(store.save('book', emptySession()), /closed/);
});

function openFailureFactory(kind) {
  return {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.error = new DOMException(
          kind,
          kind === 'blocked' ? 'InvalidStateError' : 'UnknownError'
        );
        request[kind === 'blocked' ? 'onblocked' : 'onerror']?.();
      });
      return request;
    }
  };
}
test('IndexedDB open errors and blocked upgrades reject with actionable recoverable errors', async () => {
  await assert.rejects(
    new AudiobookSessionStore(openFailureFactory('error')).load('book'),
    /error|open audiobook storage/i
  );
  await assert.rejects(
    new AudiobookSessionStore(openFailureFactory('blocked')).load('book'),
    /blocked by another tab/i
  );
});

class FakeAudio extends EventTarget {
  constructor() {
    super();
    this.currentTime = 0;
    this.duration = 120;
    this.paused = true;
    this.seeking = false;
    this.playbackRate = 1;
    this.style = {};
    this.attributes = {};
    this.src = '';
    this.loads = 0;
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  removeAttribute(key) {
    delete this.attributes[key];
    if (key === 'src') this.src = '';
  }
  fire(type) {
    this.dispatchEvent(new Event(type));
  }
  load() {
    this.loads += 1;
  }
  pause() {
    this.paused = true;
    this.fire('pause');
  }
  play() {
    if (this.rejectPlay) return Promise.reject(new Error('NotAllowedError'));
    this.paused = false;
    this.fire('play');
    return this.playPromise ?? Promise.resolve();
  }
}
function harness() {
  const audios = [],
    revoked = [],
    frames = new Map(),
    states = [],
    attached = [];
  let serial = 0;
  const player = new LocalAudioPlayer(
    {
      createAudio: () => {
        const audio = new FakeAudio();
        audios.push(audio);
        return audio;
      },
      createURL: () => `blob:local/${serial++}`,
      revokeURL: (url) => revoked.push(url),
      attach: (audio) => attached.push(audio),
      requestFrame: (fn) => {
        const id = serial++;
        frames.set(id, fn);
        return id;
      },
      cancelFrame: (id) => frames.delete(id)
    },
    (state) => states.push(state)
  );
  const file = (name = 'book.mp3', size = 100, lastModified = 1) => ({ name, size, lastModified });
  return { player, audios, revoked, frames, states, attached, file };
}
test('audio loads as a local object URL without reading entire file contents', () => {
  const h = harness();
  h.player.load(h.file());
  assert.equal(h.audios[0].src, 'blob:local/0');
  assert.equal(h.audios[0].preload, 'metadata');
  assert.equal(h.audios[0].controls, true);
  assert.equal(h.player.snapshot.ready, false);
});
test('matching audio metadata identity resumes only after metadata is ready', () => {
  const h = harness(),
    file = h.file();
  h.player.load(file, { identity: audioIdentity(file), position: 37 });
  assert.equal(h.audios[0].currentTime, 0);
  assert.equal(h.player.snapshot.time, 37);
  h.audios[0].fire('loadedmetadata');
  assert.equal(h.audios[0].currentTime, 37);
  assert.equal(h.player.snapshot.ready, true);
});
test('a different local file starts at zero rather than inheriting old resume', () => {
  const h = harness();
  h.player.load(h.file('different.mp3'), { identity: audioIdentity(h.file()), position: 37 });
  h.audios[0].fire('loadedmetadata');
  assert.equal(h.audios[0].currentTime, 0);
});
test('resume is clamped to duration and a deliberate early seek overrides it', () => {
  const h = harness(),
    file = h.file();
  h.player.load(file, { identity: audioIdentity(file), position: 300 });
  h.audios[0].fire('loadedmetadata');
  assert.equal(h.audios[0].currentTime, 120);
  h.player.load(file, { identity: audioIdentity(file), position: 37 });
  h.player.seek(9);
  h.audios[1].fire('loadedmetadata');
  assert.equal(h.audios[1].currentTime, 9);
});
test('replacing an audio file detaches listeners, pauses and revokes the old URL', async () => {
  const h = harness();
  h.player.load(h.file());
  await h.player.play();
  const old = h.audios[0];
  h.player.load(h.file('next.mp3'));
  assert.equal(old.paused, true);
  assert.equal(old.src, '');
  assert.equal(old.loads, 2);
  assert.deepEqual(h.revoked, ['blob:local/0']);
  const count = h.states.length;
  old.fire('loadedmetadata');
  old.fire('timeupdate');
  old.fire('error');
  assert.equal(h.states.length, count);
});
test('stale play rejection cannot overwrite the new file state', async () => {
  const h = harness();
  let reject;
  h.player.load(h.file());
  h.audios[0].playPromise = new Promise((_, r) => {
    reject = r;
  });
  const playing = h.player.play();
  h.player.load(h.file('new.mp3'));
  reject(new Error('old failure'));
  await playing;
  assert.equal(h.player.snapshot.error, undefined);
  assert.equal(h.player.snapshot.file.name, 'new.mp3');
});
test('play denial becomes a visible error, not an unhandled rejection', async () => {
  const h = harness();
  h.player.load(h.file());
  h.audios[0].rejectPlay = true;
  await h.player.play();
  assert.match(h.player.snapshot.error, /Playback was not allowed/);
});
test('seek and rate controls clamp invalid/out-of-range input', () => {
  const h = harness();
  h.player.load(h.file());
  h.audios[0].fire('loadedmetadata');
  h.player.seek(-5);
  assert.equal(h.audios[0].currentTime, 0);
  h.player.seek(1000);
  assert.equal(h.audios[0].currentTime, 120);
  h.player.seek(NaN);
  assert.equal(h.audios[0].currentTime, 120);
  h.player.setRate(0);
  assert.equal(h.player.snapshot.rate, 0.5);
  h.player.setRate(Infinity);
  assert.equal(h.player.snapshot.rate, 1);
});
test('cue looping returns to the exact start and native seeking out stops the loop', async () => {
  const h = harness();
  h.player.load(h.file());
  h.audios[0].fire('loadedmetadata');
  h.player.setLoop(10, 12);
  await h.player.play();
  assert.equal(h.frames.size, 1);
  h.audios[0].currentTime = 12.2;
  h.audios[0].fire('timeupdate');
  assert.equal(h.audios[0].currentTime, 10);
  h.audios[0].currentTime = 30;
  h.audios[0].fire('seeking');
  assert.equal(h.player.snapshot.loop, undefined);
});
test('invalid and fully out-of-duration loops are not installed', () => {
  const h = harness();
  h.player.load(h.file());
  h.audios[0].fire('loadedmetadata');
  for (const bounds of [
    [3, 2],
    [-10, -1],
    [121, 123],
    [NaN, 1]
  ]) {
    h.player.setLoop(...bounds);
    assert.equal(h.player.snapshot.loop, undefined);
  }
});
test('paused media does not run a frame loop; pause cancels the active loop frame', async () => {
  const h = harness();
  h.player.load(h.file());
  h.audios[0].fire('loadedmetadata');
  h.player.setLoop(0, 1);
  assert.equal(h.frames.size, 0);
  await h.player.play();
  assert.equal(h.frames.size, 1);
  h.player.pause();
  assert.equal(h.frames.size, 0);
});
test('dispose is idempotent and suppresses every later callback', async () => {
  const h = harness();
  h.player.load(h.file());
  h.audios[0].fire('loadedmetadata');
  h.player.setLoop(0, 1);
  await h.player.play();
  h.player.dispose();
  const count = h.states.length;
  h.player.dispose();
  h.player.load(h.file());
  h.player.setRate(2);
  h.audios[0].fire('timeupdate');
  assert.equal(h.states.length, count);
  assert.equal(h.frames.size, 0);
  assert.equal(h.revoked.length, 1);
  assert.equal(h.audios.length, 1);
});
test('clear retires media, cancels looping, revokes its URL and preserves playback rate', async () => {
  const h = harness();
  h.player.setRate(1.5);
  h.player.load(h.file());
  h.audios[0].fire('loadedmetadata');
  h.player.setLoop(10, 12);
  await h.player.play();
  const old = h.audios[0];
  h.player.clear();
  assert.equal(old.paused, true);
  assert.equal(old.src, '');
  assert.equal(old.loads, 2);
  assert.deepEqual(h.revoked, ['blob:local/0']);
  assert.equal(h.attached.at(-1), undefined);
  assert.equal(h.frames.size, 0);
  assert.deepEqual(h.player.snapshot, {
    time: 0,
    duration: 0,
    ready: false,
    paused: true,
    rate: 1.5,
    file: undefined,
    loop: undefined
  });
  const count = h.states.length;
  old.fire('loadedmetadata');
  old.fire('timeupdate');
  assert.equal(h.states.length, count);
});

test('opening the panel or loading metadata cannot overwrite the existing resume point', () => {
  const { captureSession } = require(join(compiled, 'persistence.js'));
  const previous = {
    ...emptySession(),
    audio: { name: 'saved.mp3', size: 500, lastModified: 1 },
    position: 45
  };
  const idle = { time: 0, duration: 0, ready: false, paused: true, rate: 1 };
  assert.equal(captureSession(previous, idle, previous).position, 45);
  const loading = { ...idle, file: { name: 'new.mp3', size: 100, lastModified: 2 } };
  assert.deepEqual(captureSession(previous, loading, previous).audio, previous.audio);
  const loaded = { ...loading, ready: true };
  assert.equal(captureSession(previous, loaded, previous).position, 0);
  assert.equal(captureSession(previous, loaded, previous).audio.name, 'new.mp3');
});
test('closing the media preserves the captured latest checkpoint rather than a stale save', () => {
  const { captureSession } = require(join(compiled, 'persistence.js'));
  const previous = {
    ...emptySession(),
    audio: { name: 'saved.mp3', size: 500, lastModified: 1 },
    position: 45
  };
  const playing = {
    file: previous.audio,
    time: 48.5,
    duration: 300,
    ready: true,
    paused: false,
    rate: 1.25
  };
  const checkpoint = captureSession(previous, playing, previous);
  const closed = captureSession(
    previous,
    { ...playing, file: undefined, ready: false, time: 0 },
    checkpoint
  );
  assert.equal(closed.position, 48.5);
  assert.equal(closed.audio.name, 'saved.mp3');
});

// Deep-review regressions: these must fail against the original implementation.
test('pausing a pending play request does not report a playback failure', async () => {
  const h = harness();
  h.player.load(h.file());
  let reject;
  h.audios[0].playPromise = new Promise((_, fail) => {
    reject = fail;
  });
  const pending = h.player.play();
  h.player.pause();
  reject(new DOMException('interrupted by pause', 'AbortError'));
  await pending;
  assert.equal(h.player.snapshot.error, undefined);
  assert.equal(h.player.snapshot.paused, true);
});
test('an older play rejection cannot replace the result of a newer play on the same file', async () => {
  const h = harness();
  h.player.load(h.file());
  let reject;
  h.audios[0].playPromise = new Promise((_, fail) => {
    reject = fail;
  });
  const older = h.player.play();
  h.audios[0].playPromise = Promise.resolve();
  await h.player.play();
  reject(new Error('old denial'));
  await older;
  assert.equal(h.player.snapshot.error, undefined);
});
test('terminal media errors invalidate readiness and cannot be cleared by late play success', async () => {
  const h = harness();
  h.player.load(h.file());
  h.audios[0].fire('loadedmetadata');
  let resolve;
  h.audios[0].playPromise = new Promise((done) => {
    resolve = done;
  });
  const pending = h.player.play();
  h.audios[0].fire('error');
  assert.equal(h.player.snapshot.ready, false);
  const error = h.player.snapshot.error;
  resolve();
  await pending;
  assert.equal(h.player.snapshot.error, error);
  assert.equal(h.player.snapshot.paused, true);
  h.audios[0].fire('loadedmetadata');
  assert.equal(h.player.snapshot.ready, false);
});
test('metadata without a finite positive duration does not destroy a resume checkpoint', () => {
  const h = harness(),
    file = h.file();
  h.player.load(file, { identity: audioIdentity(file), position: 37 });
  h.audios[0].duration = Infinity;
  h.audios[0].fire('loadedmetadata');
  assert.equal(h.player.snapshot.ready, false);
  assert.equal(h.player.snapshot.time, 37);
  h.audios[0].duration = 120;
  h.audios[0].fire('durationchange');
  assert.equal(h.player.snapshot.ready, true);
  assert.equal(h.audios[0].currentTime, 37);
});
test('pending seek is reflected in the loading state and survives early timeupdate', () => {
  const h = harness();
  h.player.load(h.file());
  h.player.seek(15);
  h.audios[0].fire('timeupdate');
  assert.equal(h.player.snapshot.time, 15);
});
test('clearing a loop by native seeking cancels its scheduled frame immediately', async () => {
  const h = harness();
  h.player.load(h.file());
  h.audios[0].fire('loadedmetadata');
  h.player.setLoop(10, 12);
  await h.player.play();
  h.audios[0].currentTime = 20;
  h.audios[0].fire('seeking');
  assert.equal(h.frames.size, 0);
});
test('normalization uses context-independent case folding for split Greek text', () => {
  assert.equal(normalizeText('ΟΣ'), normalizeText('Ο') + normalizeText('Σ'));
  assert.equal(normalizeText('ος'), normalizeText('οσ'));
});
test('invalid matching offsets are rejected instead of publishing NaN ranges', async () => {
  await assert.rejects(matchCues('beginning', [cue('beginning')], { start: NaN }), /offset/);
  await assert.rejects(matchCues('beginning', [cue('beginning')], { start: 0.5 }), /offset/);
});
test('n-gram collisions are labeled approximate, never exact', async () => {
  // Identical bigram multiset, different text: ab ba ac ca ab ba ab ba / etc.
  const target = 'ababacaba',
    candidate = 'abacababa';
  assert.equal(getSimilarity(target, candidate), 1);
  const [match] = await matchCues(candidate, [cue(target)], { approximate: true });
  assert.ok(match);
  assert.equal(match.approximate, true);
});
test('near-equal distant approximate candidates stay ambiguous when a later one is slightly better', async () => {
  const target = Array.from({ length: 150 }, (_, i) => String.fromCharCode(0x4e00 + i)).join('');
  const first = target.slice(0, 70) + 'X' + target.slice(71);
  const second = target.slice(0, -1) + 'X';
  const scores = [getSimilarity(target, first), getSimilarity(target, second)];
  // A later, slightly better winner must not erase the earlier near-tie.
  assert.ok(scores[0] > 0.9 && scores[1] > scores[0] && scores[1] - scores[0] < 0.01);
  const [match] = await matchCues(first + 'qqqqq' + second, [cue(target)], { approximate: true });
  assert.equal(match, undefined);
});
test('VTT timing immediately after a missing header separator is rejected, not silently discarded', () => {
  assert.throws(
    () => parseSubtitles('WEBVTT\n00:01.000 --> 00:02.000\nlost\n\n00:03.000 --> 00:04.000\nkept'),
    /header|separator/i
  );
});
test('ruby fallback parentheses and pronunciation are removed from subtitle plain text', () => {
  assert.equal(cueText('<ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby>'), '漢字');
});
test('loading from a closed store cannot reopen a connection', async () => {
  const store = new AudiobookSessionStore(undefined);
  await store.close();
  await assert.rejects(store.load('book'), /closed/);
});

const { AudiobookSessionCoordinator } = require(join(compiled, 'session.js'));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function until(predicate) {
  for (let i = 0; i < 50; i += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail('asynchronous operation did not progress');
}
class SessionMemoryStore {
  constructor(value) {
    this.value = value;
    this.writes = [];
    this.log = [];
    this.closed = false;
  }
  async load() {
    return this.loadGate ? this.loadGate.promise : this.value;
  }
  async save(key, data) {
    assert.equal(this.closed, false);
    this.writes.push(structuredClone(data));
    this.log.push(`save:${data.position}`);
    if (this.writeGate) await this.writeGate.promise;
    this.value = structuredClone(data);
  }
  async remove() {
    assert.equal(this.closed, false);
    this.log.push('remove');
    if (this.removeGate) await this.removeGate.promise;
    this.value = undefined;
  }
  async close() {
    this.log.push('close');
    this.closed = true;
  }
}
const playbackAt = (time) => ({
  time,
  duration: 120,
  ready: true,
  paused: false,
  rate: 1,
  file: { name: 'book.mp3', size: 100, lastModified: 1 }
});
const draftSession = () => ({
  subtitleSource: '',
  subtitleName: '',
  delay: 0,
  follow: false,
  approximate: false
});
test('a failed restore blocks persistence while allowing in-memory playback checkpoints', async () => {
  const backing = new SessionMemoryStore();
  backing.load = async () => {
    throw new Error('temporary storage failure');
  };
  const session = new AudiobookSessionCoordinator(backing, 'book');
  await assert.rejects(session.restore(), /temporary storage/);
  const data = session.capture(draftSession(), playbackAt(42));
  await assert.rejects(session.persist(data), /protect unread/);
  assert.equal(session.snapshot.position, 42);
  assert.equal(backing.writes.length, 0);
  await session.close();
});
test('invalid saved subtitle content cannot grant permission to overwrite the record', async () => {
  const backing = new SessionMemoryStore({ ...emptySession(), subtitleSource: 'damaged source' });
  const session = new AudiobookSessionCoordinator(backing, 'book');
  await assert.rejects(session.restore(), /subtitle block/);
  await assert.rejects(session.persist(emptySession()), /protect unread/);
  assert.equal(backing.value.subtitleSource, 'damaged source');
  await session.close();
});
test('older storage acknowledgments cannot roll back a newer captured resume point', async () => {
  const backing = new SessionMemoryStore();
  const session = new AudiobookSessionCoordinator(backing, 'book');
  await session.restore();
  backing.writeGate = deferred();
  const save = session.persist(session.capture(draftSession(), playbackAt(12)));
  await until(() => backing.writes.length === 1);
  session.capture(draftSession(), playbackAt(28));
  backing.writeGate.resolve();
  await save;
  assert.equal(session.snapshot.position, 28);
  const closedMedia = { time: 0, duration: 0, ready: false, paused: true, rate: 1 };
  assert.equal(session.capture(draftSession(), closedMedia).position, 28);
  await session.close();
});
test('slow storage coalesces pending snapshots without mutating the active write', async () => {
  const backing = new SessionMemoryStore();
  const session = new AudiobookSessionCoordinator(backing, 'book');
  await session.restore();
  backing.writeGate = deferred();
  const first = session.persist(session.capture(draftSession(), playbackAt(1)));
  await until(() => backing.writes.length === 1);
  const second = session.persist(session.capture(draftSession(), playbackAt(2)));
  const latest = session.capture(draftSession(), playbackAt(3));
  const third = session.persist(latest);
  latest.position = 999;
  backing.writeGate.resolve();
  await Promise.all([first, second, third]);
  assert.deepEqual(
    backing.writes.map((data) => data.position),
    [1, 3]
  );
  assert.equal(session.snapshot.position, 3);
  await session.close();
});
test('a write queued from a save completion cannot get stranded between drain lifetimes', async () => {
  const backing = new SessionMemoryStore();
  const session = new AudiobookSessionCoordinator(backing, 'book');
  await session.restore();
  await session.persist(session.capture(draftSession(), playbackAt(1)));
  const next = session.persist(session.capture(draftSession(), playbackAt(2)));
  await until(() => backing.writes.length === 2);
  await next;
  assert.equal(backing.value.position, 2);
  await session.close();
});
test('failed writes do not poison the session write queue', async () => {
  const backing = new SessionMemoryStore();
  const session = new AudiobookSessionCoordinator(backing, 'book');
  await session.restore();
  backing.writeGate = deferred();
  const failure = assert.rejects(
    session.persist(session.capture(draftSession(), playbackAt(1))),
    /quota/
  );
  await until(() => backing.writes.length === 1);
  backing.writeGate.reject(new Error('quota'));
  await failure;
  backing.writeGate = undefined;
  await session.persist(session.capture(draftSession(), playbackAt(2)));
  assert.equal(backing.value.position, 2);
  await session.close();
});
test('reset waits for an in-flight save, discards pending saves, and deletes last', async () => {
  const backing = new SessionMemoryStore();
  const session = new AudiobookSessionCoordinator(backing, 'book');
  await session.restore();
  backing.writeGate = deferred();
  const first = session.persist(session.capture(draftSession(), playbackAt(1)));
  await until(() => backing.writes.length === 1);
  const dropped = assert.rejects(session.persist(session.capture(draftSession(), playbackAt(2))), {
    name: 'AbortError'
  });
  const removing = session.remove();
  backing.writeGate.resolve();
  await Promise.all([first, dropped, removing]);
  assert.deepEqual(backing.log, ['save:1', 'remove']);
  assert.equal(backing.value, undefined);
  assert.equal(session.snapshot.position, 0);
  await session.close();
});
test('close during reset still permits deletion before storage is closed', async () => {
  const backing = new SessionMemoryStore(emptySession());
  const session = new AudiobookSessionCoordinator(backing, 'book');
  await session.restore();
  const remove = session.remove();
  const close = session.close();
  await Promise.all([remove, close]);
  assert.deepEqual(backing.log, ['remove', 'close']);
  assert.equal(backing.value, undefined);
});
test('failed reset blocks future writes until a successful explicit retry', async () => {
  const backing = new SessionMemoryStore(emptySession());
  const session = new AudiobookSessionCoordinator(backing, 'book');
  await session.restore();
  backing.removeGate = deferred();
  const removing = assert.rejects(session.remove(), /reset failed/);
  backing.removeGate.reject(new Error('reset failed'));
  await removing;
  await assert.rejects(session.persist(emptySession()), /protect unread/);
  backing.removeGate = undefined;
  await session.remove();
  await session.persist(session.capture(draftSession(), playbackAt(10)));
  assert.equal(backing.value.position, 10);
  await session.close();
});
test('late restore completion cannot resurrect a reset checkpoint', async () => {
  const backing = new SessionMemoryStore();
  backing.loadGate = deferred();
  const session = new AudiobookSessionCoordinator(backing, 'book');
  const restoring = session.restore();
  await session.remove();
  backing.loadGate.resolve({ ...emptySession(), position: 99 });
  assert.equal(await restoring, undefined);
  assert.equal(session.snapshot.position, 0);
  await session.close();
});
test('close flushes pending snapshots and rejects later captures and writes', async () => {
  const backing = new SessionMemoryStore();
  const session = new AudiobookSessionCoordinator(backing, 'book');
  await session.restore();
  const write = session.persist(session.capture(draftSession(), playbackAt(17)));
  await session.close();
  await write;
  assert.equal(backing.value.position, 17);
  await assert.rejects(session.persist(emptySession()), /closed/);
  assert.throws(() => session.capture(draftSession(), playbackAt(20)), /closed/);
});
test('an IndexedDB property getter denial is an asynchronous recoverable storage error', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    get: () => {
      throw new DOMException('restricted', 'SecurityError');
    }
  });
  try {
    const store = new AudiobookSessionStore();
    await assert.rejects(store.load('book'), /unavailable/);
    await store.close();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'indexedDB', previous);
    else delete globalThis.indexedDB;
  }
});
test('saved playback speed survives the media load algorithm resetting to defaultPlaybackRate', () => {
  const h = harness();
  h.player.setRate(1.5);
  h.player.load(h.file());
  assert.equal(h.audios[0].defaultPlaybackRate, 1.5);
});
test('canceled old loop frames cannot touch a new file lifetime', async () => {
  const h = harness();
  h.player.load(h.file());
  h.audios[0].fire('loadedmetadata');
  h.player.setLoop(10, 12);
  await h.player.play();
  const oldFrame = [...h.frames.values()][0];
  h.player.load(h.file('new.mp3'));
  h.audios[1].fire('loadedmetadata');
  h.player.setLoop(20, 22);
  await h.player.play();
  const stateCount = h.states.length,
    frameCount = h.frames.size;
  oldFrame(100);
  assert.equal(h.states.length, stateCount);
  assert.equal(h.frames.size, frameCount);
  h.player.dispose();
});
test('a delayed ended event cannot restart a loop after the user presses Pause', async () => {
  const h = harness();
  h.player.load(h.file());
  h.audios[0].fire('loadedmetadata');
  h.player.setLoop(118, 120);
  await h.player.play();
  h.player.pause();
  h.audios[0].ended = true;
  h.audios[0].currentTime = 120;
  h.audios[0].fire('ended');
  assert.equal(h.audios[0].paused, true);
  assert.equal(h.audios[0].currentTime, 120);
  h.player.dispose();
});
test('a natural media end still restarts an active requested loop', async () => {
  const h = harness();
  h.player.load(h.file());
  h.audios[0].fire('loadedmetadata');
  h.player.setLoop(118, 120);
  await h.player.play();
  h.audios[0].currentTime = 120;
  h.audios[0].ended = true;
  h.audios[0].pause();
  h.audios[0].fire('ended');
  assert.equal(h.audios[0].currentTime, 118);
  assert.equal(h.audios[0].paused, false);
  h.player.dispose();
});
test('cue playback bounds reject out-of-recording captions and clip partial overlaps', () => {
  const { cueAudioBounds } = require(join(compiled, 'subtitles.js'));
  assert.equal(cueAudioBounds(cue('before', 1, 2), -3, 100), undefined);
  assert.equal(cueAudioBounds(cue('after', 101, 102), 0, 100), undefined);
  assert.deepEqual(cueAudioBounds(cue('partial', 1, 5), -3, 100), { start: 0, end: 2 });
  assert.deepEqual(cueAudioBounds(cue('tail', 98, 103), 0, 100), { start: 98, end: 100 });
  assert.equal(cueAudioBounds(cue('none', 1, 2), NaN, 100), undefined);
});
test('aborting from final progress also prevents returning match results', async () => {
  const controller = new AbortController();
  await assert.rejects(
    matchCues('firstpassage', [cue('first passage')], {
      signal: controller.signal,
      onProgress: () => controller.abort()
    }),
    { name: 'AbortError' }
  );
});

// Review 3 regressions: these run against the previous draft as well.
test('VTT accepts several blank separator lines without losing or misreading a cue', () => {
  const source =
    'WEBVTT\n\n\nfirst\n00:01.000 --> 00:02.000\nFirst passage\n\n \n\t\nsecond\n00:03.000 --> 00:04.000\nSecond passage';
  assert.deepEqual(
    parseSubtitles(source).map((item) => item.text),
    ['First passage', 'Second passage']
  );
});
test('SRT accepts repeated whitespace-only separators while preserving cue line breaks', () => {
  const source =
    '1\r\n00:00:01,000 --> 00:00:02,000\r\nFirst\r\nline\r\n\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nSecond';
  assert.deepEqual(
    parseSubtitles(source).map((item) => item.text),
    ['First\nline', 'Second']
  );
});

const { ReaderNavigationSession, navigateBookmark } = require(join(compiled, 'navigation.js'));
function navigationHarness() {
  const pending = [],
    highlights = [],
    errors = [];
  let cancels = 0;
  const session = new ReaderNavigationSession(
    {
      show: () => {
        const task = deferred();
        pending.push(task);
        return task.promise;
      },
      cancel: () => {
        cancels++;
      }
    },
    { highlight: (range) => highlights.push(range), error: (message) => errors.push(message) }
  );
  return {
    session,
    pending,
    highlights,
    errors,
    get cancels() {
      return cancels;
    }
  };
}
test('cancel retires a resolved navigation promise before its UI continuation runs', async () => {
  const h = navigationHarness();
  const task = h.session.show({}, {});
  h.pending[0].resolve({ passage: 'retired' });
  h.session.cancel();
  await task;
  assert.deepEqual(h.highlights, []);
});
test('a newer navigation owns the highlight even if old work completes later', async () => {
  const h = navigationHarness();
  const old = h.session.show({}, {});
  const recent = h.session.show({}, {});
  h.pending[1].resolve({ passage: 'current' });
  await recent;
  h.pending[0].resolve({ passage: 'stale' });
  await old;
  assert.deepEqual(h.highlights, [{ passage: 'current' }]);
});
test('a retired navigation error cannot replace the current UI status', async () => {
  const h = navigationHarness();
  const old = h.session.show({}, {});
  const recent = h.session.show({}, {});
  h.pending[1].resolve({ passage: 'current' });
  h.pending[0].reject(new Error('stale timeout'));
  await Promise.all([old, recent]);
  assert.deepEqual(h.errors, []);
});
test('current navigation failures are reported once without unhandled rejections', async () => {
  const h = navigationHarness();
  const task = h.session.show({}, {});
  h.pending[0].reject(new Error('reader is not ready'));
  await task;
  assert.deepEqual(h.errors, ['reader is not ready']);
});
test('cue gaps cancel automatic navigation without allowing a late highlight', async () => {
  const h = navigationHarness();
  h.session.cueChanged(0);
  const task = h.session.show({}, {}, true);
  const cancels = h.cancels;
  h.session.cueChanged(-1);
  assert.equal(h.cancels, cancels + 1);
  h.pending[0].resolve({ passage: 'finished cue' });
  await task;
  assert.deepEqual(h.highlights, []);
});
test('an unmatched successor cue supersedes the previous automatic request', async () => {
  const h = navigationHarness();
  h.session.cueChanged(0);
  const task = h.session.show({}, {}, true);
  h.session.cueChanged(1);
  h.pending[0].resolve({ passage: 'old matched cue' });
  await task;
  assert.deepEqual(h.highlights, []);
});
test('chapter rendering of the same cue does not cancel its navigation waiter', async () => {
  const h = navigationHarness();
  h.session.cueChanged(7);
  const task = h.session.show({}, {}, true);
  const cancels = h.cancels;
  h.session.cueChanged(7);
  assert.equal(h.cancels, cancels);
  h.pending[0].resolve({ passage: 'newly rendered chapter' });
  await task;
  assert.deepEqual(h.highlights, [{ passage: 'newly rendered chapter' }]);
});
test('Pause cancels automatic requests but preserves explicit Show in book', async () => {
  const h = navigationHarness();
  const auto = h.session.show({}, {}, true);
  h.session.cancelAutomatic();
  h.pending[0].resolve({ passage: 'automatic' });
  await auto;
  const manual = h.session.show({}, {});
  h.session.cancelAutomatic();
  h.session.cueChanged(3);
  h.pending[1].resolve({ passage: 'manual' });
  await manual;
  assert.deepEqual(h.highlights, [{ passage: 'manual' }]);
});
test('a disposed navigation session cannot publish or start more work', async () => {
  const h = navigationHarness();
  const pending = h.session.show({}, {});
  h.session.dispose();
  h.pending[0].reject(new Error('retired'));
  await pending;
  await h.session.show({}, {});
  assert.deepEqual(h.errors, []);
  assert.equal(h.pending.length, 1);
});
test('failed bookmark scrolls are not presented as successful navigation', () => {
  const snapshot = { position: 10 };
  const manager = { formatBookmarkDataByRange: () => snapshot, scrollToBookmark: () => false };
  assert.equal(navigateBookmark(manager, 1, {}), false);
  manager.scrollToBookmark = () => true;
  assert.equal(navigateBookmark(manager, 1, {}), true);
  manager.scrollToBookmark = () => undefined;
  assert.equal(navigateBookmark(manager, 1, {}), true);
  manager.formatBookmarkDataByRange = () => undefined;
  assert.equal(navigateBookmark(manager, 1, {}), false);
  assert.equal(navigateBookmark(undefined, 1, {}), false);
});

const { TransactionFactory } = require('./idb-test-double.cjs');
test('two tab stores cannot overwrite a newer committed checkpoint from a stale restore', async () => {
  const factory = new TransactionFactory();
  const a = new AudiobookSessionStore(factory),
    b = new AudiobookSessionStore(factory);
  await a.load('same-book');
  await b.load('same-book');
  await b.save('same-book', { ...emptySession(), position: 77 });
  await assert.rejects(a.save('same-book', { ...emptySession(), position: 12 }), /another tab/);
  assert.equal((await b.load('same-book')).position, 77);
  await Promise.all([a.close(), b.close()]);
});
test('a stale tab cannot recreate captions removed by a second tab', async () => {
  const factory = new TransactionFactory();
  const a = new AudiobookSessionStore(factory),
    b = new AudiobookSessionStore(factory);
  const data = { ...emptySession(), subtitleSource: '00:01.000 --> 00:02.000\nSaved captions' };
  await a.save('same-book', data);
  await b.load('same-book');
  await b.remove('same-book');
  await assert.rejects(a.save('same-book', data), /another tab/);
  assert.equal(await b.load('same-book'), undefined);
  await Promise.all([a.close(), b.close()]);
});
test('concurrent first saves have one owner instead of silently overwriting each other', async () => {
  const factory = new TransactionFactory();
  const a = new AudiobookSessionStore(factory),
    b = new AudiobookSessionStore(factory);
  await Promise.all([a.load('same-book'), b.load('same-book')]);
  const results = await Promise.allSettled([
    a.save('same-book', { ...emptySession(), position: 1 }),
    b.save('same-book', { ...emptySession(), position: 2 })
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
  await Promise.all([a.close(), b.close()]);
});
test('a direct store write cannot overwrite a record it has never restored', async () => {
  const factory = new TransactionFactory();
  const a = new AudiobookSessionStore(factory),
    b = new AudiobookSessionStore(factory);
  await a.save('same-book', { ...emptySession(), position: 99 });
  await assert.rejects(b.save('same-book', emptySession()), /restor|unread/);
  assert.equal((await a.load('same-book')).position, 99);
  await Promise.all([a.close(), b.close()]);
});

// Transaction semantics use the declared double; native IndexedDB tests are
// separate and must run before merging. None of these claim engine validation.
test('a commit abort preserves the last acknowledged revision and permits retry', async () => {
  const factory = new TransactionFactory(),
    store = new AudiobookSessionStore(factory);
  try {
    await store.load('book');
    await store.save('book', { ...emptySession(), position: 1 });
    const revision = factory.values.get('book').storageRevision;
    factory.failNextCommit = new DOMException('Storage full', 'QuotaExceededError');
    await assert.rejects(store.save('book', { ...emptySession(), position: 2 }), /Storage full/);
    assert.equal(factory.values.get('book').position, 1);
    assert.equal(factory.values.get('book').storageRevision, revision);
    await store.save('book', { ...emptySession(), position: 3 });
    assert.equal((await store.load('book')).position, 3);
  } finally {
    await store.close();
  }
});
test('a read transaction abort rejects the load and permits a later retry', async () => {
  const factory = new TransactionFactory(),
    store = new AudiobookSessionStore(factory);
  try {
    factory.failNextAbort = new DOMException('Connection lost', 'AbortError');
    await assert.rejects(store.load('book'), /Connection lost/);
    await store.save('book', { ...emptySession(), position: 6 });
    assert.equal((await store.load('book')).position, 6);
  } finally {
    await store.close();
  }
});
test('legacy v1 sessions are adopted after restore and acquire cross-tab protection', async () => {
  const factory = new TransactionFactory();
  const legacy = { ...emptySession(), position: 18 };
  factory.values.set('legacy', legacy);
  const a = new AudiobookSessionStore(factory),
    b = new AudiobookSessionStore(factory);
  try {
    assert.deepEqual(await a.load('legacy'), validateSession(legacy));
    await b.load('legacy');
    await a.save('legacy', { ...legacy, position: 19 });
    await assert.rejects(b.save('legacy', { ...legacy, position: 20 }), /another tab/);
    assert.equal((await a.load('legacy')).position, 19);
    assert.match(factory.values.get('legacy').storageRevision, /^[0-9a-f]{32}$/);
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
});
test('reset retains only an opaque revision marker, never captions or audio identity', async () => {
  const factory = new TransactionFactory(),
    store = new AudiobookSessionStore(factory);
  try {
    await store.save('book', {
      ...emptySession(),
      subtitleSource: 'private captions',
      audio: { name: 'private.mp3', size: 1, lastModified: 1 },
      position: 42
    });
    const revision = factory.values.get('book').storageRevision;
    await store.remove('book');
    const marker = factory.values.get('book');
    assert.deepEqual(Object.keys(marker).sort(), ['storageRevision', 'tombstone']);
    assert.equal(marker.tombstone, true);
    assert.notEqual(marker.storageRevision, revision);
    assert.equal(await store.load('book'), undefined);
    await store.save('book', { ...emptySession(), position: 2 });
    assert.equal((await store.load('book')).position, 2);
  } finally {
    await store.close();
  }
});
test('different books do not conflict across connections', async () => {
  const factory = new TransactionFactory();
  const a = new AudiobookSessionStore(factory),
    b = new AudiobookSessionStore(factory);
  try {
    await Promise.all([
      a.save('one', { ...emptySession(), position: 1 }),
      b.save('two', { ...emptySession(), position: 2 })
    ]);
    assert.equal((await b.load('one')).position, 1);
    assert.equal((await a.load('two')).position, 2);
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
});
test('corrupt revision metadata is not overwritten by autosave but explicit reset recovers', async () => {
  const factory = new TransactionFactory(),
    store = new AudiobookSessionStore(factory);
  const bad = { ...emptySession(), storageRevision: 17, position: 93 };
  factory.values.set('book', bad);
  try {
    await assert.rejects(store.load('book'), /revision/);
    await assert.rejects(store.save('book', emptySession()), /revision/);
    assert.deepEqual(factory.values.get('book'), bad);
    await store.remove('book');
    assert.equal(await store.load('book'), undefined);
    await store.save('book', { ...emptySession(), position: 4 });
    assert.equal((await store.load('book')).position, 4);
  } finally {
    await store.close();
  }
});
test('revision generation does not depend on secure-context-only randomUUID', async () => {
  const factory = new TransactionFactory(),
    store = new AudiobookSessionStore(factory);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const crypto = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues: (bytes) => crypto.getRandomValues(bytes) }
  });
  try {
    await store.save('book', emptySession());
    assert.match(factory.values.get('book').storageRevision, /^[0-9a-f]{32}$/);
  } finally {
    Object.defineProperty(globalThis, 'crypto', descriptor);
    await store.close();
  }
});
test('missing random generation reports an error without modifying data', async () => {
  const factory = new TransactionFactory(),
    store = new AudiobookSessionStore(factory);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
  try {
    await assert.rejects(store.save('book', emptySession()), /Secure random/);
    assert.equal(factory.values.size, 0);
  } finally {
    Object.defineProperty(globalThis, 'crypto', descriptor);
    await store.close();
  }
});
test('conflict rejects coalesced writes and blocks retries until an explicit reset', async () => {
  const { AudiobookStorageConflictError } = require(join(compiled, 'persistence.js'));
  const gate = deferred();
  let writes = 0,
    removals = 0;
  const storage = {
    load: async () => undefined,
    close: async () => {},
    remove: async () => {
      removals++;
    },
    save: async () => {
      writes++;
      if (writes === 1) await gate.promise;
    }
  };
  const coordinator = new AudiobookSessionCoordinator(storage, 'book');
  await coordinator.restore();
  const first = coordinator.persist(emptySession());
  const firstRejected = assert.rejects(first, /another tab/);
  await Promise.resolve();
  const pending = coordinator.persist({ ...emptySession(), position: 2 });
  const pendingRejected = assert.rejects(pending, /another tab/);
  gate.reject(new AudiobookStorageConflictError());
  await Promise.all([firstRejected, pendingRejected]);
  assert.equal(writes, 1);
  await assert.rejects(coordinator.persist(emptySession()), /another tab/);
  assert.equal(writes, 1);
  await coordinator.remove();
  await coordinator.persist({ ...emptySession(), position: 3 });
  assert.equal(removals, 1);
  assert.equal(writes, 2);
  await coordinator.close();
});
