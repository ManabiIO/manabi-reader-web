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

// Deep-review reproductions: must fail against the original implementation.
test('late rejection from an earlier play attempt cannot poison a successful retry', async () => {
  const h = harness();
  h.player.load(h.file());
  let reject;
  h.audios[0].playPromise = new Promise((_, fail) => {
    reject = fail;
  });
  const first = h.player.play();
  h.audios[0].playPromise = Promise.resolve();
  await h.player.play();
  reject(new Error('old failure'));
  await first;
  assert.equal(h.player.snapshot.error, undefined);
});
test('deliberate pause suppresses rejection of its pending play promise', async () => {
  const h = harness();
  h.player.load(h.file());
  let reject;
  h.audios[0].playPromise = new Promise((_, fail) => {
    reject = fail;
  });
  const first = h.player.play();
  h.player.pause();
  reject(new Error('interrupted by pause'));
  await first;
  assert.equal(h.player.snapshot.error, undefined);
});
test('early native events do not erase a pending resume position', () => {
  const h = harness(),
    file = h.file();
  h.player.load(file, { identity: audioIdentity(file), position: 37 });
  h.audios[0].fire('timeupdate');
  assert.equal(h.player.snapshot.time, 37);
  h.player.seek(42);
  assert.equal(h.player.snapshot.time, 42);
});
test('unknown duration defers resume instead of clamping it to zero', () => {
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
test('checkpoint reads sample the live media clock, not the last timeupdate', () => {
  const h = harness();
  h.player.load(h.file());
  h.audios[0].fire('loadedmetadata');
  h.audios[0].currentTime = 17.2;
  assert.equal(h.player.snapshot.time, 17.2);
});
test('fatal decode failure disables ready-only actions and pauses media', async () => {
  const h = harness();
  h.player.load(h.file());
  h.audios[0].fire('loadedmetadata');
  await h.player.play();
  h.audios[0].fire('error');
  assert.equal(h.player.snapshot.ready, false);
  assert.equal(h.audios[0].paused, true);
  assert.equal(h.frames.size, 0);
});
test('storage cannot be reopened through load after close', async () => {
  const store = new AudiobookSessionStore(undefined);
  await store.close();
  await assert.rejects(store.load('book'), /closed/);
});
test('denied IndexedDB getter is reported asynchronously without breaking player construction', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    get() {
      throw new Error('access denied');
    }
  });
  try {
    let store;
    assert.doesNotThrow(() => {
      store = new AudiobookSessionStore();
    });
    await assert.rejects(store.load('book'), /denied|unavailable/);
    await store.close();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor);
    else delete globalThis.indexedDB;
  }
});
test('invalid matching start offsets are rejected instead of producing invalid ranges', async () => {
  for (const start of [NaN, Infinity, -Infinity, 0.5]) {
    await assert.rejects(matchCues('hello', [cue('hello')], { start }), /offset/);
  }
});
test('ruby fallback parentheses and common SRT font tags are not spoken text', () => {
  assert.equal(cueText('<ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby>'), '漢字');
  assert.equal(cueText('<font color="red">hello</font>'), 'hello');
});
