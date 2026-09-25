import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { discoverEmbedded } from '../../.cache/media-test-build/embedded.js';
import { localSource } from '../../.cache/media-test-build/sources.js';
import { readVint, assCaption } from '../../.cache/media-test-build/matroska.js';
const text = (s) => new TextEncoder().encode(s),
  join = (...parts) => new Uint8Array(Buffer.concat(parts.map((p) => Buffer.from(p))));
function unsigned(n) {
  let hex = BigInt(n).toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}
function size(n) {
  for (let width = 1; width <= 8; width++)
    if (BigInt(n) < (1n << BigInt(width * 7)) - 1n) {
      const out = new Uint8Array(width);
      let value = BigInt(n);
      for (let i = width - 1; i >= 0; i--) {
        out[i] = Number(value & 255n);
        value >>= 8n;
      }
      out[0] |= 1 << (8 - width);
      return out;
    }
  throw Error('size too large');
}
const el = (id, payload, unknown = false) =>
  join(unsigned(id), unknown ? new Uint8Array([255]) : size(payload.length), payload);
const u = (id, n) => el(id, unsigned(n));
const block = (value = 'こんにちは。', ticks = 500, flags = 0) =>
  el(0xa1, join(new Uint8Array([0x81, (ticks >> 8) & 255, ticks & 255, flags]), text(value)));
function cluster({
  value = 'こんにちは。',
  ticks = 500,
  duration = 1500,
  unknown = false,
  simple = false,
  time = 0,
  lateTime = false,
  flags = 0
} = {}) {
  const frame = simple
    ? el(0xa3, join(new Uint8Array([0x81, (ticks >> 8) & 255, ticks & 255, flags]), text(value)))
    : el(
        0xa0,
        join(
          block(value, ticks, flags),
          duration === undefined ? new Uint8Array() : u(0x9b, duration)
        )
      );
  return el(
    0x1f43b675,
    lateTime ? join(frame, u(0xe7, time)) : join(u(0xe7, time), frame),
    unknown
  );
}
function mkv({
  codec = 'S_TEXT/UTF8',
  language = 'jpn',
  ietf,
  forced = false,
  defaultDuration = 0,
  codecDelay = 0,
  compressed = false,
  clusters = [cluster()],
  extraTracks = new Uint8Array(),
  unknown = false
} = {}) {
  const entry = el(
    0xae,
    join(
      u(0xd7, 1),
      u(0x83, 17),
      el(0x86, text(codec)),
      el(0x22b59c, text(language)),
      ietf ? el(0x22b59d, text(ietf)) : new Uint8Array(),
      u(0x55aa, +forced),
      u(0x23e383, defaultDuration),
      u(0x56aa, codecDelay),
      compressed ? el(0x6d80, new Uint8Array()) : new Uint8Array()
    )
  );
  return join(
    el(0x1a45dfa3, el(0x4282, text('matroska'))),
    el(
      0x18538067,
      join(
        el(0x1549a966, u(0x2ad7b1, 1000000)),
        el(0x1654ae6b, join(entry, extraTracks)),
        ...clusters
      ),
      unknown
    )
  );
}
const discover = (bytes) =>
  discoverEmbedded(localSource(new File([bytes], 'movie.mkv')), new AbortController().signal);
