# Encoded-video transcription qualification

Review base: `f81294115a3c501c9a5cddde378c31ef92879bd1`.

## Gap addressed

The packaged-runtime gate recognized directly parsed PCM WAV data. Separate
MediaPipeline tests supplied decoded AudioBuffers. Neither composed the actual
Mediabunny adapter, encoded file, WebCodecs/Web Audio, real MOSS and durable sparse
queue in one acceptance test.

The new encoded gate imports the actual repository adapter bundled with the
lockfile-pinned Mediabunny dependency. It runs the committed runtime bytes, not a
rebuild. The model, native ABI, window policies and acceptance rules are unchanged.

## Test scope

A verified Japanese synthetic speech fixture is placed at offsets 0 and 30 seconds,
then encoded as a 48 kHz stereo Opus/WebM video. The sequence is explicitly
artificial and does not qualify continuous natural dialogue. Its source and encoded
hashes, reference timing, encoder identity and resulting transcript are retained.

The single-threaded case uses the production local File/BlobSource path. The
threaded case uses production cloudSource/CustomSource/streamedRange with actual
HTTP 206 responses and strict user/version/range headers from a loopback fixture
server. That server is not a live account/provider integration.

Before recognition, independently decoding a nonzero audio interval must agree
with the corresponding interval of a larger decode. FFprobe reads the encoded
stream's actual time base; one global comparison displacement of at most one
declared tick (hard-capped at 1 ms) is permitted. Correlation must remain >= 0.98
and relative RMS error < 0.1 over the complete interval and each third, excluding
50 ms resampler edges. Production audio and caption timestamps are never shifted.
Decoder readiness must not prepare or run the model.

The first run incorrectly demanded sample-exact timing from a millisecond WebM
clock and failed before model preparation in both source modes. The diagnostic
follow-up found a constant -16 samples at 16 kHz (exactly 1 ms) with correlation
0.99999 after that offset, in every sampled region. Independently seeking the
pinned decoder establishes a new first-packet timestamp and then accumulates
sample durations, so this test must respect container precision. This is a
correction to the test, not a production decoder fix or permission to hide packet
loss. Fifteen waveform tests reject a displacement beyond the measured tick,
region-dependent drift, missing packets, gain changes and absent/coarse clocks;
comparison never mutates either audio buffer. Two Python cases validate measured
clock extraction. The original failed diagnostics are retained.

The actual queue is cancelled after its first accepted window. No complete track
or export is allowed. Closing and reopening real IndexedDB must preserve the
checkpoint. Resume must preserve that accepted prefix, not decode accepted ordinary
windows again, fill the remaining video and publish exactly one completed track.
Final subtitles must remain intact after another database reopen. Both cases use
the existing 0.35 normalized-CER qualification limit, with exact results retained.
Failures preserve diagnostics and remain failures; timing is not a pass criterion.

## Evidence boundary

The local source-subset run passes 692 Node tests and 91 Python tests, including
fifteen waveform cases and eleven fixture/range/qualification-validator tests. The local browser is blocked
from navigating to loopback origins, so the encoded browser and actual-model
result must be read from the published head's CI; no local native pass is claimed.
The workflow preserves its pre/post committed-runtime hash checks and records the
adapter bundle's dependency graph and hashes.

Safe frozen-owner takeover, physical Safari/iOS, continuous natural-Japanese and
long-video quality, representative-device throughput/memory and live-provider
composition are separate unresolved qualifications. No lock stealing, reduced
precision, relaxed acceptance or deployment is included.

Primary references:

- https://mediabunny.dev/api/AudioBufferSink
- https://mediabunny.dev/api/CustomSourceOptions
- https://esbuild.github.io/api/#bundle

- https://www.rfc-editor.org/rfc/rfc9559.html#section-11
- https://mediabunny.dev/api/InputTrack#gettimeresolution
