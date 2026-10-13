# Progressive local MOSS transcription

## Scope

This change is stacked on video PR #46 at
`b1040f917f1af16ba7fd5b7cfbdcbf02a103197a`. It keeps the immutable Mudler Q5_0
weights and CPU-first local architecture. It does not add another ASR model,
forced alignment, a server, global speaker identities, or microphone streaming.

There are two independent improvements: accepted window results become readable
before the whole file completes, and the recognizer forwards provisional output
while decoding each window. Neither is a claim that inference is faster than real
time. Encoding and decoder prefill still precede the first output callback.

## Scheduling and seam policy

Sequential and bulk jobs use version 2 and `pause-overlap-v2`. The first input is deliberately
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
hypotheses remain recoverable. Resume retries an ordinary bounded seam rather than
earlier work. An oversized held utterance is not automatically solvable by another
identical retry: resolving it requires a reviewed larger-context/different-policy path.
That condition is derived from durable seam state, so the queue rejects an identical
Resume and the UI does not advertise it as retryable; accepted lines remain available.

This is deliberately conservative, not a proof of recognition quality. Real
Japanese, overlapping speakers and timestamps can disagree in ways the policy
cannot resolve. Longer-context quality and repair frequency must be measured.

## Checkpoints and migration

Version-one jobs retain their original 60-second cores and two-second halos. No
existing `nextWindow` is reinterpreted with the new planner. Version-two records
persist actual chosen boundaries, policy identity, accepted cues, unsettled cues,
and any unresolved pair. Validation checks sequential coverage, source intervals,
repair bounds, unique cue identities and accepted/unsettled separation.

The output callback port is `manabi-web-v7`, on the same pinned C++ and ggml
revisions and the same weight digest. Both runtime variants must be rebuilt. Reader #46's v6 runtime already contains
the Wasm-SIMD, partial-encoder and Q5_0 loop performance patches; v7 stacks the output callback
on that exact v6 performance work and must not relabel v6 bytes as v7. Partially completed v3 or
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
has not been run against the v7 WASM/model here.

Before merge, rebuild and qualify both v7 runtimes, run the repository-pinned
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
That large base-v4 improvement motivates the short first input, but it is not v7 or
representative-device qualification and inference is still slower than realtime on
that CI host. The base closeout
also identifies production packaging/serving of both WASM variants as unresolved.
This patch does not repair that deployment pipeline. It makes no new real-time
factor, accuracy, or device-memory claim.

True microphone streaming and a neural VAD remain outside this change.

## Playback-first sparse jobs

An explicit Generate action in the player now creates a version-3
`overlap-sparse-v2` job. Its 26-second cores and two-second halos bound normal
MOSS inputs to 30 seconds. The current playhead selects the next missing core;
seeks change that priority after the current inference finishes. Each completed
core is checkpointed once and reused in the same job as the queue fills the
remainder of the video. A viewer who watches through the video does not trigger
a second full transcription pass. Bulk jobs and saved v1/v2 jobs retain their
original sequential policy and can resume without reinterpretation.

Draft captions use whole cues away from unresolved seams. Once neighboring
windows agree, their boundary cues can appear too. A completed track is
published only after every core is covered and the whole-cue hypotheses join.
An ambiguous seam is repaired with a bounded union input; overlapping repairs
that exceed the model budget fail with the original hypotheses preserved.
Repair now runs as soon as both neighboring windows are available, before
unrelated later video windows. The draft defers the newly completed window's
interior while that seam is ambiguous. A repair must retain any earlier accepted
cue at matching text and timing; otherwise the job fails with its saved
hypotheses instead of silently rewriting an accepted caption. An empty repair
cannot erase speech recognized in the original windows. A successful repaired
pair uses the full repaired cues for playback and final publication, preserving
the identities and timing of matched accepted cues.
Completed version-3 jobs are compacted after atomic track publication, so
routine queue reads do not reload the complete window hypotheses.

### Durable digital-silence evidence

Normal sparse windows persist optional `digitalSilence: true` only when every
sample of the bounded model PCM equals zero. This uses `sparseModelPcm`'s exact
input after its permitted extra rounding sample has been removed, before worker
transfer can detach the buffer. Signed zero qualifies; any nonzero sample,
including quiet speech or low-level noise, continues through MOSS. An ordinary
empty recognition result does not establish silence.

For `overlap-sparse-v2`, a verified-zero neighbor may refute a one-sided cue only
when the whole cue lies inside that zero input. Crossing cues stay whole and
unresolved. Filtering applies to a derived reconciliation copy; the original
window hypotheses remain saved. Display, readiness, accepted-prefix derivation,
and publication share that reconciliation. Legacy `overlap-sparse-v1` jobs retain
their historical acceptance semantics, and older windows lacking the optional
field remain unknown. Validation rejects non-`true` evidence and a silent window
containing speech.

