# Sparse transcription: coverage and durable recovery review

## Real conversation regression and version 2 acceptance policy (2026-09-27)

The actual sparse queue was exercised in Chromium with native IndexedDB, the
single-thread v7 WASM runtime, and the verified Q5_0 model on 42.77 seconds
assembled from 20 utterances in the public HTH casual Japanese conversation
preview (dataset revision `9fde6880623724b58f8b26e6ba9fb96f04e9c88f`, local WAV
SHA-256 `fc4933c54391f84145190cbd05530b7dd04ff7db40813291afcf08e93814fc26`).
The utterances were joined with 0.2-second digital pauses; this is a stress
sequence, not original continuous or overlapping dialogue.

Version 1 finished its two ordinary windows but failed the seam repair because
it had already accepted a disconnected right-side component. That window had
switched to Chinese characters for later Japanese speech. Its surviving partial
draft had 29 edits in 76 normalized reference characters (38.16% CER), and no
complete track was published. A direct full-input call on the same PCM/model
returned Japanese in that region with 17/76 edits (22.37% CER).

New jobs use `overlap-sparse-v2`: a disconnected seek-local component is still
shown in the device-only incomplete draft, but only the reconciled prefix from
time zero becomes immutable accepted captions. The UI says draft lines may
change; export remains limited to a complete published track. Saved version 1
jobs retain their original interpretation, and admission does not deduplicate
jobs across these policies. On the same real-model input, version 2 completed
with one repaired full track, unique cue IDs, and 17/76 edits. A scripted queue
regression checks that the earlier accepted cue keeps its identity while a
provisional later cue is replaced. These are quality observations, not speed
comparisons: the local system was loaded.

This policy can still fail safely if a repair disagrees with the accepted prefix,
or if adjacent seams need more than the bounded repair input. Broader natural
conversation and video audio, controlled device measurements, frozen-tab lock
recovery, physical Safari/iOS, production serving, and live provider behavior
remain release gates.

Reviewed the playback-first stack through `9cdc1510e24e54e4c5223445f6a9297471d3c156`,
retaining the concurrent early-repair, accepted-cue, and one-sided-halo safeguards.
The runtime remains `manabi-web-v7`; no C++/WASM, model weights, quantization,
source pins, or saved audio-window policy change in this follow-up.

## Reconciliation and readiness

Display, caption lead, pending repair, and final publication now derive from the
same reconciled components. A pair repair is one two-core hypothesis; its
superseded raw windows no longer decide the repair's outer boundaries. Matching
uses the actual overlapping cue extent rather than truncating it to 16 cues.
The existing conservative text/timing matcher and its workload bounds remain.

A successfully joined internal boundary exposes whole cues, including cues that
extend beyond the nominal two-second margin. An unresolved outer cue remains
whole and hidden; caption-ready time stops at its actual start (or begins after
its end), not at a nominal boundary that would play speech without its caption.
A long held leading cue also causes the missing predecessor to be prioritized.
Out-of-order window arrivals do not discard previously accepted interior cues.

The sparse PCM adapter enforces integer-sample input extents. It trims a decoder's
single extra rounding sample before inference, rejects missing samples rather
than inventing silence, and keeps ordinary inputs within 480000 samples. Duration
is captured before the worker transfers the buffer. A fractional final sample is
accepted for cue display without extending the reported lead past media duration.

## Recovery and compatibility

Seek priority is saved from the latest operation state at checkpoint time rather
than overwritten with the old stored target. Paused/failed progress consistently
uses covered seconds. A repair-only resume records the runtime actually used,
even when all ordinary windows were completed under an older compatible port.
Blocked repaired boundaries are detected before processing unrelated video, and
are not misleadingly advertised as identically resumable.

The raw saved hypotheses remain authoritative. Earlier derived cue caches are
upgraded only when every cue exactly matches a known historical projection or
unpublished assembly, including identity, text, timing, and speaker. Arbitrary
edited caches are rejected. Validation is non-mutating and the next checkpoint
persists the derived upgrade atomically. An old unpublished finalization that
incorrectly accepted a one-sided seam returns to repair with its hypotheses kept;
completed portable subtitle tracks are not rewritten. Version-1/2 window policies
are unchanged.

## Verification

- Fixture-enabled media TypeScript/Node suite: **545 passed, 0 failed, 0 skipped**.
- **12 new regression cases fail against the current pre-fix source** and pass
  with the refinement. Additional tests cover exact-cache migration, invalid
  caches, publication retries, and 40 deterministic window-arrival orders.
- Python/native-helper suite: **74 passed**. Native decoder helpers use scripted
  output, not the real model.
- Chromium production player controller: **76 passed**; workspace controller:
  **24 passed**. The workspace test now waits for actual media metadata separately
  from early subtitle parsing; those are independent asynchronous operations.
- The pinned Prettier 3.6.2 formats the changed text sources. Local TypeScript is
  5.8.3; repository CI remains responsible for its pinned full toolchain/build.

A new five-case native IndexedDB/Chromium runner is wired into the media workflow
for cache reopening, failed/committed migration transactions, actual transcript
DOM, and caption buffering. Local browser access to the localhost harness was
blocked by the environment; no local pass is claimed for that runner. Exact-head
CI results are recorded separately on the PR. Local controller tests use explicit
storage/recognition doubles, not the Svelte shell or native IndexedDB.

## Research and remaining release gates

[OpenMOSS's experimental realtime PR](https://github.com/OpenMOSS/MOSS-Transcribe-Diarize/pull/58)
uses repeated inference and stitching, not a model-native streaming guarantee.
[Whisper-Streaming](https://github.com/ufal/whisper_streaming) distinguishes agreed
and provisional output and evaluates segment-based trimming. These support the
separation of recognized audio, accepted text, and safe playback lead; neither
establishes an optimal MOSS window size or makes Whisper attention alignment
portable to this runtime.
[Emscripten's pthread documentation](https://emscripten.org/docs/porting/pthreads.html)
also distinguishes threaded builds and browser lifecycle constraints. Scripted
queue correctness is not representative device performance evidence.

Keep this PR draft. No fresh real-model quality or performance claim is made in
this follow-up. Broader natural Japanese dialogue/seam testing, physical Safari/iOS,
controlled throughput/memory measurements, suspended-tab recovery, production
serving, and live account/provider integration remain release gates. The existing
bounded policy still fails closed on unresolved overlapping/oversized repairs;
this change does not invent word timestamps or silently discard speech to finish.
