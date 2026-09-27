# Progressive local MOSS transcription

## Scope

This change is stacked on video PR #46 at
`819f49b4193a8c203756c5f407fe624a90a952fd`. It keeps the immutable Mudler Q5_0
weights and CPU-first local architecture. It does not add another ASR model,
forced alignment, a server, global speaker identities, or microphone streaming.

There are two independent improvements: accepted window results become readable
before the whole file completes, and the recognizer forwards provisional output
while decoding each window. Neither is a claim that inference is faster than real
time. Encoding and decoder prefill still precede the first output callback.

## Scheduling and seam policy

New jobs use version 2 and `pause-overlap-v2`. The first input is deliberately
12 seconds; it advances the durable core to 10 seconds, while whole cues crossing
the final two-second stability margin remain provisional for the next window. After
that, ordinary inputs include both halos inside a 480,000-sample / 30-second limit.
Integer-sample boundaries prevent an accidental extra encoder chunk. There are two
seconds of context on each side where available. Saved `pause-overlap-v1` jobs keep
their original 30-second first input rather than being reinterpreted on resume. Near the nominal
boundary, the planner searches backwards for a sustained low-energy valley. This
is a boundary heuristic, not speech detection: quiet audio is never removed,
concatenated, or classified as absent. Only exact all-zero PCM skips recognition.

A rolling eight-second PCM cache reuses overlap and lookahead without decoding the
whole recording first. Buffers sent to the worker may be transferred; cached
samples have independent ownership. The decoder must return the requested sample
extent, with at most one trailing rounding sample that is trimmed before inference.

The assembler retains a settled prefix and a whole-cue unsettled suffix. It joins
adjacent hypotheses jointly, using local suffix/prefix text agreement and temporal
bounds. It allows one-to-many cue segmentation, normalizes only a matching copy,
preserves numbers and negation, and keeps verbatim text, real segment timestamps,
window-local speakers and accepted IDs. It never uses global text deduplication,
independent midpoint decisions, or invented word timing.

Ambiguous seams checkpoint both hypotheses before one repair attempt. A repair
covers the adjacent inputs and any earlier held utterance, but never exceeds two
encoder blocks. When accepted text overlaps that input, a unique whole-cue anchor
must connect the replacement suffix to accepted content. An oversized or still
ambiguous repair fails explicitly; accepted captions and both original boundary
hypotheses remain recoverable. Resume retries that seam rather than earlier work.
An oversized held utterance is not automatically solvable by another identical
retry: resolving it requires a reviewed larger-context/different-policy path.

This is deliberately conservative, not a proof of recognition quality. Real
Japanese, overlapping speakers and timestamps can disagree in ways the policy
cannot resolve. Longer-context quality and repair frequency must be measured.

## Checkpoints and migration

Version-one jobs retain their original 60-second cores and two-second halos. No
existing `nextWindow` is reinterpreted with the new planner. Version-two records
persist actual chosen boundaries, policy identity, accepted cues, unsettled cues,
and any unresolved pair. Validation checks sequential coverage, source intervals,
repair bounds, unique cue identities and accepted/unsettled separation.

The output callback port is `manabi-web-v5`, on the same pinned C++ and ggml
revisions and the same weight digest. Both runtime variants must be rebuilt. Reader #46's v4 runtime already contains
the Wasm-SIMD and partial-encoder performance patch; v5 stacks the output callback
on that exact work and must not relabel v4 bytes as v5. Partially completed v3 or
v4 jobs keep their durable window policy when resumed and record ordered mixed
runtime provenance. A completed old-runtime checkpoint awaiting only publication
keeps its original provenance without re-inference.

Publication still atomically checks and commits the caption pages, manifest and
completed job. The comparison now includes the job version and complete
progressive state, not just cue text. Cancellation, lease/owner fencing, account
partitions, batch ownership and awaited runtime retirement remain in force.

## Player and output callback

The player derives incomplete local tracks from durable jobs. These are not
caption manifests and are not synced. Accepted lines can be selected and studied;
provisional lines are labeled, inert text and never exported or checkpointed as
accepted content. Completion enables export only when the final published track
arrives. Pausing or failing later work does not erase the accepted prefix.