An input superseded by either adjacent seam repair cannot refute cues on the
repair's outer seam. Repairs remain the authority for their own hypotheses;
silence evidence neither filters their cues nor relaxes the prohibition on an
empty repair replacing recognized speech. Existing accepted-cue preservation,
account scoping, lease checks and atomic publication remain in force.

This evidence is part of the device-only job checkpoint, survives validation and
resume, and is compacted with the other source hypotheses after publication. It
does not add a portable caption field, sync record type or backup/restore format.
Restored unfinished jobs, wherever supported, must retain the optional field;
absence must never be inferred as silence or synthesized from empty captions.

The focused integration is derived from PR #215 at
`c5e016ab423731f0bdaae73909dd9f86fa91b496`, against main
`a1101b66db4c194140aeb4a8d6edcdfc86b4c770`. The donor's player/ETA changes are
deferred for coordination with the pitch owner; this integration leaves timing
sampling and shared audio adapters unchanged. Video Learning remains default-off
(`EXPO_PUBLIC_ENABLE_VIDEO_LEARNING` requires explicit `true`). This feature is
not a v3-hotfix release blocker.

**Integration verification: UNRUN (2026-10-13).** Regression sources in
`tests/media/sparse-transcription.test.mjs` cover covered and crossing cues in both
directions, unknown/malformed/contradictory saved evidence, legacy v1, repair
precedence and empty-repair rejection, immutable source/accepted cues, one-inference
completion, and checkpoint/restart/compaction using transaction and engine doubles.
The restart case includes a tiny nonzero sample, signed zero, buffer detachment,
and a discarded decoder rounding sample. No tests, builds, lint, type checks,
package installs, model execution, browser QA, benchmarks or CI dispatch were run
for this integration. Historical qualification elsewhere in this document does
not qualify these new changes.

### Playback estimates

The player measures decode plus warm inference time for each finished core,
excluding first-time model download/preparation, and estimates how
long it will take to build a 26-second caption lead. The estimate is updated
as more windows finish; before the first window it says that it is estimating.
If inference takes longer than one core of playback, the UI says captions may
need to buffer again. Viewers can wait or choose **Play without captions**.
This is a rolling estimate, not a promise of sustained real-time transcription.

Playback begins as soon as the browser can play the source. Authored sidecars
and embedded subtitles are shown in memory while full content hashing runs.
They are saved and bound to the portable content identity only after the full
hash verifies. A fresh local file can begin generation while that hash runs:
its windows are saved under a random device-only job identity, and no generated
track or SRT is published until the full hash binds the job to the verified
content identity. A cloud source still waits for full verification before
generation. Temporary subtitle IDs never enter portable playback state.

Switching videos keeps a requested local hash running and preserves its saved
windows. A failed digest can be retried while the workspace still holds the
same File source, including after switching videos; the saved windows then
publish without repeating inference. Each saved sparse window also carries a
digest of the exact decoded audio passed to MOSS. If the tab closes before the
full-file digest is attached, reselecting a file with the same device sample
re-decodes every saved window and compares these digests. Only matching jobs
receive the new verified content identity; accepted windows remain intact and
unfinished windows continue without repeating ASR. A mismatch leaves the old
job unpublished. Older provisional jobs without audio proofs cannot use this
recovery path.

Version-3 scheduling, early seam repair, accepted-cue preservation, and the
browser controls have deterministic and Chromium tests. Natural Japanese
boundary quality, real-WASM throughput, device memory, and suspended-tab
recovery have not yet been qualified for this new policy.

One targeted real-WASM Japanese check now covers the sparse seam. The pinned
single-thread v7 runtime and Q5_0 model processed a 35.68-second sequence made
from the two FLEURS `ja_jp` dev speakers reading the same sentence with 0.4
seconds of digital silence between them. The verified archive SHA-256 is
`2547f19203e1272aeba99c2235326fea525d6cfb9348bafbea2c3a7929e8e441`;
the recreated PCM WAV SHA-256 is
`7b6e5fcc8e6645a01bfa75b40ec162bb93519adba67c059e48ea8106e7b02e39`.
Sparse processing made two normal windows and one bounded seam repair. Its
complete text had 4 edits in 122 normalized reference characters (3.28% CER),
the same error rate as the earlier v2 check on these speakers. The first sparse
window already yielded two safely accepted cues. This is one read-speech seam
case, not a broad quality or performance result; the Mac was under load.

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

Exact digital silence is also allowed to invalidate only an unsettled prior cue fully covered by the zero-valued input; crossing cues are preserved whole.

Preview decoding is best-effort and never throws through the native WASM callback. A malformed preview disables preview for that inference; final output remains authoritative.