test('Matroska UTF-8 uses BlockDuration, language and forced metadata', async () => {
  const r = await discover(mkv({ forced: true }));
  assert.equal(r.state, 'complete', r.warnings.join(';'));
  assert.equal(r.tracks[0].language, 'ja');
  assert.equal(r.tracks[0].forced, true);
  assert.deepEqual(
    r.tracks[0].cues.map(({ start, end, text }) => ({ start, end, text })),
    [{ start: 0.5, end: 2, text: 'こんにちは。' }]
  );
});
test('Matroska IETF language takes precedence over legacy language', async () => {
  const r = await discover(mkv({ language: 'eng', ietf: 'ja-JP' }));
  assert.equal(r.tracks[0].language, 'ja-JP');
});
test('Matroska unknown Segment/Cluster lengths stop at the next top-level element', async () => {
  const r = await discover(
    mkv({
      unknown: true,
      clusters: [cluster({ unknown: true }), cluster({ time: 5000, value: '二行目' })]
    })
  );
  assert.equal(r.state, 'complete', r.warnings.join(';'));
  assert.equal(r.tracks[0].cues.length, 2);
  assert.equal(r.tracks[0].cues[1].start, 5.5);
});
test('Matroska accepts a cluster timestamp after the subtitle block', async () => {
  const r = await discover(mkv({ clusters: [cluster({ lateTime: true, time: 1000 })] }));
  assert.equal(r.tracks[0].cues[0].start, 1.5);
});
test('Matroska SimpleBlock requires an explicit track default duration', async () => {
  const r = await discover(
    mkv({ defaultDuration: 2000000000, clusters: [cluster({ simple: true })] })
  );
  assert.equal(r.tracks[0].cues[0].end, 2.5);
  const bad = await discover(mkv({ clusters: [cluster({ simple: true })] }));
  assert.equal(bad.state, 'unsupported');
  assert.equal(bad.tracks.length, 0);
});
test('Matroska negative relative timestamps and codec delay retain original timeline', async () => {
  const r = await discover(
    mkv({ codecDelay: 100000000, clusters: [cluster({ time: 1000, ticks: -200 })] })
  );
  assert.equal(r.tracks[0].cues[0].start, 0.7);
});
test('Matroska lacing rejects the entire subtitle track, not just a bad final cue', async () => {
  const r = await discover(mkv({ clusters: [cluster(), cluster({ time: 5000, flags: 2 })] }));
  assert.equal(r.state, 'unsupported');
  assert.equal(r.tracks.length, 0);
});
test('Matroska encrypted/compressed subtitle data is never interpreted as plain UTF-8', async () => {
  const r = await discover(mkv({ compressed: true }));
  assert.equal(r.state, 'unsupported');
  assert.equal(r.tracks.length, 0);
});
test('Matroska bitmap subtitle presence is not mislabeled as absent', async () => {
  const r = await discover(mkv({ codec: 'S_HDMV/PGS' }));
  assert.equal(r.state, 'unsupported');
  assert.match(r.warnings[0], /PGS/);
});
test('duplicate Matroska track IDs reject ambiguous track ownership', async () => {
  const r = await discover(mkv({ extraTracks: el(0xae, join(u(0xd7, 1), u(0x83, 1))) }));
  assert.equal(r.state, 'unsupported');
  assert.equal(r.tracks.length, 0);
});
test('Matroska truncated element bounds fail closed', async () => {
  const bytes = mkv();
  const r = await discover(bytes.slice(0, -3));
  assert.equal(r.state, 'unsupported');
  assert.equal(r.tracks.length, 0);
});
test('invalid/overflow EBML integers are rejected without precision loss', () => {
  for (const b of [
    new Uint8Array([0]),
    new Uint8Array([0x40]),
    new Uint8Array([1, 128, 0, 0, 0, 0, 0, 0])
  ])
    assert.throws(() => readVint(b));
  assert.equal(readVint(new Uint8Array([255])).unknown, true);
  assert.equal(readVint(new Uint8Array([0x81])).value, 1);
});
test('Matroska cancellation is cancellation, not a no-subtitles result', async () => {
  const c = new AbortController();
  c.abort();
  await assert.rejects(discoverEmbedded(localSource(new File([mkv()], 'x.mkv')), c.signal), {
    name: 'AbortError'
  });
});
test('ASS dialogue retains commas, line breaks, and text after drawing commands', () => {
  assert.equal(
    assCaption('0,0,Default,,0,0,0,,{\\b1}Hello, world!\\NNext line.'),
    'Hello, world!\nNext line.'
  );
  assert.equal(assCaption('0,0,Default,,0,0,0,,{\\p1}m 0 0 l 20 20{\\p0}こんにちは'), 'こんにちは');
  assert.throws(() => assCaption('incomplete'));
});
for (const name of ['embedded.mkv', 'embedded-ass.mkv'])
  test(
    `real ffmpeg-generated ${name} extracts multi-sentence captions`,
    { skip: !process.env.MEDIA_FIXTURE },
    async () => {
      const r = await discoverEmbedded(
        localSource(new File([readFileSync(process.env.MEDIA_FIXTURE + '/' + name)], name)),
        new AbortController().signal
      );
      assert.equal(r.state, 'complete', r.warnings.join(';'));
      assert.equal(r.tracks[0].cues.length, 3);
      assert.match(r.tracks[0].cues[1].text, /reading a book/);
      if (name === 'embedded.mkv') {
        assert.equal(r.tracks.length, 2);
        assert.equal(r.tracks[1].language, 'es');
        assert.equal(r.tracks[1].forced, true);
        assert.equal(r.tracks[1].cues.length, 2);
      } else assert.match(r.warnings[0], /plain text/);
    }
  );