A local-only draft selection restores after reopening without downloading or
starting MOSS. It cannot override a newer explicit selection or revive a closed
player. Draft IDs and their delays are excluded from portable playback state until
publication. Their local-only classification survives temporarily missing job
snapshots; a previously published track remains portable when pages are temporarily
unavailable. Local draft-choice writes coalesce and are drained by Close alongside
portable playback. Appending accepted cues preserves the current line-pause session.

The C++ callback uses the existing tokenizer and reports a bounded full-prefix
snapshot every eight generated tokens and at EOS. The worker handles split UTF-8
without replacement characters, parses only structurally complete preview cues,
and removes its callback after success or failure. Requests are identity-fenced;
partial output cannot resolve the final inference promise. The existing native
EOS and token-budget failure guards still determine successful completion.

MOSS normally emits `[start][Sxx]text[end]`, but an upstream issue documents valid
timestamped text with every speaker tag omitted. The parser accepts that consistent
whole-window variant as speaker-unknown so text is not discarded merely because
diarization failed. It still rejects mixed tagged/untagged grammar, malformed tails,
and unusable timestamps; bracketed numbers inside transcript text remain protected.

## Verification and remaining gates

The implementation's local evidence includes strict media TypeScript/Node tests,
Python/native helper tests, production-player/workspace Chromium tests and generated
media. The transaction layer, native model computation and provider boundaries are
explicit doubles where noted in the test reports. The native output patch test
compiles a scripted C++ decoder; it is not a full MOSS or Emscripten build.

The opt-in real-ASR harness now records `partialUpdates`, `firstOutputSeconds`, and
`firstPreviewCueSeconds`, relative to inference start. It rejects missing callbacks
or invalid timing evidence. `prepareSeconds` remains separate. This harness change
has not been run against the v5 WASM/model here.

Before merge, rebuild and qualify both v5 runtimes, run the repository-pinned
formatter/ESLint/Svelte/build and exact-head CI, and exercise real-model output,
cancellation and resume. Benchmark current legacy windows against the new profile;
compare unique covered media seconds, encoder and decoder time, time to first
preview and settled output, peak/steady memory and repair rate. Natural Japanese,
quiet speech, repeated replies, numbers, music, speaker overlaps and deliberately
seam-crossing utterances are required. Desktop/mobile and physical Safari/iOS,
native multi-tab/IndexedDB and live cloud/account composition remain separate gates.

PR #46's exact-head v4 CPU qualification run `36280725560` reports roughly
33.8–34.85 seconds threaded (about 3.14x realtime) and 61.96–63.38 seconds
single-threaded (about 5.7x realtime) for roughly 11 seconds of generated audio.
That large base-v4 improvement motivates the short first input, but it is not v5 or
representative-device qualification and inference is still slower than realtime on
that CI host. The base closeout
also identifies production packaging/serving of both WASM variants as unresolved.
This patch does not repair that deployment pipeline. It makes no new real-time
factor, accuracy, or device-memory claim.

Seek-priority/out-of-order filling, a two-block normal scheduling profile, true
microphone streaming and a neural VAD remain outside this change.

## References

- Pinned encoder padding:
  https://github.com/localai-org/moss-transcribe.cpp/blob/190a569c13b4b247450f2fb3b2a431244e84833e/src/audio_encoder.cpp
- Upstream windowed realtime proposal (not copied as a proven stitcher):
  https://github.com/OpenMOSS/MOSS-Transcribe-Diarize/pull/58
- MOSS speaker-tag omission report:
  https://github.com/OpenMOSS/MOSS-Transcribe-Diarize/issues/40
- Whisper-Streaming's agreement approach:
  https://arxiv.org/abs/2307.14743
- Emscripten C++/JavaScript callbacks:
  https://emscripten.org/docs/api_reference/emscripten.h.html

## Adversarial refinement

See `moss-progressive-review.md` for the subsequent numeric/lexical seam fixes,
repetition and speaker-turn checks, final-prefix/preview ownership repairs, delayed
draft restoration regression, and corrected single-cue streaming evidence gate.
That report distinguishes newly executed tests from real-model/device qualification.
